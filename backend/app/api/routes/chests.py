"""API routes for chest management and interactions"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import flag_modified
from typing import List, Optional, Dict, Any
from pydantic import BaseModel

from app.db.session import get_db
from app.models.chest import Chest
from app.models.chest_inventory import ChestInventory
from app.models.item import Item
from app.models.character import Character
from app.models.token import Token
from app.schemas.chest import (
    ChestCreate, ChestUpdate, ChestResponse,
    ChestInventoryCreate, ChestInventoryUpdate, ChestInventoryResponse,
    InvestigateRequest, InvestigateResponse,
    PickLockRequest, PickLockResponse,
    DisarmTrapRequest, DisarmTrapResponse,
    OpenChestRequest, OpenChestResponse,
    LootRequest, LootResponse,
    ChestAvatarGenRequest, TRAP_PRESETS, LOCK_DC_REFERENCE
)
from app.services.realtime_publisher import realtime_publisher
from app.services.avatar_service import avatar_service
from app.core.security import require_auth
from app.utils.permission_checks import require_campaign_dm, check_campaign_member
from app.utils.avatar_urls import is_temporary_avatar_url, materialize_avatar_url
from app.utils.item_payload_normalizer import build_item_payload_from_model, merge_item_into_equipment


router = APIRouter(prefix="/api/chests", tags=["chests"])


# ==================== CRUD Endpoints ====================

@router.post("", response_model=ChestResponse, status_code=status.HTTP_201_CREATED)
async def create_chest(
    payload: ChestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Create a new chest"""
    await require_campaign_dm(payload.campaign_id, current_user, db)
    chest = Chest(**payload.model_dump())
    db.add(chest)
    await db.commit()
    await db.refresh(chest)

    # Broadcast to campaign
    await _broadcast_chest_update(chest, "chest_created")
    return chest


@router.get("/campaign/{campaign_id}", response_model=List[ChestResponse])
async def list_chests(campaign_id: int, db: AsyncSession = Depends(get_db)):
    """List all chests in a campaign"""
    result = await db.execute(
        select(Chest).where(Chest.campaign_id == campaign_id).order_by(Chest.name)
    )
    return result.scalars().all()


