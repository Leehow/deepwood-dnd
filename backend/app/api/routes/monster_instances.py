from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm.attributes import flag_modified
from typing import List, Optional
import logging
from pydantic import BaseModel

from app.db.session import get_db
from app.models.token import Token

logger = logging.getLogger(__name__)
from app.models.monster_instance import MonsterInstance
from app.models.monster_avatar import MonsterAvatar
from app.schemas.monster_instance import (
    MonsterInstanceCreate,
    MonsterInstanceUpdate,
    MonsterInstanceResponse,
    MonsterAvatarGenerationRequest,
    MonsterAvatarGenerationResponse
)
from app.services.avatar_service import avatar_service
from app.services.entity_creation_service import (
    creature_size_to_token_size,
    normalize_creature_size,
)
from app.services.realtime_publisher import realtime_publisher
from app.core.security import require_auth
from app.utils.item_payload_normalizer import (
    normalize_character_equipment_payloads,
    normalize_item_payload,
)
from app.utils.permission_checks import require_campaign_dm, check_campaign_member

router = APIRouter(prefix="/api/monster-instances", tags=["monster-instances"])


def _merge_currency(base_currency: Optional[dict], extra_currency: Optional[dict]) -> dict:
    currency = dict(base_currency or {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0})
    for coin_type in ("cp", "sp", "ep", "gp", "pp"):
        amount = int((extra_currency or {}).get(coin_type) or 0)
        if amount:
            currency[coin_type] = int(currency.get(coin_type) or 0) + amount
    return currency


def _normalize_monster_payload_dict(payload: dict) -> dict:
    normalized = dict(payload)
    has_inventory = "inventory" in normalized
    has_equipment = "equipment" in normalized
    has_currency = "currency" in normalized

    inventory_items, inventory_currency, _ = normalize_character_equipment_payloads(
        normalized.get("inventory") if has_inventory else []
    )
    equipment_items, equipment_currency, _ = normalize_character_equipment_payloads(
        normalized.get("equipment") if has_equipment else []
    )

    if has_inventory:
        normalized["inventory"] = inventory_items
    if has_equipment:
        normalized["equipment"] = equipment_items or None

    if has_currency or any(inventory_currency.values()) or any(equipment_currency.values()):
        currency = _merge_currency(normalized.get("currency"), inventory_currency)
        normalized["currency"] = _merge_currency(currency, equipment_currency)

    return normalized


def _apply_normalized_monster_payload(monster: MonsterInstance) -> bool:
    normalized = _normalize_monster_payload_dict(
        {
            "inventory": monster.inventory,
            "equipment": monster.equipment,
            "currency": monster.currency,
        }
    )
    changed = False

    for field in ("inventory", "equipment", "currency"):
        next_value = normalized.get(field)
        if getattr(monster, field) != next_value:
            setattr(monster, field, next_value)
            flag_modified(monster, field)
            changed = True

    return changed


async def _commit_normalized_monsters(
    db: AsyncSession, monsters: List[MonsterInstance]
) -> None:
    """Persist lazy payload normalization, then reload server-generated columns.

    ``updated_at`` uses ``onupdate=func.now()``; the normalization UPDATE makes the
    flush expire it (even with ``expire_on_commit=False``, since the new value is
    server-generated). Left expired, it lazy-loads during response-model
    serialization — outside the async greenlet — raising MissingGreenlet / HTTP 500.
    This reproduces on the first GET right after the QA seed inserts un-normalized
    monsters; reloading here keeps serialization to in-memory reads only.
    """
    changed = [m for m in monsters if _apply_normalized_monster_payload(m)]
    if not changed:
        return
    await db.commit()
    for monster in changed:
        await db.refresh(monster, attribute_names=["updated_at"])


def _item_payload_identity(item: dict) -> tuple[str, str | int]:
    normalized = normalize_item_payload(item, quantity=item.get("quantity") if isinstance(item, dict) else None)
    library_item_id = normalized.get("libraryItemId")
    if library_item_id is not None:
        return ("library", int(library_item_id))
    return ("id", str(normalized.get("id") or "unknown-item"))


def _remove_transferred_items(items: Optional[list], transfer_counts: dict[tuple[str, str | int], int]) -> list:
    if not isinstance(items, list):
        return []

    remaining = []
    pending_counts = dict(transfer_counts)

    for item in items:
        if not isinstance(item, dict):
            remaining.append(item)
            continue

        identity = _item_payload_identity(item)
        remove_qty = pending_counts.get(identity, 0)
        if remove_qty <= 0:
            remaining.append(item)
            continue

        current_qty = int(item.get("quantity") or 1)
        if current_qty > remove_qty:
            next_qty = current_qty - remove_qty
            remaining.append(normalize_item_payload(item, quantity=next_qty))
            pending_counts[identity] = 0
        else:
            pending_counts[identity] = remove_qty - current_qty

    return remaining


