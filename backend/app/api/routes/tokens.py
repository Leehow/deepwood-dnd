from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from sqlalchemy.orm.attributes import flag_modified
from typing import Any, List, Optional
import logging
import asyncio
import httpx

from app.db.session import get_db, get_db_readonly
from app.models.token import Token
from app.models.character import Character
from app.models.monster_instance import MonsterInstance
from app.models.shop import Shop
from app.models.chest import Chest
from app.models.campaign_storage import CampaignStorage
from app.models.chat_message import ChatMessage
from app.schemas.token import (
    TokenCreate, TokenPositionUpdate, TokenSizeUpdate, TokenHPUpdate,
    TokenTempHPUpdate,
    TokenActiveEffectsUpdate, TokenAurasUpdate, TokenFactionUpdate,
    TokenTransformationUpdate, TokenConcentrationUpdate, TokenDisguiseUpdate,
    TokenResponse, TokensResponse,
    LootBagCreateRequest, LootBagLootRequest, LootBagLootResponse
)
from app.services import aura_service
from app.services.ai_model_service import ai_model_service
from app.services.immunity_service import check_condition_immunity
from app.services.combat_turn_trigger_hooks import (
    dispatch_combat_turn_triggers_if_changed,
)
from app.services.realtime_publisher import realtime_publisher
from app.services.runtime_schema_service import (
    RuntimeSchemaValidationError,
    normalize_token_active_auras,
    normalize_token_active_effects,
    normalize_token_casting_in_progress,
    normalize_token_concentration_spell,
    normalize_token_death_saves,
    normalize_token_disguise_data,
    normalize_token_transformation_data,
)
from app.services.spell_runtime_service import (
    build_token_spell_projection_map,
    end_concentration_runtime_instances,
    notify_target_downed,
    publish_runtime_projection_updates,
)
from app.core.security import require_auth
from app.utils.rules_cache import (
    get_spell_by_id,
    get_spell_size_delta,
    spell_has_effect_type,
    spell_has_illusion_subtype,
)
from app.utils.permission_checks import check_campaign_member
from app.utils.nature_domain import get_master_of_nature_restore_data
from app.utils.pending_effects import apply_damage_break_cleanup
from app.utils.trickery_domain import get_concentration_linked_token_ids
from app.utils.item_payload_normalizer import (
    merge_item_into_equipment,
    normalize_character_equipment_payloads,
    normalize_loot_bag_data,
    normalize_token_item_fields,
)

router = APIRouter(prefix="/tokens", tags=["Tokens"])
logger = logging.getLogger(__name__)


def _resolve_item_token_avatar(item_data: dict | None) -> tuple[str | None, str | None]:
    if not item_data:
        return None, None

    avatar = item_data.get("icon") or item_data.get("avatar_url") or item_data.get("iconPath")
    avatar_large = item_data.get("avatar_url_large") or avatar

    if isinstance(avatar, str) and avatar.startswith("assets/"):
        avatar = f"/{avatar}"
    if isinstance(avatar_large, str) and avatar_large.startswith("assets/"):
        avatar_large = f"/{avatar_large}"

    return avatar, avatar_large


def _world_time_to_seconds(t: dict) -> int:
    """Convert a world-time dict {day, hour, minute, second} to total seconds."""
    return (
        int(t.get("day", 1)) * 86400
        + int(t.get("hour", 0)) * 3600
        + int(t.get("minute", 0)) * 60
        + int(t.get("second", 0))
    )