@router.get("/avatar-library")
async def get_chest_avatar_library(
    campaign_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(Chest).where(Chest.has_avatar == True, Chest.avatar_url.isnot(None))
    if campaign_id is not None:
        query = query.order_by(Chest.campaign_id != campaign_id, Chest.id.desc())
    else:
        query = query.order_by(Chest.id.desc())

    result = await db.execute(query.limit(100))
    chests = result.scalars().all()
    return [
        {
            "id": chest.id,
            "name": chest.name,
            "avatar_url": chest.avatar_url,
            "avatar_url_large": chest.avatar_url_large,
            "campaign_id": chest.campaign_id,
        }
        for chest in chests
        if chest.avatar_url
    ]


@router.get("/presets/traps")
async def get_trap_presets():
    """Get available trap presets"""
    return TRAP_PRESETS


@router.get("/presets/locks")
async def get_lock_dc_reference():
    """Get lock DC reference"""
    return LOCK_DC_REFERENCE


@router.get("/{chest_id}", response_model=ChestResponse)
async def get_chest(chest_id: int, db: AsyncSession = Depends(get_db)):
    """Get a single chest by ID"""
    result = await db.execute(select(Chest).where(Chest.id == chest_id))
    chest = result.scalar_one_or_none()
    if not chest:
        raise HTTPException(status_code=404, detail="Chest not found")
    return chest


@router.post("/{chest_id}", response_model=ChestResponse)
async def update_chest(
    chest_id: int,
    payload: ChestUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Update a chest"""
    result = await db.execute(select(Chest).where(Chest.id == chest_id))
    chest = result.scalar_one_or_none()
    if not chest:
        raise HTTPException(status_code=404, detail="Chest not found")

    await require_campaign_dm(chest.campaign_id, current_user, db)

    update_data = payload.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(chest, k, v)
    await db.commit()
    await db.refresh(chest)

    # Broadcast update
    await _broadcast_chest_update(chest, "chest_updated")
    return chest


@router.delete("/{chest_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chest(
    chest_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Delete a chest, its inventory, and any associated map tokens"""
    result = await db.execute(select(Chest).where(Chest.id == chest_id))
    chest = result.scalar_one_or_none()
    if not chest:
        raise HTTPException(status_code=404, detail="Chest not found")

    await require_campaign_dm(chest.campaign_id, current_user, db)

    campaign_id = chest.campaign_id

    # Find and delete associated tokens
    token_result = await db.execute(select(Token).where(Token.chest_id == chest_id))
    tokens_to_delete = token_result.scalars().all()
    token_ids = [t.id for t in tokens_to_delete]

    for token in tokens_to_delete:
        await db.delete(token)

    # Delete chest inventory and chest
    # Collect item IDs before deleting inventory
    inv_res = await db.execute(select(ChestInventory.item_id).where(ChestInventory.chest_id == chest_id))
    item_ids = [row[0] for row in inv_res.all()]

    await db.execute(delete(ChestInventory).where(ChestInventory.chest_id == chest_id))
    # Delete orphaned items that were created for this chest
    if item_ids:
        await db.execute(delete(Item).where(Item.id.in_(item_ids)))
    await db.execute(delete(Chest).where(Chest.id == chest_id))
    await db.commit()

    # Broadcast deletion
    try:
        # Broadcast token removals first
        for token_id in token_ids:
            await realtime_publisher.publish_map_token_removed(
                campaign_id,
                token_id=token_id,
            )

        # Then broadcast chest deletion
        await realtime_publisher.publish_chest_deleted(
            campaign_id,
            chest_id=chest_id,
        )
    except Exception as e:
        print(f"[WebSocket] Failed to broadcast chest deletion: {e}")

    return None


# ==================== Inventory Endpoints ====================

@router.get("/{chest_id}/inventory", response_model=List[ChestInventoryResponse])
async def list_inventory(chest_id: int, db: AsyncSession = Depends(get_db)):
    """List all items in a chest"""
    result = await db.execute(
        select(ChestInventory).where(ChestInventory.chest_id == chest_id)
    )
    return result.scalars().all()


@router.get("/{chest_id}/inventory/detailed")
async def list_inventory_detailed(chest_id: int, db: AsyncSession = Depends(get_db)):
    """List all items in a chest with full item details"""
    result = await db.execute(
        select(ChestInventory)
        .where(ChestInventory.chest_id == chest_id)
        .options(selectinload(ChestInventory.item))
    )
    inventory = result.scalars().all()

    detailed = []
    for inv in inventory:
        item_data = None
        if inv.item:
            item_data = {
                "id": inv.item.id,
                "name": inv.item.name,
                "name_cn": getattr(inv.item, "name_cn", None),
                "category": getattr(inv.item, "category", None),
                "rarity": getattr(inv.item, "rarity", None),
                "description": getattr(inv.item, "description", None),
                "avatar_url": getattr(inv.item, "avatar_url", None),
                "cost": getattr(inv.item, "cost", None),
            }
        detailed.append({
            "id": inv.id,
            "chest_id": inv.chest_id,
            "item_id": inv.item_id,
            "quantity": inv.quantity,
            "item": item_data
        })
    return detailed


@router.post("/{chest_id}/inventory", response_model=ChestInventoryResponse, status_code=status.HTTP_201_CREATED)
async def add_inventory_item(
    chest_id: int,
    payload: ChestInventoryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Add an item to a chest's inventory"""
    # Verify chest exists
    result = await db.execute(select(Chest).where(Chest.id == chest_id))
    chest = result.scalar_one_or_none()
    if not chest:
        raise HTTPException(status_code=404, detail="Chest not found")

    await require_campaign_dm(chest.campaign_id, current_user, db)

    # Check if item already exists in chest, stack if so
    existing = await db.execute(
        select(ChestInventory).where(
            ChestInventory.chest_id == chest_id,
            ChestInventory.item_id == payload.item_id
        )
    )
    existing_inv = existing.scalar_one_or_none()

    if existing_inv:
        existing_inv.quantity += payload.quantity
        await db.commit()
        await db.refresh(existing_inv)
        return existing_inv

    inv = ChestInventory(chest_id=chest_id, **payload.model_dump())
    db.add(inv)
    await db.commit()
    await db.refresh(inv)

    # Broadcast update
    await _broadcast_chest_update(chest, "chest_inventory_updated")
    return inv


@router.post("/{chest_id}/inventory/{inv_id}", response_model=ChestInventoryResponse)
async def update_inventory_item(
    chest_id: int, inv_id: int, payload: ChestInventoryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Update inventory item quantity"""
    # Verify chest exists and user is DM
    chest_res = await db.execute(select(Chest).where(Chest.id == chest_id))
    chest = chest_res.scalar_one_or_none()
    if not chest:
        raise HTTPException(status_code=404, detail="Chest not found")
    await require_campaign_dm(chest.campaign_id, current_user, db)

    result = await db.execute(
        select(ChestInventory).where(
            ChestInventory.id == inv_id,
            ChestInventory.chest_id == chest_id
        )
    )
    inv = result.scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Inventory item not found")

    update_data = payload.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(inv, k, v)
    await db.commit()
    await db.refresh(inv)
    return inv


@router.delete("/{chest_id}/inventory/{inv_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_inventory_item(
    chest_id: int, inv_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Remove an item from chest inventory"""
    # Verify chest exists and user is DM
    chest_res = await db.execute(select(Chest).where(Chest.id == chest_id))
    chest = chest_res.scalar_one_or_none()
    if not chest:
        raise HTTPException(status_code=404, detail="Chest not found")
    await require_campaign_dm(chest.campaign_id, current_user, db)

    result = await db.execute(
        select(ChestInventory).where(
            ChestInventory.id == inv_id,
            ChestInventory.chest_id == chest_id
        )
    )
    inv = result.scalar_one_or_none()
    if not inv:
        raise HTTPException(status_code=404, detail="Inventory item not found")

    await db.execute(delete(ChestInventory).where(ChestInventory.id == inv_id))
    await db.commit()
    return None


# ==================== Interaction Endpoints ====================

@router.post("/{chest_id}/investigate", response_model=InvestigateResponse)
async def investigate_chest(
    chest_id: int, payload: InvestigateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Investigate a chest to detect traps.
    Uses Investigation or Perception check vs trap_detection_dc.
    """
    result = await db.execute(select(Chest).where(Chest.id == chest_id))
    chest = result.scalar_one_or_none()
    if not chest:
        raise HTTPException(status_code=404, detail="Chest not found")

    await check_campaign_member(chest.campaign_id, current_user, db)

    # If no trap or already detected
    if not chest.is_trapped:
        return InvestigateResponse(
            success=True,
            trap_detected=False,
            message="你仔细检查了宝箱，没有发现任何陷阱。",
            chest=ChestResponse.model_validate(chest)
        )

    if chest.trap_detected:
        trap_name = TRAP_PRESETS.get(chest.trap_type, {}).get("name", chest.trap_type or "陷阱")
        return InvestigateResponse(
            success=True,
            trap_detected=True,
            message=f"你已经知道这个宝箱有{trap_name}。",
            chest=ChestResponse.model_validate(chest)
        )

    # Check against detection DC
    success = payload.roll_result >= chest.trap_detection_dc

    if success:
        chest.trap_detected = True
        await db.commit()
        await db.refresh(chest)
        await _broadcast_chest_update(chest, "chest_trap_detected")

        trap_name = TRAP_PRESETS.get(chest.trap_type, {}).get("name", chest.trap_type or "陷阱")
        effect = chest.trap_effect or {}
        effect_text = effect.get("effect_text", "")

        return InvestigateResponse(
            success=True,
            trap_detected=True,
            message=f"你发现了{trap_name}！{effect_text}",
            chest=ChestResponse.model_validate(chest)
        )
    else:
        return InvestigateResponse(
            success=True,
            trap_detected=False,
            message="你仔细检查了宝箱，没有发现任何陷阱。",
            chest=ChestResponse.model_validate(chest)
        )


@router.post("/{chest_id}/pick-lock", response_model=PickLockResponse)
async def pick_lock(
    chest_id: int, payload: PickLockRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Attempt to pick a chest's lock.
    Uses Dexterity (Thieves' Tools) check vs lock_dc.
    """
    result = await db.execute(select(Chest).where(Chest.id == chest_id))
    chest = result.scalar_one_or_none()
    if not chest:
        raise HTTPException(status_code=404, detail="Chest not found")

    await check_campaign_member(chest.campaign_id, current_user, db)

    # Check if locked
    if not chest.is_locked:
        return PickLockResponse(
            success=True,
            unlocked=True,
            message="宝箱已经是解锁状态。",
            chest=ChestResponse.model_validate(chest)
        )

    # Check if requires key
    if chest.requires_key:
        key_name = chest.key_name or "特定钥匙"
        return PickLockResponse(
            success=False,
            unlocked=False,
            message=f"这把锁需要{key_name}才能打开，无法用撬锁工具打开。",
            chest=ChestResponse.model_validate(chest)
        )

    # Check against lock DC
    success = payload.roll_result >= chest.lock_dc

    if success:
        chest.is_locked = False
        chest.state = "unlocked"
        await db.commit()
        await db.refresh(chest)
        await _broadcast_chest_update(chest, "chest_unlocked")

        return PickLockResponse(
            success=True,
            unlocked=True,
            message="你成功撬开了锁！",
            chest=ChestResponse.model_validate(chest)
        )
    else:
        diff = chest.lock_dc - payload.roll_result
        if diff >= 5:
            return PickLockResponse(
                success=False,
                unlocked=False,
                message="撬锁失败，锁太复杂了。",
                chest=ChestResponse.model_validate(chest)
            )
        else:
            return PickLockResponse(
                success=False,
                unlocked=False,
                message="撬锁失败，差一点就成功了。",
                chest=ChestResponse.model_validate(chest)
            )


@router.post("/{chest_id}/disarm-trap", response_model=DisarmTrapResponse)
async def disarm_trap(
    chest_id: int, payload: DisarmTrapRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Attempt to disarm a detected trap.
    Uses Dexterity (Thieves' Tools) check vs trap_disarm_dc.
    Failing by 5+ triggers the trap.
    """
    result = await db.execute(select(Chest).where(Chest.id == chest_id))
    chest = result.scalar_one_or_none()
    if not chest:
        raise HTTPException(status_code=404, detail="Chest not found")

    await check_campaign_member(chest.campaign_id, current_user, db)

    # Check if trapped
    if not chest.is_trapped:
        return DisarmTrapResponse(
            success=True,
            disarmed=True,
            triggered=False,
            message="这个宝箱没有陷阱。",
            chest=ChestResponse.model_validate(chest)
        )

    if chest.trap_disarmed:
        return DisarmTrapResponse(
            success=True,
            disarmed=True,
            triggered=False,
            message="陷阱已经被拆除了。",
            chest=ChestResponse.model_validate(chest)
        )

    if chest.trap_triggered:
        return DisarmTrapResponse(
            success=True,
            disarmed=False,
            triggered=True,
            message="陷阱已经被触发过了。",
            chest=ChestResponse.model_validate(chest)
        )

    # Check if trap detected
    if not chest.trap_detected:
        return DisarmTrapResponse(
            success=False,
            disarmed=False,
            triggered=False,
            message="你还没有发现陷阱，无法拆除。先进行调查检定来发现陷阱。",
            chest=ChestResponse.model_validate(chest)
        )

    # Check against disarm DC
    roll = payload.roll_result
    diff = chest.trap_disarm_dc - roll

    trap_name = TRAP_PRESETS.get(chest.trap_type, {}).get("name", chest.trap_type or "陷阱")

    if roll >= chest.trap_disarm_dc:
        # Success
        chest.trap_disarmed = True
        await db.commit()
        await db.refresh(chest)
        await _broadcast_chest_update(chest, "chest_trap_disarmed")

        return DisarmTrapResponse(
            success=True,
            disarmed=True,
            triggered=False,
            message=f"你成功拆除了{trap_name}！",
            chest=ChestResponse.model_validate(chest)
        )
    elif diff >= 5:
        # Critical failure - trigger trap
        chest.trap_triggered = True
        await db.commit()
        await db.refresh(chest)
        await _broadcast_chest_update(chest, "chest_trap_triggered")

        effect = chest.trap_effect or {}
        damage = effect.get("damage")
        effect_text = effect.get("effect_text", "陷阱触发了！")

        return DisarmTrapResponse(
            success=False,
            disarmed=False,
            triggered=True,
            damage_taken=damage,
            message=f"拆除失败，{trap_name}触发了！{effect_text}",
            chest=ChestResponse.model_validate(chest)
        )
    else:
        # Normal failure
        return DisarmTrapResponse(
            success=False,
            disarmed=False,
            triggered=False,
            message=f"拆除{trap_name}失败，但陷阱没有触发。你可以再试一次。",
            chest=ChestResponse.model_validate(chest)
        )


@router.post("/{chest_id}/open", response_model=OpenChestResponse)
async def open_chest(
    chest_id: int, payload: OpenChestRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Open a chest. Triggers any active traps.
    Chest must be unlocked first.
    """
    result = await db.execute(select(Chest).where(Chest.id == chest_id))
    chest = result.scalar_one_or_none()
    if not chest:
        raise HTTPException(status_code=404, detail="Chest not found")

    await check_campaign_member(chest.campaign_id, current_user, db)

    # Check state
    if chest.state == "open" or chest.state == "looted":
        # Get contents
        contents = await _get_chest_contents(chest_id, db)
        return OpenChestResponse(
            success=True,
            trap_triggered=False,
            message="宝箱已经打开了。",
            chest=ChestResponse.model_validate(chest),
            contents=contents
        )

    # Check if locked
    if chest.is_locked:
        return OpenChestResponse(
            success=False,
            trap_triggered=False,
            message="宝箱是锁着的。需要先解锁或撬锁。",
            chest=ChestResponse.model_validate(chest)
        )

    # Check for active trap
    trap_triggered = False
    damage_taken = None
    trap_message = ""

    if chest.is_trapped and not chest.trap_disarmed and not chest.trap_triggered:
        # Trap triggers!
        chest.trap_triggered = True
        trap_triggered = True

        trap_name = TRAP_PRESETS.get(chest.trap_type, {}).get("name", chest.trap_type or "陷阱")
        effect = chest.trap_effect or {}
        damage_taken = effect.get("damage")
        effect_text = effect.get("effect_text", "")
        trap_message = f"{trap_name}触发了！{effect_text} "

    # Open the chest
    chest.state = "open"
    await db.commit()
    await db.refresh(chest)
    await _broadcast_chest_update(chest, "chest_opened")

    # Get contents
    contents = await _get_chest_contents(chest_id, db)

    message = trap_message + "你打开了宝箱。"
    if contents.get("items") or any(contents.get("currency", {}).values()):
        message += " 里面有一些东西！"
    else:
        message += " 里面是空的。"

    return OpenChestResponse(
        success=True,
        trap_triggered=trap_triggered,
        damage_taken=damage_taken,
        message=message,
        chest=ChestResponse.model_validate(chest),
        contents=contents
    )


@router.post("/{chest_id}/loot", response_model=LootResponse)
async def loot_chest(
    chest_id: int, payload: LootRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Loot items and currency from an open chest.
    Transfers items/currency to the character's inventory.
    """
    result = await db.execute(select(Chest).where(Chest.id == chest_id))
    chest = result.scalar_one_or_none()
    if not chest:
        raise HTTPException(status_code=404, detail="Chest not found")

    await check_campaign_member(chest.campaign_id, current_user, db)

    # Check if open
    if chest.state != "open" and chest.state != "looted":
        return LootResponse(
            success=False,
            message="宝箱还没有打开。",
            chest=ChestResponse.model_validate(chest)
        )

    # Fetch character
    char_result = await db.execute(select(Character).where(Character.id == payload.character_id))
    char = char_result.scalar_one_or_none()
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")

    looted_items = []
    looted_currency = {}
    already_taken_items = []  # Track items that were already taken by others

    # Loot currency
    if payload.take_currency:
        currency_taken = {}
        if chest.cp > 0:
            currency_taken["cp"] = chest.cp
            chest.cp = 0
        if chest.sp > 0:
            currency_taken["sp"] = chest.sp
            chest.sp = 0
        if chest.ep > 0:
            currency_taken["ep"] = chest.ep
            chest.ep = 0
        if chest.gp > 0:
            currency_taken["gp"] = chest.gp
            chest.gp = 0
        if chest.pp > 0:
            currency_taken["pp"] = chest.pp
            chest.pp = 0

        if currency_taken:
            # Add to character currency
            cur = char.currency or {}
            for coin, amount in currency_taken.items():
                cur[coin] = int(cur.get(coin, 0)) + amount
            char.currency = cur
            flag_modified(char, "currency")
            looted_currency = currency_taken

    # Loot items (with row-level locking to prevent race conditions)
    if payload.items:
        for loot_item in payload.items:
            inv_id = loot_item.get("inventory_id")
            qty = loot_item.get("quantity", 1)

            # Use FOR UPDATE to lock the row and prevent concurrent modifications
            inv_result = await db.execute(
                select(ChestInventory)
                .where(ChestInventory.id == inv_id, ChestInventory.chest_id == chest_id)
                .options(selectinload(ChestInventory.item))
                .with_for_update()  # Lock row to prevent race condition
            )
            inv = inv_result.scalar_one_or_none()
            if not inv:
                continue

            # Re-check quantity after acquiring lock
            take_qty = min(qty, inv.quantity)
            if take_qty <= 0:
                # Item was already taken by someone else
                if inv.item:
                    item_name = getattr(inv.item, "name_cn", None) or getattr(inv.item, "name", None) or "物品"
                    already_taken_items.append(item_name)
                continue

            # Add to character equipment
            db_item = inv.item
            if db_item:
                equip_list = char.equipment if isinstance(char.equipment, list) else []
                item_payload = build_item_payload_from_model(db_item, quantity=take_qty)
                equip_list, _, _ = merge_item_into_equipment(
                    equip_list,
                    item_payload,
                    quantity=take_qty,
                )

                char.equipment = equip_list
                flag_modified(char, "equipment")

                looted_items.append({
                    "item_id": db_item.id,
                    "name": item_payload.get("name") or getattr(db_item, "name_cn", None) or getattr(db_item, "name", None) or "物品",
                    "quantity": take_qty
                })

            # Update chest inventory
            inv.quantity -= take_qty
            if inv.quantity <= 0:
                await db.delete(inv)
    else:
        # Loot all items (with row-level locking to prevent race conditions)
        inv_result = await db.execute(
            select(ChestInventory)
            .where(ChestInventory.chest_id == chest_id)
            .options(selectinload(ChestInventory.item))
            .with_for_update()  # Lock all rows to prevent race condition
        )
        all_inv = inv_result.scalars().all()

        equip_list = char.equipment if isinstance(char.equipment, list) else []

        for inv in all_inv:
            # Re-check quantity after acquiring lock
            if inv.quantity <= 0:
                continue

            db_item = inv.item
            if not db_item:
                continue

            item_payload = build_item_payload_from_model(db_item, quantity=inv.quantity)
            equip_list, _, _ = merge_item_into_equipment(
                equip_list,
                item_payload,
                quantity=inv.quantity,
            )

            looted_items.append({
                "item_id": db_item.id,
                "name": item_payload.get("name") or getattr(db_item, "name_cn", None) or getattr(db_item, "name", None) or "物品",
                "quantity": inv.quantity
            })

            await db.delete(inv)

        char.equipment = list(equip_list)
        flag_modified(char, "equipment")

    # Check if chest is now empty
    remaining = await db.execute(
        select(ChestInventory).where(ChestInventory.chest_id == chest_id)
    )
    has_items = remaining.scalar_one_or_none() is not None
    has_currency = (chest.cp > 0 or chest.sp > 0 or chest.ep > 0 or chest.gp > 0 or chest.pp > 0)

    if not has_items and not has_currency:
        chest.state = "looted"

    await db.commit()
    await db.refresh(chest)
    await db.refresh(char)
    await _broadcast_chest_update(chest, "chest_looted")

    try:
        await realtime_publisher.publish_character_equipment_updated(
            chest.campaign_id,
            character_id=char.id,
            equipment=char.equipment or [],
            currency=char.currency or {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0},
            reason="chest_looted",
        )
    except Exception as exc:
        logger.warning("[Chest] Failed to broadcast character equipment update after loot: %s", exc)

    # Build message
    parts = []
    if looted_items:
        item_strs = [f"{i['name']} x{i['quantity']}" for i in looted_items]
        parts.append(f"物品: {', '.join(item_strs)}")
    if looted_currency:
        coin_strs = []
        for coin in ["pp", "gp", "ep", "sp", "cp"]:
            if looted_currency.get(coin, 0) > 0:
                coin_strs.append(f"{looted_currency[coin]}{coin}")
        if coin_strs:
            parts.append(f"货币: {', '.join(coin_strs)}")

    message = "你获得了: " + "; ".join(parts) if parts else "没有东西可拿。"

    # Add warning about items already taken by others
    if already_taken_items:
        message += f" ⚠️ 以下物品已被其他人拿走: {', '.join(already_taken_items)}"

    return LootResponse(
        success=True,
        message=message,
        looted_items=looted_items,
        looted_currency=looted_currency,
        chest=ChestResponse.model_validate(chest)
    )


# ==================== Avatar Generation ====================

@router.post("/{chest_id}/generate-avatar", response_model=ChestResponse)
async def generate_chest_avatar(
    chest_id: int,
    db: AsyncSession = Depends(get_db),
    body: Optional[ChestAvatarGenRequest] = None,
    current_user: dict = Depends(require_auth),
):
    """Generate an AI avatar for a chest"""
    result = await db.execute(select(Chest).where(Chest.id == chest_id))
    chest = result.scalar_one_or_none()
    if not chest:
        raise HTTPException(status_code=404, detail="Chest not found")

    await require_campaign_dm(chest.campaign_id, current_user, db)

    try:
        small_url, large_url = await avatar_service.generate_avatar(
            db=db,
            entity_type="chest",
            entity_id=chest.id,
            name=chest.name or "",
            description=chest.description or "",
            appearance=chest.appearance_description or "",
            prompt_override=body.prompt_override if body else None
        )

        if is_temporary_avatar_url(small_url):
            repaired = await materialize_avatar_url(small_url, "chest", chest.id, chest.name or "")
            if repaired:
                small_url, large_url = repaired

        chest.avatar_url = small_url
        chest.avatar_url_large = large_url
        chest.has_avatar = True
        await db.commit()
        await db.refresh(chest)

        await _broadcast_chest_update(chest, "chest_avatar_updated")
        return chest

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to generate chest avatar: {e}")


# ==================== Helper Functions ====================

async def _get_chest_contents(chest_id: int, db: AsyncSession) -> Dict[str, Any]:
    """Get chest contents (items and currency)"""
    result = await db.execute(select(Chest).where(Chest.id == chest_id))
    chest = result.scalar_one_or_none()

    if not chest:
        return {"items": [], "currency": {}}

    # Get inventory
    inv_result = await db.execute(
        select(ChestInventory)
        .where(ChestInventory.chest_id == chest_id)
        .options(selectinload(ChestInventory.item))
    )
    inventory = inv_result.scalars().all()

    items = []
    for inv in inventory:
        item_data = None
        if inv.item:
            item_data = {
                "inventory_id": inv.id,
                "item_id": inv.item.id,
                "name": inv.item.name,
                "name_cn": getattr(inv.item, "name_cn", None),
                "quantity": inv.quantity,
                "rarity": getattr(inv.item, "rarity", None),
                "avatar_url": getattr(inv.item, "avatar_url", None),
            }
            items.append(item_data)

    return {
        "items": items,
        "currency": {
            "cp": chest.cp or 0,
            "sp": chest.sp or 0,
            "ep": chest.ep or 0,
            "gp": chest.gp or 0,
            "pp": chest.pp or 0,
        }
    }


async def _broadcast_chest_update(chest: Chest, event_type: str):
    """Broadcast chest update to campaign"""
    try:
        await realtime_publisher.publish_chest_event(
            chest.campaign_id,
            event_type=event_type,
            chest=ChestResponse.model_validate(chest).model_dump(),
        )
    except Exception as e:
        print(f"[WebSocket] Failed to broadcast chest update: {e}")