@router.post("", response_model=MonsterInstanceResponse, status_code=status.HTTP_201_CREATED)
async def create_monster_instance(
    monster: MonsterInstanceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Create a new monster instance in the campaign

    If the monster has preset default avatars (from monsters.json), they will be
    automatically applied. The avatar paths are converted from local paths like
    "/assets/monster-avatars/goblin_128.webp" to full URLs.
    """
    # Set current_hp to hit_points if not provided
    monster_data = monster.model_dump()
    if monster_data.get("current_hp") is None and monster_data.get("hit_points"):
        monster_data["current_hp"] = monster_data["hit_points"]

    # Auto-set token_size from creature size if not explicitly provided
    if not monster_data.get("token_size") and monster_data.get("size"):
        monster_data["token_size"] = _get_token_size(monster_data["size"])
    if monster_data.get("size"):
        monster_data["size"] = normalize_creature_size(monster_data["size"])

    if not monster_data.get("entity_type"):
        monster_data["entity_type"] = "monster"

    inner_monster_data = monster_data.get("monster_data") or {}
    if inner_monster_data.get("speed") is not None and inner_monster_data.get("speeds") is None:
        inner_monster_data["speeds"] = inner_monster_data.pop("speed")
    if inner_monster_data.get("abilityScores") is not None and inner_monster_data.get("ability_scores") is None:
        inner_monster_data["ability_scores"] = inner_monster_data.pop("abilityScores")
    if inner_monster_data.get("specialAbilities") is not None and inner_monster_data.get("special_abilities") is None:
        inner_monster_data["special_abilities"] = inner_monster_data.pop("specialAbilities")
    if inner_monster_data.get("legendaryActions") is not None and inner_monster_data.get("legendary_actions") is None:
        inner_monster_data["legendary_actions"] = inner_monster_data.pop("legendaryActions")
    if inner_monster_data.get("hpFormula") is not None and inner_monster_data.get("hp_formula") is None:
        inner_monster_data["hp_formula"] = inner_monster_data.pop("hpFormula")
    if inner_monster_data.get("nameEn") is not None and inner_monster_data.get("name_en") is None:
        inner_monster_data["name_en"] = inner_monster_data.pop("nameEn")
    inner_monster_data.pop("is_npc", None)
    monster_data["monster_data"] = inner_monster_data

    # Check for preset default avatars in monster_data (from monsters.json)
    default_small = inner_monster_data.get("defaultAvatarSmall")
    default_large = inner_monster_data.get("defaultAvatarLarge")

    if default_small and default_large:
        # Convert local paths to full static asset URLs
        # In production, these will be served from OSS via oss-asset-mapping.json
        # In development, served from /public/assets/
        monster_data["avatar_url"] = default_small  # Will be resolved by frontend
        monster_data["avatar_url_large"] = default_large
        monster_data["has_avatar"] = True
        logger.info(f"Using preset avatar for monster: {monster_data.get('name')}")

    monster_data = _normalize_monster_payload_dict(monster_data)
    db_monster = MonsterInstance(**monster_data)
    db.add(db_monster)
    await db.commit()
    await db.refresh(db_monster)
    return db_monster


@router.get("/campaign/{campaign_id}", response_model=List[MonsterInstanceResponse])
async def get_campaign_monsters(
    campaign_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    Get all monster instances for a specific campaign
    """
    result = await db.execute(
        select(MonsterInstance)
        .where(MonsterInstance.campaign_id == campaign_id)
        .order_by(MonsterInstance.id.desc())
    )
    monsters = result.scalars().all()
    await _commit_normalized_monsters(db, monsters)
    return monsters


@router.get("/by-controller/{character_id}", response_model=List[MonsterInstanceResponse])
async def get_controlled_monsters(
    character_id: int,
    campaign_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Get all MonsterInstances controlled by a character (companions, familiars, summons)."""
    from sqlalchemy import and_
    query = select(MonsterInstance).where(
        MonsterInstance.controller_character_id == character_id
    )
    if campaign_id is not None:
        query = query.where(MonsterInstance.campaign_id == campaign_id)
    query = query.order_by(MonsterInstance.control_type, MonsterInstance.name)
    result = await db.execute(query)
    monsters = result.scalars().all()
    await _commit_normalized_monsters(db, monsters)
    return monsters


class SummonCompanionRequest(BaseModel):
    character_id: int
    campaign_id: int
    map_url: str


@router.post("/summon-companion")
async def summon_companion(
    req: SummonCompanionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Summon/teleport companion token next to the owner character on the current map.
    If the companion MonsterInstance doesn't exist yet, create it from companions.json.
    If the token exists on the map, move it next to the owner. If not, create it.
    """
    from sqlalchemy import and_
    from app.models.character import Character
    from app.models.campaign import Campaign
    from app.models.map_settings import MapSettings
    from pathlib import Path
    import json

    # Get character
    char_result = await db.execute(select(Character).where(Character.id == req.character_id))
    character = char_result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    companion_id = (character.subclass_choices or {}).get("beastCompanion")
    familiar_id = (character.subclass_choices or {}).get("familiarForm")
    if not companion_id and not familiar_id:
        raise HTTPException(status_code=400, detail="Character has no beast companion or familiar")

    # Determine category and control_type
    if companion_id:
        target_id = companion_id
        category = "beast_master"
        ctrl_type = "companion"
    else:
        target_id = familiar_id
        category = "find_familiar"
        ctrl_type = "familiar"

    # Find or create companion MonsterInstance
    mi_result = await db.execute(
        select(MonsterInstance).where(and_(
            MonsterInstance.campaign_id == req.campaign_id,
            MonsterInstance.controller_character_id == character.id,
            MonsterInstance.control_type == ctrl_type
        )).with_for_update()
    )
    instance = mi_result.scalar_one_or_none()

    if not instance:
        # Create from companions.json
        from app.utils.rules_cache import get_companions_data
        companions_data = get_companions_data()
        beast = None
        for c in companions_data["categories"][category]["creatures"]:
            if c["id"] == target_id:
                beast = c
                break
        if not beast:
            raise HTTPException(status_code=400, detail=f"Unknown companion: {target_id}")

        ability_scores = {k: beast["abilityScores"].get(k, 10) for k in ["str", "dex", "con", "int", "wis", "cha"]}
        instance = MonsterInstance(
            campaign_id=req.campaign_id,
            monster_id=f"{ctrl_type}_{target_id}",
            name=beast.get("nameEn", target_id),
            name_cn=beast.get("name", ""),
            entity_type=ctrl_type,
            size=beast.get("size", "中型"),
            type=beast.get("type", "野兽"),
            challenge_rating=beast.get("cr", "1/4"),
            armor_class=beast.get("ac", 10),
            hit_points=beast.get("hp", 10),
            hit_dice=beast.get("hpFormula", ""),
            ability_scores=ability_scores,
            speeds=beast.get("speed", {"walk": 30}),
            monster_data={
                "specialAbilities": beast.get("specialAbilities", []),
                "actions": beast.get("actions", []),
                "skills": beast.get("skills", ""),
                "senses": beast.get("senses", {}),
                "trait": beast.get("trait", ""),
                "hpFormula": beast.get("hpFormula", ""),
            },
            avatar_url=f"/assets/monster-avatars/{target_id}_128.webp",
            avatar_url_large=f"/assets/monster-avatars/{target_id}_512.webp",
            has_avatar=True,
            current_hp=beast.get("hp", 10),
            token_size="1x1",
            controller_character_id=character.id,
            control_type=ctrl_type,
        )
        db.add(instance)
        await db.flush()

    # Find owner token position
    owner_token_result = await db.execute(
        select(Token).where(and_(
            Token.campaign_id == req.campaign_id,
            Token.character_id == character.id,
            Token.map_url == req.map_url
        ))
    )
    owner_token = owner_token_result.scalar_one_or_none()
    if owner_token:
        center_x, center_y = owner_token.position_x, owner_token.position_y
    else:
        center_x, center_y = 15, 10

    # Get used positions
    used_result = await db.execute(
        select(Token.position_x, Token.position_y).where(and_(
            Token.campaign_id == req.campaign_id,
            Token.map_url == req.map_url
        ))
    )
    used_positions = {(r.position_x, r.position_y) for r in used_result.all()}

    deltas = [
        (1, 0), (0, 1), (-1, 0), (0, -1),
        (1, 1), (-1, 1), (1, -1), (-1, -1),
        (2, 0), (0, 2), (-2, 0), (0, -2),
    ]

    # Check if companion token already exists on this map
    existing_token_result = await db.execute(
        select(Token).where(and_(
            Token.campaign_id == req.campaign_id,
            Token.monster_instance_id == instance.id,
            Token.map_url == req.map_url
        ))
    )
    existing_token = existing_token_result.scalar_one_or_none()

    if existing_token:
        # Move to next to owner (exclude own position from used)
        used_positions.discard((existing_token.position_x, existing_token.position_y))
        pos_x, pos_y = center_x + 1, center_y
        for dx, dy in deltas:
            candidate = (center_x + dx, center_y + dy)
            if candidate not in used_positions:
                pos_x, pos_y = candidate
                break
        existing_token.position_x = pos_x
        existing_token.position_y = pos_y
        await db.commit()

        token_data = {
            "id": existing_token.id,
            "campaign_id": req.campaign_id,
            "monster_instance_id": instance.id,
            "user_id": character.user_id,
            "map_url": req.map_url,
            "position_x": pos_x,
            "position_y": pos_y,
            "token_size": "1x1",
            "instance_name": instance.name_cn or instance.name,
            "monster_name": instance.name,
            "monster_name_cn": instance.name_cn,
            "avatar": instance.avatar_url,
            "avatar_large": instance.avatar_url_large,
            "faction": "player",
            "current_hp": instance.current_hp,
            "max_hp": instance.hit_points,
            "controller_character_id": instance.controller_character_id,
            "control_type": instance.control_type,
        }
        await realtime_publisher.publish_token_moved(
            req.campaign_id,
            token_id=existing_token.id,
            position_x=pos_x,
            position_y=pos_y,
        )
        return {"status": "moved", "token": token_data}

    else:
        # Create new token
        pos_x, pos_y = center_x + 1, center_y
        for dx, dy in deltas:
            candidate = (center_x + dx, center_y + dy)
            if candidate not in used_positions:
                pos_x, pos_y = candidate
                break

        token = Token(
            campaign_id=req.campaign_id,
            monster_instance_id=instance.id,
            user_id=character.user_id,
            map_url=req.map_url,
            position_x=pos_x,
            position_y=pos_y,
            token_size="1x1",
            instance_name=instance.name_cn or instance.name,
            faction="player",
        )
        db.add(token)
        await db.commit()

        token_data = {
            "id": token.id,
            "campaign_id": req.campaign_id,
            "monster_instance_id": instance.id,
            "user_id": character.user_id,
            "map_url": req.map_url,
            "position_x": pos_x,
            "position_y": pos_y,
            "token_size": "1x1",
            "instance_name": instance.name_cn or instance.name,
            "monster_name": instance.name,
            "monster_name_cn": instance.name_cn,
            "avatar": instance.avatar_url,
            "avatar_large": instance.avatar_url_large,
            "faction": "player",
            "current_hp": instance.current_hp,
            "max_hp": instance.hit_points,
            "controller_character_id": instance.controller_character_id,
            "control_type": instance.control_type,
        }
        await realtime_publisher.publish_token_placed(req.campaign_id, token=token_data)
        return {"status": "created", "token": token_data}


@router.post("/dismiss-companion")
async def dismiss_companion(
    req: SummonCompanionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Remove companion token from the current map (MonsterInstance is kept)."""
    from sqlalchemy import and_

    # Find companion instance (companion or familiar)
    mi_result = await db.execute(
        select(MonsterInstance).where(and_(
            MonsterInstance.campaign_id == req.campaign_id,
            MonsterInstance.controller_character_id == req.character_id,
            MonsterInstance.control_type.in_(["companion", "familiar"])
        ))
    )
    instance = mi_result.scalar_one_or_none()
    if not instance:
        return {"status": "no_companion"}

    # Find and delete token on this map
    token_result = await db.execute(
        select(Token).where(and_(
            Token.campaign_id == req.campaign_id,
            Token.monster_instance_id == instance.id,
            Token.map_url == req.map_url
        ))
    )
    token = token_result.scalar_one_or_none()
    if not token:
        return {"status": "not_on_map"}

    token_id = token.id
    await db.delete(token)
    await db.commit()

    await realtime_publisher.publish_map_token_removed(req.campaign_id, token_id=token_id)
    return {"status": "dismissed", "token_id": token_id}


@router.post("/generate-avatar", response_model=MonsterAvatarGenerationResponse)
async def generate_monster_avatar(
    request: MonsterAvatarGenerationRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Generate avatar for a monster instance using Fast Image Generation Model

    Creates a portrait image based on monster's appearance description from monsters.json
    """
    # Get monster instance
    result = await db.execute(
        select(MonsterInstance).where(MonsterInstance.id == request.monster_instance_id)
    )
    monster = result.scalar_one_or_none()

    if not monster:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Monster instance with id {request.monster_instance_id} not found"
        )

    try:
        # Extract appearance from monster_data or use override
        appearance_text = ""

        if request.appearance_description:
            appearance_text = request.appearance_description
        elif monster.monster_data:
            # Try 'appearanceEn' first (best for image generation), then 'appearance'
            # Do NOT use 'description' - it often contains stat blocks that AI renders as text
            if monster.monster_data.get("appearanceEn"):
                appearance_text = monster.monster_data["appearanceEn"]
            elif monster.monster_data.get("appearance"):
                appearance_text = monster.monster_data["appearance"]

        # Prepare monster attributes for AI-generated appearance (if needed)
        monster_attributes = {
            "name_cn": monster.name_cn,
            "size": monster.size,
            "type": monster.type,
            "ability_scores": monster.monster_data.get("abilityScores") if monster.monster_data else None,
        }

        # Determine if this is an NPC (check request flag OR entity_type)
        is_npc = request.is_npc or monster.entity_type == "npc"

        # Build custom prompt for NPC (character portrait style)
        prompt_override = None
        if is_npc:
            # Get role from monster_data
            role = monster.monster_data.get("role", "") if monster.monster_data else ""
            display_name = monster.name_cn or monster.name
            npc_prompt = f"A detailed D&D fantasy character portrait of {display_name}"
            if role:
                npc_prompt += f", a {role}"
            npc_prompt += ". "
            if appearance_text:
                npc_prompt += f"Appearance: {appearance_text[:250]}. "
            npc_prompt += "IMPORTANT: Any stats or attributes are only for visual reference to inform physique and demeanor, do NOT draw them as text. Professional digital character art, fantasy RPG style, warm lighting, friendly or neutral expression, detailed face and clothing, high quality portrait, centered composition, NO TEXT, NO STATS, NO NUMBERS, NO LABELS, pure artwork only"
            prompt_override = npc_prompt

        # Use AvatarService to generate avatar (returns tuple: small_url, large_url)
        small_url, large_url = await avatar_service.generate_avatar(
            db=db,
            entity_type="monster",
            entity_id=monster.id,
            name=monster.name,
            appearance=appearance_text,
            size=monster.size or "",
            entity_subtype=monster.type or "",
            alignment=monster.alignment or "",
            generate_appearance_with_ai=True,  # Enable AI generation if appearance missing
            monster_attributes=monster_attributes,
            is_npc=is_npc,
            prompt_override=prompt_override
        )

        # Build prompt for response (reconstruct for logging)
        prompt_parts = [
            f"A detailed D&D fantasy monster portrait of a {monster.name}",
            f"{monster.size} {monster.type}" if monster.size and monster.type else "",
            f"Appearance: {appearance_text[:200]}" if appearance_text else "",
            f"Alignment: {monster.alignment}" if monster.alignment else "",
            "Epic fantasy monster art style"
        ]
        prompt = ", ".join([p for p in prompt_parts if p])

        # Update monster instance with avatar URLs (small for 1x1, large for 2x2+)
        monster.avatar_url = small_url
        monster.avatar_url_large = large_url
        monster.has_avatar = True

        # Add to shared avatar library (use large URL for sharing)
        shared_avatar = MonsterAvatar(
            monster_id=monster.monster_id,
            monster_name=monster.name,  # Save name for lookup
            avatar_url=small_url,
            avatar_url_large=large_url,
            created_by=request.created_by if hasattr(request, 'created_by') else None,
            usage_count=1  # Creator counts as first use
        )
        db.add(shared_avatar)

        await db.commit()

        return MonsterAvatarGenerationResponse(
            success=True,
            avatar_url=small_url,
            avatar_url_large=large_url,
            prompt=prompt
        )

    except HTTPException:
        # Re-raise HTTPExceptions from avatar_service
        raise
    except Exception as e:
        print(f"[Monster Avatar] Error: {e}")
        import traceback
        traceback.print_exc()
        return MonsterAvatarGenerationResponse(
            success=False,
            error=f"Failed to generate avatar: {str(e)}"
        )


@router.post("/{monster_instance_id}/avatar")
async def update_monster_avatar(
    monster_instance_id: int,
    req: dict,
    db: AsyncSession = Depends(get_db),
):
    """Update monster instance avatar from base64 data URL (for equipment regen)"""
    result = await db.execute(
        select(MonsterInstance).where(MonsterInstance.id == monster_instance_id)
    )
    monster = result.scalar_one_or_none()
    if not monster:
        raise HTTPException(status_code=404, detail="Monster instance not found")

    avatar_data = req.get("avatar", "")
    if not avatar_data:
        raise HTTPException(status_code=400, detail="Missing avatar data")

    avatar_url = avatar_data
    avatar_large_url = avatar_data

    # If base64 data, upload to OSS
    if avatar_data.startswith("data:image/") or not avatar_data.startswith("http"):
        from app.domain.parsing.oss_storage import get_oss_storage
        oss = get_oss_storage()
        result_urls = await oss.upload_avatar_base64_async(avatar_data, "monster", monster_instance_id)
        if result_urls:
            avatar_url, avatar_large_url = result_urls
        else:
            raise HTTPException(status_code=500, detail="Failed to upload avatar to OSS")

    monster.avatar_url = avatar_url
    monster.avatar_url_large = avatar_large_url
    monster.has_avatar = True
    await db.commit()

    return {"success": True, "avatar_url": avatar_url, "avatar_url_large": avatar_large_url}

import httpx
import json
import re
import uuid
from pydantic import BaseModel as PydanticBaseModel, Field
from typing import Dict, Any
from app.services.ai_model_service import ai_model_service
from app.models.ai_settings import ModelType

# Instructor for structured LLM output
try:
    import instructor
    from openai import AsyncOpenAI
    INSTRUCTOR_AVAILABLE = True
except ImportError:
    INSTRUCTOR_AVAILABLE = False
    logger.warning("instructor not installed, falling back to manual JSON parsing")


# ============ Pydantic Models for Structured Output ============

class DamageInfo(PydanticBaseModel):
    """伤害信息结构"""
    dice: str = Field(description="伤害骰，如 1d8+3")
    type: str = Field(description="伤害类型，如 挥砍、穿刺、钝击、火焰等")


class MonsterAction(PydanticBaseModel):
    """怪物动作结构"""
    name: str = Field(description="动作名称")
    description: str = Field(
        description="动作描述，攻击格式：'近战武器攻击：+X 命中，触及 Y 尺。命中则造成 NdM+B TYPE伤害。'"
    )
    attack_bonus: Optional[int] = Field(default=None, description="攻击加值数字，如 5")
    damage: Optional[DamageInfo] = Field(default=None, description="伤害信息")


class SpecialAbility(PydanticBaseModel):
    """特殊能力结构"""
    name: str = Field(description="能力名称")
    description: str = Field(description="能力描述")


class LegendaryAction(PydanticBaseModel):
    """传奇动作结构"""
    name: str = Field(description="传奇动作名称")
    description: str = Field(description="描述")
    cost: int = Field(default=1, description="消耗传奇动作点数")


class AbilityScores(PydanticBaseModel):
    """属性值结构"""
    strength: int = Field(default=10, alias="str", description="力量")
    strMod: int = Field(default=0, description="力量调整值")
    dexterity: int = Field(default=10, alias="dex", description="敏捷")
    dexMod: int = Field(default=0, description="敏捷调整值")
    constitution: int = Field(default=10, alias="con", description="体质")
    conMod: int = Field(default=0, description="体质调整值")
    intelligence: int = Field(default=10, alias="int", description="智力")
    intMod: int = Field(default=0, description="智力调整值")
    wisdom: int = Field(default=10, alias="wis", description="感知")
    wisMod: int = Field(default=0, description="感知调整值")
    charisma: int = Field(default=10, alias="cha", description="魅力")
    chaMod: int = Field(default=0, description="魅力调整值")

    model_config = {"populate_by_name": True}

    def model_dump(self, **kwargs):
        """Override to output with short aliases for D&D compatibility"""
        data = super().model_dump(**kwargs)
        # Convert to short names expected by frontend
        return {
            "str": data.get("strength", 10),
            "strMod": data.get("strMod", 0),
            "dex": data.get("dexterity", 10),
            "dexMod": data.get("dexMod", 0),
            "con": data.get("constitution", 10),
            "conMod": data.get("conMod", 0),
            "int": data.get("intelligence", 10),
            "intMod": data.get("intMod", 0),
            "wis": data.get("wisdom", 10),
            "wisMod": data.get("wisMod", 0),
            "cha": data.get("charisma", 10),
            "chaMod": data.get("chaMod", 0),
        }


class Speeds(PydanticBaseModel):
    """速度结构"""
    walk: int = Field(default=30, description="步行速度")
    fly: int = Field(default=0, description="飞行速度")
    swim: int = Field(default=0, description="游泳速度")
    climb: int = Field(default=0, description="攀爬速度")
    burrow: int = Field(default=0, description="掘地速度")


class ParsedMonsterData(PydanticBaseModel):
    """完整怪物数据结构 - 用于 instructor 强制格式"""
    name: str = Field(description="中文名称")
    name_en: Optional[str] = Field(default=None, description="英文名称")
    size: str = Field(
        default="medium",
        description="体型: tiny/small/medium/large/huge/gargantuan"
    )
    type: str = Field(
        default="humanoid",
        description="生物类型: aberration/beast/celestial/construct/dragon/elemental/fey/fiend/giant/humanoid/monstrosity/ooze/plant/undead"
    )
    alignment: Optional[str] = Field(default=None, description="阵营")
    challenge_rating: str = Field(default="1", description="挑战等级")
    armor_class: int = Field(default=10, description="护甲等级")
    hit_points: int = Field(default=10, description="生命值")
    hit_dice: Optional[str] = Field(default=None, description="生命骰，如 2d8+2")
    speeds: Speeds = Field(default_factory=Speeds, description="速度")
    ability_scores: AbilityScores = Field(default_factory=AbilityScores, description="属性值")
    skills: List[str] = Field(default_factory=list, description="技能加值列表")
    damage_resistances: List[str] = Field(default_factory=list, description="伤害抗性")
    damage_immunities: List[str] = Field(default_factory=list, description="伤害免疫")
    condition_immunities: List[str] = Field(default_factory=list, description="状态免疫")
    senses: List[str] = Field(default_factory=list, description="感官")
    languages: List[str] = Field(default_factory=list, description="语言")
    special_abilities: List[SpecialAbility] = Field(default_factory=list, description="特殊能力")
    actions: List[MonsterAction] = Field(description="动作列表，至少包含一个基础攻击")
    legendary_actions: Optional[List[LegendaryAction]] = Field(default=None, description="传奇动作")
    description: Optional[str] = Field(default=None, description="背景描述")
    appearance: Optional[str] = Field(default=None, description="外观特征")


class ParsedNPCData(ParsedMonsterData):
    """NPC 数据结构 - 继承怪物并添加 NPC 特有字段"""
    race: Optional[str] = Field(default=None, description="种族")
    occupation: Optional[str] = Field(default=None, description="职业/身份")
    personality_traits: Optional[str] = Field(default=None, description="性格特点")
    faction: Optional[str] = Field(default=None, description="所属阵营/组织")
    is_npc: bool = Field(default=True, description="是否为NPC")


class ParseCustomMonsterRequest(PydanticBaseModel):
    """从自然语言描述解析怪物或NPC"""
    campaign_id: int
    description: str
    is_npc: bool = False  # True 则创建 NPC，False 则创建怪物
    name: Optional[str] = None  # 用户指定的名字，优先于AI生成的名字


CUSTOM_MONSTER_PARSE_PROMPT = """你是D&D 5E怪物数据解析专家。请从以下自然语言描述中提取怪物/生物信息，并格式化为结构化JSON。

## 用户输入
{description}

## 输出要求
返回单个JSON对象：
```json
{{
  "name": "中文名称",
  "name_en": "英文名称（如果有）",
  "size": "体型(tiny/small/medium/large/huge/gargantuan)",
  "type": "生物类型(aberration/beast/celestial/construct/dragon/elemental/fey/fiend/giant/humanoid/monstrosity/ooze/plant/undead)",
  "alignment": "阵营(lawful good/neutral good/chaotic good/lawful neutral/neutral/chaotic neutral/lawful evil/neutral evil/chaotic evil/unaligned)",
  "challenge_rating": "挑战等级(0, 1/8, 1/4, 1/2, 1, 2, 3, ..., 30)",
  "armor_class": AC数值,
  "hit_points": 生命值,
  "hit_dice": "生命骰(如2d8+2)",
  "speeds": {{"walk": 30, "fly": 0, "swim": 0, "climb": 0, "burrow": 0}},
  "ability_scores": {{
    "str": 力量值, "strMod": 力量调整值,
    "dex": 敏捷值, "dexMod": 敏捷调整值,
    "con": 体质值, "conMod": 体质调整值,
    "int": 智力值, "intMod": 智力调整值,
    "wis": 感知值, "wisMod": 感知调整值,
    "cha": 魅力值, "chaMod": 魅力调整值
  }},
  "skills": ["技能加值列表，如 察觉 +5"],
  "damage_resistances": ["伤害抗性"],
  "damage_immunities": ["伤害免疫"],
  "condition_immunities": ["状态免疫"],
  "senses": ["感官，如 黑暗视觉 60尺"],
  "languages": ["语言"],
  "special_abilities": [
    {{"name": "能力名称", "description": "能力描述"}}
  ],
  "actions": [
    {{"name": "动作名称", "description": "动作描述（见格式要求）", "attack_bonus": 攻击加值数字, "damage": {{"dice": "伤害骰", "type": "伤害类型"}}}}
  ],
  "legendary_actions": null或[{{"name": "传奇动作名", "description": "描述", "cost": 消耗数}}],
  "description": "外观描述",
  "appearance": "详细外观特征（用于生成头像）"
}}
```

## actions 格式要求【重要】
每个攻击动作必须包含以下字段：
- name: 动作名称
- description: 标准格式为 "近战武器攻击：+X 命中，触及 Y 尺。命中则造成 NdM+B TYPE伤害。"
  - 示例："近战武器攻击：+5 命中，触及 5 尺。命中则造成 1d8+3 挥砍伤害。"
  - 示例："远程武器攻击：+4 命中，射程 80/320 尺。命中则造成 1d6+2 穿刺伤害。"
- attack_bonus: 攻击加值的数字（如 5），不是字符串
- damage: 对象格式 {{"dice": "1d8+3", "type": "挥砍"}}

## 注意事项
- 如果描述不够详细，根据D&D 5E规则合理推断默认值
- 体型映射：微型=tiny, 小型=small, 中型=medium, 大型=large, 巨型=huge, 超巨型=gargantuan
- 调整值计算: (属性值 - 10) / 2 向下取整
- 如果是普通人类NPC，CR通常为0或1/8，AC约10-12，HP约4-11
- actions 数组至少要有一个基础攻击动作，且必须包含 attack_bonus 和 damage 字段

只返回JSON对象，不要其他内容。"""


CUSTOM_NPC_PARSE_PROMPT = """你是D&D 5E NPC数据解析专家。请从以下自然语言描述中提取NPC信息，并格式化为结构化JSON。

## 用户输入
{description}

## 输出要求
返回单个JSON对象：
```json
{{
  "name": "中文名称",
  "name_en": "英文名称（如果有）",
  "size": "体型(通常medium)",
  "type": "humanoid",
  "alignment": "阵营",
  "challenge_rating": "挑战等级(NPC通常0-2)",
  "armor_class": AC数值,
  "hit_points": 生命值,
  "hit_dice": "生命骰",
  "speeds": {{"walk": 30}},
  "ability_scores": {{
    "str": 10, "strMod": 0,
    "dex": 10, "dexMod": 0,
    "con": 10, "conMod": 0,
    "int": 10, "intMod": 0,
    "wis": 10, "wisMod": 0,
    "cha": 10, "chaMod": 0
  }},
  "skills": ["NPC擅长的技能"],
  "senses": ["被动察觉等"],
  "languages": ["通用语等"],
  "special_abilities": [],
  "actions": [
    {{"name": "动作名称", "description": "动作描述（见格式要求）", "attack_bonus": 攻击加值数字或null, "damage": {{"dice": "伤害骰", "type": "伤害类型"}}或null}}
  ],
  "description": "NPC背景描述",
  "appearance": "外观特征",
  "race": "种族（如人类、精灵、矮人）",
  "occupation": "职业/身份（如铁匠、酒馆老板、商人）",
  "personality_traits": "性格特点",
  "faction": "所属阵营/组织（如有）",
  "is_npc": true
}}
```

## actions 格式要求【重要】
如果NPC有战斗能力，每个攻击动作必须包含：
- name: 动作名称
- description: 标准格式为 "近战武器攻击：+X 命中，触及 Y 尺。命中则造成 NdM+B TYPE伤害。"
  - 示例："近战武器攻击：+3 命中，触及 5 尺。命中则造成 1d6+1 挥砍伤害。"
- attack_bonus: 攻击加值的数字（如 3），不是字符串
- damage: 对象格式 {{"dice": "1d6+1", "type": "挥砍"}}

非战斗NPC可以只有简单动作（如"说服"），此时 attack_bonus 和 damage 设为 null。

## 注意事项
- NPC通常是非战斗人员，CR较低(0-2)
- 普通平民: AC 10, HP 4 (1d8), CR 0
- 技艺人员: AC 10, HP 9 (2d8), CR 0
- 护卫/士兵: AC 16, HP 11 (2d8+2), CR 1/8
- 重点描述性格、职业、背景，战斗数据可简化
- 如果NPC有武器，务必提供完整的 attack_bonus 和 damage 字段

只返回JSON对象，不要其他内容。"""


def _parse_json_response(text: str) -> dict:
    """Parse JSON from LLM response (fallback method)"""
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


async def _parse_with_instructor(
    config,
    description: str,
    is_npc: bool
) -> dict:
    """Use instructor for structured LLM output with automatic validation"""
    # Create OpenAI-compatible client pointing to user's API
    base_url = config.api_url.rstrip('/')
    if base_url.endswith('/chat/completions'):
        base_url = base_url.rsplit('/chat/completions', 1)[0]

    client = instructor.from_openai(
        AsyncOpenAI(
            base_url=base_url,
            api_key=config.api_key,
        ),
        mode=instructor.Mode.JSON,  # Works with most OpenAI-compatible APIs
    )

    # Select response model based on type
    response_model = ParsedNPCData if is_npc else ParsedMonsterData

    # System prompt for context
    system_prompt = """你是D&D 5E数据解析专家。根据用户描述生成结构化的怪物/NPC数据。

重要规则：
1. actions 数组中每个攻击动作必须包含 attack_bonus (整数) 和 damage (对象: {dice, type})
2. description 格式示例："近战武器攻击：+5 命中，触及 5 尺。命中则造成 1d8+3 挥砍伤害。"
3. 体型使用英文: tiny/small/medium/large/huge/gargantuan
4. 调整值计算: (属性值 - 10) / 2 向下取整
5. 如信息不足，根据D&D 5E规则合理推断默认值"""

    user_prompt = f"请解析以下描述并生成完整的{'NPC' if is_npc else '怪物'}数据：\n\n{description}"

    result = await client.chat.completions.create(
        model=config.model_name,
        response_model=response_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        max_tokens=3000,
        temperature=0.1,
        max_retries=2,  # Auto-retry on validation failure
    )

    # Convert Pydantic model to dict
    return result.model_dump()


async def _parse_custom_monster_with_llm_fallback(
    db: AsyncSession,
    description: str,
    is_npc: bool
) -> dict:
    """Fallback: Use raw LLM call with manual JSON parsing"""
    try:
        config = await ai_model_service.get_config_for_usage(db, "custom_creation")
    except Exception as e:
        logger.error(f"[Custom Monster] Failed to get model config: {e}")
        raise HTTPException(status_code=500, detail="AI服务不可用，请先配置模型")

    prompt_template = CUSTOM_NPC_PARSE_PROMPT if is_npc else CUSTOM_MONSTER_PARSE_PROMPT
    prompt = prompt_template.format(description=description)

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
                    "max_tokens": 3000,
                    "temperature": 0.1
                },
                headers={
                    "Authorization": f"Bearer {config.api_key}",
                    "Content-Type": "application/json",
                },
            )

        if resp.status_code != 200:
            logger.error(f"[Custom Monster] LLM API error: {resp.status_code}")
            raise HTTPException(status_code=500, detail="AI分析失败")

        data = resp.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

        if not content:
            raise HTTPException(status_code=500, detail="AI返回空响应")

        parsed = _parse_json_response(content)
        if not parsed:
            raise HTTPException(status_code=500, detail="无法解析AI返回的数据")

        return parsed

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Custom Monster] LLM call failed: {e}")
        raise HTTPException(status_code=500, detail=f"AI调用失败: {str(e)}")


