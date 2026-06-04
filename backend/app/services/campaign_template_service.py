"""Campaign template serialization/deserialization service."""
import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.sql import func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.campaign import Campaign, CampaignMember
from app.models.monster_instance import MonsterInstance
from app.models.item import Item
from app.models.shop import Shop
from app.models.shop_inventory import ShopInventory
from app.models.chest import Chest
from app.models.chest_inventory import ChestInventory
from app.models.module_maps import ModuleMaps
from app.models.module_note import ModuleNote
from app.models.map_settings import MapSettings
from app.models.map_marker import MapMarker
from app.models.fog_of_war import FogOfWar
from app.models.drawing import Drawing
from app.models.ruler import Ruler
from app.models.token import Token
from app.models.module_chat_session import ModuleChatSession
from app.models.module_chat import ModuleChatMessage
from app.models.resource_chat import ResourceChatMessage
from app.models.rules_chat import RulesChatMessage

logger = logging.getLogger(__name__)

TEMPLATE_FORMAT = "deepwood-campaign-template-v1"


def _row_to_dict(row, exclude: set = None) -> dict:
    """Convert a SQLAlchemy model instance to a plain dict."""
    exclude = exclude or set()
    d = {}
    for c in row.__table__.columns:
        if c.name not in exclude:
            val = getattr(row, c.name if c.name != "metadata" else "meta", None)
            d[c.name] = val
    return d


