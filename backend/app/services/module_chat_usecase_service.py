from __future__ import annotations

import asyncio
import random
from collections.abc import Awaitable, Callable, Mapping, Sequence
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.item import Item
from app.models.monster_instance import MonsterInstance
from app.models.shop import Shop
from app.models.shop_inventory import ShopInventory
from app.models.token import Token
from app.services.entity_creation_service import EntityCreationService
from app.services.module_avatar_generation_service import (
    generate_module_monster_avatar_background,
    generate_module_shop_avatar_background,
)
from app.services.module_entity_service import (
    create_item_from_data,
    derive_npc_avatar_appearance,
    match_monster_from_module,
    match_preset_monster_by_name,
    search_module_item,
    split_combined_shop_items,
)
from app.services.realtime_publisher import realtime_publisher

ParseModuleMonsterDescription = Callable[
    [str, str, AsyncSession, str, Sequence[dict[str, Any]] | None],
    Awaitable[dict[str, Any]],
]
GenerateItemWithLlm = Callable[[str, AsyncSession, str], Awaitable[dict[str, Any]]]


async def create_direct_module_entity(
    *,
    db: AsyncSession,
    campaign: Any,
    campaign_id: int,
    module_id: str,
    module: Any | None,
    entity_type: str,
    data: dict[str, Any],
    preset_monsters: Sequence[Mapping[str, Any]],
    preset_equipment: Mapping[str, Any],
    parse_module_monster_description: ParseModuleMonsterDescription,
    generate_item_with_llm: GenerateItemWithLlm,
) -> dict[str, Any]:
    normalized_type = entity_type.lower()
    if normalized_type in ("npc", "monster"):
        return await _create_npc_or_monster(
            db=db,
            campaign_id=campaign_id,
            module_id=module_id,
            module=module,
            entity_type=normalized_type,
            data=data,
            preset_monsters=preset_monsters,
            parse_module_monster_description=parse_module_monster_description,
        )
    if normalized_type == "shop":
        return await _create_shop(
            db=db,
            campaign=campaign,
            campaign_id=campaign_id,
            module_id=module_id,
            module=module,
            data=data,
            preset_equipment=preset_equipment,
            generate_item_with_llm=generate_item_with_llm,
        )
    if normalized_type == "item":
        return await _create_item(
            db=db,
            campaign_id=campaign_id,
            module_id=module_id,
            module=module,
            data=data,
            preset_equipment=preset_equipment,
            generate_item_with_llm=generate_item_with_llm,
        )
    raise ValueError(f"Unsupported direct module entity type: {entity_type}")