async def _parse_custom_monster_with_llm(
    db: AsyncSession,
    description: str,
    is_npc: bool
) -> dict:
    """
    Parse custom monster/NPC from description using LLM.
    Uses instructor for structured output if available, falls back to manual parsing.
    """
    try:
        config = await ai_model_service.get_config_for_usage(db, "custom_creation")
    except Exception as e:
        logger.error(f"[Custom Monster] Failed to get model config: {e}")
        raise HTTPException(status_code=500, detail="AI服务不可用，请先配置模型")

    # Try instructor first (structured output)
    if INSTRUCTOR_AVAILABLE:
        try:
            logger.info("[Custom Monster] Using instructor for structured output")
            result = await _parse_with_instructor(config, description, is_npc)
            logger.info(f"[Custom Monster] Instructor parsed successfully: {result.get('name')}")
            return result
        except Exception as e:
            logger.warning(f"[Custom Monster] Instructor failed, falling back: {e}")
            # Fall through to fallback method

    # Fallback to manual JSON parsing
    logger.info("[Custom Monster] Using fallback JSON parsing")
    return await _parse_custom_monster_with_llm_fallback(db, description, is_npc)


def _get_token_size(size: str) -> str:
    """Get token size based on creature size (visual size for rendering)"""
    return creature_size_to_token_size(size)


