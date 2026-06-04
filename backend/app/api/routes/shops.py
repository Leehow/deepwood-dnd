from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import flag_modified
from typing import List, Optional, Dict
from pydantic import BaseModel, Field

from app.db.session import get_db
from app.models.shop import Shop
from app.models.shop_inventory import ShopInventory
from app.models.item import Item
from app.models.character import Character
from app.schemas.shop import (
    ShopCreate, ShopUpdate, ShopResponse,
    ShopInventoryCreate, ShopInventoryUpdate, ShopInventoryResponse,
)
from app.services.websocket_manager import manager
from app.services.avatar_service import avatar_service
from app.services.realtime_publisher import realtime_publisher
from app.core.security import require_auth
from app.utils.permission_checks import require_campaign_dm, check_campaign_member
from app.utils.avatar_urls import is_temporary_avatar_url, materialize_avatar_url
from app.utils.item_payload_normalizer import (
    build_item_payload_from_model,
    items_can_stack,
    merge_item_into_equipment,
)

router = APIRouter(prefix="/api/shops", tags=["shops"])


# ---- Transactions (buy/sell) request/response models ----
class BuyRequest(BaseModel):
    character_id: int = Field(..., description="Buyer character ID")
    inventory_id: int = Field(..., description="Shop inventory entry ID")
    quantity: int = Field(..., gt=0, description="Quantity to buy")


class SellRequest(BaseModel):
    character_id: int = Field(..., description="Seller character ID")
    inventory_id: int = Field(..., description="Shop inventory entry ID (price source)")
    quantity: int = Field(..., gt=0, description="Quantity to sell back")


class TransactionResponse(BaseModel):
    success: bool
    transaction_type: str
    total_price_gp: float
    shop: ShopResponse
    inventory: ShopInventoryResponse
    character_currency: Dict[str, int]



class ShopAvatarGenRequest(BaseModel):
    prompt_override: Optional[str] = None
    size: Optional[str] = "256x256"



@router.post("", response_model=ShopResponse, status_code=status.HTTP_201_CREATED)
async def create_shop(
    payload: ShopCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    await require_campaign_dm(payload.campaign_id, current_user, db)
    shop = Shop(**payload.model_dump())
    db.add(shop)
    await db.commit()
    await db.refresh(shop)
    return shop


@router.get("/campaign/{campaign_id}", response_model=List[ShopResponse])
async def list_shops(campaign_id: int, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Shop).where(Shop.campaign_id == campaign_id).order_by(Shop.name))
    return res.scalars().all()