async def serialize_campaign_to_template(
    campaign_id: int, dm_user_id: str, db: AsyncSession
) -> Dict[str, Any]:
    """Serialize a campaign's resources into a JSON-serializable template dict."""
    # 1. Campaign basic info
    res = await db.execute(select(Campaign).where(Campaign.id == campaign_id))
    campaign = res.scalar_one_or_none()
    if not campaign:
        raise ValueError("Campaign not found")
    if campaign.dm_user_id != dm_user_id:
        raise PermissionError("Only the DM can save a campaign as template")

    skip = {"id", "created_at", "updated_at"}

    # 2. Monster instances
    res = await db.execute(
        select(MonsterInstance).where(MonsterInstance.campaign_id == campaign_id)
    )
    monsters = []
    for m in res.scalars().all():
        d = _row_to_dict(m, skip | {"campaign_id"})
        d["_template_id"] = m.id
        monsters.append(d)

    # 3. Items
    res = await db.execute(
        select(Item).where(Item.campaign_id == campaign_id)
    )
    items = []
    for item in res.scalars().all():
        d = _row_to_dict(item, skip | {"campaign_id"})
        d["_template_id"] = item.id
        items.append(d)

    # 4. Shops + inventory
    res = await db.execute(
        select(Shop).where(Shop.campaign_id == campaign_id)
    )
    shops = []
    for shop in res.scalars().all():
        d = _row_to_dict(shop, skip | {"campaign_id"})
        d["_template_id"] = shop.id
        inv_res = await db.execute(
            select(ShopInventory).where(ShopInventory.shop_id == shop.id)
        )
        d["inventory"] = [
            {"item_template_id": si.item_id, "quantity": si.quantity, "price_gp": si.price_gp}
            for si in inv_res.scalars().all()
        ]
        shops.append(d)

    # 5. Chests + inventory
    res = await db.execute(
        select(Chest).where(Chest.campaign_id == campaign_id)
    )
    chests = []
    for chest in res.scalars().all():
        d = _row_to_dict(chest, skip | {"campaign_id"})
        d["_template_id"] = chest.id
        inv_res = await db.execute(
            select(ChestInventory).where(ChestInventory.chest_id == chest.id)
        )
        d["inventory"] = [
            {"item_template_id": ci.item_id, "quantity": ci.quantity}
            for ci in inv_res.scalars().all()
        ]
        chests.append(d)

    # 6. Module maps
    res = await db.execute(
        select(ModuleMaps).where(ModuleMaps.campaign_id == campaign_id)
    )
    module_maps = [_row_to_dict(r, skip | {"campaign_id"}) for r in res.scalars().all()]

    # 7. Module notes (DM only)
    module_id = campaign.selected_module_id
    module_notes = []
    if module_id:
        res = await db.execute(
            select(ModuleNote).where(
                ModuleNote.module_id == module_id,
                ModuleNote.user_id == dm_user_id,
            )
        )
        module_notes = [_row_to_dict(r, skip) for r in res.scalars().all()]

    # 8. Map settings, markers, fog, drawings, rulers
    res = await db.execute(
        select(MapSettings).where(MapSettings.campaign_id == campaign_id)
    )
    map_settings = [_row_to_dict(r, skip | {"campaign_id"}) for r in res.scalars().all()]

    res = await db.execute(
        select(MapMarker).where(MapMarker.campaign_id == campaign_id)
    )
    map_markers = [_row_to_dict(r, skip | {"campaign_id"}) for r in res.scalars().all()]

    res = await db.execute(
        select(FogOfWar).where(FogOfWar.campaign_id == campaign_id)
    )
    fog_of_war = [_row_to_dict(r, skip | {"campaign_id"}) for r in res.scalars().all()]

    res = await db.execute(
        select(Drawing).where(Drawing.campaign_id == campaign_id)
    )
    drawings = [_row_to_dict(r, skip | {"campaign_id"}) for r in res.scalars().all()]

    res = await db.execute(
        select(Ruler).where(Ruler.campaign_id == campaign_id)
    )
    rulers = [_row_to_dict(r, skip | {"campaign_id"}) for r in res.scalars().all()]

    # 9. Tokens (exclude player character tokens)
    res = await db.execute(
        select(Token).where(
            Token.campaign_id == campaign_id,
            Token.character_id.is_(None),
        )
    )
    tokens = []
    for t in res.scalars().all():
        d = _row_to_dict(t, skip | {"campaign_id", "character_id"})
        tokens.append(d)

    # 10. Module chat sessions + messages
    chat_sessions = []
    if module_id:
        res = await db.execute(
            select(ModuleChatSession).where(
                ModuleChatSession.campaign_id == campaign_id,
                ModuleChatSession.user_id == dm_user_id,
            )
        )
        for sess in res.scalars().all():
            sd = _row_to_dict(sess, skip | {"campaign_id"})
            msg_res = await db.execute(
                select(ModuleChatMessage).where(
                    ModuleChatMessage.session_id == sess.id
                ).order_by(ModuleChatMessage.created_at)
            )
            sd["messages"] = [
                _row_to_dict(msg, {"id", "created_at"})
                for msg in msg_res.scalars().all()
            ]
            sd["_template_session_id"] = sess.id
            chat_sessions.append(sd)

    # 11. Resource chat
    res = await db.execute(
        select(ResourceChatMessage).where(
            ResourceChatMessage.campaign_id == campaign_id,
            ResourceChatMessage.user_id == dm_user_id,
        ).order_by(ResourceChatMessage.created_at)
    )
    resource_chat = [_row_to_dict(r, {"id", "created_at", "campaign_id"}) for r in res.scalars().all()]

    # 12. Rules chat
    res = await db.execute(
        select(RulesChatMessage).where(
            RulesChatMessage.campaign_id == campaign_id,
            RulesChatMessage.user_id == dm_user_id,
        ).order_by(RulesChatMessage.created_at)
    )
    rules_chat = [_row_to_dict(r, {"id", "created_at", "campaign_id"}) for r in res.scalars().all()]

    # 13. Module content (ParsedModule)
    module_export = None
    if module_id:
        from app.models.parsed_module import ParsedModule
        res = await db.execute(
            select(ParsedModule).where(ParsedModule.module_id == module_id)
        )
        pm = res.scalar_one_or_none()
        if pm:
            module_export = {
                "title": pm.title,
                "title_en": pm.title_en,
                "description": pm.description,
                "module_info": pm.module_info,
                "toc": pm.toc or [],
                "chapters": pm.chapters or [],
                "monsters": pm.monsters or [],
                "items": pm.items or [],
                "images": pm.images or [],
                "tables": pm.tables or [],
            }

    return {
        "format": TEMPLATE_FORMAT,
        "campaign": {
            "name": campaign.name,
            "description": campaign.description,
            "cover_image": campaign.cover_image,
            "current_map_url": campaign.current_map_url,
            "selected_module_id": campaign.selected_module_id,
            "meta": campaign.meta,
        },
        "monsters": monsters,
        "items": items,
        "shops": shops,
        "chests": chests,
        "module_maps": module_maps,
        "module_notes": module_notes,
        "map_settings": map_settings,
        "map_markers": map_markers,
        "fog_of_war": fog_of_war,
        "drawings": drawings,
        "rulers": rulers,
        "tokens": tokens,
        "chat_sessions": chat_sessions,
        "resource_chat": resource_chat,
        "rules_chat": rules_chat,
        "module": module_export,
    }