@router.post("/parse-custom", response_model=MonsterInstanceResponse)
async def parse_and_create_custom_monster(
    request: ParseCustomMonsterRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    从自然语言描述解析并创建自定义怪物或NPC。
    """
    if not request.description or len(request.description.strip()) < 5:
        raise HTTPException(status_code=400, detail="描述太短，请提供更详细的描述")

    parsed = await _parse_custom_monster_with_llm(db, request.description, request.is_npc)

    # 用户指定的名字优先于AI解析的名字
    monster_name = request.name.strip() if request.name and request.name.strip() else parsed.get("name", "自定义生物")

    # Generate unique monster_id for custom creatures
    monster_id = f"custom-{'npc' if request.is_npc else 'monster'}-{uuid.uuid4().hex[:8]}"

    # CR to XP mapping (D&D 5E standard)
    CR_TO_XP = {
        "0": 10, "1/8": 25, "1/4": 50, "1/2": 100,
        "1": 200, "2": 450, "3": 700, "4": 1100, "5": 1800,
        "6": 2300, "7": 2900, "8": 3900, "9": 5000, "10": 5900,
        "11": 7200, "12": 8400, "13": 10000, "14": 11500, "15": 13000,
        "16": 15000, "17": 18000, "18": 20000, "19": 22000, "20": 25000,
        "21": 33000, "22": 41000, "23": 50000, "24": 62000, "25": 75000,
        "26": 90000, "27": 105000, "28": 120000, "29": 135000, "30": 155000
    }

    # Get CR and calculate XP
    cr_value = parsed.get("challenge_rating", "0")
    cr_str = str(cr_value)
    xp_value = CR_TO_XP.get(cr_str, 0)

    # Build monster_data with all parsed info
    # 确保 appearance 有值（用于生成头像）
    appearance_value = parsed.get("appearance", "")
    if not appearance_value:
        # 如果 LLM 没有返回 appearance，用 description 或原始输入
        appearance_value = parsed.get("description", "") or request.description

    monster_data = {
        "xp": xp_value,
        "cr": cr_str,
        "skills": parsed.get("skills", []),
        "damage_resistances": parsed.get("damage_resistances", []),
        "damage_immunities": parsed.get("damage_immunities", []),
        "condition_immunities": parsed.get("condition_immunities", []),
        "senses": parsed.get("senses", []),
        "languages": parsed.get("languages", []),
        "special_abilities": parsed.get("special_abilities", []),
        "actions": parsed.get("actions", []),
        "legendary_actions": parsed.get("legendary_actions"),
        "description": parsed.get("description", "") or request.description,
        "appearance": appearance_value,
        "speeds": parsed.get("speeds"),
        "ability_scores": parsed.get("ability_scores"),
        # NPC specific
        "race": parsed.get("race"),
        "occupation": parsed.get("occupation"),
        "personality_traits": parsed.get("personality_traits"),
        "faction": parsed.get("faction"),
    }

    new_monster = MonsterInstance(
        campaign_id=request.campaign_id,
        monster_id=monster_id,
        name=monster_name,
        name_cn=monster_name,
        size=normalize_creature_size(parsed.get("size", "medium")),
        type=parsed.get("type", "humanoid"),
        alignment=parsed.get("alignment"),
        challenge_rating=str(parsed.get("challenge_rating", "0")),
        armor_class=parsed.get("armor_class", 10),
        hit_points=parsed.get("hit_points", 4),
        hit_dice=parsed.get("hit_dice"),
        ability_scores=parsed.get("ability_scores"),
        speeds=parsed.get("speeds"),
        monster_data=monster_data,
        current_hp=parsed.get("hit_points", 4),
        token_size=_get_token_size(parsed.get("size", "medium")),
        entity_type="npc" if request.is_npc else "monster",
    )

    db.add(new_monster)
    await db.commit()
    await db.refresh(new_monster)

    return new_monster


# ================== Import from Module with Parsing ==================

from app.services.monster_parser_service import monster_parser_service


class ImportModuleMonsterRequest(PydanticBaseModel):
    """从模组导入怪物到资源库（带二次解析）"""
    campaign_id: int
    name: str
    name_en: Optional[str] = None
    description: str  # 原始文本描述


class ImportModuleMonsterResponse(PydanticBaseModel):
    """导入结果"""
    success: bool
    monster_id: Optional[int] = None
    name: str
    parsed_stats: bool = False
    parsed_actions: bool = False
    parsed_spellcasting: bool = False
    error: Optional[str] = None


@router.post("/import-from-module", response_model=ImportModuleMonsterResponse)
async def import_monster_from_module(
    request: ImportModuleMonsterRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    从模组导入怪物到资源库，使用三阶段LLM解析：
    1. 解析基础属性（AC、HP、属性值等）
    2. 解析动作（攻击、特殊能力等）
    3. 解析法术（如有施法能力）
    """
    try:
        # Three-stage parsing
        monster_data = await monster_parser_service.parse_full(
            db,
            request.description,
            request.name,
            request.name_en or ""
        )

        # Check what was parsed
        has_stats = bool(monster_data.get("armor_class") or monster_data.get("hit_points"))
        has_actions = bool(monster_data.get("actions") or monster_data.get("special_abilities"))
        has_spellcasting = bool(monster_data.get("spellcasting"))

        # Generate unique ID
        monster_id = f"module-monster-{uuid.uuid4().hex[:8]}"

        # Extract values with defaults
        size = normalize_creature_size(monster_data.get("size", "medium"))
        cr = str(monster_data.get("challenge_rating", "1"))

        # Create monster instance
        new_monster = MonsterInstance(
            campaign_id=request.campaign_id,
            monster_id=monster_id,
            name=request.name,
            name_cn=request.name,
            size=size,
            type=monster_data.get("type", "humanoid"),
            alignment=monster_data.get("alignment"),
            challenge_rating=cr,
            armor_class=monster_data.get("armor_class", 10),
            hit_points=monster_data.get("hit_points", 10),
            hit_dice=monster_data.get("hit_dice"),
            ability_scores=monster_data.get("ability_scores"),
            speeds=monster_data.get("speeds"),
            monster_data=monster_data,
            current_hp=monster_data.get("hit_points", 10),
            token_size=_get_token_size(size),
            entity_type="monster",
        )

        db.add(new_monster)
        await db.commit()
        await db.refresh(new_monster)

        return ImportModuleMonsterResponse(
            success=True,
            monster_id=new_monster.id,
            name=request.name,
            parsed_stats=has_stats,
            parsed_actions=has_actions,
            parsed_spellcasting=has_spellcasting
        )

    except Exception as e:
        logger.error(f"Failed to import monster from module: {e}")
        import traceback
        traceback.print_exc()
        return ImportModuleMonsterResponse(
            success=False,
            name=request.name,
            error=str(e)
        )


# ==================== Convert Monster to Loot Chest ====================

from app.models.chest import Chest
from app.models.chest_inventory import ChestInventory
from app.models.item import Item


class ConvertToChestRequest(PydanticBaseModel):
    """Request to convert a monster token to a loot chest"""
    token_id: int
    chest_name: Optional[str] = None  # Custom name, defaults to "战利品 (MonsterName)"
    appearance_description: Optional[str] = None  # For avatar generation
    selected_items: Optional[List[dict]] = None  # Items to transfer; None = use monster.inventory
    include_currency: Optional[bool] = True  # Whether to transfer currency


class ConvertToChestResponse(PydanticBaseModel):
    """Response after converting monster to chest"""
    success: bool
    chest_id: Optional[int] = None
    token_id: Optional[int] = None
    message: str


@router.post("/convert-to-chest", response_model=ConvertToChestResponse)
async def convert_monster_to_chest(
    request: ConvertToChestRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Convert a dead monster/NPC token to a loot chest containing its inventory and currency.

    The monster token will be replaced with a chest token at the same position.
    All items and currency from the monster will be transferred to the chest.
    """
    try:
        # 1. Get the token
        token_result = await db.execute(
            select(Token).where(Token.id == request.token_id)
        )
        token = token_result.scalar_one_or_none()

        if not token:
            raise HTTPException(status_code=404, detail="Token not found")

        if not token.monster_instance_id:
            raise HTTPException(status_code=400, detail="Token is not a monster token")

        # 2. Get the monster instance
        monster_result = await db.execute(
            select(MonsterInstance).where(MonsterInstance.id == token.monster_instance_id)
        )
        monster = monster_result.scalar_one_or_none()

        if not monster:
            raise HTTPException(status_code=404, detail="Monster instance not found")

        # Determine items and currency to transfer
        if request.selected_items is not None:
            # DM selected specific items — could be from equipment or inventory
            items_to_transfer = request.selected_items
        else:
            # Legacy: transfer all inventory items
            items_to_transfer = monster.inventory or []

        currency = monster.currency or {}
        include_currency = request.include_currency if request.include_currency is not None else True
        has_currency = include_currency and any(currency.get(k, 0) > 0 for k in ["cp", "sp", "ep", "gp", "pp"])

        if not items_to_transfer and not has_currency:
            return ConvertToChestResponse(
                success=False,
                message="没有选中任何物品或金钱可转换为宝箱"
            )

        # 3. Create the chest
        monster_display_name = monster.name_cn or monster.name
        chest_name = request.chest_name or f"📦 战利品 ({monster_display_name})"

        # Build appearance description if not provided
        appearance = request.appearance_description
        if not appearance:
            appearance = f"一个简陋的战利品袋，里面装着从{monster_display_name}身上搜刮的物品。"

        chest = Chest(
            campaign_id=monster.campaign_id,
            name=chest_name,
            description=f"从{monster_display_name}身上获得的战利品",
            appearance_description=appearance,
            state="unlocked",  # Loot chests are unlocked
            is_locked=False,
            lock_dc=0,
            is_trapped=False,
            cp=currency.get("cp", 0) if include_currency else 0,
            sp=currency.get("sp", 0) if include_currency else 0,
            ep=currency.get("ep", 0) if include_currency else 0,
            gp=currency.get("gp", 0) if include_currency else 0,
            pp=currency.get("pp", 0) if include_currency else 0,
            # Use monster's avatar as chest avatar if available
            avatar_url=monster.avatar_url,
            avatar_url_large=monster.avatar_url_large,
            has_avatar=monster.has_avatar or False,
        )
        db.add(chest)
        await db.flush()  # Get chest.id

        # 4. Convert selected items to ChestInventory
        transferred_equipment_counts: dict[tuple[str, str | int], int] = {}
        transferred_inventory_counts: dict[tuple[str, str | int], int] = {}
        for inv_item in items_to_transfer:
            quantity = int(inv_item.get("quantity") or 1)
            if quantity <= 0:
                continue
            source = inv_item.get("source", "inventory")  # "equipment" or "inventory"
            normalized_item = normalize_item_payload(inv_item, quantity=quantity)
            identity = _item_payload_identity(normalized_item)
            if source == "equipment":
                transferred_equipment_counts[identity] = transferred_equipment_counts.get(identity, 0) + quantity
            else:
                transferred_inventory_counts[identity] = transferred_inventory_counts.get(identity, 0) + quantity

            library_item_id = normalized_item.get("libraryItemId")
            if library_item_id is not None:
                existing_item = await db.execute(select(Item).where(Item.id == int(library_item_id)))
                if existing_item.scalar_one_or_none():
                    chest_inv = ChestInventory(
                        chest_id=chest.id,
                        item_id=int(library_item_id),
                        quantity=quantity,
                    )
                    db.add(chest_inv)
                    continue

            item_name = normalized_item.get("name") or normalized_item.get("name_cn") or "Unknown Item"
            avatar_url = normalized_item.get("avatar_url") or normalized_item.get("icon")
            avatar_url_large = (
                normalized_item.get("avatar_url_large")
                or normalized_item.get("avatar_url")
                or normalized_item.get("icon")
            )
            new_item = Item(
                campaign_id=monster.campaign_id,
                name=item_name,
                name_cn=normalized_item.get("name_cn") or item_name,
                category=normalized_item.get("category") or "gear",
                subcategory=normalized_item.get("subcategory"),
                cost=normalized_item.get("cost"),
                weight=normalized_item.get("weight"),
                rarity=normalized_item.get("rarity") or "common",
                damage=normalized_item.get("damage"),
                properties=normalized_item.get("properties"),
                range=normalized_item.get("range"),
                armor_class=normalized_item.get("armor_class"),
                strength_requirement=normalized_item.get("strength_requirement"),
                stealth_disadvantage=bool(normalized_item.get("stealth_disadvantage"))
                if normalized_item.get("stealth_disadvantage") is not None else False,
                description=normalized_item.get("description"),
                description_cn=normalized_item.get("description_cn"),
                avatar_url=avatar_url,
                avatar_url_large=avatar_url_large,
                has_avatar=bool(avatar_url),
                requires_attunement=bool(normalized_item.get("requires_attunement")),
                attunement_by=normalized_item.get("attunement_by"),
                magic_bonus=normalized_item.get("magic_bonus"),
                extra_damage=normalized_item.get("extra_damage"),
                abilities=normalized_item.get("abilities"),
                charges=normalized_item.get("charges"),
                item_spells=normalized_item.get("item_spells"),
                sentient=normalized_item.get("sentient"),
                source_module=normalized_item.get("source_module"),
                is_custom=True,
            )
            db.add(new_item)
            await db.flush()  # Get new_item.id

            chest_inv = ChestInventory(
                chest_id=chest.id,
                item_id=new_item.id,
                quantity=quantity
            )
            db.add(chest_inv)

        # 5. Update the token to be a chest token
        token.chest_id = chest.id
        token.monster_instance_id = None
        token.loot_bag_data = None
        token.instance_name = chest_name
        token.token_size = "1x1"  # Chests are typically 1x1
        token.current_hp = None  # Chests don't have HP

        # 6. Remove transferred items from monster
        if request.selected_items is not None:
            if transferred_equipment_counts and monster.equipment:
                remaining_equipment = _remove_transferred_items(monster.equipment, transferred_equipment_counts)
                monster.equipment = remaining_equipment
                flag_modified(monster, "equipment")

            if transferred_inventory_counts and monster.inventory:
                remaining_inventory = _remove_transferred_items(monster.inventory, transferred_inventory_counts)
                monster.inventory = remaining_inventory
                flag_modified(monster, "inventory")

            if include_currency:
                monster.currency = {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}
                flag_modified(monster, "currency")
        else:
            # Legacy: clear all inventory and currency
            monster.inventory = []
            monster.currency = {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}
            flag_modified(monster, "inventory")
            flag_modified(monster, "currency")

        await db.commit()
        await db.refresh(chest)
        await db.refresh(token)

        # 7. Broadcast the update
        await realtime_publisher.publish_monster_converted_to_chest(
            monster.campaign_id,
            token_id=token.id,
            chest_id=chest.id,
            chest={
                "id": chest.id,
                "name": chest.name,
                "state": chest.state,
                "avatar_url": chest.avatar_url,
                "cp": chest.cp,
                "sp": chest.sp,
                "ep": chest.ep,
                "gp": chest.gp,
                "pp": chest.pp,
            },
            position_x=token.position_x,
            position_y=token.position_y,
            map_url=token.map_url,
        )

        logger.info(f"Converted monster {monster.id} ({monster_display_name}) to chest {chest.id}")

        return ConvertToChestResponse(
            success=True,
            chest_id=chest.id,
            token_id=token.id,
            message=f"成功将{monster_display_name}转换为战利品宝箱"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Convert to chest failed: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"转换失败: {str(e)}")


class QuickGenerateNPCRequest(PydanticBaseModel):
    campaign_id: int


@router.post("/quick-generate-npc", response_model=MonsterInstanceResponse)
async def quick_generate_npc(
    request: QuickGenerateNPCRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    快速生成一个非战斗剧情NPC。
    使用预设模板属性 + FAST模型生成名字/外观/职业，结合地图和章节上下文。
    """
    campaign_id = request.campaign_id

    # 1. 获取地图和章节上下文
    map_name, chapter_name, module_id = await _get_map_and_chapter_context(
        db, campaign_id
    )

    # 2. RAG: 尝试从模组获取当地NPC相关信息
    rag_context = ""
    if module_id:
        try:
            embedding_service = ModuleEmbeddingService(db)
            query = "当地NPC居民人物角色"
            if map_name:
                query = f"{map_name} NPC 居民 人物"
            if chapter_name:
                query = f"{chapter_name} {query}"
            results = await embedding_service.search_module_content(
                module_id, query, top_k=3,
                similarity_threshold=0.25, use_rerank=False,
            )
            if results:
                rag_context = "\n".join(
                    r.get("content", "")[:300] for r in results[:3]
                )
        except Exception as e:
            logger.warning(f"[QuickNPC] RAG search failed: {e}")

    # 3. 用FAST模型生成名字、职业、外观
    try:
        usage_params = await ai_model_service.get_usage_params(
            db, "npc_quick_generate"
        )
        config = usage_params.config
    except Exception as e:
        logger.error(f"[QuickNPC] Failed to get model config: {e}")
        raise HTTPException(status_code=500, detail="AI服务不可用")

    context_parts = []
    if map_name:
        context_parts.append(f"当前地图：{map_name}")
    if chapter_name:
        context_parts.append(f"当前章节：{chapter_name}")
    if rag_context:
        context_parts.append(f"模组参考信息：\n{rag_context}")

    context_str = (
        "\n".join(context_parts) if context_parts else "通用奇幻城镇"
    )

    prompt = f"""为D&D 5E游戏生成一个非战斗剧情NPC。请根据以下场景信息来生成：

{context_str}

请用以下JSON格式回复，不要有其他文字：
{{"name": "NPC中文名(2-5字)", "occupation": "职业/身份(如酒保、商人、学者)", "appearance": "外貌描述(30-60字，包含种族、年龄、外观特征)", "race": "种族(如人类、矮人、精灵、半身人)"}}"""

    endpoint = config.api_url.rstrip("/")
    if not endpoint.endswith("/chat/completions"):
        endpoint += "/chat/completions"

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                endpoint,
                json={
                    "model": config.model_name,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 200,
                    "temperature": 0.9,
                },
                headers={
                    "Authorization": f"Bearer {config.api_key}",
                    "Content-Type": "application/json",
                },
            )

        if resp.status_code != 200:
            raise HTTPException(status_code=500, detail="AI调用失败")

        data = resp.json()
        content = (
            data.get("choices", [{}])[0]
            .get("message", {}).get("content", "").strip()
        )

        json_match = re.search(r"\{.*\}", content, re.DOTALL)
        if not json_match:
            logger.warning(f"[QuickNPC] No JSON in AI response: {content[:200]}")
            raise HTTPException(status_code=500, detail="AI返回格式错误")

        ai_result = json.loads(json_match.group())
        npc_name = ai_result.get("name", "无名旅人")
        occupation = ai_result.get("occupation", "平民")
        appearance = ai_result.get("appearance", "")
        race = ai_result.get("race", "人类")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[QuickNPC] AI generation failed: {e}")
        npc_name = "无名旅人"
        occupation = "平民"
        appearance = ""
        race = "人类"

    # 4. 随机选择一个模板
    template = stdlib_random.choice(NPC_QUICK_TEMPLATES)
    cr_str = template["cr"]
    CR_TO_XP = {
        "0": 10, "1/8": 25, "1/4": 50, "1/2": 100,
        "1": 200, "2": 450, "3": 700,
    }
    xp_value = CR_TO_XP.get(cr_str, 10)
    monster_id = f"quick-npc-{uuid.uuid4().hex[:8]}"

    monster_data = {
        "xp": xp_value,
        "cr": cr_str,
        "description": f"{occupation}。{appearance}",
        "appearance": appearance,
        "race": race,
        "occupation": occupation,
        "speeds": template["speed"],
        "ability_scores": template["ability_scores"],
        "languages": template["languages"],
        "template_used": template["template_name"],
    }

    new_monster = MonsterInstance(
        campaign_id=campaign_id,
        monster_id=monster_id,
        name=npc_name,
        name_cn=npc_name,
        size=normalize_creature_size(template["size"]),
        type=template["type"],
        alignment=template["alignment"],
        challenge_rating=cr_str,
        armor_class=template["ac"],
        hit_points=template["hp"],
        hit_dice=template["hit_dice"],
        ability_scores=template["ability_scores"],
        speeds=template["speed"],
        monster_data=monster_data,
        current_hp=template["hp"],
        token_size=_get_token_size(template["size"]),
        entity_type="npc",
    )

    db.add(new_monster)
    await db.commit()
    await db.refresh(new_monster)

    # 5. 后台生成头像
    asyncio.create_task(
        _quick_generate_npc_avatar_background(
            monster_instance_id=new_monster.id,
            campaign_id=campaign_id,
            name=npc_name,
            appearance=appearance,
            occupation=occupation,
        )
    )

    return new_monster


@router.get("/{monster_instance_id}", response_model=MonsterInstanceResponse)
async def get_monster_instance(
    monster_instance_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    Get a specific monster instance by ID
    """
    result = await db.execute(
        select(MonsterInstance).where(MonsterInstance.id == monster_instance_id)
    )
    monster = result.scalar_one_or_none()
    
    if not monster:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Monster instance with id {monster_instance_id} not found"
        )

    if _apply_normalized_monster_payload(monster):
        await db.commit()

    return monster


@router.post("/{monster_instance_id}", response_model=MonsterInstanceResponse)
async def update_monster_instance(
    monster_instance_id: int,
    monster_update: MonsterInstanceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Update an existing monster instance
    """
    result = await db.execute(
        select(MonsterInstance).where(MonsterInstance.id == monster_instance_id)
    )
    monster = result.scalar_one_or_none()
    
    if not monster:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Monster instance with id {monster_instance_id} not found"
        )
    
    # Update only provided fields
    update_data = _normalize_monster_payload_dict(monster_update.model_dump(exclude_unset=True))
    for field, value in update_data.items():
        setattr(monster, field, value)
        if field in {"inventory", "equipment", "currency"}:
            flag_modified(monster, field)

    await db.commit()
    await db.refresh(monster)

    # Sync status_effects conditions → token active_effects for HUD display
    if "status_effects" in update_data:
        try:
            from app.services.immunity_service import CONDITION_TRANSLATIONS
            from app.services import aura_service
            _cond_icons = {
                'blinded': '🙈', 'charmed': '💕', 'deafened': '🙉', 'exhaustion': '😫',
                'frightened': '😨', 'grappled': '🤝', 'incapacitated': '🚫', 'invisible': '👻',
                'paralyzed': '😵', 'petrified': '🗿', 'poisoned': '🤢', 'prone': '⬇️',
                'restrained': '🕸️', 'stunned': '⚡', 'unconscious': '💤', 'silenced': '🔇',
                'diseased': '🤒', 'sleep': '💤', 'aging': '👴', 'confused': '🌀',
            }
            _cond_colors = {
                'blinded': '#374151', 'charmed': '#ec4899', 'deafened': '#374151', 'exhaustion': '#92400e',
                'frightened': '#7c3aed', 'grappled': '#d97706', 'incapacitated': '#6b7280', 'invisible': '#6366f1',
                'paralyzed': '#dc2626', 'petrified': '#78716c', 'poisoned': '#16a34a', 'prone': '#92400e',
                'restrained': '#92400e', 'stunned': '#eab308', 'unconscious': '#1e40af', 'silenced': '#64748b',
                'diseased': '#84cc16', 'sleep': '#1e40af', 'aging': '#78716c', 'confused': '#f59e0b',
            }
            # Monster uses "conditions" key (not "active_conditions")
            active_conditions = (monster.status_effects or {}).get("conditions", [])
            condition_effects = []
            active_auras = aura_service.build_status_auras_from_status_effects(monster.status_effects)
            aura_display_effects = aura_service.build_status_aura_display_effects(monster.status_effects)
            for ac in active_conditions:
                cond = ac.get("condition", "") if isinstance(ac, dict) else str(ac)
                dur = ac.get("duration") if isinstance(ac, dict) else None
                cond_cn = CONDITION_TRANSLATIONS.get(cond, cond)
                rounds_left = None
                if dur and isinstance(dur, dict) and dur.get("type") != "permanent":
                    rounds_left = dur.get("remaining")
                condition_effects.append({
                    "id": f"condition_{cond}", "name": cond_cn, "condition": cond,
                    "icon": _cond_icons.get(cond, "❓"), "color": _cond_colors.get(cond, "#6b7280"),
                    "dm_added": True,
                    **({"duration": rounds_left} if rounds_left is not None else {}),
                })
            token_results = await db.execute(
                select(Token).where(Token.monster_instance_id == monster.id)
            )
            tokens = token_results.scalars().all()
            for token in tokens:
                existing = token.active_effects or []
                non_dm = [e for e in existing if not e.get("dm_added")]
                token.active_effects = non_dm + condition_effects + aura_display_effects
                token.active_auras = active_auras or None
                flag_modified(token, "active_effects")
                flag_modified(token, "active_auras")
            if tokens:
                await db.commit()
            for token in tokens:
                await realtime_publisher.publish_token_effects_updated(
                    token.campaign_id,
                    token_id=token.id,
                    active_effects=token.active_effects,
                    monster_instance_id=int(monster.id),
                    monster_status_effects=monster.status_effects,
                    reason="dm_status_update",
                )
                await realtime_publisher.publish_token_auras_updated(
                    token.campaign_id,
                    token_id=token.id,
                    active_auras=token.active_auras or [],
                    aura_id="status_sync",
                    enabled=bool(token.active_auras),
                )
                await aura_service.on_token_move(
                    token.id,
                    int(token.campaign_id),
                    token.map_url,
                    db,
                )
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"[MonsterStatus] Token sync error: {e}")

    return monster