@router.get("/avatar-library")
async def get_shop_avatar_library(
    campaign_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(Shop).where(Shop.has_avatar == True, Shop.avatar_url.isnot(None))
    if campaign_id is not None:
        query = query.order_by(Shop.campaign_id != campaign_id, Shop.id.desc())
    else:
        query = query.order_by(Shop.id.desc())

    res = await db.execute(query.limit(100))
    shops = res.scalars().all()
    return [
        {
            "id": shop.id,
            "name": shop.name,
            "avatar_url": shop.avatar_url,
            "avatar_url_large": shop.avatar_url_large,
            "campaign_id": shop.campaign_id,
        }
        for shop in shops
        if shop.avatar_url
    ]


# ---- Preset/Template shop creation ----
class PresetShopItem(BaseModel):
    name: str
    name_cn: str
    category: str
    subcategory: Optional[str] = None
    cost: Optional[dict] = None
    weight: Optional[float] = None
    damage: Optional[dict] = None
    properties: Optional[list] = None
    range: Optional[dict] = None
    armor_class: Optional[dict] = None
    strength_requirement: Optional[int] = None
    stealth_disadvantage: bool = False
    description: Optional[str] = None
    description_cn: Optional[str] = None
    rarity: str = "common"
    requires_attunement: bool = False
    abilities: Optional[list] = None
    avatar_url: Optional[str] = None
    quantity: int = 1
    price_gp: float = 0.0


class PresetShopCreateRequest(BaseModel):
    campaign_id: int
    name: str
    description: Optional[str] = None
    appearance_description: Optional[str] = None
    gold_gp: int = 0
    accepts_selling: bool = True
    discount_rate: float = 0.5
    avatar_url: Optional[str] = None
    avatar_url_large: Optional[str] = None
    items: List[PresetShopItem]


@router.post("/from-template", response_model=ShopResponse, status_code=status.HTTP_201_CREATED)
async def create_shop_from_template(
    payload: PresetShopCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Batch-create a shop with all inventory items in a single transaction."""
    await require_campaign_dm(payload.campaign_id, current_user, db)
    import logging
    logging.getLogger(__name__).info(f"[from-template] name={payload.name} avatar_url={payload.avatar_url} items={len(payload.items)}")
    shop = Shop(
        campaign_id=payload.campaign_id,
        name=payload.name,
        description=payload.description,
        appearance_description=payload.appearance_description,
        gold_gp=payload.gold_gp,
        accepts_selling=payload.accepts_selling,
        discount_rate=payload.discount_rate,
        avatar_url=payload.avatar_url,
        avatar_url_large=payload.avatar_url_large,
        has_avatar=bool(payload.avatar_url),
    )
    db.add(shop)
    await db.flush()  # get shop.id

    for it in payload.items:
        item = Item(
            campaign_id=payload.campaign_id,
            name=it.name,
            name_cn=it.name_cn,
            category=it.category,
            subcategory=it.subcategory,
            cost=it.cost,
            weight=it.weight,
            damage=it.damage,
            properties=it.properties,
            range=it.range,
            armor_class=it.armor_class,
            strength_requirement=it.strength_requirement,
            stealth_disadvantage=it.stealth_disadvantage,
            description=it.description,
            description_cn=it.description_cn,
            rarity=it.rarity,
            requires_attunement=it.requires_attunement,
            abilities=it.abilities,
            avatar_url=it.avatar_url,
            is_custom=False,
        )
        db.add(item)
        await db.flush()  # get item.id

        inv = ShopInventory(
            shop_id=shop.id,
            item_id=item.id,
            quantity=it.quantity,
            price_gp=it.price_gp,
        )
        db.add(inv)

    await db.commit()
    await db.refresh(shop)
    return shop


# Static routes MUST come before dynamic routes to avoid conflicts
@router.post("/parse-custom", response_model=ShopResponse)
async def parse_and_create_custom_shop(
    request: "ParseCustomShopRequest",
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    从自然语言描述解析并创建自定义商店。
    """
    if not request.description or len(request.description.strip()) < 5:
        raise HTTPException(status_code=400, detail="描述太短，请提供更详细的描述")

    await require_campaign_dm(request.campaign_id, current_user, db)

    parsed = await _parse_custom_shop_with_llm(db, request.description)

    shop_name = parsed.get("name", "自定义商店")

    # Validate and normalize values
    gold_gp = parsed.get("gold_gp", 1000)
    if not isinstance(gold_gp, (int, float)):
        gold_gp = 1000
    gold_gp = max(0, int(gold_gp))

    discount_rate = parsed.get("discount_rate", 0.5)
    if not isinstance(discount_rate, (int, float)):
        discount_rate = 0.5
    discount_rate = max(0.0, min(1.0, float(discount_rate)))

    accepts_selling = parsed.get("accepts_selling", True)
    if not isinstance(accepts_selling, bool):
        accepts_selling = True

    new_shop = Shop(
        campaign_id=request.campaign_id,
        name=shop_name,
        description=parsed.get("description", ""),
        appearance_description=parsed.get("appearance_description", ""),
        gold_gp=gold_gp,
        accepts_selling=accepts_selling,
        discount_rate=discount_rate,
    )

    db.add(new_shop)
    await db.commit()
    await db.refresh(new_shop)

    return new_shop


@router.get("/{shop_id}", response_model=ShopResponse)
async def get_shop(shop_id: int, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Shop).where(Shop.id == shop_id))
    shop = res.scalar_one_or_none()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    return shop



@router.post("/{shop_id}/generate-avatar", response_model=ShopResponse)
async def generate_shop_avatar(
    shop_id: int,
    db: AsyncSession = Depends(get_db),
    body: Optional[ShopAvatarGenRequest] = None,
    current_user: dict = Depends(require_auth),
):
    """Generate a real avatar image for a shop using the configured AVATAR model."""
    print(f"[ShopAvatar] START shop_id={shop_id}", flush=True)

    res = await db.execute(select(Shop).where(Shop.id == shop_id))
    shop = res.scalar_one_or_none()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")

    await require_campaign_dm(shop.campaign_id, current_user, db)

    try:
        # Use AvatarService to generate avatar (returns tuple: small_url, large_url)
        small_url, large_url = await avatar_service.generate_avatar(
            db=db,
            entity_type="shop",
            entity_id=shop.id,
            name=shop.name or "",
            description=shop.description or "",
            appearance=shop.appearance_description or "",
            prompt_override=body.prompt_override if body else None
        )

        if is_temporary_avatar_url(small_url):
            repaired = await materialize_avatar_url(small_url, "shop", shop.id, shop.name or "")
            if repaired:
                small_url, large_url = repaired

        # Update shop with avatar URLs (small for sidebar, large for detail view)
        shop.avatar_url = small_url
        shop.avatar_url_large = large_url
        shop.has_avatar = True
        await db.commit()
        await db.refresh(shop)

        print(f"[ShopAvatar] DONE shop_id={shop_id} -> small={small_url}, large={large_url}", flush=True)
        return shop

    except HTTPException:
        # Re-raise HTTPExceptions from avatar_service
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to generate shop avatar: {e}")


@router.post("/{shop_id}", response_model=ShopResponse)
async def update_shop(
    shop_id: int,
    payload: ShopUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    res = await db.execute(select(Shop).where(Shop.id == shop_id))
    shop = res.scalar_one_or_none()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")

    await require_campaign_dm(shop.campaign_id, current_user, db)

    update_data = payload.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(shop, k, v)
    await db.commit()
    await db.refresh(shop)
    return shop


@router.delete("/{shop_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_shop(
    shop_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    res = await db.execute(select(Shop).where(Shop.id == shop_id))
    shop = res.scalar_one_or_none()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")

    await require_campaign_dm(shop.campaign_id, current_user, db)

    # Collect item IDs before deleting inventory
    inv_res = await db.execute(select(ShopInventory.item_id).where(ShopInventory.shop_id == shop_id))
    item_ids = [row[0] for row in inv_res.all()]

    await db.execute(delete(ShopInventory).where(ShopInventory.shop_id == shop_id))
    # Delete orphaned items that were created for this shop
    if item_ids:
        await db.execute(delete(Item).where(Item.id.in_(item_ids)))
    await db.execute(delete(Shop).where(Shop.id == shop_id))
    await db.commit()
    return None


# Inventory endpoints
@router.get("/{shop_id}/inventory", response_model=List[ShopInventoryResponse])
async def list_inventory(shop_id: int, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(ShopInventory).where(ShopInventory.shop_id == shop_id))
    return res.scalars().all()


@router.post("/{shop_id}/inventory", response_model=ShopInventoryResponse, status_code=status.HTTP_201_CREATED)
async def add_inventory_item(
    shop_id: int,
    payload: ShopInventoryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    # Verify shop exists and user is DM
    res = await db.execute(select(Shop).where(Shop.id == shop_id))
    shop = res.scalar_one_or_none()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    await require_campaign_dm(shop.campaign_id, current_user, db)

    inv = ShopInventory(shop_id=shop_id, **payload.model_dump())
    db.add(inv)
    await db.commit()
    await db.refresh(inv)
    return inv


@router.post("/{shop_id}/inventory/{inv_id}", response_model=ShopInventoryResponse)
async def update_inventory_item(
    shop_id: int,
    inv_id: int,
    payload: ShopInventoryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    # Verify shop exists and user is DM
    shop_res = await db.execute(select(Shop).where(Shop.id == shop_id))
    shop = shop_res.scalar_one_or_none()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    await require_campaign_dm(shop.campaign_id, current_user, db)

    res = await db.execute(select(ShopInventory).where(ShopInventory.id == inv_id, ShopInventory.shop_id == shop_id))
    inv = res.scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Inventory item not found")

    update_data = payload.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(inv, k, v)
    await db.commit()
    await db.refresh(inv)
    return inv


# ---- Transactions ----
@router.post("/{shop_id}/buy", response_model=TransactionResponse)
async def buy_item(
    shop_id: int,
    payload: BuyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    # Fetch shop
    res_shop = await db.execute(select(Shop).where(Shop.id == shop_id))
    shop = res_shop.scalar_one_or_none()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")

    await check_campaign_member(shop.campaign_id, current_user, db)

    # Fetch inventory entry and validate ownership (with eager loading for item)
    res_inv = await db.execute(
        select(ShopInventory)
        .where(ShopInventory.id == payload.inventory_id, ShopInventory.shop_id == shop_id)
        .options(selectinload(ShopInventory.item))
    )
    inv = res_inv.scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Inventory item not found")

    if not inv.price_gp or inv.price_gp <= 0:
        raise HTTPException(status_code=400, detail="该物品无定价（价格≤0），不可购买")

    if payload.quantity <= 0:
        raise HTTPException(status_code=400, detail="数量必须>0")

    if inv.quantity is None or inv.quantity < payload.quantity:
        raise HTTPException(status_code=400, detail="库存不足")

    # Fetch character
    res_char = await db.execute(select(Character).where(Character.id == payload.character_id))
    char = res_char.scalar_one_or_none()
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")

    # Prepare currency objects with defaults
    cur = (char.currency or {})
    cur_cp = int(cur.get("cp") or 0)
    cur_sp = int(cur.get("sp") or 0)
    cur_ep = int(cur.get("ep") or 0)
    cur_gp = int(cur.get("gp") or 0)
    cur_pp = int(cur.get("pp") or 0)

    # Compute total cost in copper pieces for precision (1gp=100cp, 1sp=10cp, 1ep=50cp, 1pp=1000cp)
    total_price_cp = int(round(float(inv.price_gp) * payload.quantity * 100))
    if total_price_cp <= 0:
        raise HTTPException(status_code=400, detail="总价无效")

    wallet_cp = cur_cp + cur_sp * 10 + cur_ep * 50 + cur_gp * 100 + cur_pp * 1000
    if wallet_cp < total_price_cp:
        raise HTTPException(status_code=400, detail="角色金币不足")

    # Deduct cost: consume from smallest denomination first
    remaining = total_price_cp
    for denom, rate in [("cp", 1), ("sp", 10), ("ep", 50), ("gp", 100), ("pp", 1000)]:
        if remaining <= 0:
            break
        vals = {"cp": cur_cp, "sp": cur_sp, "ep": cur_ep, "gp": cur_gp, "pp": cur_pp}
        coins = vals[denom]
        can_use = min(coins, remaining // rate)
        if can_use > 0:
            remaining -= can_use * rate
            if denom == "cp": cur_cp -= can_use
            elif denom == "sp": cur_sp -= can_use
            elif denom == "ep": cur_ep -= can_use
            elif denom == "gp": cur_gp -= can_use
            elif denom == "pp": cur_pp -= can_use
    # If remainder left, pay with next larger denomination and get change
    if remaining > 0:
        for denom, rate in [("sp", 10), ("ep", 50), ("gp", 100), ("pp", 1000)]:
            vals = {"sp": cur_sp, "ep": cur_ep, "gp": cur_gp, "pp": cur_pp}
            coins = vals[denom]
            if coins > 0 and rate >= remaining:
                change = rate - remaining
                if denom == "sp": cur_sp -= 1
                elif denom == "ep": cur_ep -= 1
                elif denom == "gp": cur_gp -= 1
                elif denom == "pp": cur_pp -= 1
                cur_cp += change
                remaining = 0
                break
        if remaining > 0:
            # Fallback: just deduct from gp with rounding
            cur_gp -= max(1, int(round(remaining / 100)))
            remaining = 0

    # Apply updates
    shop.gold_gp = int((shop.gold_gp or 0)) + int(round(total_price_cp / 100))
    inv.quantity = int(inv.quantity) - payload.quantity
    if inv.quantity < 0:
        inv.quantity = 0

    # Add purchased items to character equipment (prefer stacking into unequipped stacks)
    try:
        db_item = inv.item
        if not db_item:
            raise HTTPException(status_code=404, detail="Item not found")

        equip_list = char.equipment if isinstance(char.equipment, list) else []
        item_payload = build_item_payload_from_model(db_item, quantity=payload.quantity)
        updated_equipment, _, _ = merge_item_into_equipment(
            equip_list,
            item_payload,
            quantity=payload.quantity,
        )
        char.equipment = updated_equipment
        flag_modified(char, "equipment")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"添加物品到背包时出错: {e!r}")

    # Persist
    char.currency = {"cp": cur_cp, "sp": cur_sp, "ep": cur_ep, "gp": cur_gp, "pp": cur_pp}
    await db.commit()
    await db.refresh(shop)
    await db.refresh(inv)
    await db.refresh(char)

    # Broadcast shop transaction to campaign
    try:
        await realtime_publisher.publish_shop_transaction(
            shop.campaign_id,
            subtype="buy",
            shop_id=shop.id,
            inventory=ShopInventoryResponse.model_validate(inv).model_dump(),
            character_id=char.id,
            character_currency=char.currency or {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0},
        )
    except Exception as _e:
        # Non-fatal
        print(f"[WebSocket] Failed to broadcast shop buy: {_e}")

    try:
        await realtime_publisher.publish_character_equipment_updated(
            shop.campaign_id,
            character_id=char.id,
            equipment=char.equipment or [],
            currency=char.currency or {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0},
            reason="shop_buy",
        )
    except Exception as _e:
        print(f"[WebSocket] Failed to broadcast character equipment update after buy: {_e}")

    return TransactionResponse(
        success=True,
        transaction_type="buy",
        total_price_gp=round(total_price_cp / 100, 2),
        shop=ShopResponse.model_validate(shop),
        inventory=ShopInventoryResponse.model_validate(inv),
        character_currency=char.currency or {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0},
    )


@router.post("/{shop_id}/sell", response_model=TransactionResponse)
async def sell_item(
    shop_id: int,
    payload: SellRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    # Fetch shop
    res_shop = await db.execute(select(Shop).where(Shop.id == shop_id))
    shop = res_shop.scalar_one_or_none()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")

    await check_campaign_member(shop.campaign_id, current_user, db)

    if not shop.accepts_selling:
        raise HTTPException(status_code=400, detail="该商店不回收物品")

    # Fetch inventory entry (used for price reference, and stock increases)
    res_inv = await db.execute(
        select(ShopInventory).where(ShopInventory.id == payload.inventory_id, ShopInventory.shop_id == shop_id)
    )
    inv = res_inv.scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Inventory item not found")

    if not inv.price_gp or inv.price_gp <= 0:
        raise HTTPException(status_code=400, detail="该物品无定价（价格≤0），不可回收")

    rate = shop.discount_rate or 0.0
    if rate <= 0:
        raise HTTPException(status_code=400, detail="商店折价系数≤0，不回收")

    if payload.quantity <= 0:
        raise HTTPException(status_code=400, detail="数量必须>0")

    # Fetch character
    res_char = await db.execute(select(Character).where(Character.id == payload.character_id))
    char = res_char.scalar_one_or_none()
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")

    # Compute buy-back total in copper for precision
    unit_buyback = inv.price_gp * rate
    total_price = unit_buyback * payload.quantity
    total_price_cp = int(round(float(total_price) * 100))
    if total_price_cp <= 0:
        raise HTTPException(status_code=400, detail="回收价无效")

    shop_gold_cp = int((shop.gold_gp or 0)) * 100
    if shop_gold_cp < total_price_cp:
        raise HTTPException(status_code=400, detail="商店金币不足，无法回收")

    # Deduct items from character equipment (sell) — match by canonical id/libraryItemId, fallback by name
    try:
        res_item = await db.execute(select(Item).where(Item.id == inv.item_id))
        db_item = res_item.scalar_one_or_none()
        item_names = set()
        canonical_item = None
        if db_item:
            canonical_item = build_item_payload_from_model(db_item, quantity=1)
            nm = getattr(db_item, "name", None)
            if nm:
                item_names.add(str(nm).strip().lower())
            nm_cn = getattr(db_item, "name_cn", None)
            if nm_cn:
                item_names.add(str(nm_cn).strip().lower())

        equip_list = char.equipment if isinstance(char.equipment, list) else []
        if not isinstance(equip_list, list):
            equip_list = []

        candidates = []  # each: {index, equipped, qty}
        total_have = 0
        for idx, e in enumerate(equip_list):
            if not isinstance(e, dict):
                continue
            matched = False
            if canonical_item is not None and not e.get("equippedSlot"):
                matched = items_can_stack(e, canonical_item)
            if not matched:
                eq_name = str(e.get("name") or "").strip().lower()
                if eq_name and item_names and eq_name in item_names:
                    matched = True
            if matched:
                qty = int(e.get("quantity") or 1)
                total_have += qty
                candidates.append({"index": idx, "equipped": bool(e.get("equippedSlot")), "qty": qty})

        if total_have < payload.quantity:
            raise HTTPException(status_code=400, detail="角色背包中该物品数量不足")

        to_deduct = int(payload.quantity)
        # Work on a shallow copy of the list
        new_equipment = list(equip_list)
        # Prefer deducting from unequipped stacks first
        candidates.sort(key=lambda c: (c["equipped"],))
        for c in candidates:
            if to_deduct <= 0:
                break
            i = c["index"]
            entry = dict(new_equipment[i]) if isinstance(new_equipment[i], dict) else {}
            curr_qty = int(entry.get("quantity") or 1)
            use = curr_qty if curr_qty <= to_deduct else to_deduct
            new_qty = curr_qty - use
            if new_qty <= 0:
                new_equipment[i] = None
            else:
                entry["quantity"] = new_qty
                new_equipment[i] = entry
            to_deduct -= use

        # Remove deleted entries
        new_equipment = [e for e in new_equipment if e is not None]
        char.equipment = new_equipment
        flag_modified(char, "equipment")
    except HTTPException:
        # Bubble up known validation errors
        raise
    except Exception as e:
        # Do not allow silent failures; surface a clear message
        raise HTTPException(status_code=500, detail=f"扣减角色背包时出错: {e!r}")

    # Apply updates: increase inventory quantity, pay character, reduce shop gold
    inv.quantity = int(inv.quantity or 0) + payload.quantity

    cur = (char.currency or {})
    cur_cp = int(cur.get("cp") or 0)
    cur_sp = int(cur.get("sp") or 0)
    cur_ep = int(cur.get("ep") or 0)
    cur_gp = int(cur.get("gp") or 0)
    cur_pp = int(cur.get("pp") or 0)

    # Pay character in mixed denominations from copper total
    pay_remaining = total_price_cp
    add_gp = pay_remaining // 100
    pay_remaining %= 100
    add_sp = pay_remaining // 10
    pay_remaining %= 10
    add_cp = pay_remaining
    cur_gp += add_gp
    cur_sp += add_sp
    cur_cp += add_cp
    shop.gold_gp = int((shop.gold_gp or 0)) - int(round(total_price_cp / 100))

    # Persist
    char.currency = {"cp": cur_cp, "sp": cur_sp, "ep": cur_ep, "gp": cur_gp, "pp": cur_pp}
    await db.commit()
    await db.refresh(shop)
    await db.refresh(inv)
    await db.refresh(char)

    # Broadcast shop transaction to campaign
    try:
        await realtime_publisher.publish_shop_transaction(
            shop.campaign_id,
            subtype="sell",
            shop_id=shop.id,
            inventory=ShopInventoryResponse.model_validate(inv).model_dump(),
            character_id=char.id,
            character_currency=char.currency or {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0},
        )
    except Exception as _e:
        print(f"[WebSocket] Failed to broadcast shop sell: {_e}")

    try:
        await realtime_publisher.publish_character_equipment_updated(
            shop.campaign_id,
            character_id=char.id,
            equipment=char.equipment or [],
            currency=char.currency or {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0},
            reason="shop_sell",
        )
    except Exception as _e:
        print(f"[WebSocket] Failed to broadcast character equipment update after sell: {_e}")

    return TransactionResponse(
        success=True,
        transaction_type="sell",
        total_price_gp=round(total_price_cp / 100, 2),
        shop=ShopResponse.model_validate(shop),
        inventory=ShopInventoryResponse.model_validate(inv),
        character_currency=char.currency or {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0},
    )



@router.delete("/{shop_id}/inventory/{inv_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_inventory_item(
    shop_id: int,
    inv_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    # Verify shop exists and user is DM
    shop_res = await db.execute(select(Shop).where(Shop.id == shop_id))
    shop = shop_res.scalar_one_or_none()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    await require_campaign_dm(shop.campaign_id, current_user, db)

    res = await db.execute(select(ShopInventory).where(ShopInventory.id == inv_id, ShopInventory.shop_id == shop_id))
    inv = res.scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Inventory item not found")

    await db.execute(delete(ShopInventory).where(ShopInventory.id == inv_id))
    await db.commit()
    return None


# ================== Custom Shop Parsing ==================

import httpx
import json
import re
from app.services.ai_model_service import ai_model_service
from app.models.ai_settings import ModelType


class ParseCustomShopRequest(BaseModel):
    """从自然语言描述解析商店"""
    campaign_id: int
    description: str


CUSTOM_SHOP_PARSE_PROMPT = """你是D&D 5E商店数据解析专家。请从以下自然语言描述中提取商店信息，并格式化为结构化JSON。

## 用户输入
{description}

## 输出要求
返回单个JSON对象：
```json
{{
  "name": "商店名称",
  "description": "商店描述（背景故事、特色等）",
  "appearance_description": "外观描述（用于生成头像，如建筑风格、招牌、门面等）",
  "gold_gp": 商店初始金币数量（整数，默认1000）,
  "accepts_selling": true或false（是否回收物品，默认true）,
  "discount_rate": 回收折扣率（0.0-1.0，默认0.5表示半价回收）
}}
```

## 注意事项
- 如果描述不够详细，根据商店类型合理推断默认值
- 小摊贩/流动商人: gold_gp约100-500
- 普通商店: gold_gp约500-2000
- 大型商会/高档商店: gold_gp约2000-10000
- 黑市/特殊商人: 可能不回收(accepts_selling=false)或低折扣率
- appearance_description 要足够详细，方便生成商店头像图片

只返回JSON对象，不要其他内容。"""


def _parse_json_response_shop(text: str) -> dict:
    """Parse JSON from LLM response"""
    try:
        return json.loads(text)
    except:
        pass

    code_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', text)
    if code_match:
        try:
            return json.loads(code_match.group(1))
        except:
            pass

    brace_match = re.search(r'\{[\s\S]*\}', text)
    if brace_match:
        try:
            return json.loads(brace_match.group(0))
        except:
            pass

    return None


async def _parse_custom_shop_with_llm(db: AsyncSession, description: str) -> dict:
    """Use configurable model to parse custom shop from description"""
    try:
        config = await ai_model_service.get_config_for_usage(db, "custom_creation")
    except Exception as e:
        print(f"[Custom Shop] Failed to get model config for custom_creation: {e}")
        raise HTTPException(status_code=500, detail="AI服务不可用，请先配置模型")

    prompt = CUSTOM_SHOP_PARSE_PROMPT.format(description=description)

    endpoint = config.api_url.rstrip('/')
    if not endpoint.endswith('/chat/completions'):
        endpoint = endpoint + '/chat/completions'

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                endpoint,
                json={
                    "model": config.model_name,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 1500,
                    "temperature": 0.1
                },
                headers={
                    "Authorization": f"Bearer {config.api_key}",
                    "Content-Type": "application/json",
                },
            )

        if resp.status_code != 200:
            print(f"[Custom Shop] LLM API error: {resp.status_code}")
            raise HTTPException(status_code=500, detail="AI分析失败")

        data = resp.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

        if not content:
            raise HTTPException(status_code=500, detail="AI返回空响应")

        parsed = _parse_json_response_shop(content)
        if not parsed:
            raise HTTPException(status_code=500, detail="无法解析AI返回的数据")

        return parsed

    except HTTPException:
        raise
    except Exception as e:
        print(f"[Custom Shop] LLM call failed: {e}")
        raise HTTPException(status_code=500, detail=f"AI调用失败: {str(e)}")