async def _create_npc_or_monster(
    *,
    db: AsyncSession,
    campaign_id: int,
    module_id: str,
    module: Any | None,
    entity_type: str,
    data: dict[str, Any],
    preset_monsters: Sequence[Mapping[str, Any]],
    parse_module_monster_description: ParseModuleMonsterDescription,
) -> dict[str, Any]:
    npc_name = data.get("name", "未知NPC")
    entity_source = "request"

    existing_monster_result = await db.execute(
        select(MonsterInstance).where(
            MonsterInstance.campaign_id == campaign_id,
            (MonsterInstance.name == npc_name) | (MonsterInstance.name_cn == npc_name),
        )
    )
    existing_monster = existing_monster_result.scalar_one_or_none()
    if existing_monster:
        return {
            "success": True,
            "id": existing_monster.id,
            "name": existing_monster.name,
            "type": "npc",
            "skipped": True,
            "message": f"怪物/NPC '{npc_name}' 已存在于资源库中",
        }

    module_monsters = module.monsters if module and getattr(module, "monsters", None) else []

    preset_monster = match_preset_monster_by_name(npc_name, preset_monsters)
    if preset_monster:
        data = {**preset_monster, **data, "name": npc_name}
        entity_source = "preset"
    else:
        module_monster = match_monster_from_module(npc_name, module_monsters)
        if module_monster:
            already_structured = any(
                module_monster.get(field) is not None for field in ("ac", "hp", "cr")
            )
            if not already_structured:
                description = module_monster.get("description", "")
                raw_actions = module_monster.get("actions")
                actions_text = ""
                if isinstance(raw_actions, str):
                    actions_text = raw_actions
                elif isinstance(raw_actions, list):
                    actions_text = "; ".join(
                        f"{action.get('name', '')}: {action.get('description', '')}"
                        for action in raw_actions
                        if isinstance(action, dict)
                    )

                parsed = await parse_module_monster_description(
                    description,
                    npc_name,
                    db,
                    actions_text=actions_text,
                    all_module_monsters=module_monsters,
                )
                if parsed:
                    module_monster = {**module_monster, **parsed}

            data = {**module_monster, **data, "name": npc_name}
            entity_source = "module"
        else:
            has_structured_data = any(
                data.get(field) is not None for field in ("hp", "hit_points", "ac", "armor_class")
            )
            if not has_structured_data and data.get("description"):
                raw_actions = data.get("actions")
                actions_text = raw_actions if isinstance(raw_actions, str) else ""
                parsed = await parse_module_monster_description(
                    data.get("description", ""),
                    npc_name,
                    db,
                    actions_text=actions_text,
                    all_module_monsters=module_monsters,
                )
                if parsed:
                    data = {**data, **parsed}
            entity_source = "ai"

    is_npc = data.get("is_npc", entity_type == "npc")
    id_prefix = "npc" if is_npc else "monster"
    monster_instance = await EntityCreationService.create_from_raw_data(
        db=db,
        campaign_id=campaign_id,
        raw_data=data,
        source="module",
        monster_id=f"{id_prefix}_{uuid4().hex[:8]}",
        is_npc=is_npc,
        source_module=module_id,
        appearance=data.get("appearance", ""),
        background=data.get("background", ""),
    )
    await db.commit()
    await db.refresh(monster_instance)

    await realtime_publisher.publish_npc_created(
        campaign_id,
        monster_instance_id=monster_instance.id,
        name=monster_instance.name,
    )

    npc_appearance = derive_npc_avatar_appearance(
        name=data.get("name", "未知角色"),
        creature_type=data.get("type", ""),
        explicit_appearance=data.get("appearance", ""),
        toc=module.toc if module and getattr(module, "toc", None) else None,
    )
    asyncio.create_task(
        generate_module_monster_avatar_background(
            monster_instance_id=monster_instance.id,
            campaign_id=campaign_id,
            name=monster_instance.name,
            appearance=npc_appearance,
        )
    )

    return {
        "success": True,
        "id": monster_instance.id,
        "name": monster_instance.name,
        "type": "npc",
        "source": entity_source,
    }