@router.delete("/{monster_instance_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_monster_instance(
    monster_instance_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Delete a monster instance from the campaign.
    Also deletes all map tokens associated with this monster instance.
    """
    result = await db.execute(
        select(MonsterInstance).where(MonsterInstance.id == monster_instance_id)
    )
    monster = result.scalar_one_or_none()

    if not monster:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Monster instance with id {monster_instance_id} not found"
        )

    campaign_id = monster.campaign_id

    # Get all token ids before deletion for WebSocket broadcast
    tokens_result = await db.execute(
        select(Token.id).where(Token.monster_instance_id == monster_instance_id)
    )
    token_ids = [row[0] for row in tokens_result.fetchall()]

    # Delete all map tokens associated with this monster instance
    await db.execute(delete(Token).where(Token.monster_instance_id == monster_instance_id))

    # Delete the monster instance
    await db.execute(delete(MonsterInstance).where(MonsterInstance.id == monster_instance_id))
    await db.commit()

    # Broadcast token removal for each deleted token
    for token_id in token_ids:
        await realtime_publisher.publish_map_token_removed(campaign_id, token_id=token_id)

    return None


# ================== Quick Generate NPC ==================

import asyncio
import random as stdlib_random
from app.db.session import async_session_maker
from app.models.campaign import Campaign
from app.models.module_maps import ModuleMaps
from app.services.module_embedding_service import ModuleEmbeddingService

# Non-combat NPC stat templates
NPC_QUICK_TEMPLATES = [
    {
        "template_name": "平民",
        "size": "中型", "type": "人形生物", "alignment": "任意阵营",
        "ac": 10, "hp": 4, "hit_dice": "1d8",
        "ability_scores": {"str": 10, "dex": 10, "con": 10, "int": 10, "wis": 10, "cha": 10},
        "cr": "0", "xp": 10, "speed": {"walk": 30},
        "languages": ["通用语"],
    },
    {
        "template_name": "工匠",
        "size": "中型", "type": "人形生物", "alignment": "任意阵营",
        "ac": 10, "hp": 5, "hit_dice": "1d8+1",
        "ability_scores": {"str": 11, "dex": 10, "con": 12, "int": 12, "wis": 11, "cha": 10},
        "cr": "0", "xp": 10, "speed": {"walk": 30},
        "languages": ["通用语"],
    },
    {
        "template_name": "商人",
        "size": "中型", "type": "人形生物", "alignment": "任意阵营",
        "ac": 10, "hp": 5, "hit_dice": "1d8+1",
        "ability_scores": {"str": 9, "dex": 11, "con": 12, "int": 13, "wis": 12, "cha": 14},
        "cr": "0", "xp": 10, "speed": {"walk": 30},
        "languages": ["通用语"],
    },
    {
        "template_name": "酒馆老板",
        "size": "中型", "type": "人形生物", "alignment": "任意阵营",
        "ac": 10, "hp": 9, "hit_dice": "2d8",
        "ability_scores": {"str": 12, "dex": 10, "con": 11, "int": 11, "wis": 12, "cha": 14},
        "cr": "1/8", "xp": 25, "speed": {"walk": 30},
        "languages": ["通用语"],
    },
    {
        "template_name": "学者",
        "size": "中型", "type": "人形生物", "alignment": "任意阵营",
        "ac": 10, "hp": 5, "hit_dice": "1d8+1",
        "ability_scores": {"str": 8, "dex": 10, "con": 12, "int": 16, "wis": 14, "cha": 11},
        "cr": "0", "xp": 10, "speed": {"walk": 30},
        "languages": ["通用语", "精灵语"],
    },
    {
        "template_name": "贵族",
        "size": "中型", "type": "人形生物", "alignment": "任意阵营",
        "ac": 12, "hp": 9, "hit_dice": "2d8",
        "ability_scores": {"str": 10, "dex": 12, "con": 11, "int": 13, "wis": 12, "cha": 16},
        "cr": "1/8", "xp": 25, "speed": {"walk": 30},
        "languages": ["通用语", "精灵语"],
    },
    {
        "template_name": "农夫",
        "size": "中型", "type": "人形生物", "alignment": "任意阵营",
        "ac": 10, "hp": 5, "hit_dice": "1d8+1",
        "ability_scores": {"str": 13, "dex": 10, "con": 12, "int": 9, "wis": 12, "cha": 10},
        "cr": "0", "xp": 10, "speed": {"walk": 30},
        "languages": ["通用语"],
    },
    {
        "template_name": "乞丐",
        "size": "中型", "type": "人形生物", "alignment": "任意阵营",
        "ac": 10, "hp": 3, "hit_dice": "1d8-1",
        "ability_scores": {"str": 8, "dex": 12, "con": 9, "int": 10, "wis": 13, "cha": 11},
        "cr": "0", "xp": 10, "speed": {"walk": 30},
        "languages": ["通用语"],
    },
]


async def _get_map_and_chapter_context(
    db: AsyncSession, campaign_id: int
) -> tuple[str, str, str]:
    """获取当前地图名称和章节上下文。返回 (map_name, chapter_name, module_id)"""
    campaign = await db.get(Campaign, campaign_id)
    if not campaign or not campaign.current_map_url:
        return "", "", ""

    module_id = campaign.selected_module_id or ""
    if not module_id:
        return "", "", ""

    result = await db.execute(
        select(ModuleMaps).where(
            ModuleMaps.campaign_id == campaign_id,
            ModuleMaps.module_id == module_id,
        )
    )
    module_maps = result.scalar_one_or_none()
    if not module_maps or not module_maps.maps:
        return "", "", module_id

    for m in module_maps.maps:
        if m.get("url") == campaign.current_map_url:
            return m.get("name", ""), m.get("chapter", ""), module_id

    return "", "", module_id


async def _quick_generate_npc_avatar_background(
    monster_instance_id: int,
    campaign_id: int,
    name: str,
    appearance: str,
    occupation: str,
):
    """后台生成快速NPC的头像"""
    try:
        async with async_session_maker() as db:
            existing = await db.execute(
                select(MonsterInstance)
                .where(MonsterInstance.name_cn == name)
                .where(MonsterInstance.has_avatar == True)
                .where(MonsterInstance.avatar_url.isnot(None))
                .where(MonsterInstance.id != monster_instance_id)
                .limit(1)
            )
            existing_inst = existing.scalar_one_or_none()

            if existing_inst and existing_inst.avatar_url:
                instance = await db.get(MonsterInstance, monster_instance_id)
                if instance:
                    instance.avatar_url = existing_inst.avatar_url
                    instance.avatar_url_large = existing_inst.avatar_url_large
                    instance.has_avatar = True
                    await db.commit()
                await realtime_publisher.publish_npc_avatar_updated(
                    campaign_id,
                    monster_instance_id=monster_instance_id,
                    avatar_url=existing_inst.avatar_url,
                    avatar_url_large=existing_inst.avatar_url_large,
                )
                return

            npc_prompt = f"A detailed D&D fantasy character portrait of {name}, a {occupation}. "
            if appearance:
                npc_prompt += f"Appearance: {appearance[:250]}. "
            npc_prompt += (
                "IMPORTANT: Any stats or attributes are only for visual reference to inform physique and demeanor, do NOT draw them as text. "
                "Professional digital character art, fantasy RPG style, warm lighting, "
                "friendly or neutral expression, detailed face and clothing, high quality portrait, "
                "centered composition, NO TEXT, NO STATS, NO NUMBERS, NO LABELS, pure artwork only"
            )

            small_url, large_url = await avatar_service.generate_avatar(
                db=db,
                entity_type="monster",
                entity_id=monster_instance_id,
                name=name,
                description=appearance,
                appearance=f"{occupation}: {appearance}",
                is_npc=True,
                prompt_override=npc_prompt,
            )

            instance = await db.get(MonsterInstance, monster_instance_id)
            if instance:
                instance.avatar_url = small_url
                instance.avatar_url_large = large_url
                instance.has_avatar = True
                await db.commit()

            await realtime_publisher.publish_npc_avatar_updated(
                campaign_id,
                monster_instance_id=monster_instance_id,
                avatar_url=small_url,
                avatar_url_large=large_url,
            )
    except Exception as e:
        logger.error(f"[QuickNPC] Avatar generation failed for {monster_instance_id}: {e}")