def _calc_expires_at(current_time: dict, duration_rounds: int) -> dict:
    """Calculate world-time expiration: current_time + duration_rounds * 6 seconds."""
    total_sec = _world_time_to_seconds(current_time) + duration_rounds * 6
    day = max(1, total_sec // 86400)
    remainder = total_sec % 86400
    hour = remainder // 3600
    remainder %= 3600
    minute = remainder // 60
    second = remainder % 60
    return {"day": day, "hour": hour, "minute": minute, "second": second}


async def _get_campaign_world_time(db: AsyncSession, campaign_id: int) -> dict:
    from app.models.campaign import Campaign

    campaign_obj = await db.get(Campaign, int(campaign_id))
    campaign_meta = campaign_obj.meta if campaign_obj and campaign_obj.meta else {}
    return campaign_meta.get("time_of_day") or {}


async def _apply_concentration_world_time_expiry(
    db: AsyncSession,
    *,
    campaign_id: int,
    concentration_spell: Optional[dict],
) -> dict:
    updated = dict(concentration_spell or {})
    duration_rounds = updated.get("duration_rounds")
    if duration_rounds is None:
        return updated

    try:
        total_rounds = int(duration_rounds)
    except (TypeError, ValueError):
        return updated

    current_round = 0
    try:
        current_round = int(updated.get("current_round") or 0)
    except (TypeError, ValueError):
        current_round = 0

    current_time = await _get_campaign_world_time(db, campaign_id)
    if not current_time:
        return updated

    remaining_rounds = max(0, total_rounds - current_round)
    updated["expires_at"] = _calc_expires_at(current_time, remaining_rounds)
    return updated


def _effect_is_appearance_disguise(effect: dict) -> bool:
    spell_id = effect.get("spell_id")
    return bool(effect.get("spell_buff") and spell_has_illusion_subtype(get_spell_by_id(spell_id), "appearance"))


def _should_clear_disguise_after_effect_update(
    *,
    old_effects: list[dict],
    new_effects: list[dict],
    has_disguise_data: bool,
) -> bool:
    if not has_disguise_data:
        return False
    old_had_disguise = any(_effect_is_appearance_disguise(effect) for effect in old_effects)
    new_has_disguise = any(_effect_is_appearance_disguise(effect) for effect in new_effects)
    return old_had_disguise and not new_has_disguise


def _strip_removed_spell_auras(
    token: Token,
    *,
    removed_effects: list[dict],
) -> bool:
    removed_spell_ids = {
        str(effect.get("spell_id") or "").strip()
        for effect in removed_effects
        if isinstance(effect, dict) and str(effect.get("spell_id") or "").strip()
    }
    if not removed_spell_ids or not token.active_auras:
        return False

    next_auras = token.active_auras
    for spell_id in removed_spell_ids:
        next_auras = aura_service.strip_spell_aura_entries(
            next_auras,
            spell_id=spell_id,
            source_token_id=token.id,
        )

    if next_auras == token.active_auras:
        return False

    token.active_auras = normalize_token_active_auras(next_auras, strict=False)
    flag_modified(token, "active_auras")
    return True


async def _delete_linked_concentration_tokens(
    db: AsyncSession,
    concentration_spell: Optional[dict],
) -> List[int]:
    """Delete tokens linked to a concentration effect and return removed ids."""
    removed_token_ids: List[int] = []
    for token_id in get_concentration_linked_token_ids(concentration_spell):
        linked_token = await db.get(Token, token_id)
        if not linked_token:
            continue
        await db.delete(linked_token)
        removed_token_ids.append(token_id)
    return removed_token_ids


# ── Summon materialization (concentration-on-empty-ground path) ────────────
# The frontend non-combat area path (useMapAreaSpellNonCombatController) only
# stores `concentration_spell.area_effect` and never routes through
# /api/spells/cast, so `SpawnSummonHandler` never fires for spells like
# Conjure Animals. The helpers below let `set_token_concentration` realise
# the summon outcome itself: drop a spawn_summon active effect on the caster
# and create linked item tokens at the chosen area point. Stays idempotent
# for duration edits via the linked_token_ids skip.

_SUMMON_COUNT_CAP = 16


def _find_spawn_summon_leaves(spell_data: Optional[dict]) -> list[dict]:
    """Return all spawn_summon effect leaves from a spell's top-level effects."""
    leaves: list[dict] = []
    if not isinstance(spell_data, dict):
        return leaves
    for phase in spell_data.get("effects") or []:
        if not isinstance(phase, dict):
            continue
        for leaf in phase.get("effects") or []:
            if isinstance(leaf, dict) and leaf.get("type") == "spawn_summon":
                leaves.append(leaf)
    return leaves


def _coerce_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return None


def _summon_offset_for_index(index: int) -> tuple[int, int]:
    """Simple ring layout around the area-effect center for summon placement."""
    if index <= 0:
        return (0, 0)
    ring_offsets = [
        (1, 0), (-1, 0), (0, 1), (0, -1),
        (1, 1), (-1, -1), (1, -1), (-1, 1),
        (2, 0), (-2, 0), (0, 2), (0, -2),
        (2, 1), (-2, 1), (2, -1), (-2, -1),
    ]
    if index - 1 < len(ring_offsets):
        return ring_offsets[index - 1]
    # Fallback: stack at center for any overflow beyond cap
    return (0, 0)


def _build_summon_item_data(
    *,
    leaf: dict,
    spell_id: str,
    spell_name: str,
    caster_token_id: int,
    display_name: str,
) -> dict:
    item_data: dict[str, Any] = {
        "type": "summon",
        "summon": True,
        "name": display_name,
        "spell_id": spell_id,
        "spell_name": spell_name,
        "caster_token_id": caster_token_id,
    }
    monster_id = leaf.get("monsterId")
    if monster_id:
        item_data["monster_id"] = monster_id
    avatar_path = leaf.get("avatarPath")
    if avatar_path:
        item_data["icon"] = avatar_path
        item_data["avatar_url"] = avatar_path
    description = leaf.get("description")
    if description:
        item_data["description"] = description
    return item_data


def _resolve_summon_hp(hp_formula: Any) -> Optional[int]:
    if hp_formula is None:
        return None
    if isinstance(hp_formula, (int, float)):
        return int(hp_formula)
    if isinstance(hp_formula, str):
        text = hp_formula.strip()
        if text.isdigit():
            return int(text)
    return None


async def _materialize_summon_for_concentration(
    db: AsyncSession,
    *,
    caster_token: Token,
    conc_data: dict,
) -> list[Token]:
    """Spawn summon tokens for a concentration spell whose rules define
    a top-level `spawn_summon` effect. Mutates `conc_data` and the caster's
    `active_effects` in place. Idempotent: a no-op when `linked_token_ids`
    is already populated (e.g. duration edits or replay)."""
    if not isinstance(conc_data, dict):
        return []
    if conc_data.get("linked_token_ids"):
        return []
    area_effect = conc_data.get("area_effect")
    if not isinstance(area_effect, dict):
        return []
    spell_id = (conc_data.get("spell_id") or "").strip()
    if not spell_id:
        return []

    spell_data = get_spell_by_id(spell_id)
    leaves = _find_spawn_summon_leaves(spell_data)
    if not leaves:
        return []

    center_x = _coerce_int(area_effect.get("center_x"))
    center_y = _coerce_int(area_effect.get("center_y"))
    if center_x is None or center_y is None:
        return []
    map_url = area_effect.get("map_url") or caster_token.map_url
    if not map_url:
        return []

    spell_name = (spell_data or {}).get("name") or spell_id
    effects = list(caster_token.active_effects or [])
    created_tokens: list[Token] = []
    linked_ids: list[int] = []

    for leaf in leaves:
        instance_name = leaf.get("instanceName") or spell_name
        token_size = leaf.get("tokenSize") or "1x1"
        faction = leaf.get("faction") or "player"
        count = _coerce_int(leaf.get("count")) or 1
        count = max(1, min(_SUMMON_COUNT_CAP, count))
        hp_value = _resolve_summon_hp(leaf.get("hpFormula"))

        effect_id = f"{spell_id}_summon"
        entry: dict[str, Any] = {
            "id": effect_id,
            "name": f"召唤({instance_name})",
            "source": spell_name,
            "source_token_id": caster_token.id,
            "spell_id": spell_id,
            "is_concentration": True,
            "effect_type": "spawn_summon",
            "instance_name": instance_name,
            "token_size": token_size,
            "faction": faction,
        }
        monster_id = leaf.get("monsterId")
        if monster_id:
            entry["monster_id"] = monster_id
        if leaf.get("avatarPath"):
            entry["avatar_path"] = leaf.get("avatarPath")
        if leaf.get("hpFormula") is not None:
            entry["hp_formula"] = leaf.get("hpFormula")
        if count > 1:
            entry["count"] = count
        if leaf.get("description"):
            entry["description"] = leaf.get("description")

        effects = [e for e in effects if e.get("id") != effect_id]
        effects.append(entry)

        item_data = _build_summon_item_data(
            leaf=leaf,
            spell_id=spell_id,
            spell_name=spell_name,
            caster_token_id=caster_token.id,
            display_name=instance_name,
        )

        for idx in range(count):
            offset_x, offset_y = _summon_offset_for_index(idx)
            display = instance_name if count == 1 else f"{instance_name} {idx + 1}"
            new_token = Token(
                campaign_id=caster_token.campaign_id,
                item_data={**item_data, "name": display},
                item_quantity=1,
                user_id=caster_token.user_id or "dm",
                map_url=map_url,
                position_x=center_x + offset_x,
                position_y=center_y + offset_y,
                token_size=token_size,
                instance_name=display,
                current_hp=hp_value,
                faction=faction,
            )
            db.add(new_token)
            created_tokens.append(new_token)

    if not created_tokens:
        return []

    await db.flush()
    for new_token in created_tokens:
        if new_token.id is not None:
            linked_ids.append(int(new_token.id))

    caster_token.active_effects = effects or None
    flag_modified(caster_token, "active_effects")
    conc_data["linked_token_ids"] = linked_ids
    return created_tokens


# ── Grant-sense materialization (concentration-on-self area path) ──────────
# Same non-combat shortcut as the summon path above: spells like Detect Magic
# whose on-cast effects include a `grant_sense` leaf set concentration via
# /api/tokens/{id}/concentration without ever invoking the effect engine, so
# `GrantSenseHandler` never fires. This helper persists the caster-side
# active_effect that `handlers/sense.py` would produce, mirroring its entry
# shape so cleanup via `_remove_control_effects_from_tokens` matches by
# spell_id + source_token_id when the concentration ends.

_GRANT_SENSE_CN = {
    "truesight": "真实视觉",
    "blindsight": "盲视",
    "tremorsense": "震颤感知",
    "detect_invisible": "侦测隐形",
    "detect_magic": "侦测魔法",
    "remote_sensor": "远程感应器",
    "darkvision": "暗视觉",
}


def _find_grant_sense_leaves(spell_data: Optional[dict]) -> list[dict]:
    """Return all on-cast grant_sense effect leaves from a spell's rules."""
    leaves: list[dict] = []
    if not isinstance(spell_data, dict):
        return leaves
    for phase in spell_data.get("effects") or []:
        if not isinstance(phase, dict):
            continue
        if phase.get("trigger") and phase.get("trigger") != "on_cast":
            continue
        for leaf in phase.get("effects") or []:
            if isinstance(leaf, dict) and leaf.get("type") == "grant_sense":
                leaves.append(leaf)
    return leaves


async def _materialize_grant_sense_for_concentration(
    db: AsyncSession,
    *,
    caster_token: Token,
    conc_data: dict,
) -> list[dict]:
    """Persist `grant_sense` active_effects on the caster for a concentration
    spell whose rules carry on-cast grant_sense leaves. Mutates the caster's
    `active_effects` in place. Idempotent: repeated calls for the same spell
    replace any prior entry with the same id rather than duplicating. Returns
    the list of effect entries written this call (may be empty)."""
    if not isinstance(conc_data, dict):
        return []
    spell_id = (conc_data.get("spell_id") or "").strip()
    if not spell_id:
        return []

    spell_data = get_spell_by_id(spell_id)
    leaves = _find_grant_sense_leaves(spell_data)
    if not leaves:
        return []

    spell_name = (
        (spell_data or {}).get("name")
        or conc_data.get("spell_name")
        or spell_id
    )

    effects = list(caster_token.active_effects or [])
    written: list[dict] = []

    for leaf in leaves:
        sense_type = leaf.get("senseType")
        if not isinstance(sense_type, str) or not sense_type:
            continue
        effect_id = f"{spell_id}_sense"
        entry: dict[str, Any] = {
            "id": effect_id,
            "name": _GRANT_SENSE_CN.get(sense_type, sense_type),
            "source": spell_name,
            "source_token_id": caster_token.id,
            "spell_id": spell_id,
            "is_concentration": True,
            "effect_type": "grant_sense",
            "sense_type": sense_type,
        }
        sense_range = _coerce_int(leaf.get("range"))
        if sense_range is not None:
            entry["range"] = sense_range
        effects = [e for e in effects if e.get("id") != effect_id]
        effects.append(entry)
        written.append(entry)

    if not written:
        return []

    caster_token.active_effects = effects or None
    flag_modified(caster_token, "active_effects")
    return written


@router.get("/campaign/{campaign_id}/map", response_model=TokensResponse)
async def list_tokens_for_map(campaign_id: int, map_url: str, db: AsyncSession = Depends(get_db_readonly)):
    """Return all tokens for a given campaign and map_url with character/monster name and avatar"""
    import logging
    logger = logging.getLogger(__name__)

    # Get all tokens for this campaign and map
    result = await db.execute(
        select(Token).where(and_(Token.campaign_id == campaign_id, Token.map_url == map_url))
    )
    all_tokens = result.scalars().all()
    projection_map = await build_token_spell_projection_map(
        db,
        campaign_id=campaign_id,
        token_ids=[token.id for token in all_tokens],
    )

    tokens: List[TokenResponse] = []
    for t in all_tokens:
        logger.info(f"[Token Load] Token id={t.id}, current_hp={t.current_hp}, character_id={t.character_id}, monster_instance_id={t.monster_instance_id}, transformation_data={t.transformation_data is not None}")
        normalized_item_data, normalized_item_quantity, _ = normalize_token_item_fields(t.item_data, t.item_quantity)
        normalized_loot_bag_data, _ = normalize_loot_bag_data(t.loot_bag_data)
        token_data = {
            "id": t.id,
            "campaign_id": t.campaign_id,
            "character_id": t.character_id,
            "monster_instance_id": t.monster_instance_id,
            "item_data": normalized_item_data,
            "item_quantity": normalized_item_quantity if normalized_item_data is not None else t.item_quantity,
            "shop_id": t.shop_id,
            "loot_bag_data": normalized_loot_bag_data,
            "chest_id": t.chest_id,
            "user_id": t.user_id,
            "map_url": t.map_url,
            "position_x": t.position_x,
            "position_y": t.position_y,
            "token_size": t.token_size,
            "instance_name": t.instance_name,
            "current_hp": t.current_hp,
            "temp_hp": t.temp_hp,
            "active_effects": normalize_token_active_effects(t.active_effects, strict=False),
            "active_auras": normalize_token_active_auras(t.active_auras, strict=False),
            "faction": t.faction or "player",
            "concentration_spell": normalize_token_concentration_spell(t.concentration_spell, strict=False),
            "casting_in_progress": normalize_token_casting_in_progress(t.casting_in_progress, strict=False),
            "transformation_data": normalize_token_transformation_data(t.transformation_data, strict=False),
            "disguise_data": normalize_token_disguise_data(t.disguise_data, strict=False),
            "death_saves": normalize_token_death_saves(t.death_saves, strict=False),
        }

        # Fetch character, monster, item, or shop data
        if t.character_id:
            c_res = await db.execute(select(Character).where(Character.id == t.character_id))
            c = c_res.scalar_one_or_none()
            if c:
                token_data["character_name"] = c.name
                token_data["character_race"] = c.race_id
                token_data["character_class"] = c.class_id
                token_data["character_level"] = c.level
                token_data["avatar"] = c.avatar
                token_data["avatar_large"] = c.avatar_large
                # Compute max_hp for characters
                from app.utils.classes import get_class_by_name
                class_data = get_class_by_name(c.class_id)
                computed_max_hp = None
                if class_data:
                    hit_die_str = str(class_data.get("hitDie", 8))
                    hit_die = int(hit_die_str.replace("d", "")) if "d" in hit_die_str else int(hit_die_str)
                    con_mod = (c.ability_scores.get("constitution", 10) - 10) // 2 if c.ability_scores else 0
                    if c.level == 1:
                        computed_max_hp = hit_die + con_mod
                    else:
                        avg_per_level = (hit_die // 2) + 1
                        computed_max_hp = hit_die + con_mod + (c.level - 1) * (avg_per_level + con_mod)
                    token_data["max_hp"] = computed_max_hp
                # Use Character.current_hp as source of truth; fall back to max HP (full health)
                if c.current_hp is not None:
                    token_data["current_hp"] = c.current_hp
                elif computed_max_hp is not None:
                    token_data["current_hp"] = computed_max_hp
        elif t.monster_instance_id:
            m_res = await db.execute(select(MonsterInstance).where(MonsterInstance.id == t.monster_instance_id))
            m = m_res.scalar_one_or_none()
            if m:
                token_data["monster_name"] = m.name
                token_data["monster_name_cn"] = m.name_cn
                token_data["monster_type"] = m.type
                token_data["monster_size"] = m.size
                token_data["avatar"] = m.avatar_url
                token_data["avatar_large"] = m.avatar_url_large
                token_data["max_hp"] = m.hit_points  # 从怪物实例获取最大HP
                # Companion/Summon control fields
                token_data["controller_character_id"] = m.controller_character_id
                token_data["control_type"] = m.control_type
                token_data["entity_type"] = m.entity_type or ("npc" if (m.monster_data or {}).get("is_npc") else "monster")
        elif normalized_item_data:
            avatar, avatar_large = _resolve_item_token_avatar(normalized_item_data)
            token_data["avatar"] = avatar
            token_data["avatar_large"] = avatar_large
        elif t.shop_id:
            s_res = await db.execute(select(Shop).where(Shop.id == t.shop_id))
            s = s_res.scalar_one_or_none()
            if s:
                token_data["shop_name"] = s.name
                token_data["avatar"] = s.avatar_url
                token_data["avatar_large"] = s.avatar_url_large
        elif t.chest_id:
            ch_res = await db.execute(select(Chest).where(Chest.id == t.chest_id))
            ch = ch_res.scalar_one_or_none()
            if ch:
                token_data["chest_name"] = ch.name
                token_data["chest_state"] = ch.state
                token_data["avatar"] = ch.avatar_url
                token_data["avatar_large"] = ch.avatar_url_large

        token_data.update(projection_map.get(t.id, {}))

        tokens.append(TokenResponse(**token_data))

    return TokensResponse(tokens=tokens)


@router.post("", response_model=TokenResponse)
async def upsert_token(
    payload: TokenCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Create or update a token for character, monster, or item. Broadcast token_placed."""
    await check_campaign_member(payload.campaign_id, current_user, db)

    normalized_item_data, normalized_item_quantity, _ = normalize_token_item_fields(payload.item_data, payload.item_quantity)

    # If map_url is "current", fetch the current map URL from campaign
    map_url = payload.map_url
    if map_url == "current":
        from app.models.campaign import Campaign
        campaign_result = await db.execute(
            select(Campaign).where(Campaign.id == payload.campaign_id)
        )
        campaign = campaign_result.scalar_one_or_none()
        if campaign and campaign.current_map_url:
            map_url = campaign.current_map_url
        else:
            map_url = ""  # Default to empty if no current map

    # Build query based on whether it's a character, monster, or item token
    if payload.character_id:
        # Character token - check for existing token
        result = await db.execute(
            select(Token).where(
                and_(
                    Token.campaign_id == payload.campaign_id,
                    Token.character_id == payload.character_id,
                    Token.map_url == map_url,
                )
            )
        )
        token = result.scalar_one_or_none()
    else:
        # Monster/item/shop token - always create new (multiple instances allowed)
        token = None

    if token:
        # Update existing token
        token.position_x = payload.position_x
        token.position_y = payload.position_y
        token.token_size = payload.token_size
    else:
        # Create new token
        instance_name = payload.instance_name
        current_hp = payload.current_hp
        user_id = payload.user_id

        # For monster tokens, auto-generate instance name if not provided
        if payload.monster_instance_id and not instance_name:
            # Get monster instance to get base name
            m_res = await db.execute(select(MonsterInstance).where(MonsterInstance.id == payload.monster_instance_id))
            monster = m_res.scalar_one_or_none()
            if monster:
                # Count existing tokens for this monster in this campaign
                count_res = await db.execute(
                    select(func.count(Token.id)).where(
                        and_(
                            Token.campaign_id == payload.campaign_id,
                            Token.monster_instance_id == payload.monster_instance_id
                        )
                    )
                )
                count = count_res.scalar() or 0
                # Prefer Chinese name (name_cn) over English name (name) for display
                display_name = monster.name_cn or monster.name
                instance_name = f"{display_name} {count + 1}"

                # Set current_hp to monster's max HP if not provided
                if current_hp is None and monster.hit_points:
                    current_hp = monster.hit_points

        # For character tokens, use character name and user_id if not provided
        if payload.character_id:
            c_res = await db.execute(select(Character).where(Character.id == payload.character_id))
            char = c_res.scalar_one_or_none()
            if char:
                if not instance_name:
                    instance_name = char.name
                # Use character's user_id if not provided in payload
                if not user_id:
                    user_id = char.user_id
                # Note: Character HP is calculated from level, class, and CON modifier
                # current_hp should be set manually by DM or calculated on frontend
        # For item tokens, use item name and quantity if no instance_name
        if normalized_item_data is not None and not instance_name:
            try:
                item_name = normalized_item_data.get("name") or "未知物品"
            except Exception:
                item_name = "未知物品"
            quantity = normalized_item_quantity or 1
            instance_name = f"{item_name} ×{quantity}"
        # For shop tokens, use shop name if not provided
        if payload.shop_id and not instance_name:
            s_res = await db.execute(select(Shop).where(Shop.id == payload.shop_id))
            s = s_res.scalar_one_or_none()
            if s:
                instance_name = s.name
        # For chest tokens, use chest name if not provided
        if payload.chest_id and not instance_name:
            ch_res = await db.execute(select(Chest).where(Chest.id == payload.chest_id))
            ch = ch_res.scalar_one_or_none()
            if ch:
                instance_name = ch.name

        # Set default user_id for non-character tokens (DM creates these)
        if not user_id:
            if payload.monster_instance_id or payload.item_data or payload.shop_id or payload.chest_id:
                user_id = "dm"  # Default to DM for monster/item/shop tokens

        token = Token(
            campaign_id=payload.campaign_id,
            character_id=payload.character_id,
            monster_instance_id=payload.monster_instance_id,
            item_data=normalized_item_data,
            item_quantity=normalized_item_quantity,
            shop_id=payload.shop_id,
            chest_id=payload.chest_id,
            user_id=user_id,
            map_url=map_url,
            position_x=payload.position_x,
            position_y=payload.position_y,
            token_size=payload.token_size,
            instance_name=instance_name,
            current_hp=current_hp,
        )
        db.add(token)

    await db.commit()
    await db.refresh(token)

    # Fetch character, monster, or item data for response
    token_data = {
        "id": token.id,
        "campaign_id": token.campaign_id,
        "character_id": token.character_id,
        "monster_instance_id": token.monster_instance_id,
        "item_data": normalized_item_data if normalized_item_data is not None else token.item_data,
        "item_quantity": normalized_item_quantity if normalized_item_data is not None else token.item_quantity,
        "shop_id": token.shop_id,
        "chest_id": token.chest_id,
        "loot_bag_data": token.loot_bag_data,
        "user_id": token.user_id,
        "map_url": token.map_url,
        "position_x": token.position_x,
        "position_y": token.position_y,
        "token_size": token.token_size,
        "instance_name": token.instance_name,
        "current_hp": token.current_hp,
        "active_effects": normalize_token_active_effects(token.active_effects, strict=False),
        "active_auras": normalize_token_active_auras(token.active_auras, strict=False),
        "faction": token.faction,
        "concentration_spell": normalize_token_concentration_spell(token.concentration_spell, strict=False),
    }

    if token.character_id:
        c_res = await db.execute(select(Character).where(Character.id == token.character_id))
        c = c_res.scalar_one_or_none()
        if c:
            token_data["character_name"] = c.name
            token_data["character_race"] = c.race_id
            token_data["character_class"] = c.class_id
            token_data["character_level"] = c.level
            token_data["avatar"] = c.avatar
            token_data["avatar_large"] = c.avatar_large
    elif token.monster_instance_id:
        m_res = await db.execute(select(MonsterInstance).where(MonsterInstance.id == token.monster_instance_id))
        m = m_res.scalar_one_or_none()
        if m:
            token_data["monster_name"] = m.name
            token_data["monster_name_cn"] = m.name_cn
            token_data["monster_type"] = m.type
            token_data["monster_size"] = m.size
            token_data["avatar"] = m.avatar_url
            token_data["avatar_large"] = m.avatar_url_large
            token_data["max_hp"] = m.hit_points  # 从怪物实例获取最大HP
            token_data["entity_type"] = m.entity_type or ("npc" if (m.monster_data or {}).get("is_npc") else "monster")
    elif token_data["item_data"]:
        avatar, avatar_large = _resolve_item_token_avatar(token_data["item_data"])
        token_data["avatar"] = avatar
        token_data["avatar_large"] = avatar_large
    elif token.shop_id:
        s_res = await db.execute(select(Shop).where(Shop.id == token.shop_id))
        s = s_res.scalar_one_or_none()
        if s:
            token_data["shop_name"] = s.name
            token_data["avatar"] = s.avatar_url
            token_data["avatar_large"] = s.avatar_url_large
    elif token.chest_id:
        ch_res = await db.execute(select(Chest).where(Chest.id == token.chest_id))
        ch = ch_res.scalar_one_or_none()
        if ch:
            token_data["chest_name"] = ch.name
            token_data["chest_state"] = ch.state
            token_data["avatar"] = ch.avatar_url
            token_data["avatar_large"] = ch.avatar_url_large

    data = TokenResponse(**token_data)

    await realtime_publisher.publish_token_placed(
        token.campaign_id,
        token=data.model_dump(),
    )

    return data


@router.post("/{token_id}/position", response_model=TokenResponse)
async def update_token_position(
    token_id: int,
    payload: TokenPositionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    res = await db.execute(select(Token).where(Token.id == token_id))
    token = res.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    token.position_x = payload.position_x
    token.position_y = payload.position_y
    await db.commit()
    await db.refresh(token)

    # Fetch character or monster data
    token_data = {
        "id": token.id,
        "campaign_id": token.campaign_id,
        "character_id": token.character_id,
        "monster_instance_id": token.monster_instance_id,
        "user_id": token.user_id,
        "map_url": token.map_url,
        "position_x": token.position_x,
        "position_y": token.position_y,
        "token_size": token.token_size,
    }

    if token.character_id:
        c_res = await db.execute(select(Character).where(Character.id == token.character_id))
        c = c_res.scalar_one_or_none()
        if c:
            token_data["character_name"] = c.name
            token_data["character_race"] = c.race_id
            token_data["character_class"] = c.class_id
            token_data["character_level"] = c.level
            token_data["avatar"] = c.avatar
            token_data["avatar_large"] = c.avatar_large
    elif token.monster_instance_id:
        m_res = await db.execute(select(MonsterInstance).where(MonsterInstance.id == token.monster_instance_id))
        m = m_res.scalar_one_or_none()
        if m:
            token_data["monster_name"] = m.name
            token_data["monster_name_cn"] = m.name_cn
            token_data["monster_type"] = m.type
            token_data["monster_size"] = m.size
            token_data["avatar"] = m.avatar_url
            token_data["avatar_large"] = m.avatar_url_large
            token_data["max_hp"] = m.hit_points

    data = TokenResponse(**token_data)

    await realtime_publisher.publish_token_moved(
        token.campaign_id,
        token_id=token.id,
        position_x=token.position_x,
        position_y=token.position_y,
    )

    return data


@router.post("/{token_id}/size", response_model=TokenResponse)
async def update_token_size(
    token_id: int,
    payload: TokenSizeUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Update token size (e.g., 1x1, 2x2, 2x3)"""
    res = await db.execute(select(Token).where(Token.id == token_id))
    token = res.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    token.token_size = payload.token_size
    await db.commit()
    await db.refresh(token)

    # Fetch character or monster data
    token_data = {
        "id": token.id,
        "campaign_id": token.campaign_id,
        "character_id": token.character_id,
        "monster_instance_id": token.monster_instance_id,
        "user_id": token.user_id,
        "map_url": token.map_url,
        "position_x": token.position_x,
        "position_y": token.position_y,
        "token_size": token.token_size,
    }

    if token.character_id:
        c_res = await db.execute(select(Character).where(Character.id == token.character_id))
        c = c_res.scalar_one_or_none()
        if c:
            token_data["character_name"] = c.name
            token_data["character_race"] = c.race_id
            token_data["character_class"] = c.class_id
            token_data["character_level"] = c.level
            token_data["avatar"] = c.avatar
            token_data["avatar_large"] = c.avatar_large
    elif token.monster_instance_id:
        m_res = await db.execute(select(MonsterInstance).where(MonsterInstance.id == token.monster_instance_id))
        m = m_res.scalar_one_or_none()
        if m:
            token_data["monster_name"] = m.name
            token_data["monster_name_cn"] = m.name_cn
            token_data["monster_type"] = m.type
            token_data["monster_size"] = m.size
            token_data["avatar"] = m.avatar_url
            token_data["avatar_large"] = m.avatar_url_large
            token_data["max_hp"] = m.hit_points

    data = TokenResponse(**token_data)

    await realtime_publisher.publish_token_size_updated(
        token.campaign_id,
        token_id=token.id,
        token_size=token.token_size,
    )

    return data


@router.post("/{token_id}/hp", response_model=TokenResponse)
async def update_token_hp(
    token_id: int,
    payload: TokenHPUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Update token current HP. Handles Wild Shape HP logic and triggers automatic concentration check if damage was dealt."""
    res = await db.execute(select(Token).where(Token.id == token_id))
    token = res.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    # Calculate damage for concentration check
    old_hp = token.current_hp or 0
    new_hp = payload.current_hp
    damage_taken = max(0, old_hp - new_hp)
    incoming_damage = damage_taken

    # Temporary HP absorption — D&D 5E: temp HP absorbs damage first
    # Skip when force=True (DM direct HP edit, not damage)
    temp_hp_absorbed = 0
    if not payload.force and damage_taken > 0 and token.temp_hp and token.temp_hp > 0:
        absorbed = min(token.temp_hp, damage_taken)
        token.temp_hp -= absorbed
        damage_taken -= absorbed
        temp_hp_absorbed = absorbed
        new_hp = max(0, old_hp - damage_taken)
        if token.temp_hp <= 0:
            token.temp_hp = None
            # Auto-remove spell buffs whose temp HP pool just expired.
            if token.active_effects:
                new_effects = [
                    e for e in token.active_effects
                    if not (
                        e.get("spell_buff")
                        and spell_has_effect_type(get_spell_by_id(e.get("spell_id")), "grant_temp_hp")
                    )
                ]
                if len(new_effects) != len(token.active_effects):
                    token.active_effects = new_effects
                    flag_modified(token, "active_effects")
        logger.info(f"[TempHP] Token {token_id} temp HP absorbed {absorbed}, remaining temp_hp={token.temp_hp}, real damage={damage_taken}")

    # Transformation HP handling - D&D 5E rules (Wild Shape, Polymorph, etc.)
    # Damage goes to beast HP first, overflow goes to druid HP
    wild_shape_ended = False
    transformation_data_before = token.transformation_data

    if token.transformation_data and damage_taken > 0:
        # Token is transformed and taking damage
        beast_current_hp = token.transformation_data.get("current_hp", 0)
        beast_new_hp = beast_current_hp - damage_taken

        if beast_new_hp <= 0:
            # Beast HP depleted - transformation ends
            overflow_damage = abs(beast_new_hp)  # Damage that carries over
            wild_shape_ended = True

            # End transformation
            token.transformation_data = None

            # Apply overflow damage to character's actual HP
            # old_hp is the druid's original HP stored in token.current_hp
            token.current_hp = max(0, old_hp - overflow_damage)

            logger.info(f"[Wild Shape] Token {token_id} transformation ended from damage. Beast HP: {beast_current_hp} -> 0, Overflow: {overflow_damage}, Druid HP: {old_hp} -> {token.current_hp}")
        else:
            # Beast takes damage but survives
            token.transformation_data = {
                **token.transformation_data,
                "current_hp": beast_new_hp
            }
            # Druid's actual HP is unchanged
            logger.info(f"[Wild Shape] Token {token_id} beast took damage. Beast HP: {beast_current_hp} -> {beast_new_hp}")
            # Don't update token.current_hp - it stays as druid's HP
            damage_taken = 0  # No concentration check for druid when beast takes damage
    else:
        # Normal HP update (no transformation or healing)
        # Use new_hp which already accounts for temp HP absorption
        token.current_hp = new_hp

    # Also update Character.current_hp if this is a character token (keep in sync)
    if token.character_id and (not transformation_data_before or wild_shape_ended):
        # Only sync character HP if not transformed, or if transformation just ended
        c_res = await db.execute(select(Character).where(Character.id == token.character_id))
        char = c_res.scalar_one_or_none()
        if char:
            char.current_hp = token.current_hp

    # Perform concentration check if damage was dealt and token has concentration
    # (Only for damage to druid, not beast)
    conc_check_result = None
    if damage_taken > 0 and token.concentration_spell:
        conc_check_result = await perform_concentration_check(token, damage_taken, db)

    damage_break_cleanup_result = await apply_damage_break_cleanup(
        token=token,
        damage_amount=incoming_damage,
        db=db,
    )

    await db.commit()
    await db.refresh(token)

    # Fetch character or monster data
    token_data = {
        "id": token.id,
        "campaign_id": token.campaign_id,
        "character_id": token.character_id,
        "monster_instance_id": token.monster_instance_id,
        "user_id": token.user_id,
        "map_url": token.map_url,
        "position_x": token.position_x,
        "position_y": token.position_y,
        "token_size": token.token_size,
        "instance_name": token.instance_name,
        "current_hp": token.current_hp,
        "temp_hp": token.temp_hp,
    }

    max_hp = None
    if token.character_id:
        c_res = await db.execute(select(Character).where(Character.id == token.character_id))
        c = c_res.scalar_one_or_none()
        if c:
            token_data["character_name"] = c.name
            token_data["character_race"] = c.race_id
            token_data["character_class"] = c.class_id
            token_data["character_level"] = c.level
            token_data["avatar"] = c.avatar
            token_data["avatar_large"] = c.avatar_large
            # Compute max_hp for characters (same logic as elsewhere)
            from app.utils.classes import get_class_by_name
            class_data = get_class_by_name(c.class_id)
            if class_data:
                hit_die_str = str(class_data.get("hitDie", 8))
                hit_die = int(hit_die_str.replace("d", "")) if "d" in hit_die_str else int(hit_die_str)
                con_mod = (c.ability_scores.get("constitution", 10) - 10) // 2 if c.ability_scores else 0
                if c.level == 1:
                    max_hp = hit_die + con_mod
                else:
                    avg_roll = (hit_die // 2) + 1
                    max_hp = hit_die + con_mod + (c.level - 1) * (avg_roll + con_mod)
    elif token.monster_instance_id:
        m_res = await db.execute(select(MonsterInstance).where(MonsterInstance.id == token.monster_instance_id))
        m = m_res.scalar_one_or_none()
        if m:
            token_data["monster_name"] = m.name
            token_data["monster_name_cn"] = m.name_cn
            token_data["monster_type"] = m.type
            token_data["monster_size"] = m.size
            token_data["avatar"] = m.avatar_url
            token_data["avatar_large"] = m.avatar_url_large
            token_data["max_hp"] = m.hit_points
            max_hp = m.hit_points

    # Include transformation_data in response
    token_data["transformation_data"] = token.transformation_data

    data = TokenResponse(**token_data)


    # Broadcast HP update
    await realtime_publisher.publish_token_hp_updated(
        token.campaign_id,
        token_id=token.id,
        current_hp=token.current_hp,
        max_hp=max_hp,
        temp_hp=token.temp_hp,
        active_effects=token.active_effects,
        character_id=token.character_id,
        monster_instance_id=token.monster_instance_id,
        transformation_data=token.transformation_data,
    )

    if damage_break_cleanup_result.active_effects_changed:
        character_status_effects = None
        monster_status_effects = None
        monster_instance_id = token.monster_instance_id
        if token.character_id:
            refreshed_char = await db.get(Character, token.character_id)
            if refreshed_char:
                character_status_effects = refreshed_char.status_effects
        elif token.monster_instance_id:
            refreshed_monster = await db.get(MonsterInstance, token.monster_instance_id)
            if refreshed_monster:
                monster_instance_id = refreshed_monster.id
                monster_status_effects = refreshed_monster.status_effects
        await realtime_publisher.publish_token_active_effects_updated(
            token.campaign_id,
            token_id=token.id,
            active_effects=token.active_effects or [],
            character_id=token.character_id,
            monster_instance_id=monster_instance_id,
            character_status_effects=character_status_effects,
            monster_status_effects=monster_status_effects,
        )

    for touched_token_id in damage_break_cleanup_result.concentration_touched_token_ids:
        touched_token = await db.get(Token, touched_token_id)
        if touched_token:
            await realtime_publisher.publish_token_concentration_updated(
                token.campaign_id,
                token_id=touched_token_id,
                concentration_spell=touched_token.concentration_spell,
            )

    if old_hp > 0 and (token.current_hp or 0) <= 0:
        await notify_target_downed(
            db,
            campaign_id=token.campaign_id,
            target_token_id=token.id,
        )

    # If transformation ended from damage, broadcast that separately
    if wild_shape_ended:
        await realtime_publisher.publish_transformation_updated(
            token.campaign_id,
            token_id=token.id,
            transformation_data=None,
            reason="damage",
        )

    # If concentration check was performed, broadcast the result
    if conc_check_result and conc_check_result.get("needed"):
        await realtime_publisher.publish_concentration_check_result(
            token.campaign_id,
            data=conc_check_result,
        )
        # If concentration was broken, also send update and remove effects
        if not conc_check_result.get("success"):
            broken_spell = conc_check_result.get("broken_spell", {})
            runtime_touched_token_ids = list(conc_check_result.get("runtime_touched_token_ids") or [])
            spell_id = broken_spell.get("spell_id", "")
            removed_linked_token_ids = await _delete_linked_concentration_tokens(db, broken_spell)

            # Remove self-buff from caster and clear temp HP if applicable
            if spell_id:
                effects = token.active_effects or []
                removed_effs = [e for e in effects if e.get("spell_buff") and e.get("spell_id") == spell_id]
                new_effects = [e for e in effects if not (e.get("spell_buff") and e.get("spell_id") == spell_id)]
                if len(new_effects) < len(effects):
                    token.active_effects = new_effects
                    flag_modified(token, "active_effects")
                    for re in removed_effs:
                        if re.get("buff_effects", {}).get("tempHp"):
                            token.temp_hp = None
                            break

            # Remove control effects from caster + affected tokens. Including
            # the caster sweeps caster-side concentration-bound non-`spell_buff`
            # effects (e.g. Witch Bolt's `grant_action`) that the manual
            # spell_buff cleanup above does not touch.
            cleanup_ids = _old_concentration_cleanup_token_ids(
                caster_token_id=token.id,
                old_concentration_spell=broken_spell,
            )
            effects_removed_from: List[int] = []
            if spell_id and cleanup_ids:
                effects_removed_from = await _remove_control_effects_from_tokens(
                    db=db,
                    spell_id=spell_id,
                    affected_token_ids=cleanup_ids,
                    caster_token_id=token.id,
                    campaign_id=token.campaign_id,
                )
                await db.commit()
            elif removed_linked_token_ids:
                await db.commit()

            for linked_token_id in removed_linked_token_ids:
                await realtime_publisher.publish_map_token_removed(
                    token.campaign_id,
                    token_id=linked_token_id,
                )

            await realtime_publisher.publish_token_concentration_updated(
                token.campaign_id,
                token_id=token.id,
                concentration_spell=None,
                reason="damage",
                broken_spell=broken_spell,
                active_effects=token.active_effects or [],
                temp_hp=token.temp_hp,
                effects_removed_from=effects_removed_from,
            )
            if runtime_touched_token_ids:
                await publish_runtime_projection_updates(
                    db,
                    campaign_id=token.campaign_id,
                    token_ids=runtime_touched_token_ids,
                )

    return data


@router.put("/{token_id}/temp-hp")
async def update_token_temp_hp(token_id: int, payload: TokenTempHPUpdate, db: AsyncSession = Depends(get_db), current_user: dict = Depends(require_auth)):
    """Set temporary HP on a token. D&D 5E: don't stack, keep the higher value."""
    result = await db.execute(select(Token).where(Token.id == token_id))
    token = result.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    current_temp = token.temp_hp or 0
    new_temp = payload.temp_hp if payload.force else max(current_temp, payload.temp_hp)
    token.temp_hp = new_temp if new_temp > 0 else None
    await db.commit()

    await realtime_publisher.publish_token_hp_updated(
        token.campaign_id,
        token_id=token.id,
        current_hp=token.current_hp,
        temp_hp=token.temp_hp,
        character_id=token.character_id,
        monster_instance_id=token.monster_instance_id,
    )

    return {"success": True, "token_id": token_id, "temp_hp": token.temp_hp}


@router.post("/{token_id}/active-effects", response_model=TokenResponse)
async def update_token_active_effects(token_id: int, payload: TokenActiveEffectsUpdate, db: AsyncSession = Depends(get_db), current_user: dict = Depends(require_auth)):
    """Update token active status effects (e.g., Rage, Bardic Inspiration)"""
    res = await db.execute(select(Token).where(Token.id == token_id))
    token = res.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    old_effects = list(token.active_effects or [])

    # Check for condition immunity from auras before applying effects
    filtered_effects = []
    blocked_conditions = []

    if payload.active_effects and token.campaign_id and token.map_url:
        # Fetch all tokens on this map for aura immunity check
        all_tokens_result = await db.execute(
            select(Token).where(
                Token.campaign_id == token.campaign_id,
                Token.map_url == token.map_url
            )
        )
        all_tokens = all_tokens_result.scalars().all()
        all_tokens_data = []
        for t in all_tokens:
            token_data_item = {
                "id": t.id,
                "position_x": t.position_x,
                "position_y": t.position_y,
                "token_size": t.token_size,
                "active_auras": t.active_auras,
                "current_hp": t.current_hp,
                "character_name": t.instance_name or "Unknown"
            }
            if t.character_id:
                char = await db.get(Character, t.character_id)
                if char:
                    token_data_item["character_name"] = char.name
            all_tokens_data.append(token_data_item)

        # Check each effect for immunity
        for effect in payload.active_effects:
            effect_id = effect.get("id", "").lower()
            # Check if this is a condition that can be blocked by auras
            is_immune, immunity_source = check_condition_immunity(
                immunities=None,  # Only checking aura immunity here
                condition_type=effect_id,
                all_tokens=all_tokens_data,
                target_token_id=token_id
            )
            if is_immune:
                blocked_conditions.append({
                    "condition": effect_id,
                    "blocked_by": immunity_source,
                    "source": immunity_source
                })
                logger.info(f"[TokenEffects] Condition '{effect_id}' blocked by {immunity_source}")
            else:
                filtered_effects.append(effect)
    else:
        filtered_effects = payload.active_effects or []

    try:
        token.active_effects = normalize_token_active_effects(
            filtered_effects if filtered_effects else None,
            strict=True,
        )
    except RuntimeSchemaValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # If an appearance-disguise spell buff was removed, clear disguise_data too.
    disguise_cleared = _should_clear_disguise_after_effect_update(
        old_effects=list(old_effects or []),
        new_effects=list(filtered_effects or []),
        has_disguise_data=bool(token.disguise_data),
    )
    if disguise_cleared:
        token.disguise_data = None
        flag_modified(token, "disguise_data")

    # Cleanup spell-generated items for removed spell_buff effects
    old_buff_ids = {e.get("id") for e in old_effects if e.get("spell_buff")}
    new_buff_ids = {e.get("id") for e in filtered_effects if e.get("spell_buff")}
    removed_buff_ids = old_buff_ids - new_buff_ids
    removed_buffs = [e for e in old_effects if e.get("id") in removed_buff_ids]
    aura_changed = _strip_removed_spell_auras(
        token,
        removed_effects=removed_buffs,
    )
    if removed_buff_ids:
        from app.utils.spell_item_cleanup import cleanup_spell_generated_items
        await cleanup_spell_generated_items(db, removed_buffs, token, token.campaign_id)

    await db.commit()
    await db.refresh(token)

    # Build response data
    token_data = {
        "id": token.id,
        "campaign_id": token.campaign_id,
        "character_id": token.character_id,
        "monster_instance_id": token.monster_instance_id,
        "user_id": token.user_id,
        "map_url": token.map_url,
        "position_x": token.position_x,
        "position_y": token.position_y,
        "token_size": token.token_size,
        "instance_name": token.instance_name,
        "current_hp": token.current_hp,
        "active_effects": normalize_token_active_effects(token.active_effects, strict=False),
    }

    # Add character/monster data if applicable
    if token.character_id:
        c_res = await db.execute(select(Character).where(Character.id == token.character_id))
        c = c_res.scalar_one_or_none()
        if c:
            token_data["character_name"] = c.name
            token_data["avatar"] = c.avatar

    elif token.monster_instance_id:
        m_res = await db.execute(select(MonsterInstance).where(MonsterInstance.id == token.monster_instance_id))
        m = m_res.scalar_one_or_none()
        if m:
            token_data["monster_name"] = m.name
            token_data["monster_name_cn"] = m.name_cn
            token_data["avatar"] = m.avatar_url

    data = TokenResponse(**token_data)


    # Broadcast active effects update via WebSocket
    await realtime_publisher.publish_token_active_effects_updated(
        token.campaign_id,
        token_id=token.id,
        active_effects=token.active_effects,
    )
    if aura_changed:
        await realtime_publisher.publish_token_auras_updated(
            token.campaign_id,
            token_id=token.id,
            active_auras=token.active_auras or [],
            aura_id="",
            enabled=bool(token.active_auras),
        )
    await publish_runtime_projection_updates(
        db,
        campaign_id=token.campaign_id,
        token_ids=[token.id],
    )
    if token.campaign_id and token.map_url:
        await aura_service.on_token_move(
            token.id,
            int(token.campaign_id),
            token.map_url,
            db,
        )

    # If disguise was cleared, also broadcast disguise removal
    if disguise_cleared:
        await realtime_publisher.publish_token_disguise_updated(
            token.campaign_id,
            token_id=token.id,
            disguise_data=None,
            active_effects=token.active_effects,
        )

    return data


@router.post("/{token_id}/add-effect")
async def add_effect_to_token(token_id: int, payload: dict, db: AsyncSession = Depends(get_db), current_user: dict = Depends(require_auth)):
    """Atomically append a single effect to a token's active_effects (no race condition)"""
    res = await db.execute(select(Token).where(Token.id == token_id))
    token = res.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    effect = payload.get("effect")
    if not effect:
        raise HTTPException(status_code=400, detail="Missing 'effect' field")

    current = list(normalize_token_active_effects(token.active_effects, strict=False) or [])
    # Remove existing effect with same spell_id if it's a spell_buff
    spell_id = effect.get("spell_id")
    if effect.get("spell_buff") and spell_id:
        current = [e for e in current if not (e.get("spell_buff") and e.get("spell_id") == spell_id)]
    current.append(effect)

    try:
        token.active_effects = normalize_token_active_effects(current, strict=True)
    except RuntimeSchemaValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    flag_modified(token, "active_effects")
    await db.commit()
    await db.refresh(token)

    await realtime_publisher.publish_token_active_effects_updated(
        token.campaign_id,
        token_id=token.id,
        active_effects=token.active_effects,
    )
    await publish_runtime_projection_updates(
        db,
        campaign_id=token.campaign_id,
        token_ids=[token.id],
    )
    return {"status": "ok", "active_effects": token.active_effects}


@router.post("/{token_id}/toggle-reaction")
async def toggle_token_reaction(
    token_id: int,
    reaction_id: str,
    armed: bool,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Toggle a reaction's armed state on a token.
    When armed=True, the reaction will automatically trigger when its condition is met.
    """
    from sqlalchemy.orm.attributes import flag_modified

    res = await db.execute(select(Token).where(Token.id == token_id))
    token = res.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    # Get current effects
    active_effects = list(token.active_effects or [])

    # Reaction definitions
    REACTION_DEFS = {
        "uncanny_dodge": {"name": "灵巧闪避", "icon": "🏃", "color": "#6366f1", "uses_per_round": 1},
        "deflect_missiles": {"name": "落石偏转", "icon": "🤚", "color": "#14b8a6", "uses_per_round": 1},
        "parry": {"name": "招架", "icon": "⚔️", "color": "#f59e0b", "uses_per_round": 1},
        "shield_spell": {"name": "护盾术", "icon": "🛡️", "color": "#3b82f6", "uses_per_round": 1},
    }

    reaction_def = REACTION_DEFS.get(reaction_id)
    if not reaction_def:
        raise HTTPException(status_code=400, detail=f"Unknown reaction: {reaction_id}")

    # Find existing reaction effect
    existing_idx = None
    for i, effect in enumerate(active_effects):
        if effect.get("id") == reaction_id:
            existing_idx = i
            break

    if armed:
        # Arm the reaction
        new_effect = {
            "id": reaction_id,
            "name": reaction_def["name"],
            "icon": reaction_def["icon"],
            "color": reaction_def["color"],
            "armed": True,
            "uses_remaining": reaction_def["uses_per_round"],
            "uses_per_round": reaction_def["uses_per_round"],
            "is_reaction": True
        }
        if existing_idx is not None:
            active_effects[existing_idx] = new_effect
        else:
            active_effects.append(new_effect)
        logger.info(f"[Reaction] Armed {reaction_id} on token {token_id}")
    else:
        # Disarm the reaction - remove it
        if existing_idx is not None:
            active_effects.pop(existing_idx)
        logger.info(f"[Reaction] Disarmed {reaction_id} on token {token_id}")

    token.active_effects = active_effects if active_effects else None
    flag_modified(token, "active_effects")
    await db.commit()
    await db.refresh(token)

    # Broadcast update
    await realtime_publisher.publish_token_active_effects_updated(
        token.campaign_id,
        token_id=token.id,
        active_effects=token.active_effects,
    )

    return {
        "success": True,
        "token_id": token_id,
        "reaction_id": reaction_id,
        "armed": armed,
        "active_effects": token.active_effects
    }


@router.post("/{token_id}/reset-reactions")
async def reset_token_reactions(token_id: int, db: AsyncSession = Depends(get_db), current_user: dict = Depends(require_auth)):
    """
    Reset all reaction uses for a token (typically called at start of their turn).
    """
    from sqlalchemy.orm.attributes import flag_modified

    res = await db.execute(select(Token).where(Token.id == token_id))
    token = res.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    if not token.active_effects:
        return {"success": True, "message": "No effects to reset"}

    # Reset uses for all armed reactions
    updated = False
    active_effects = list(token.active_effects)
    for i, effect in enumerate(active_effects):
        if effect.get("is_reaction") and effect.get("armed"):
            uses_per_round = effect.get("uses_per_round", 1)
            if effect.get("uses_remaining", 0) < uses_per_round:
                active_effects[i] = {**effect, "uses_remaining": uses_per_round}
                updated = True

    if updated:
        token.active_effects = active_effects
        flag_modified(token, "active_effects")
        await db.commit()
        await db.refresh(token)

        # Broadcast update
        await realtime_publisher.publish_token_active_effects_updated(
            token.campaign_id,
            token_id=token.id,
            active_effects=token.active_effects,
        )

    return {
        "success": True,
        "token_id": token_id,
        "active_effects": token.active_effects
    }


@router.delete("/{token_id}")
async def delete_token(token_id: int, db: AsyncSession = Depends(get_db), current_user: dict = Depends(require_auth)):
    res = await db.execute(select(Token).where(Token.id == token_id))
    token = res.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    campaign_id = token.campaign_id

    await db.delete(token)
    await db.commit()

    # Check if there's an active combat and remove the token from it
    combat_result = await db.execute(
        select(CampaignStorage).where(
            and_(
                CampaignStorage.campaign_id == campaign_id,
                CampaignStorage.object_type == "combat",
                CampaignStorage.object_id == "current",
                CampaignStorage.is_active == True
            )
        )
    )
    combat_obj = combat_result.scalar_one_or_none()

    if combat_obj and combat_obj.data:
        combat_data = combat_obj.data
        participants = combat_data.get("participants", [])
        order = combat_data.get("order", [])

        # Check if token is in combat
        if token_id in order:
            logger.info(f"[Token Delete] Removing token {token_id} from active combat in campaign {campaign_id}")

            # Snapshot pre-mutation combat state so the turn-trigger hook can
            # detect whether deleting this token changed the active combatant.
            prev_combat_data = dict(combat_data) if isinstance(combat_data, dict) else None
            prev_combat_is_active = bool(combat_obj.is_active)

            # Remove from participants
            new_participants = [p for p in participants if p.get("token_id") != token_id]

            # Remove from order and adjust current_index if needed
            token_index = order.index(token_id)
            new_order = [tid for tid in order if tid != token_id]

            current_index = combat_data.get("current_index", 0)
            # If removed token was before or at current index, adjust
            if new_order:
                if token_index < current_index:
                    current_index = max(0, current_index - 1)
                elif token_index == current_index:
                    # Current turn token removed, keep index but wrap if needed
                    current_index = current_index % len(new_order) if new_order else 0
            else:
                current_index = 0

            # Update combat data
            new_combat_data = {
                **combat_data,
                "participants": new_participants,
                "order": new_order,
                "current_index": current_index
            }

            # If no participants left, end combat
            if not new_order:
                combat_obj.is_active = False
                logger.info(f"[Token Delete] No participants left, ending combat in campaign {campaign_id}")

            combat_obj.data = new_combat_data
            combat_obj.version += 1
            await db.commit()

            # Dispatch turn triggers via the shared hook (same semantics as
            # campaign_storage.update_storage_object). Runs after the commit
            # and before the storage_updated broadcast, matching Stage 8a.
            await dispatch_combat_turn_triggers_if_changed(
                db,
                campaign_id=campaign_id,
                prev_data=prev_combat_data,
                prev_is_active=prev_combat_is_active,
                new_data=new_combat_data,
                new_is_active=bool(combat_obj.is_active),
            )

            # Broadcast updated combat state
            await realtime_publisher.publish_combat_storage_updated(
                campaign_id,
                event_type="storage_updated",
                storage_object={
                    "id": combat_obj.id,
                    "campaign_id": combat_obj.campaign_id,
                    "object_type": combat_obj.object_type,
                    "object_id": combat_obj.object_id,
                    "object_name": combat_obj.object_name,
                    "data": new_combat_data,
                    "is_active": combat_obj.is_active,
                    "version": combat_obj.version,
                },
            )

    await realtime_publisher.publish_map_token_removed(
        campaign_id,
        token_id=token_id,
    )

    return {"success": True}


@router.post("/campaign/{campaign_id}/decrement-effect-durations")
async def decrement_effect_durations(
    campaign_id: str,
    map_url: str,
    rounds: int = 1,
    current_day: Optional[int] = None,
    current_hour: Optional[int] = None,
    current_minute: Optional[int] = None,
    current_second: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    try:
        if current_day is not None:
            current_time = {
                "day": current_day,
                "hour": current_hour or 0,
                "minute": current_minute or 0,
                "second": current_second or 0,
            }
        else:
            current_time = await _get_campaign_world_time(db, int(campaign_id))
        # Compatibility endpoint: route through the single settlement owner but
        # run ONLY the token active-effect step. The out-of-combat top-bar
        # advance also fires WS time_update, which already settled due casts,
        # concentration, and runtime instances for this same world time; running
        # them again here would double-broadcast. RT-3 (frontend) will collapse
        # the dual dispatch; until then this subset keeps settlement single-owned
        # without duplicating those steps. See app/services/world_time_settlement.
        from app.services.world_time_settlement import settle_world_time

        settlement = await settle_world_time(
            db,
            int(campaign_id),
            current_time,
            rounds=rounds,
            map_url=map_url,
            source="http_decrement",
            settle_due_casts=False,
            settle_effect_durations=True,
            settle_concentration=False,
            settle_runtime_instances=False,
        )
        return settlement.effect_cleanup
    except Exception as e:
        logger.error(f"[Effect Duration] Error decrementing durations: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def cleanup_campaign_effect_durations(
    db: AsyncSession,
    *,
    campaign_id: int,
    current_time: Optional[dict],
    rounds: int = 1,
    map_url: Optional[str] = None,
) -> dict:
    """
    Decrement duration of all active effects on tokens for a campaign/map.
    Called when a new combat round starts, or when time advances (rest, manual round advance).
    Effects with expires_at are compared against the current campaign world time.
    Effects with only duration (legacy) are decremented by rounds.
    rounds: number of rounds to decrement (default 1, use higher for rests)
    When rounds=0, only world-time expirations are cleaned.
    """
    current_seconds = _world_time_to_seconds(current_time) if current_time else None
    query_filters = [Token.campaign_id == int(campaign_id), Token.active_effects.isnot(None)]
    if map_url is not None:
        query_filters.append(Token.map_url == map_url)

    result = await db.execute(select(Token).where(and_(*query_filters)))
    tokens = result.scalars().all()

    updated_tokens = []
    for token in tokens:
        if not token.active_effects:
            continue

        old_effects = list(token.active_effects or [])
        new_effects = []
        effects_changed = False
        expired_effects = []

        for effect in old_effects:
            if effect.get("duration_unit") == "day":
                new_effects.append(effect)
                continue

            expires_at = effect.get("expires_at")
            if expires_at and current_seconds is not None:
                expire_seconds = _world_time_to_seconds(expires_at)
                if current_seconds >= expire_seconds:
                    expired_effects.append(effect)
                    effects_changed = True
                    continue
                new_effects.append(effect)
                continue

            dur = effect.get("duration")
            if dur is None:
                dur = effect.get("roundsRemaining")
            if rounds > 0 and dur is not None and dur > 0:
                new_duration = dur - rounds
                if new_duration > 0:
                    updated = {**effect, "duration": new_duration}
                    if "roundsRemaining" in effect:
                        updated["roundsRemaining"] = new_duration
                    new_effects.append(updated)
                else:
                    expired_effects.append(effect)
                effects_changed = True
            else:
                new_effects.append(effect)

        if effects_changed:
            aura_changed = _strip_removed_spell_auras(
                token,
                removed_effects=expired_effects,
            )
            token.active_effects = new_effects if new_effects else None
            disguise_cleared = _should_clear_disguise_after_effect_update(
                old_effects=old_effects,
                new_effects=list(new_effects or []),
                has_disguise_data=bool(token.disguise_data),
            )
            if disguise_cleared:
                token.disguise_data = None
                flag_modified(token, "disguise_data")
            updated_tokens.append(
                {
                    "token_id": token.id,
                    "token": token,
                    "active_effects": new_effects,
                    "expired_effects": expired_effects,
                    "disguise_cleared": disguise_cleared,
                    "aura_changed": aura_changed,
                }
            )

    await db.commit()

    from app.utils.spell_item_cleanup import cleanup_spell_generated_items

    for update in updated_tokens:
        expired = update.get("expired_effects", [])
        if not expired:
            continue
        await cleanup_spell_generated_items(db, expired, update["token"], int(campaign_id))
        restore_control = next(
            (
                get_master_of_nature_restore_data(effect)
                for effect in expired
                if get_master_of_nature_restore_data(effect)
            ),
            None,
        )
        expired_conditions = [
            e.get("condition") for e in expired if isinstance(e, dict) and e.get("condition")
        ]
        if expired_conditions:
            tk = update["token"]
            if tk.character_id:
                char = await db.get(Character, tk.character_id)
                if char:
                    status = dict(char.status_effects or {})
                    conds = list(status.get("active_conditions", []))
                    conds = [c for c in conds if c.get("condition") not in expired_conditions]
                    status["active_conditions"] = conds
                    char.status_effects = status
                    update["_broadcast_char_status"] = {
                        "character_id": int(char.id),
                        "status_effects": status,
                    }
            elif tk.monster_instance_id:
                monster = await db.get(MonsterInstance, tk.monster_instance_id)
                if monster:
                    status = dict(monster.status_effects or {})
                    conds = list(status.get("conditions", []))
                    conds = [c for c in conds if c.get("condition") not in expired_conditions]
                    status["conditions"] = conds
                    monster.status_effects = status
                    update["_broadcast_monster_status"] = {
                        "monster_instance_id": int(monster.id),
                        "status_effects": status,
                    }
        if restore_control:
            tk = update["token"]
            if tk.monster_instance_id:
                monster = await db.get(MonsterInstance, tk.monster_instance_id)
                if monster:
                    monster.controller_character_id = restore_control.get(
                        "original_controller_character_id"
                    )
                    monster.control_type = restore_control.get("original_control_type")
            original_user_id = restore_control.get("original_user_id")
            original_faction = restore_control.get("original_faction") or "enemy"
            tk.user_id = original_user_id
            faction_changed = tk.faction != original_faction
            tk.faction = original_faction
            update["_broadcast_token_update"] = {
                "id": tk.id,
                "user_id": tk.user_id,
                "faction": tk.faction,
                "controller_character_id": restore_control.get(
                    "original_controller_character_id"
                ),
                "control_type": restore_control.get("original_control_type"),
            }
            if faction_changed:
                update["_recalc_aura"] = True
    await db.commit()

    for update in updated_tokens:
        if "_broadcast_token_update" in update:
            await realtime_publisher.publish_token_updated(
                campaign_id,
                token=update["_broadcast_token_update"],
            )
        broadcast_msg: dict = {
            "token_id": update["token_id"],
            "active_effects": update["active_effects"],
        }
        if "_broadcast_char_status" in update:
            info = update["_broadcast_char_status"]
            broadcast_msg["character_id"] = info["character_id"]
            broadcast_msg["character_status_effects"] = info["status_effects"]
        elif "_broadcast_monster_status" in update:
            info = update["_broadcast_monster_status"]
            broadcast_msg["monster_instance_id"] = info["monster_instance_id"]
            broadcast_msg["monster_status_effects"] = info["status_effects"]
        await realtime_publisher.publish_token_active_effects_updated(
            campaign_id,
            **broadcast_msg,
        )
        if update.get("aura_changed"):
            await realtime_publisher.publish_token_auras_updated(
                campaign_id,
                token_id=update["token_id"],
                active_auras=update["token"].active_auras or [],
                aura_id="",
                enabled=bool(update["token"].active_auras),
            )
        if update.get("disguise_cleared"):
            await realtime_publisher.publish_token_disguise_updated(
                campaign_id,
                token_id=update["token_id"],
                disguise_data=None,
                active_effects=update["active_effects"],
            )

        expired_names = [
            e.get("name", "Unknown") if isinstance(e, dict) else e
            for e in update["expired_effects"]
        ]
        for effect_name in expired_names:
            await realtime_publisher.publish_effect_expired(
                campaign_id,
                token_id=update["token_id"],
                effect_name=effect_name,
            )

        if update.get("_recalc_aura"):
            await aura_service.on_token_move(
                update["token_id"],
                int(campaign_id),
                update["token"].map_url,
                db,
            )
        elif update.get("aura_changed") and update["token"].map_url:
            await aura_service.on_token_move(
                update["token_id"],
                int(campaign_id),
                update["token"].map_url,
                db,
            )

        if "_broadcast_char_status" in update:
            info = update["_broadcast_char_status"]
            await realtime_publisher.publish_character_status_effects_updated(
                campaign_id,
                character_id=info["character_id"],
                status_effects=info["status_effects"],
            )

    logger.info(
        f"[Effect Duration] Updated durations for {len(updated_tokens)} tokens in campaign {campaign_id}"
    )
    return {
        "success": True,
        "updated_count": len(updated_tokens),
        "updates": [
            {
                "token_id": u["token_id"],
                "active_effects": u["active_effects"],
                "expired_effects": [
                    e.get("name", "Unknown") if isinstance(e, dict) else e
                    for e in u["expired_effects"]
                ],
            }
            for u in updated_tokens
        ],
    }


# ============== Loot Bag Endpoints ==============

@router.post("/loot-bag/create", response_model=TokenResponse)
async def create_loot_bag(payload: LootBagCreateRequest, db: AsyncSession = Depends(get_db), current_user: dict = Depends(require_auth)):
    """Create a loot bag token from a dead monster's inventory/currency"""
    # Get the monster token
    result = await db.execute(select(Token).where(Token.id == payload.monster_token_id))
    monster_token = result.scalar_one_or_none()
    if not monster_token:
        raise HTTPException(status_code=404, detail="Monster token not found")

    if not monster_token.monster_instance_id:
        raise HTTPException(status_code=400, detail="Token is not a monster token")

    # Get the monster instance to get inventory/currency
    m_res = await db.execute(
        select(MonsterInstance).where(MonsterInstance.id == monster_token.monster_instance_id)
    )
    monster = m_res.scalar_one_or_none()
    if not monster:
        raise HTTPException(status_code=404, detail="Monster instance not found")

    # Check if monster has anything to drop
    has_items = monster.inventory and len(monster.inventory) > 0
    has_currency = monster.currency and any(v > 0 for v in monster.currency.values())

    if not has_items and not has_currency:
        raise HTTPException(status_code=400, detail="Monster has no items or currency to drop")

    # Use provided position or monster's position
    pos_x = payload.position_x if payload.position_x is not None else monster_token.position_x
    pos_y = payload.position_y if payload.position_y is not None else monster_token.position_y

    # Create loot bag data
    source_name = monster.name_cn or monster.name
    normalized_loot_items, _, _ = normalize_character_equipment_payloads(monster.inventory or [])
    loot_bag_data = {
        "source_monster_id": monster.id,
        "source_name": source_name,
        "items": normalized_loot_items,
        "currency": monster.currency or {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0},
        "looted_by": []
    }

    # Create loot bag token
    loot_token = Token(
        campaign_id=monster_token.campaign_id,
        loot_bag_data=loot_bag_data,
        user_id="dm",
        map_url=monster_token.map_url,
        position_x=pos_x,
        position_y=pos_y,
        token_size="0.5x0.5",
        instance_name=f"战利品袋 ({source_name})"
    )
    db.add(loot_token)

    # Delete the monster token
    await db.delete(monster_token)
    await db.commit()
    await db.refresh(loot_token)

    # Build response
    token_data = {
        "id": loot_token.id,
        "campaign_id": loot_token.campaign_id,
        "loot_bag_data": loot_token.loot_bag_data,
        "user_id": loot_token.user_id,
        "map_url": loot_token.map_url,
        "position_x": loot_token.position_x,
        "position_y": loot_token.position_y,
        "token_size": loot_token.token_size,
        "instance_name": loot_token.instance_name,
    }
    data = TokenResponse(**token_data)

    # Broadcast monster token removed
    await realtime_publisher.publish_map_token_removed(
        loot_token.campaign_id,
        token_id=payload.monster_token_id,
    )

    # Broadcast loot bag created
    await realtime_publisher.publish_loot_bag_created(
        loot_token.campaign_id,
        token=data.model_dump(),
        source_name=source_name,
    )

    return data


@router.post("/loot-bag/{token_id}/loot", response_model=LootBagLootResponse)
async def loot_from_bag(
    token_id: int,
    payload: LootBagLootRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Loot items and/or currency from a loot bag"""
    # Get the loot bag token
    result = await db.execute(select(Token).where(Token.id == token_id))
    token = result.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    if not token.loot_bag_data:
        raise HTTPException(status_code=400, detail="Token is not a loot bag")

    # Get the character doing the looting
    c_res = await db.execute(select(Character).where(Character.id == payload.character_id))
    character = c_res.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    loot_data = token.loot_bag_data
    normalized_loot_data, loot_changed = normalize_loot_bag_data(loot_data)
    if loot_changed:
        token.loot_bag_data = normalized_loot_data
        loot_data = normalized_loot_data or {}
    items = loot_data.get("items", [])
    currency = loot_data.get("currency", {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0})

    items_taken = []
    currency_taken = {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}

    # Take items
    if payload.item_indices is None:
        # Take all items
        items_taken = items.copy()
        remaining_items = []
    else:
        # Take specific items by index
        remaining_items = []
        for i, item in enumerate(items):
            if i in payload.item_indices:
                items_taken.append(item)
            else:
                remaining_items.append(item)

    # Take currency
    if payload.take_currency:
        currency_taken = currency.copy()
        remaining_currency = {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}
    else:
        remaining_currency = currency.copy()

    # Add items to character's equipment
    char_equipment = character.equipment or []
    for item in items_taken:
        char_equipment, _, _ = merge_item_into_equipment(
            char_equipment,
            item,
            quantity=item.get("quantity", 1) if isinstance(item, dict) else 1,
        )
    normalized_equipment, currency_extracted, _ = normalize_character_equipment_payloads(char_equipment)
    character.equipment = normalized_equipment

    # Add currency to character
    char_currency = character.currency or {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}
    for coin_type in ["cp", "sp", "ep", "gp", "pp"]:
        char_currency[coin_type] = char_currency.get(coin_type, 0) + currency_taken.get(coin_type, 0)
        char_currency[coin_type] = char_currency.get(coin_type, 0) + currency_extracted.get(coin_type, 0)
    character.currency = char_currency

    # Update or delete loot bag
    bag_empty = len(remaining_items) == 0 and all(v == 0 for v in remaining_currency.values())

    if bag_empty:
        # Delete empty loot bag
        await db.delete(token)
    else:
        # Update loot bag data
        token.loot_bag_data = {
            **loot_data,
            "items": remaining_items,
            "currency": remaining_currency,
            "looted_by": loot_data.get("looted_by", []) + [str(character.id)]
        }

    await db.commit()

    # Broadcast loot event
    await realtime_publisher.publish_loot_bag_looted(
        token.campaign_id,
        token_id=token_id,
        character_id=character.id,
        character_name=character.name,
        items_taken=items_taken,
        currency_taken=currency_taken,
        bag_empty=bag_empty,
    )

    await realtime_publisher.publish_character_equipment_updated(
        token.campaign_id,
        character_id=character.id,
        equipment=character.equipment or [],
        currency=character.currency or {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0},
        reason="loot_bag_looted",
    )

    # If bag is empty, also broadcast removal
    if bag_empty:
        await realtime_publisher.publish_loot_bag_removed(
            token.campaign_id,
            token_id=token_id,
        )

    return LootBagLootResponse(
        success=True,
        items_taken=items_taken,
        currency_taken=currency_taken,
        remaining_items=remaining_items,
        remaining_currency=remaining_currency,
        bag_empty=bag_empty
    )


@router.delete("/loot-bag/{token_id}")
async def delete_loot_bag(token_id: int, db: AsyncSession = Depends(get_db), current_user: dict = Depends(require_auth)):
    """Delete a loot bag (DM only)"""
    result = await db.execute(select(Token).where(Token.id == token_id))
    token = result.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    if not token.loot_bag_data:
        raise HTTPException(status_code=400, detail="Token is not a loot bag")

    campaign_id = token.campaign_id
    await db.delete(token)
    await db.commit()

    await realtime_publisher.publish_loot_bag_removed(
        campaign_id,
        token_id=token_id,
    )

    return {"success": True}


# ============== Aura Endpoints ==============

@router.post("/{token_id}/toggle-aura")
async def toggle_token_aura(
    token_id: int,
    aura_id: str,
    enabled: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Toggle an aura on/off for a token"""
    result = await aura_service.toggle_aura(token_id, aura_id, enabled, db)

    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Failed to toggle aura"))

    # Get token for broadcast
    token_result = await db.execute(select(Token).where(Token.id == token_id))
    token = token_result.scalar_one_or_none()

    if token:
        # Broadcast aura update
        await realtime_publisher.publish_token_auras_updated(
            token.campaign_id,
            token_id=token_id,
            active_auras=result.get("active_auras"),
            aura_id=aura_id,
            enabled=enabled,
        )

        # Trigger aura recalculation for the map
        await aura_service.on_token_move(token_id, token.campaign_id, token.map_url, db)

    return result


@router.get("/{token_id}/auras")
async def get_token_auras(token_id: int, db: AsyncSession = Depends(get_db)):
    """Get active auras for a token"""
    result = await db.execute(select(Token).where(Token.id == token_id))
    token = result.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    return {
        "token_id": token_id,
        "active_auras": token.active_auras or []
    }


@router.get("/{token_id}/available-auras")
async def get_available_auras_for_token(token_id: int, db: AsyncSession = Depends(get_db)):
    """Get list of auras available to this token based on character class/level"""
    result = await db.execute(select(Token).where(Token.id == token_id))
    token = result.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    if not token.character_id:
        return {"available_auras": [], "reason": "Only character tokens can have auras"}

    # Get character data
    char_result = await db.execute(select(Character).where(Character.id == token.character_id))
    character = char_result.scalar_one_or_none()
    if not character:
        return {"available_auras": [], "reason": "Character not found"}

    available = aura_service.get_available_auras_for_character(
        character.class_id or "",
        character.subclass_id,
        character.level or 1
    )

    return {
        "available_auras": available,
        "character_class": character.class_id,
        "character_level": character.level
    }


@router.post("/{token_id}/faction")
async def update_token_faction(
    token_id: int,
    payload: TokenFactionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Update token faction (player, enemy, neutral)"""
    result = await db.execute(select(Token).where(Token.id == token_id))
    token = result.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    if payload.faction not in ("player", "enemy", "neutral"):
        raise HTTPException(status_code=400, detail="Invalid faction. Must be: player, enemy, neutral")

    token.faction = payload.faction
    await db.commit()

    # Broadcast faction update
    await realtime_publisher.publish_token_faction_updated(
        token.campaign_id,
        token_id=token_id,
        faction=payload.faction,
    )

    # Trigger aura recalculation (faction affects who receives aura)
    await aura_service.on_token_move(token_id, token.campaign_id, token.map_url, db)

    return {"success": True, "token_id": token_id, "faction": payload.faction}


@router.get("/campaign/{campaign_id}/aura-state")
async def get_campaign_aura_state(
    campaign_id: int,
    map_url: str,
    db: AsyncSession = Depends(get_db)
):
    """Get current aura state for all tokens on a map"""
    # Check if combat is active
    combat_result = await db.execute(
        select(CampaignStorage).where(
            and_(
                CampaignStorage.campaign_id == campaign_id,
                CampaignStorage.object_type == "combat",
                CampaignStorage.object_id == "current",
                CampaignStorage.is_active == True
            )
        )
    )
    combat = combat_result.scalar_one_or_none()
    in_combat = combat is not None

    # Get aura state
    aura_updates = await aura_service.recalculate_auras_for_map(
        campaign_id, map_url, db, in_combat
    )

    return {
        "campaign_id": campaign_id,
        "map_url": map_url,
        "in_combat": in_combat,
        "auras": aura_updates
    }


@router.post("/{token_id}/transform")
async def update_token_transformation(
    token_id: int,
    payload: TokenTransformationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Update token transformation data (Wild Shape, Polymorph, True Polymorph, Shapechange, etc.).
    Set transformation_data to null to end the transformation.
    """
    result = await db.execute(select(Token).where(Token.id == token_id))
    token = result.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    # Get target name for narrative
    target_name = "目标"
    if token.character_id:
        char_result = await db.execute(select(Character).where(Character.id == token.character_id))
        char = char_result.scalar_one_or_none()
        if char:
            target_name = char.name
    elif token.instance_name:
        target_name = token.instance_name

    existing_transformation = token.transformation_data or {}

    # Extract source info
    if payload.transformation_data:
        source_info = payload.transformation_data.get("source", {})
    else:
        source_info = existing_transformation.get("source", {})

    spell_name = source_info.get("spell_name", "变化")
    config_id = source_info.get("config_id", "wild_shape")
    active_mode = (
        payload.transformation_data.get("activeMode")
        if payload.transformation_data
        else existing_transformation.get("activeMode")
    )
    spell_data = get_spell_by_id(config_id)
    size_delta = get_spell_size_delta(spell_data, active_mode)

    if size_delta is not None:
        raise HTTPException(
            status_code=400,
            detail="体型变化法术必须通过统一施法链处理，不能再直接走 /tokens/{id}/transform。",
        )

    # Determine if transforming or reverting
    is_transforming = payload.transformation_data is not None
    beast_name = ""
    if is_transforming and payload.transformation_data:
        beast_name = payload.transformation_data.get("beast_name", "") or payload.transformation_data.get("beast_name_en", "生物")

    # Update transformation data
    try:
        token.transformation_data = normalize_token_transformation_data(payload.transformation_data, strict=True)
    except RuntimeSchemaValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    flag_modified(token, "transformation_data")

    await db.commit()
    logger.info(f"[Transform] Token {token_id} transformation_data updated: {payload.transformation_data is not None}, config={config_id}")

    # Broadcast transformation update immediately
    await realtime_publisher.publish_transformation_updated(
        token.campaign_id,
        token_id=token_id,
        transformation_data=payload.transformation_data,
    )

    # Spawn background task for narrative generation (non-blocking)
    task = asyncio.create_task(
        _generate_transformation_narrative_background(
            campaign_id=token.campaign_id,
            token_id=token_id,
            character_id=token.character_id,
            target_name=target_name,
            beast_name=beast_name,
            spell_name=spell_name,
            config_id=config_id,
            is_transforming=is_transforming,
        )
    )
    logger.debug(f"[Transform] Narrative task created: {task}")

    return {
        "success": True,
        "token_id": token_id,
        "transformation_data": payload.transformation_data
    }


async def _generate_transformation_narrative_background(
    campaign_id: int,
    token_id: int,
    character_id: int | None,
    target_name: str,
    beast_name: str,
    spell_name: str,
    config_id: str,
    is_transforming: bool,
):
    """
    Background task to generate AI narrative for transformation.
    Broadcasts the result via WebSocket when complete.
    """
    from app.db.session import async_session_maker

    # Config-specific prompts
    TRANSFORM_PROMPTS = {
        "wild_shape": ("德鲁伊的野性变形", "自然之力", "皮肤、骨骼、毛发"),
        "polymorph": ("变形术的魔法效果", "变化魔法", "身体在魔法中扭曲"),
        "true_polymorph": ("完全变形术的强大魔法", "纯粹的变化之力", "整个存在被重塑"),
        "shapechange": ("形体变化的高等魔法", "强大的变化魔法", "意志驱动形态转换"),
    }
    flavor = TRANSFORM_PROMPTS.get(config_id, ("变化魔法", "魔法能量", "身体发生变化"))
    icon = "🐺" if config_id == "wild_shape" else "✨" if config_id == "polymorph" else "🌟" if config_id == "true_polymorph" else "🔮"

    try:
        async with async_session_maker() as db:
            usage_params = await ai_model_service.get_usage_params(db, "transformation_narrative")
            config = usage_params.config

            if is_transforming:
                prompt = f"""你是一位TRPG战斗叙述者。请用40-60个中文字描述{flavor[0]}过程。
描述要求：
- 魔幻、神秘、富有画面感
- 描述身体变化的过程（{flavor[2]}）
- 体现{flavor[1]}的流动
- 简洁有力，不要废话

角色: {target_name}
变形目标: {beast_name}

直接输出描述，不要加引号或其他格式。"""
            else:
                prompt = f"""你是一位TRPG战斗叙述者。请用30-50个中文字描述{spell_name}结束、恢复原形态的过程。
描述要求：
- 魔幻、自然
- 描述从变化形态恢复的变化
- 体现{flavor[1]}的消散
- 简洁有力

角色: {target_name}

直接输出描述，不要加引号或其他格式。"""

            endpoint = config.api_url.rstrip('/')
            if not endpoint.endswith('/chat/completions'):
                endpoint = endpoint + '/chat/completions'

            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    endpoint,
                    json={
                        "model": config.model_name,
                        "messages": [{"role": "user", "content": prompt}],
                        "max_tokens": usage_params.max_tokens,
                        "temperature": usage_params.temperature or 0.9
                    },
                    headers={
                        "Authorization": f"Bearer {config.api_key}",
                        "Content-Type": "application/json",
                    }
                )
                resp.raise_for_status()
                result = resp.json()

            narrative = result["choices"][0]["message"]["content"].strip().strip('"\'')

            await realtime_publisher.publish_transformation_narrative(
                campaign_id,
                token_id=token_id,
                character_id=character_id,
                character_name=target_name,
                beast_name=beast_name if is_transforming else None,
                is_transforming=is_transforming,
                config_id=config_id,
                narrative=narrative,
            )

            if is_transforming:
                chat_content = f"{icon} **{target_name}** {spell_name} → **{beast_name}**\n\n{narrative}"
            else:
                chat_content = f"{icon} **{target_name}** {spell_name}结束\n\n{narrative}"

            chat_msg = ChatMessage(
                campaign_id=campaign_id,
                sender_user_id="system",
                sender_role="system",
                sender_character_id=character_id,
                message_type="system",
                content=chat_content,
                recipients=[],
                is_private=False,
                meta={"transformation": True, "config_id": config_id, "is_transforming": is_transforming, "beast_name": beast_name}
            )
            db.add(chat_msg)
            await db.commit()

            logger.info(f"[Transform] Generated narrative for {target_name}: {narrative[:50]}...")

    except Exception as e:
        import traceback
        logger.error(f"[Transform] Failed to generate narrative: {e}\n{traceback.format_exc()}")
        fallback = f"{target_name}的身体在{flavor[1]}中发生变化，化身为{beast_name}。" if is_transforming else f"{target_name}的变化形态消散，恢复了原形态。"
        try:
            await realtime_publisher.publish_transformation_narrative(
                campaign_id,
                token_id=token_id,
                character_id=character_id,
                character_name=target_name,
                beast_name=beast_name if is_transforming else None,
                is_transforming=is_transforming,
                config_id=config_id,
                narrative=fallback,
            )
            async with async_session_maker() as db:
                if is_transforming:
                    chat_content = f"{icon} **{target_name}** {spell_name} → **{beast_name}**\n\n{fallback}"
                else:
                    chat_content = f"{icon} **{target_name}** {spell_name}结束\n\n{fallback}"

                chat_msg = ChatMessage(
                    campaign_id=campaign_id,
                    sender_user_id="system",
                    sender_role="system",
                    sender_character_id=character_id,
                    message_type="system",
                    content=chat_content,
                    recipients=[],
                    is_private=False,
                    meta={"transformation": True, "config_id": config_id, "is_transforming": is_transforming, "beast_name": beast_name}
                )
                db.add(chat_msg)
                await db.commit()
        except Exception as broadcast_error:
            logger.error(f"[Transform] Failed to broadcast fallback: {broadcast_error}")


# ============== Disguise/Illusion Endpoints ==============

@router.post("/{token_id}/disguise")
async def update_token_disguise(
    token_id: int,
    payload: TokenDisguiseUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Update token disguise appearance for host-side editing/dismissal.
    Initial spell casting for appearance illusions should go through /api/spells/cast.
    Set disguise_data to null to dismiss the disguise.
    Also manages a spell_buff in active_effects for legacy UI compatibility.
    """
    result = await db.execute(select(Token).where(Token.id == token_id))
    token = result.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    try:
        token.disguise_data = normalize_token_disguise_data(payload.disguise_data, strict=True)
    except RuntimeSchemaValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    flag_modified(token, "disguise_data")

    # Manage spell_buff in active_effects for status panel & token icon display
    effs = list(token.active_effects or [])
    if payload.disguise_data:
        # Add spell_buff if not already present
        spell_id = str(payload.disguise_data.get("spell_id") or "").strip()
        spell_name = payload.disguise_data.get("spell_name") or "幻术伪装"
        caster_name = payload.disguise_data.get("caster_name", "")
        has_buff = any(
            spell_id and e.get("spell_buff") and e.get("spell_id") == spell_id
            for e in effs
        )
        if spell_id and not has_buff:
            # Fetch campaign time for world-time expiration
            from app.models.campaign import Campaign
            campaign_obj = await db.get(Campaign, token.campaign_id)
            campaign_meta = campaign_obj.meta if campaign_obj and campaign_obj.meta else {}
            current_time = campaign_meta.get("time_of_day") or {}
            buff_entry = {
                "id": f"spell_buff_{spell_id}",
                "name": spell_name,
                "spell_buff": True,
                "spell_id": spell_id,
                "is_concentration": False,
                "icon": "🌀",
                "color": "#a78bfa",
                "icon_path": f"/assets/spell-icons/{spell_id}.png",
                "from_caster": caster_name,
                "duration": 600,  # 1 hour = 600 rounds
            }
            if current_time:
                buff_entry["expires_at"] = _calc_expires_at(current_time, 600)
            effs.append(buff_entry)
            token.active_effects = effs
            flag_modified(token, "active_effects")
    else:
        # Remove disguise spell_buff when dismissing
        new_effs = [
            e for e in effs
            if not _effect_is_appearance_disguise(e)
        ]
        if len(new_effs) != len(effs):
            token.active_effects = new_effs
            flag_modified(token, "active_effects")

    await db.commit()

    await realtime_publisher.publish_token_disguise_updated(
        token.campaign_id,
        token_id=token_id,
        disguise_data=payload.disguise_data,
        active_effects=token.active_effects,
    )

    return {"success": True, "token_id": token_id, "disguise_data": payload.disguise_data}


# ============== Concentration Endpoints ==============

def _old_concentration_cleanup_token_ids(
    *,
    caster_token_id: int,
    old_concentration_spell: Optional[dict],
) -> List[int]:
    """Token ids to sweep when an old concentration spell ends.

    Includes the caster (so caster-side concentration-bound effects like
    `grant_action` are cleaned up alongside target debuffs) plus the spell's
    `affected_token_ids`, deduplicated and coerced to ints.
    """
    raw_affected: list = []
    if isinstance(old_concentration_spell, dict):
        raw_affected = list(old_concentration_spell.get("affected_token_ids") or [])

    ordered: List[int] = []
    seen: set[int] = set()
    for candidate in [caster_token_id, *raw_affected]:
        if candidate is None:
            continue
        try:
            value = int(candidate)
        except (TypeError, ValueError):
            continue
        if value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


async def _remove_control_effects_from_tokens(
    db: AsyncSession,
    spell_id: str,
    affected_token_ids: List[int],
    caster_token_id: int,
    campaign_id: int,
) -> List[int]:
    """
    Remove control effects from affected tokens when concentration is broken.
    Also restores transformation_data for size-changing spells (enlarge-reduce).
    Returns list of token IDs that had effects removed.
    """
    SIZE_CN = ["微型", "小型", "中型", "大型", "巨型", "超巨型"]
    SIZE_CN_TO_IDX = {cn: i for i, cn in enumerate(SIZE_CN)}
    SIZE_GRIDS = ["0.4x0.4", "0.65x0.65", "1x1", "2x2", "3x3", "4x4"]
    removed_from = []

    for token_id in affected_token_ids:
        result = await db.execute(select(Token).where(Token.id == token_id))
        token = result.scalar_one_or_none()
        if not token:
            continue

        changed = False

        # Clear transformation_data when the ended concentration spell is the
        # source. Covers both size-changing spells (Enlarge/Reduce — restore
        # size from `original_size`) and full-replacement transformations
        # (Polymorph — no size delta, just drop the morphed state).
        # Match on either `source.spell_id` or `source.config_id` since
        # transformation payloads use either depending on the cast path.
        spell_data = get_spell_by_id(spell_id)
        td = token.transformation_data
        source = (td or {}).get("source", {}) if td else {}
        td_belongs_to_spell = bool(td) and (
            source.get("spell_id") == spell_id
            or source.get("config_id") == spell_id
        )
        if td_belongs_to_spell:
            size_delta = get_spell_size_delta(spell_data, td.get("activeMode"))
            restored_size: Optional[str] = None
            if size_delta is not None:
                orig_label = td.get("original_size", "中型")
                orig_idx = SIZE_CN_TO_IDX.get(orig_label, 2)
                restored_size = SIZE_GRIDS[orig_idx]
                token.token_size = restored_size
            token.transformation_data = None
            flag_modified(token, "transformation_data")
            changed = True
            if restored_size is not None:
                await realtime_publisher.publish_transformation_updated(
                    campaign_id,
                    token_id=token_id,
                    transformation_data=None,
                    token_size=restored_size,
                )
            else:
                await realtime_publisher.publish_transformation_updated(
                    campaign_id,
                    token_id=token_id,
                    transformation_data=None,
                )

        # Filter out effects belonging to the ended concentration spell only.
        # Matching by caster_token_id alone strips unrelated non-concentration
        # buffs (e.g. False Life / Armor of Agathys) when the caster is in the
        # affected list — see Chrome QA 2026-05-28. Spell IDs and source-token
        # IDs are compared as normalized strings so JSON-stored aliases
        # (sourceSpell/sourceTokenId, str vs int) match the live spell_id and
        # caster_token_id.
        if token.active_effects:
            original_count = len(token.active_effects)

            def _norm_id(value: Any) -> Optional[str]:
                if value is None:
                    return None
                normalized = str(value).strip()
                return normalized or None

            target_spell_key = _norm_id(spell_id)
            caster_token_key = _norm_id(caster_token_id)

            def _belongs_to_ended_spell(effect: dict) -> bool:
                effect_spell_id = (
                    effect.get("spell_id")
                    or effect.get("sourceSpell")
                    or effect.get("source_spell")
                    or effect.get("spellId")
                )
                if _norm_id(effect_spell_id) != target_spell_key:
                    return False
                effect_source_token = (
                    effect.get("source_token_id")
                    if effect.get("source_token_id") is not None
                    else effect.get("sourceTokenId")
                )
                if effect_source_token is None:
                    return True
                return _norm_id(effect_source_token) == caster_token_key

            new_effects = [
                e for e in token.active_effects
                if not _belongs_to_ended_spell(e)
            ]

            if len(new_effects) < original_count:
                token.active_effects = new_effects
                flag_modified(token, "active_effects")
                changed = True
                # Broadcast effect removal
                await realtime_publisher.publish_token_effects_updated(
                    campaign_id,
                    token_id=token_id,
                    active_effects=new_effects,
                    reason="concentration_lost",
                )

        if changed:
            removed_from.append(token_id)

    return removed_from


async def cleanup_expired_concentration_for_campaign(
    db: AsyncSession,
    *,
    campaign_id: int,
    current_time: Optional[dict],
) -> List[int]:
    current_seconds = _world_time_to_seconds(current_time) if current_time else None
    if current_seconds is None:
        return []

    result = await db.execute(
        select(Token).where(
            and_(
                Token.campaign_id == int(campaign_id),
                Token.concentration_spell.isnot(None),
            )
        )
    )
    tokens = result.scalars().all()
    expired_token_ids: List[int] = []

    for token in tokens:
        concentration_spell = normalize_token_concentration_spell(
            token.concentration_spell,
            strict=False,
        )
        expires_at = (concentration_spell or {}).get("expires_at")
        if not expires_at or current_seconds < _world_time_to_seconds(expires_at):
            continue

        spell_id = concentration_spell.get("spell_id", "")
        removed_linked_token_ids = await _delete_linked_concentration_tokens(db, concentration_spell)

        token.concentration_spell = None
        runtime_touched_token_ids = await end_concentration_runtime_instances(
            db,
            campaign_id=token.campaign_id,
            concentration_owner_token_ids=[token.id],
        )
        aura_changed = False

        if spell_id:
            effects = list(normalize_token_active_effects(token.active_effects, strict=False) or [])
            removed_effects = [
                effect
                for effect in effects
                if effect.get("spell_buff") and effect.get("spell_id") == spell_id
            ]
            next_effects = [
                effect
                for effect in effects
                if not (effect.get("spell_buff") and effect.get("spell_id") == spell_id)
            ]
            if len(next_effects) < len(effects):
                token.active_effects = next_effects or None
                flag_modified(token, "active_effects")
                for removed_effect in removed_effects:
                    if removed_effect.get("buff_effects", {}).get("tempHp"):
                        token.temp_hp = None
                        break
            aura_changed = _strip_removed_spell_auras(token, removed_effects=removed_effects)

        cleanup_ids = _old_concentration_cleanup_token_ids(
            caster_token_id=token.id,
            old_concentration_spell=concentration_spell,
        )
        removed_from: List[int] = []
        if spell_id and cleanup_ids:
            removed_from = await _remove_control_effects_from_tokens(
                db=db,
                spell_id=spell_id,
                affected_token_ids=cleanup_ids,
                caster_token_id=token.id,
                campaign_id=token.campaign_id,
            )

        await db.commit()

        for linked_token_id in removed_linked_token_ids:
            await realtime_publisher.publish_map_token_removed(
                token.campaign_id,
                token_id=linked_token_id,
            )

        await realtime_publisher.publish_token_concentration_updated(
            token.campaign_id,
            token_id=token.id,
            concentration_spell=None,
            reason="duration_expired",
            broken_spell=concentration_spell,
            active_effects=normalize_token_active_effects(token.active_effects, strict=False) or [],
            temp_hp=token.temp_hp,
            effects_removed_from=removed_from,
        )
        projection_token_ids = sorted({token.id, *runtime_touched_token_ids})
        if projection_token_ids:
            await publish_runtime_projection_updates(
                db,
                campaign_id=token.campaign_id,
                token_ids=projection_token_ids,
            )
        if aura_changed:
            await realtime_publisher.publish_token_auras_updated(
                token.campaign_id,
                token_id=token.id,
                active_auras=token.active_auras or [],
                aura_id="",
                enabled=bool(token.active_auras),
            )
            if token.map_url:
                await aura_service.on_token_move(
                    token.id,
                    int(token.campaign_id),
                    token.map_url,
                    db,
                )
        expired_token_ids.append(token.id)

    return expired_token_ids


@router.post("/{token_id}/concentration")
async def set_token_concentration(
    token_id: int,
    payload: TokenConcentrationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Set concentration spell for a token.
    Pre-computes CON save data for automatic concentration checks.
    """
    from sqlalchemy.orm.attributes import flag_modified
    from app.utils.saving_throws import calc_saving_throw_modifier, get_proficiency_bonus

    result = await db.execute(select(Token).where(Token.id == token_id))
    token = result.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    # If payload is None, break concentration
    if payload.concentration_spell is None:
        old_conc = token.concentration_spell
        old_spell_id = old_conc.get("spell_id", "") if old_conc else ""
        removed_linked_token_ids = await _delete_linked_concentration_tokens(db, old_conc)
        token.concentration_spell = None
        runtime_touched_token_ids = await end_concentration_runtime_instances(
            db,
            campaign_id=token.campaign_id,
            concentration_owner_token_ids=[token_id],
        )
        aura_changed = False
        if old_spell_id:
            effects = list(token.active_effects or [])
            removed_effects = [
                effect for effect in effects if effect.get("spell_buff") and effect.get("spell_id") == old_spell_id
            ]
            next_effects = [
                effect for effect in effects if not (effect.get("spell_buff") and effect.get("spell_id") == old_spell_id)
            ]
            if len(next_effects) < len(effects):
                token.active_effects = next_effects or None
                flag_modified(token, "active_effects")
                for removed_effect in removed_effects:
                    if removed_effect.get("buff_effects", {}).get("tempHp"):
                        token.temp_hp = None
                        break
            aura_changed = _strip_removed_spell_auras(token, removed_effects=removed_effects)

            cleanup_ids = _old_concentration_cleanup_token_ids(
                caster_token_id=token_id,
                old_concentration_spell=old_conc,
            )
            if cleanup_ids:
                await _remove_control_effects_from_tokens(
                    db=db,
                    spell_id=old_spell_id,
                    affected_token_ids=cleanup_ids,
                    caster_token_id=token_id,
                    campaign_id=token.campaign_id,
                )
        await db.commit()

        for linked_token_id in removed_linked_token_ids:
            await realtime_publisher.publish_map_token_removed(
                token.campaign_id,
                token_id=linked_token_id,
            )

        await realtime_publisher.publish_token_concentration_updated(
            token.campaign_id,
            token_id=token_id,
            concentration_spell=None,
            reason="manual_break",
        )
        projection_token_ids = sorted({token_id, *runtime_touched_token_ids})
        if projection_token_ids:
            await publish_runtime_projection_updates(
                db,
                campaign_id=token.campaign_id,
                token_ids=projection_token_ids,
            )
        if aura_changed:
            await realtime_publisher.publish_token_auras_updated(
                token.campaign_id,
                token_id=token_id,
                active_auras=token.active_auras or [],
                aura_id="",
                enabled=bool(token.active_auras),
            )
            if token.map_url:
                await aura_service.on_token_move(
                    token_id,
                    int(token.campaign_id),
                    token.map_url,
                    db,
                )
        return {"success": True, "token_id": token_id, "concentration_spell": None}

    # For character tokens, compute CON save data
    conc_data = dict(payload.concentration_spell)

    # If replacing an existing concentration, clean up old spell buffs
    old_conc = token.concentration_spell
    old_spell_id = old_conc.get("spell_id", "") if old_conc else ""
    removed_old_buff = False
    old_aura_changed = False
    removed_old_linked_token_ids: List[int] = []
    old_runtime_touched_token_ids: List[int] = []
    if old_spell_id:
        removed_old_linked_token_ids = await _delete_linked_concentration_tokens(db, old_conc)
        old_runtime_touched_token_ids = await end_concentration_runtime_instances(
            db,
            campaign_id=token.campaign_id,
            concentration_owner_token_ids=[token_id],
        )
        effects = token.active_effects or []
        removed_effects = [e for e in effects if e.get("spell_buff") and e.get("spell_id") == old_spell_id]
        new_effects = [e for e in effects if not (e.get("spell_buff") and e.get("spell_id") == old_spell_id)]
        if len(new_effects) < len(effects):
            token.active_effects = new_effects
            flag_modified(token, "active_effects")
            removed_old_buff = True
            # Clear temp HP if removed buff granted it
            for re in removed_effects:
                if re.get("buff_effects", {}).get("tempHp"):
                    token.temp_hp = None
                    break
        old_aura_changed = _strip_removed_spell_auras(token, removed_effects=removed_effects)

        # Also sweep concentration-bound effects from caster + affected targets.
        # Caster is included so non-`spell_buff` ties (e.g. Witch Bolt's
        # caster-side `grant_action`) get cleaned up; the manual spell_buff
        # cleanup above handles temp HP / aura side-effects.
        cleanup_ids = _old_concentration_cleanup_token_ids(
            caster_token_id=token_id,
            old_concentration_spell=old_conc,
        )
        if cleanup_ids:
            await _remove_control_effects_from_tokens(
                db=db,
                spell_id=old_spell_id,
                affected_token_ids=cleanup_ids,
                caster_token_id=token_id,
                campaign_id=token.campaign_id,
            )

    if token.character_id:
        char_res = await db.execute(select(Character).where(Character.id == token.character_id))
        char = char_res.scalar_one_or_none()
        if char:
            ability_scores = char.ability_scores or {}
            level = char.level or 1
            class_id = char.class_id

            # Calculate CON save modifier
            save_info = calc_saving_throw_modifier(
                ability_scores, "constitution", class_id, level
            )
            conc_data["con_save_bonus"] = save_info["total"]

            # Check for War Caster feat
            feats = char.feats or []
            has_war_caster = "war_caster" in feats or "warCaster" in feats
            conc_data["has_advantage"] = has_war_caster
            if has_war_caster:
                conc_data["extra_bonus_source"] = "战斗施法者"

    conc_data = await _apply_concentration_world_time_expiry(
        db,
        campaign_id=token.campaign_id,
        concentration_spell=conc_data,
    )

    # Materialize summons for spells whose rules carry a top-level
    # spawn_summon effect (e.g. Conjure Animals). The non-combat area
    # path never routes through /api/spells/cast, so the handler chain
    # cannot fire — handle it inline here while we hold the caster row.
    created_summon_tokens = await _materialize_summon_for_concentration(
        db,
        caster_token=token,
        conc_data=conc_data,
    )

    # Materialize caster-side grant_sense entries for spells whose rules
    # include an on-cast grant_sense leaf (e.g. Detect Magic). The non-combat
    # area path skips /api/spells/cast, so `GrantSenseHandler` never runs —
    # persist the equivalent active_effect inline so the frontend can render
    # the sense overlay and cleanup matches on concentration end.
    await _materialize_grant_sense_for_concentration(
        db,
        caster_token=token,
        conc_data=conc_data,
    )

    try:
        token.concentration_spell = normalize_token_concentration_spell(conc_data, strict=True)
    except RuntimeSchemaValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    flag_modified(token, "concentration_spell")
    await db.commit()

    for created_token in created_summon_tokens:
        await db.refresh(created_token)

    for linked_token_id in removed_old_linked_token_ids:
        await realtime_publisher.publish_map_token_removed(
            token.campaign_id,
            token_id=linked_token_id,
        )

    for created_token in created_summon_tokens:
        avatar, avatar_large = _resolve_item_token_avatar(created_token.item_data)
        await realtime_publisher.publish_token_placed(
            token.campaign_id,
            token={
                "id": created_token.id,
                "campaign_id": created_token.campaign_id,
                "item_data": created_token.item_data,
                "item_quantity": created_token.item_quantity,
                "user_id": created_token.user_id,
                "map_url": created_token.map_url,
                "position_x": created_token.position_x,
                "position_y": created_token.position_y,
                "token_size": created_token.token_size,
                "instance_name": created_token.instance_name,
                "current_hp": created_token.current_hp,
                "faction": created_token.faction,
                "avatar": avatar,
                "avatar_large": avatar_large,
            },
        )

    concentration_kwargs = {
        "token_id": token_id,
        "concentration_spell": conc_data,
    }
    if removed_old_buff:
        concentration_kwargs["active_effects"] = token.active_effects or []
        concentration_kwargs["replaced_spell"] = old_spell_id

    await realtime_publisher.publish_token_concentration_updated(
        token.campaign_id,
        **concentration_kwargs,
    )
    projection_token_ids = sorted({token_id, *old_runtime_touched_token_ids})
    if projection_token_ids:
        await publish_runtime_projection_updates(
            db,
            campaign_id=token.campaign_id,
            token_ids=projection_token_ids,
        )
    if old_aura_changed:
        await realtime_publisher.publish_token_auras_updated(
            token.campaign_id,
            token_id=token_id,
            active_auras=token.active_auras or [],
            aura_id="",
            enabled=bool(token.active_auras),
        )
        if token.map_url:
            await aura_service.on_token_move(
                token_id,
                int(token.campaign_id),
                token.map_url,
                db,
            )

    return {
        "success": True,
        "token_id": token_id,
        "concentration_spell": conc_data
    }


@router.patch("/{token_id}/area-effect-position")
async def update_area_effect_position(
    token_id: int,
    payload: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Update the center position of a concentration spell's area effect (DM drag)."""
    from sqlalchemy.orm.attributes import flag_modified

    result = await db.execute(select(Token).where(Token.id == token_id))
    token = result.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    conc = token.concentration_spell
    if not conc or not conc.get("area_effect"):
        raise HTTPException(status_code=400, detail="Token has no active area effect")

    center_x = payload.get("center_x")
    center_y = payload.get("center_y")
    illusion_token_id = payload.get("illusion_token_id")

    # Update position if provided
    if center_x is not None and center_y is not None:
        conc["area_effect"]["center_x"] = float(center_x)
        conc["area_effect"]["center_y"] = float(center_y)

    # Store illusion token binding if provided
    if illusion_token_id is not None:
        conc["area_effect"]["illusion_token_id"] = int(illusion_token_id)

    if center_x is None and center_y is None and illusion_token_id is None:
        raise HTTPException(status_code=400, detail="center_x/center_y or illusion_token_id required")

    token.concentration_spell = conc
    flag_modified(token, "concentration_spell")
    await db.commit()

    await realtime_publisher.publish_token_concentration_updated(
        token.campaign_id,
        token_id=token_id,
        concentration_spell=conc,
    )

    return {"success": True, "token_id": token_id}


@router.patch("/{token_id}/illusion-image")
async def update_illusion_image(
    token_id: int,
    payload: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Update the image of an illusion token (reshapeable illusions like Silent Image)."""
    from sqlalchemy.orm.attributes import flag_modified

    result = await db.execute(select(Token).where(Token.id == token_id))
    token = result.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    if not token.item_data or token.item_data.get("type") != "illusion":
        raise HTTPException(status_code=400, detail="Token is not an illusion")

    image_url = payload.get("image_url")
    description = payload.get("description")
    display_name = payload.get("display_name")
    if not image_url:
        raise HTTPException(status_code=400, detail="image_url required")

    updated_item_data = dict(token.item_data)
    updated_item_data["icon"] = image_url
    updated_item_data["avatar_url"] = image_url
    updated_item_data["avatar_url_large"] = image_url
    updated_item_data.pop("image_url", None)
    if description is not None:
        updated_item_data["description"] = description
    normalized_item_data, normalized_quantity, _ = normalize_token_item_fields(
        updated_item_data,
        token.item_quantity,
    )
    token.item_data = normalized_item_data
    token.item_quantity = normalized_quantity
    if display_name:
        token.instance_name = display_name
    flag_modified(token, "item_data")
    await db.commit()

    await realtime_publisher.publish_token_updated(
        token.campaign_id,
        token={
            "id": token.id,
            "instance_name": token.instance_name,
            "item_data": token.item_data,
            "position_x": token.position_x,
            "position_y": token.position_y,
            "token_size": token.token_size,
        },
    )

    return {"success": True, "token_id": token_id}


@router.patch("/{token_id}/disguise-image")
async def update_disguise_image(
    token_id: int,
    payload: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Update the disguise appearance of a token (Malleable Illusions for disguise spells)."""
    from sqlalchemy.orm.attributes import flag_modified

    result = await db.execute(select(Token).where(Token.id == token_id))
    token = result.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    if not token.disguise_data:
        raise HTTPException(status_code=400, detail="Token has no disguise")

    image_url = payload.get("image_url")
    description = payload.get("description")
    if not image_url:
        raise HTTPException(status_code=400, detail="image_url required")

    token.disguise_data["disguise_avatar"] = image_url
    if description is not None:
        token.disguise_data["description"] = description
    flag_modified(token, "disguise_data")
    await db.commit()

    await realtime_publisher.publish_token_updated(
        token.campaign_id,
        token={
            "id": token.id,
            "disguise_data": token.disguise_data,
            "position_x": token.position_x,
            "position_y": token.position_y,
            "token_size": token.token_size,
        },
    )

    return {"success": True, "token_id": token_id}


@router.delete("/{token_id}/concentration")
async def break_token_concentration(
    token_id: int,
    reason: str = "manual",
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Break concentration on a token.
    Reason can be: "manual", "new_spell", "damage", "incapacitated"
    Automatically removes control effects from affected tokens.
    """
    result = await db.execute(select(Token).where(Token.id == token_id))
    token = result.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    old_conc = token.concentration_spell
    if not old_conc:
        return {"success": True, "message": "No concentration to break"}

    spell_id = old_conc.get("spell_id", "")

    removed_linked_token_ids = await _delete_linked_concentration_tokens(db, old_conc)

    token.concentration_spell = None
    runtime_touched_token_ids = await end_concentration_runtime_instances(
        db,
        campaign_id=token.campaign_id,
        concentration_owner_token_ids=[token_id],
    )
    aura_changed = False

    # Remove self-buff effect from caster token
    if spell_id:
        effects = token.active_effects or []
        removed_effects = [e for e in effects if e.get("spell_buff") and e.get("spell_id") == spell_id]
        new_effects = [e for e in effects if not (e.get("spell_buff") and e.get("spell_id") == spell_id)]
        if len(new_effects) < len(effects):
            token.active_effects = new_effects
            flag_modified(token, "active_effects")
            # Clear temp HP if removed buff granted it
            for re in removed_effects:
                if re.get("buff_effects", {}).get("tempHp"):
                    token.temp_hp = None
                    break
        aura_changed = _strip_removed_spell_auras(token, removed_effects=removed_effects)

    # Remove control effects from caster + affected tokens, sharing the
    # cleanup-id helper used by other concentration-end paths so caster-side
    # `grant_action` (and similar concentration-bound non-`spell_buff` effects)
    # get cleaned up alongside target debuffs.
    cleanup_ids = _old_concentration_cleanup_token_ids(
        caster_token_id=token_id,
        old_concentration_spell=old_conc,
    )
    removed_from: List[int] = []
    if spell_id and cleanup_ids:
        removed_from = await _remove_control_effects_from_tokens(
            db=db,
            spell_id=spell_id,
            affected_token_ids=cleanup_ids,
            caster_token_id=token_id,
            campaign_id=token.campaign_id,
        )

    await db.commit()

    # Broadcast linked token removal before concentration update so frontend cleans up previews first.
    for linked_token_id in removed_linked_token_ids:
        await realtime_publisher.publish_map_token_removed(
            token.campaign_id,
            token_id=linked_token_id,
        )

    # Broadcast concentration broken
    await realtime_publisher.publish_token_concentration_updated(
        token.campaign_id,
        token_id=token_id,
        concentration_spell=None,
        reason=reason,
        broken_spell=old_conc,
        active_effects=token.active_effects or [],
        temp_hp=token.temp_hp,
        effects_removed_from=removed_from,
    )
    projection_token_ids = sorted({token_id, *runtime_touched_token_ids})
    if projection_token_ids:
        await publish_runtime_projection_updates(
            db,
            campaign_id=token.campaign_id,
            token_ids=projection_token_ids,
        )
    if aura_changed:
        await realtime_publisher.publish_token_auras_updated(
            token.campaign_id,
            token_id=token_id,
            active_auras=token.active_auras or [],
            aura_id="",
            enabled=bool(token.active_auras),
        )
        if token.map_url:
            await aura_service.on_token_move(
                token_id,
                int(token.campaign_id),
                token.map_url,
                db,
            )

    return {
        "success": True,
        "token_id": token_id,
        "broken_spell": old_conc,
        "reason": reason,
        "effects_removed_from": removed_from,
    }


async def perform_concentration_check(
    token: Token,
    damage: int,
    db: AsyncSession,
) -> dict:
    """
    Perform automatic concentration check when token takes damage.
    Returns check result dict.
    """
    import random

    conc = token.concentration_spell
    if not conc or damage <= 0:
        return {"needed": False}

    # DC = max(10, damage // 2)
    dc = max(10, damage // 2)

    # Get save bonus and advantage from pre-computed data
    con_save_bonus = conc.get("con_save_bonus", 0)
    has_advantage = conc.get("has_advantage", False)

    # Roll dice
    roll1 = random.randint(1, 20)
    roll2 = random.randint(1, 20) if has_advantage else roll1

    if has_advantage:
        roll = max(roll1, roll2)
        roll_details = f"[{roll1}] vs [{roll2}]"
    else:
        roll = roll1
        roll_details = f"[{roll}]"

    total = roll + con_save_bonus
    success = total >= dc

    result = {
        "needed": True,
        "token_id": token.id,
        "token_name": token.instance_name or "Unknown",
        "spell_name": conc.get("spell_name", "Unknown"),
        "damage": damage,
        "dc": dc,
        "roll": roll,
        "roll_details": roll_details,
        "bonus": con_save_bonus,
        "total": total,
        "success": success,
        "advantage": has_advantage,
    }

    # If failed, break concentration
    if not success:
        token.concentration_spell = None
        result["runtime_touched_token_ids"] = await end_concentration_runtime_instances(
            db,
            campaign_id=token.campaign_id,
            concentration_owner_token_ids=[token.id],
        )
        result["broken_spell"] = conc

    return result