async def _create_shop(
    *,
    db: AsyncSession,
    campaign: Any,
    campaign_id: int,
    module_id: str,
    module: Any | None,
    data: dict[str, Any],
    preset_equipment: Mapping[str, Any],
    generate_item_with_llm: GenerateItemWithLlm,
) -> dict[str, Any]:
    db_shop = Shop(
        campaign_id=campaign_id,
        name=data.get("name", "未知商店"),
        description=data.get("description"),
        appearance_description=data.get("appearance_description"),
        gold_gp=data.get("gold_gp", 500),
        accepts_selling=data.get("accepts_selling", True),
        discount_rate=data.get("discount_rate", 0.5),
    )
    db.add(db_shop)
    await db.flush()

    created_items: list[dict[str, Any]] = []
    module_items = module.items if module and getattr(module, "items", None) else []

    for item_data in split_combined_shop_items(data.get("items", []))[:25]:
        item_name = item_data.get("name", "")
        if not item_name:
            continue

        existing_item_result = await db.execute(
            select(Item).where(Item.campaign_id == campaign_id, Item.name == item_name)
        )
        existing_item = existing_item_result.scalar_one_or_none()

        if existing_item:
            db_item = existing_item
            item_source = "reused"
        else:
            preset = preset_equipment.get(item_name) or preset_equipment.get(item_name.lower())
            if preset:
                item_kwargs = create_item_from_data(campaign_id, item_data, preset)
                item_source = "preset"
            else:
                module_item = search_module_item(item_name, module_items)
                if module_item:
                    context = module_item.get("description", "")
                    if module_item.get("actions"):
                        context += f"\n特殊能力: {module_item.get('actions')}"
                    llm_formatted = await generate_item_with_llm(item_name, db, context)
                    merged_data = {**module_item, **llm_formatted, **item_data}
                    merged_data["source_module"] = getattr(module, "title", None) or module_id
                    item_kwargs = create_item_from_data(campaign_id, merged_data, None)
                    item_source = "module"
                else:
                    llm_item = await generate_item_with_llm(item_name, db, "")
                    item_kwargs = create_item_from_data(campaign_id, {**item_data, **llm_item}, None)
                    item_source = "ai"

            db_item = Item(**item_kwargs)
            db.add(db_item)
            await db.flush()

        price_gp = item_data.get("price_gp")
        if not price_gp:
            cost = db_item.cost or {}
            price_gp = cost.get("amount", 10) if isinstance(cost, dict) else 10

        db.add(
            ShopInventory(
                shop_id=db_shop.id,
                item_id=db_item.id,
                quantity=item_data.get("quantity", 5),
                price_gp=price_gp,
            )
        )
        created_items.append(
            {"id": db_item.id, "name": db_item.name, "price": price_gp, "status": item_source}
        )

    token_id = None
    if campaign.current_map_url:
        token = Token(
            campaign_id=campaign_id,
            map_url=campaign.current_map_url,
            shop_id=db_shop.id,
            user_id=campaign.dm_user_id,
            instance_name=db_shop.name,
            position_x=random.randint(5, 15),
            position_y=random.randint(5, 15),
            token_size="2x2",
        )
        db.add(token)
        await db.flush()
        token_id = token.id

    await db.commit()
    await db.refresh(db_shop)

    appearance = data.get("appearance_description", f"{db_shop.name}，一家位于冒险者小镇的商店")
    asyncio.create_task(
        generate_module_shop_avatar_background(
            shop_id=db_shop.id,
            campaign_id=campaign_id,
            name=db_shop.name,
            appearance=appearance,
        )
    )
    await realtime_publisher.publish_shop_created(
        campaign_id,
        shop_id=db_shop.id,
        name=db_shop.name,
        item_count=len(created_items),
        token_id=token_id,
    )

    return {
        "success": True,
        "id": db_shop.id,
        "name": db_shop.name,
        "type": "shop",
        "items": created_items,
        "token_id": token_id,
    }


async def _create_item(
    *,
    db: AsyncSession,
    campaign_id: int,
    module_id: str,
    module: Any | None,
    data: dict[str, Any],
    preset_equipment: Mapping[str, Any],
    generate_item_with_llm: GenerateItemWithLlm,
) -> dict[str, Any]:
    item_name = data.get("name", "未知物品")
    item_source = "request"

    existing_item_result = await db.execute(
        select(Item).where(
            Item.campaign_id == campaign_id,
            (Item.name == item_name) | (Item.name_cn == item_name),
        )
    )
    existing_item = existing_item_result.scalar_one_or_none()
    if existing_item:
        return {
            "success": True,
            "id": existing_item.id,
            "name": existing_item.name,
            "type": "item",
            "skipped": True,
            "message": f"物品 '{item_name}' 已存在于资源库中",
        }

    module_items = module.items if module and getattr(module, "items", None) else []
    preset = preset_equipment.get(item_name) or preset_equipment.get(item_name.lower())
    if preset:
        item_kwargs = create_item_from_data(campaign_id, data, preset)
        item_source = "preset"
    else:
        module_item = search_module_item(item_name, module_items)
        if module_item:
            context = module_item.get("description", "")
            if module_item.get("actions"):
                context += f"\n特殊能力: {module_item.get('actions')}"
            llm_formatted = await generate_item_with_llm(item_name, db, context)
            merged_data = {**module_item, **llm_formatted, **data}
            merged_data["source_module"] = getattr(module, "title", None) or module_id
            item_kwargs = create_item_from_data(campaign_id, merged_data, None)
            item_source = "module"
        else:
            llm_item = await generate_item_with_llm(item_name, db, "")
            item_kwargs = create_item_from_data(campaign_id, {**data, **llm_item}, None)
            item_source = "ai"

    db_item = Item(**item_kwargs)
    db.add(db_item)
    await db.commit()
    await db.refresh(db_item)

    await realtime_publisher.publish_item_created(
        campaign_id,
        item_id=db_item.id,
        name=db_item.name,
    )

    return {
        "success": True,
        "id": db_item.id,
        "name": db_item.name,
        "type": "item",
        "source": item_source,
    }