async def create_campaign_from_template(
    template_data: Dict[str, Any],
    dm_user_id: str,
    name: Optional[str],
    description: Optional[str],
    db: AsyncSession,
) -> Campaign:
    """Create a new campaign from template data, remapping all IDs."""
    tpl = template_data
    camp_info = tpl["campaign"]

    # 1. Create campaign
    campaign = Campaign(
        name=name or camp_info["name"],
        description=description if description is not None else camp_info.get("description"),
        dm_user_id=dm_user_id,
        cover_image=camp_info.get("cover_image"),
        current_map_url=camp_info.get("current_map_url"),
        selected_module_id=camp_info.get("selected_module_id"),
        meta=camp_info.get("meta") or {},
    )
    db.add(campaign)
    await db.flush()
    cid = campaign.id

    # 1.5 Module content → create ParsedModule copy
    module_data = tpl.get("module")
    if module_data:
        from app.models.parsed_module import ParsedModule
        import uuid
        new_module_id = str(uuid.uuid4())
        chapters = module_data.get("chapters", [])
        monsters_mod = module_data.get("monsters", [])
        items_mod = module_data.get("items", [])
        images = module_data.get("images", [])
        tables = module_data.get("tables", [])
        pm = ParsedModule(
            module_id=new_module_id,
            title=module_data.get("title", "Imported Module"),
            title_en=module_data.get("title_en", ""),
            description=module_data.get("description", ""),
            module_info=module_data.get("module_info"),
            toc=module_data.get("toc", []),
            chapters=chapters, monsters=monsters_mod, items=items_mod,
            images=images, tables=tables,
            chapters_count=len(chapters), monsters_count=len(monsters_mod),
            items_count=len(items_mod), images_count=len(images),
            tables_count=len(tables),
            created_by=dm_user_id,
            is_shared=False,
            original_module_id=camp_info.get("selected_module_id"),
            parsed_date=func.now(),
        )
        db.add(pm)
        await db.flush()
        campaign.selected_module_id = new_module_id

    # DM member
    db.add(CampaignMember(campaign_id=cid, user_id=dm_user_id, role="dm"))

    # ID maps: old_template_id -> new_id
    monster_map: Dict[int, int] = {}
    item_map: Dict[int, int] = {}
    shop_map: Dict[int, int] = {}
    chest_map: Dict[int, int] = {}

    # 2. Monsters
    for m in tpl.get("monsters", []):
        old_id = m.pop("_template_id", None)
        obj = MonsterInstance(campaign_id=cid, **m)
        db.add(obj)
        await db.flush()
        if old_id is not None:
            monster_map[old_id] = obj.id

    # 3. Items
    for it in tpl.get("items", []):
        old_id = it.pop("_template_id", None)
        obj = Item(campaign_id=cid, **it)
        db.add(obj)
        await db.flush()
        if old_id is not None:
            item_map[old_id] = obj.id

    # 4. Shops + inventory
    for s in tpl.get("shops", []):
        old_id = s.pop("_template_id", None)
        inv_data = s.pop("inventory", [])
        obj = Shop(campaign_id=cid, **s)
        db.add(obj)
        await db.flush()
        if old_id is not None:
            shop_map[old_id] = obj.id
        for si in inv_data:
            new_item_id = item_map.get(si["item_template_id"])
            if new_item_id:
                db.add(ShopInventory(
                    shop_id=obj.id, item_id=new_item_id,
                    quantity=si.get("quantity", 1), price_gp=si.get("price_gp", 0),
                ))

    # 5. Chests + inventory
    for c in tpl.get("chests", []):
        old_id = c.pop("_template_id", None)
        inv_data = c.pop("inventory", [])
        obj = Chest(campaign_id=cid, **c)
        db.add(obj)
        await db.flush()
        if old_id is not None:
            chest_map[old_id] = obj.id
        for ci in inv_data:
            new_item_id = item_map.get(ci["item_template_id"])
            if new_item_id:
                db.add(ChestInventory(
                    chest_id=obj.id, item_id=new_item_id,
                    quantity=ci.get("quantity", 1),
                ))

    # 6. Module maps
    for mm in tpl.get("module_maps", []):
        db.add(ModuleMaps(campaign_id=cid, **mm))

    # 7. Module notes (reassign to current DM, remap module_id)
    for mn in tpl.get("module_notes", []):
        mn.pop("user_id", None)
        if campaign.selected_module_id:
            mn["module_id"] = campaign.selected_module_id
        db.add(ModuleNote(user_id=dm_user_id, **mn))

    # 8. Map settings, markers, fog, drawings, rulers
    for ms in tpl.get("map_settings", []):
        db.add(MapSettings(campaign_id=cid, **ms))
    for mk in tpl.get("map_markers", []):
        db.add(MapMarker(campaign_id=cid, **mk))
    for fw in tpl.get("fog_of_war", []):
        db.add(FogOfWar(campaign_id=cid, **fw))
    for dr in tpl.get("drawings", []):
        db.add(Drawing(campaign_id=cid, **dr))
    for rl in tpl.get("rulers", []):
        db.add(Ruler(campaign_id=cid, **rl))

    # 9. Tokens (remap FKs)
    for t in tpl.get("tokens", []):
        t.pop("character_id", None)
        if t.get("monster_instance_id"):
            t["monster_instance_id"] = monster_map.get(t["monster_instance_id"])
        if t.get("shop_id"):
            t["shop_id"] = shop_map.get(t["shop_id"])
        if t.get("chest_id"):
            t["chest_id"] = chest_map.get(t["chest_id"])
        t["user_id"] = dm_user_id
        db.add(Token(campaign_id=cid, **t))

    # 10. Module chat sessions + messages
    module_id = campaign.selected_module_id
    for sess_data in tpl.get("chat_sessions", []):
        sess_data.pop("_template_session_id", None)
        messages = sess_data.pop("messages", [])
        sess_data.pop("user_id", None)
        sess_data.pop("module_id", None)
        sess = ModuleChatSession(
            module_id=module_id or sess_data.get("module_id", ""),
            user_id=dm_user_id, campaign_id=cid,
            **sess_data,
        )
        db.add(sess)
        await db.flush()
        for msg in messages:
            msg.pop("session_id", None)
            msg.pop("user_id", None)
            msg.pop("module_id", None)
            db.add(ModuleChatMessage(
                session_id=sess.id,
                user_id=dm_user_id,
                module_id=module_id or "",
                **msg,
            ))

    # 11. Resource chat
    for rc in tpl.get("resource_chat", []):
        rc.pop("user_id", None)
        db.add(ResourceChatMessage(campaign_id=cid, user_id=dm_user_id, **rc))

    # 12. Rules chat
    for rc in tpl.get("rules_chat", []):
        rc.pop("user_id", None)
        db.add(RulesChatMessage(campaign_id=cid, user_id=dm_user_id, **rc))

    await db.flush()
    return campaign
