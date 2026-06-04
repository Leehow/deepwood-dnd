"""
Unified spell casting API — routes all spell effects through SpellResolver.
Supports both combat and non-combat contexts.
"""
import logging
import re
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm.attributes import flag_modified

from app.db.session import get_db
from app.models.token import Token
from app.models.character import Character
from app.models.monster_instance import MonsterInstance
from app.models.campaign import Campaign
from app.models.campaign_storage import CampaignStorage
from app.models.monster_avatar import MonsterAvatar
from app.models.user_avatar import UserAvatar
from app.models.spell_runtime_instance import SpellRuntimeInstance
from app.services.spell_resolver import SpellResolver, SpellContext, TargetInfo
from app.services.realtime_publisher import realtime_publisher
from app.services.character_progression_service import calculate_max_hp
from app.services.effect_engine.creature_types import resolve_creature_type_from_monster_id
from app.services.spell_runtime_service import (
    create_runtime_spell_instance,
    end_runtime_instance,
    end_concentration_runtime_instances,
    execute_runtime_action,
    notify_target_downed,
    publish_runtime_projection_updates,
    resolve_spell_duration_rounds,
    spell_uses_runtime_engine,
)
from app.services.runtime_schema_service import (
    normalize_character_equipment,
    normalize_character_spell_slots_state,
    normalize_token_casting_in_progress,
    normalize_token_concentration_spell,
    normalize_token_disguise_data,
)
from app.utils.rules_cache import (
    get_spell_by_id,
    get_races_data,
    get_spell_cast_option,
    get_spell_size_delta,
    get_spellcasting_data,
    spell_has_illumination_type,
    spell_has_illusion_subtype,
)
from app.api.routes.character_utils import (
    calculate_proficiency_bonus,
    calculate_ability_modifier,
    get_spell_save_dc,
    get_spell_attack_bonus,
)
from app.core.security import require_auth
from app.utils.permission_checks import check_campaign_member
from app.utils.trickery_domain import get_concentration_linked_token_ids
from app.utils.spell_buff_conditions import derive_buff_conditions

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/spells", tags=["spells"])

# D&D 5E size system — English keys, numeric index (0=Tiny … 5=Gargantuan)
SIZE_KEYS = ["tiny", "small", "medium", "large", "huge", "gargantuan"]
SIZE_CN = ["微型", "小型", "中型", "大型", "巨型", "超巨型"]
SIZE_KEY_TO_IDX = {k: i for i, k in enumerate(SIZE_KEYS)}
SIZE_CN_TO_IDX = {cn: i for i, cn in enumerate(SIZE_CN)}
SIZE_GRIDS = ["0.4x0.4", "0.65x0.65", "1x1", "2x2", "3x3", "4x4"]
GRID_TO_SIZE_IDX = {g: i for i, g in enumerate(SIZE_GRIDS)}
DEFAULT_SIZE_IDX = 2  # medium

# Spellcasting ability by class
CLASS_SPELLCASTING_ABILITY = {
    "wizard": "intelligence", "artificer": "intelligence",
    "cleric": "wisdom", "druid": "wisdom",
    "ranger": "wisdom", "monk": "wisdom",
    "bard": "charisma", "paladin": "charisma",
    "sorcerer": "charisma", "warlock": "charisma",
}

PASSIVE_DAMAGE_IMMUNITY_KEYS = {
    "acid",
    "bludgeoning",
    "bludgeoning_nonmagical",
    "cold",
    "fire",
    "force",
    "lightning",
    "necrotic",
    "piercing",
    "piercing_nonmagical",
    "poison",
    "psychic",
    "radiant",
    "slashing",
    "slashing_nonmagical",
    "thunder",
}


class SpellCastRequest(BaseModel):
    spell_id: str
    slot_level: int
    caster_token_id: int
    target_token_ids: list[int]
    campaign_id: int
    freecast: bool = False
    ritual_cast: bool = False
    selected_option: Optional[str] = None
    material_id: Optional[str] = None
    illusion_data: Optional[Dict[str, Optional[str]]] = None
    target_auto_fail_save: bool = False
    # Misty Step / self-teleport destination picked on the map.
    # The frontend sends grid coordinates (top-left cell of the destination)
    # and the resolver forwards them to TeleportHandler via phase context.
    teleport_destination: Optional[Dict[str, int]] = None


class SpellCastResponse(BaseModel):
    success: bool
    spell_id: Optional[str] = None
    spell_name: Optional[str] = None
    caster_token_id: Optional[int] = None
    in_combat: bool = False
    duration_hint: Optional[str] = None
    total_damage: int = 0
    total_healing: int = 0
    concentration_set: bool = False
    results: list = []
    affected_token_ids: list[int] = []
    destroyed_token_ids: list[int] = []
    dispelled_darkness_count: int = 0
    narrative: Optional[str] = None
    items_generated: list = []
    error: Optional[str] = None


class StartSpellCastRequest(BaseModel):
    spell_id: str
    slot_level: int
    caster_token_id: int
    campaign_id: int
    target_token_ids: list[int] = []
    freecast: bool = False
    ritual_cast: bool = False
    selected_option: Optional[str] = None
    material_id: Optional[str] = None
    confirm_break_concentration: bool = False
    # Area spells that need to preserve placement during the long cast
    # (Alarm, Glyph of Warding, Magic Circle, etc.) attach the structured
    # shape/center/radius/map_url payload here. The lasting spell effect is
    # NOT created at start-cast time; the data is just held in
    # `casting_in_progress.area_effect` so the ready-cast release flow can
    # use the same placement the caster chose.
    area_effect: Optional[Dict[str, Any]] = None


class StartSpellCastResponse(BaseModel):
    success: bool
    requires_confirmation: bool = False
    confirmation_reason: Optional[str] = None
    spell_name: Optional[str] = None
    casting_in_progress: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class ResolveDueCastsRequest(BaseModel):
    campaign_id: int
    current_time: Dict[str, Any]


class RuntimeActionExecuteRequest(BaseModel):
    runtime_instance_id: int
    action_id: str
    actor_token_id: int
    target_token_id: Optional[int] = None


class RuntimeActionExecuteResponse(BaseModel):
    success: bool
    runtime_instance_id: Optional[int] = None
    touched_token_ids: list[int] = []
    error: Optional[str] = None


class RuntimeInstanceEndResponse(BaseModel):
    success: bool
    runtime_instance_id: Optional[int] = None
    touched_token_ids: list[int] = []
    error: Optional[str] = None


class GrantedActionExecuteRequest(BaseModel):
    """Execute a `grant_action` entry persisted on a token's
    `active_effects` (e.g. Witch Bolt repeat damage). Action-only/freecast:
    no slot use, no concentration reset, no new runtime instance."""
    campaign_id: int
    caster_token_id: int
    target_token_id: int
    # Either effect_id alone, or (spell_id + action_kind [+ action_name])
    effect_id: Optional[str] = None
    spell_id: Optional[str] = None
    action_kind: Optional[str] = None
    action_name: Optional[str] = None


class GrantedActionExecuteResponse(BaseModel):
    success: bool
    spell_name: Optional[str] = None
    action_name: Optional[str] = None
    total_damage: int = 0
    total_healing: int = 0
    results: list = []
    narrative: Optional[str] = None
    affected_token_ids: list[int] = []
    error: Optional[str] = None


def _find_active_effect_grant_action(
    active_effects: Optional[List[Dict[str, Any]]],
    *,
    effect_id: Optional[str] = None,
    spell_id: Optional[str] = None,
    action_kind: Optional[str] = None,
    action_name: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Find a `grant_action` entry on a token's active_effects. Prefer exact
    `effect_id`; otherwise match on (spell_id, action_kind) with optional
    action_name disambiguation."""
    if not active_effects:
        return None
    for entry in active_effects:
        if not isinstance(entry, dict):
            continue
        if entry.get("effect_type") != "grant_action":
            continue
        if effect_id and entry.get("id") == effect_id:
            return entry
    if effect_id:
        return None
    if not spell_id or not action_kind:
        return None
    candidates: List[Dict[str, Any]] = []
    for entry in active_effects:
        if not isinstance(entry, dict):
            continue
        if entry.get("effect_type") != "grant_action":
            continue
        if entry.get("spell_id") != spell_id:
            continue
        if entry.get("action_kind") != action_kind:
            continue
        candidates.append(entry)
    if not candidates:
        return None
    if action_name:
        named = [c for c in candidates if c.get("action_name") == action_name]
        if named:
            return named[0]
    return candidates[0]


def _build_synthetic_damage_spell_data(
    *,
    spell_id: str,
    spell_name: str,
    action_name: str,
    damage_formula: str,
    damage_type: str,
    spell_level: int = 0,
    attack: Optional[Dict[str, Any]] = None,
    save: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build a minimal `effects[]` payload so `SpellResolver` deals exactly
    one leaf damage to the resolved target without any side effects
    (no concentration, no spell-buff visuals, no slot consumption).

    `spell_level` should carry the source spell's rules-data level (e.g.
    Witch Bolt → 1) so cantrip-only passive bonuses do not fire on follow-up
    damage. Slot consumption is independently disabled via `slot_level=0`
    on the SpellContext.

    `attack` / `save` carry the grant_action entry's own phase metadata so a
    persisted follow-up reproduces its source spell's to-hit / saving-throw
    behavior (Spiritual Weapon rolls a spell attack, Call Lightning rolls a
    DEX save). When neither is supplied the payload stays pure direct damage
    (Witch Bolt repeat_damage — unchanged). Attack and save are mutually
    exclusive in the resolver, so attack wins if a malformed entry has both."""
    phase: Dict[str, Any] = {
        "trigger": "on_cast",
        "target": {"type": "single"},
        "effects": [
            {
                "type": "deal_damage",
                "formula": damage_formula,
                "damage_type": damage_type,
            }
        ],
    }
    if attack:
        phase["attack"] = attack
    elif save:
        phase["save"] = save
    return {
        "id": spell_id,
        "name": action_name or spell_name,
        "level": spell_level,
        "school": "evocation",
        "concentration": False,
        "duration": "立即",
        "effects": [phase],
    }


TIME_DEFAULTS = {
    "day": 123,
    "hour": 12,
    "minute": 0,
    "second": 0,
    "cycle": "day",
    "realTimeActive": False,
    "environment": "normal",
}


def _normalize_campaign_time(time_data: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    data = dict(TIME_DEFAULTS)
    if time_data:
        data.update({
            "day": int(time_data.get("day", data["day"])),
            "hour": int(time_data.get("hour", data["hour"])),
            "minute": int(time_data.get("minute", data["minute"])),
            "second": int(time_data.get("second", data["second"])),
            "cycle": time_data.get("cycle", data["cycle"]),
            "realTimeActive": bool(time_data.get("realTimeActive", data["realTimeActive"])),
            "environment": time_data.get("environment", data["environment"]),
        })
    return data


def _campaign_time_to_seconds(time_data: Dict[str, Any]) -> int:
    return (
        (int(time_data.get("day", TIME_DEFAULTS["day"])) * 24 * 3600)
        + (int(time_data.get("hour", 0)) * 3600)
        + (int(time_data.get("minute", 0)) * 60)
        + int(time_data.get("second", 0))
    )


def _seconds_to_campaign_time(total_seconds: int) -> Dict[str, Any]:
    day_seconds = 24 * 3600
    day = max(1, total_seconds // day_seconds)
    remainder = total_seconds % day_seconds
    hour = remainder // 3600
    remainder %= 3600
    minute = remainder // 60
    second = remainder % 60
    cycle = "night"
    if 5 <= hour < 8:
        cycle = "dawn"
    elif 8 <= hour < 17:
        cycle = "day"
    elif 17 <= hour < 20:
        cycle = "dusk"
    return {
        "day": day,
        "hour": hour,
        "minute": minute,
        "second": second,
        "cycle": cycle,
        "realTimeActive": False,
        "environment": "normal",
    }


def _parse_casting_time(casting_time: str) -> Dict[str, Any]:
    raw = (casting_time or "").strip().lower()
    cn = (casting_time or "").strip()
    patterns = [
        (r"^(\d+)\s*(bonus action|bonus_action)$", "bonus_action", 1),
        (r"^(\d+)\s*(reaction)$", "reaction", 1),
        (r"^(\d+)\s*(action)$", "action", 1),
        (r"^(\d+)\s*(rounds?|轮)$", "round", 6),
        (r"^(\d+)\s*(minutes?|分钟)$", "minute", 60),
        (r"^(\d+)\s*(hours?|小时)$", "hour", 3600),
    ]
    for pattern, unit, multiplier in patterns:
        match = re.match(pattern, raw) or re.match(pattern, cn.lower())
        if match:
            value = int(match.group(1))
            return {"value": value, "unit": unit, "seconds": value * multiplier}

    if "附赠动作" in cn:
        return {"value": 1, "unit": "bonus_action", "seconds": 1}
    if "反应" in cn:
        return {"value": 1, "unit": "reaction", "seconds": 1}
    if "动作" in cn:
        return {"value": 1, "unit": "action", "seconds": 1}
    if "分钟" in cn:
        m = re.search(r"(\d+)", cn)
        value = int(m.group(1)) if m else 1
        return {"value": value, "unit": "minute", "seconds": value * 60}
    if "小时" in cn:
        m = re.search(r"(\d+)", cn)
        value = int(m.group(1)) if m else 1
        return {"value": value, "unit": "hour", "seconds": value * 3600}
    if "轮" in cn:
        m = re.search(r"(\d+)", cn)
        value = int(m.group(1)) if m else 1
        return {"value": value, "unit": "round", "seconds": value * 6}
    return {"value": 1, "unit": "action", "seconds": 1}


def _split_passive_immunities(immunities: List[str]) -> tuple[List[str], List[str]]:
    damage_immunities: List[str] = []
    condition_immunities: List[str] = []
    for raw in immunities:
        value = str(raw or "").strip()
        if not value:
            continue
        if value.lower() in PASSIVE_DAMAGE_IMMUNITY_KEYS:
            damage_immunities.append(value)
        else:
            condition_immunities.append(value)
    return damage_immunities, condition_immunities


def _parse_cr(cr_str: Optional[str]) -> float:
    """Parse D&D challenge rating string to float. E.g. '1/2' → 0.5, '3' → 3.0."""
    if not cr_str:
        return 0.0
    cr_str = cr_str.strip()
    if "/" in cr_str:
        parts = cr_str.split("/")
        try:
            return float(parts[0]) / float(parts[1])
        except (ValueError, ZeroDivisionError):
            return 0.0
    try:
        return float(cr_str)
    except ValueError:
        return 0.0


def _normalize_spell_slot_array(values: Any) -> list[int]:
    normalized = [0] * 10
    if not isinstance(values, list):
        return normalized

    for index in range(min(len(values), 10)):
        raw_value = values[index]
        if raw_value is None:
            normalized[index] = 0
            continue
        try:
            normalized[index] = max(0, int(raw_value))
        except (TypeError, ValueError):
            normalized[index] = 0
    return normalized


def _is_third_caster(class_id: Optional[str], subclass_id: Optional[str]) -> bool:
    return (
        (class_id == "fighter" and subclass_id == "eldritch_knight")
        or (class_id == "rogue" and subclass_id == "arcane_trickster")
    )


def _build_default_spell_slots_state_for_character(character: Character) -> list[int] | None:
    class_id = (character.class_id or "").strip().lower()
    subclass_id = (character.subclass_id or "").strip().lower()
    if not class_id:
        return None

    spellcasting_data = get_spellcasting_data()

    if class_id == "warlock":
        pact_cfg = (spellcasting_data.get("pactMagic") or {}).get("warlock") or {}
        entry = pact_cfg.get(str(character.level or 1)) or {}
        slots = [0] * 10
        slot_count = int(entry.get("slots") or 0)
        slot_level = int(entry.get("level") or 1)
        if slot_count <= 0 or slot_level < 1 or slot_level > 9:
            return slots
        slots[slot_level] = slot_count
        return normalize_character_spell_slots_state(slots, strict=True) or slots

    table_key: Optional[str] = None
    if _is_third_caster(class_id, subclass_id):
        table_key = "thirdCaster"
    elif class_id in {"paladin", "ranger"}:
        table_key = "halfCaster"
    elif class_id in {
        "artificer",
        "bard",
        "cleric",
        "druid",
        "sorcerer",
        "wizard",
    }:
        table_key = "fullCaster"

    if not table_key:
        return None

    raw_slots = ((spellcasting_data.get("slotTables") or {}).get(table_key) or {}).get(str(character.level or 1)) or []
    slots = [0, *[max(0, int(value or 0)) for value in raw_slots]]
    while len(slots) < 10:
        slots.append(0)
    return normalize_character_spell_slots_state(slots[:10], strict=True) or slots[:10]


def _get_available_spell_slot_count(spell_slots_state: Any, slot_level: int) -> int:
    if slot_level <= 0:
        return 0

    if isinstance(spell_slots_state, list):
        slots = _normalize_spell_slot_array(spell_slots_state)
        return slots[slot_level] if slot_level < len(slots) else 0

    if isinstance(spell_slots_state, dict):
        regular_slots = _normalize_spell_slot_array(spell_slots_state.get("slots"))
        pact_slots = _normalize_spell_slot_array(spell_slots_state.get("pact_slots"))
        regular = regular_slots[slot_level] if slot_level < len(regular_slots) else 0
        pact = pact_slots[slot_level] if slot_level < len(pact_slots) else 0
        return regular + pact

    return 0


def _consume_spell_slot_state(spell_slots_state: Any, slot_level: int) -> tuple[Any, bool]:
    if slot_level <= 0:
        return spell_slots_state, False

    if isinstance(spell_slots_state, list):
        slots = _normalize_spell_slot_array(spell_slots_state)
        if slot_level >= len(slots) or slots[slot_level] <= 0:
            return slots, False
        slots[slot_level] -= 1
        normalized = normalize_character_spell_slots_state(slots, strict=True) or slots
        return normalized, True

    if isinstance(spell_slots_state, dict):
        next_state = dict(spell_slots_state)
        regular_slots = _normalize_spell_slot_array(next_state.get("slots"))
        pact_slots = _normalize_spell_slot_array(next_state.get("pact_slots"))

        if slot_level < len(regular_slots) and regular_slots[slot_level] > 0:
            regular_slots[slot_level] -= 1
        elif slot_level < len(pact_slots) and pact_slots[slot_level] > 0:
            pact_slots[slot_level] -= 1
        else:
            next_state["slots"] = regular_slots
            next_state["pact_slots"] = pact_slots
            return next_state, False

        next_state["slots"] = regular_slots
        next_state["pact_slots"] = pact_slots
        return next_state, True

    return spell_slots_state, False


def _ensure_character_spell_slots_state(character: Character) -> Any:
    current_state = getattr(character, "spell_slots_state", None)
    if current_state is not None:
        return current_state

    default_state = _build_default_spell_slots_state_for_character(character)
    if default_state is None:
        return None

    character.spell_slots_state = default_state
    try:
        flag_modified(character, "spell_slots_state")
    except Exception:
        pass
    return default_state


def _has_available_spell_slot(character: Character, slot_level: int) -> bool:
    spell_slots_state = _ensure_character_spell_slots_state(character)
    return _get_available_spell_slot_count(spell_slots_state, slot_level) > 0


def _consume_character_spell_slot(character: Character, slot_level: int) -> tuple[bool, Any]:
    spell_slots_state = _ensure_character_spell_slots_state(character)
    next_state, consumed = _consume_spell_slot_state(spell_slots_state, slot_level)
    if not consumed:
        return False, spell_slots_state

    character.spell_slots_state = next_state
    try:
        flag_modified(character, "spell_slots_state")
    except Exception:
        pass
    return True, next_state


def _spell_requires_manual_release(
    spell_data: Dict[str, Any],
    casting: Optional[Dict[str, Any]] = None,
) -> bool:
    range_value = str(spell_data.get("range", "") or "").strip().lower()
    area = spell_data.get("areaOfEffect") or spell_data.get("area_of_effect")
    area_type = str((area or {}).get("type", "") or "").strip().lower()
    target_token_ids = list((casting or {}).get("target_token_ids") or [])

    # Self-emanating lines/cones still require choosing direction at release time.
    if range_value.startswith("自身"):
        if area:
            return area_type in {"cone", "line"}
        return False

    # Any non-self area spell needs selecting a point/origin.
    if area:
        return True

    # Touch / ranged single-target spells can auto-complete only if a target was already locked in.
    return len(target_token_ids) == 0


def _build_casting_state(
    spell_data: Dict[str, Any],
    req: StartSpellCastRequest,
    current_time: Dict[str, Any],
    started_by_user_id: Optional[str],
) -> Dict[str, Any]:
    base_cast = _parse_casting_time(spell_data.get("castingTime", "1 action"))
    extra_seconds = 600 if req.ritual_cast else 0
    total_seconds = base_cast["seconds"] + extra_seconds
    finish_time = _seconds_to_campaign_time(_campaign_time_to_seconds(current_time) + total_seconds)
    state: Dict[str, Any] = {
        "spell_id": req.spell_id,
        "spell_name": spell_data.get("name", req.spell_id),
        "slot_level": req.slot_level,
        "cast_mode": "ritual" if req.ritual_cast else "normal",
        "base_casting_time": {"value": base_cast["value"], "unit": base_cast["unit"]},
        "total_cast_seconds": total_seconds,
        "started_at_campaign": current_time,
        "finish_at_campaign": finish_time,
        "target_token_ids": req.target_token_ids,
        "selected_option": req.selected_option,
        "material_id": req.material_id,
        "requires_concentration_during_cast": total_seconds >= 60,
        "breaks_existing_concentration": total_seconds >= 60,
        "started_by_user_id": started_by_user_id,
        "freecast": req.freecast,
        "status": "casting",
    }
    if req.area_effect:
        state["area_effect"] = req.area_effect
    return state


async def _get_campaign_time(db: AsyncSession, campaign_id: int) -> Dict[str, Any]:
    campaign = await db.get(Campaign, campaign_id)
    meta = campaign.meta if campaign and campaign.meta else {}
    return _normalize_campaign_time(meta.get("time_of_day"))


async def _broadcast_casting_update(token: Token, reason: Optional[str] = None) -> None:
    await realtime_publisher.publish_token_casting_updated(
        token.campaign_id,
        token_id=token.id,
        casting_in_progress=token.casting_in_progress,
        **({"reason": reason} if reason else {}),
    )


async def _sync_token_aura_runtime(
    db: AsyncSession,
    *,
    token_ids: List[int],
) -> None:
    from app.services import aura_service

    unique_token_ids = sorted({int(token_id) for token_id in token_ids if token_id})
    if not unique_token_ids:
        return

    map_triggers: Dict[tuple[int, str], int] = {}
    for token_id in unique_token_ids:
        token = await db.get(Token, token_id)
        if not token:
            continue
        await realtime_publisher.publish_token_auras_updated(
            token.campaign_id,
            token_id=token.id,
            active_auras=token.active_auras or [],
            aura_id="",
            enabled=bool(token.active_auras),
        )
        if token.campaign_id and token.map_url:
            map_triggers.setdefault((int(token.campaign_id), token.map_url), token.id)

    for (campaign_id, map_url), trigger_token_id in map_triggers.items():
        await aura_service.on_token_move(
            trigger_token_id,
            campaign_id,
            map_url,
            db,
        )


def _can_manage_casting(
    token: Token,
    casting: Optional[Dict[str, Any]],
    current_user: Dict[str, Any],
    campaign: Optional[Campaign],
) -> bool:
    user_id = current_user.get("user_id")
    if campaign and campaign.dm_user_id == user_id:
        return True
    if token.user_id and token.user_id == user_id:
        return True
    if casting and casting.get("started_by_user_id") == user_id:
        return True
    return False


async def _delete_linked_concentration_tokens(
    db: AsyncSession,
    concentration_spell: Optional[Dict[str, Any]],
) -> list[int]:
    removed_token_ids: list[int] = []
    for token_id in get_concentration_linked_token_ids(concentration_spell):
        linked_token = await db.get(Token, token_id)
        if not linked_token:
            continue
        await db.delete(linked_token)
        removed_token_ids.append(token_id)
    return removed_token_ids


def _is_replaced_concentration_effect(
    effect: Dict[str, Any],
    old_spell_id: str,
    caster_token_id: int,
) -> bool:
    """Predicate for caster-side active_effects to drop when an old concentration spell ends.

    Only matches when the effect belongs to the old concentration spell AND is
    concentration-owned. Non-concentration effects (e.g. Forcecage barriers) are
    preserved even when their spell_id matches.
    """
    if effect.get("spell_id") != old_spell_id:
        return False
    if effect.get("spell_buff"):
        return True
    if effect.get("is_concentration"):
        source_id = effect.get("source_token_id")
        if source_id is None or source_id == caster_token_id:
            return True
    return False


async def _cleanup_replaced_concentration_effects(
    token: Token,
    db: AsyncSession,
    *,
    concentration_spell: Optional[Dict[str, Any]] = None,
) -> tuple[list[int], list[int]]:
    """Clean up runtime/effects linked to an old concentration spell before replacing it."""
    from app.services.aura_service import strip_spell_aura_entries
    old_conc = concentration_spell or token.concentration_spell
    old_spell_id = old_conc.get("spell_id", "") if old_conc else ""
    if not old_spell_id:
        return [], []

    from app.api.routes.tokens import _remove_control_effects_from_tokens

    removed_linked_token_ids = await _delete_linked_concentration_tokens(db, old_conc)
    runtime_touched_token_ids = await end_concentration_runtime_instances(
        db,
        campaign_id=token.campaign_id,
        concentration_owner_token_ids=[token.id],
    )

    effects = token.active_effects or []
    new_effects = [
        effect
        for effect in effects
        if not _is_replaced_concentration_effect(effect, old_spell_id, token.id)
    ]
    if len(new_effects) < len(effects):
        token.active_effects = new_effects
        flag_modified(token, "active_effects")
    next_auras = strip_spell_aura_entries(
        token.active_auras,
        spell_id=old_spell_id,
        source_token_id=token.id,
    )
    if next_auras != token.active_auras:
        token.active_auras = next_auras
        flag_modified(token, "active_auras")

    old_affected = list(old_conc.get("affected_token_ids") or [])
    if old_affected:
        await _remove_control_effects_from_tokens(
            db=db,
            spell_id=old_spell_id,
            affected_token_ids=old_affected,
            caster_token_id=token.id,
            campaign_id=token.campaign_id,
        )

    return removed_linked_token_ids, runtime_touched_token_ids


async def _break_concentration_for_new_cast(
    token: Token,
    db: AsyncSession,
    reason: str,
) -> Optional[Dict[str, Any]]:
    old_conc = token.concentration_spell
    if not old_conc:
        return None

    token.concentration_spell = None
    flag_modified(token, "concentration_spell")
    removed_linked_token_ids, runtime_touched_token_ids = await _cleanup_replaced_concentration_effects(
        token,
        db,
        concentration_spell=old_conc,
    )

    await db.flush()
    for linked_token_id in removed_linked_token_ids:
        await realtime_publisher.publish_map_token_removed(
            token.campaign_id,
            token_id=linked_token_id,
        )
    await realtime_publisher.publish_token_concentration_updated(
        token.campaign_id,
        token_id=token.id,
        concentration_spell=None,
        reason=reason,
        broken_spell=old_conc,
        active_effects=token.active_effects or [],
    )
    if runtime_touched_token_ids:
        await publish_runtime_projection_updates(
            db,
            campaign_id=token.campaign_id,
            token_ids=runtime_touched_token_ids,
        )
    await _sync_token_aura_runtime(
        db,
        token_ids=[token.id, *runtime_touched_token_ids],
    )
    return old_conc


def _build_duration_hint(spell_data: dict, in_combat: bool) -> Optional[str]:
    """Build a human-readable duration hint."""
    dur = spell_data.get("duration", "")
    if not dur or dur in ("立即", "瞬间", "Instantaneous"):
        return None
    if in_combat:
        m = re.search(r"(\d+)\s*(分钟|小时|轮|日|天)", dur)
        if m:
            val, unit = int(m.group(1)), m.group(2)
            if unit == "轮": rounds = val
            elif unit == "分钟": rounds = val * 10
            elif unit == "小时": rounds = val * 600
            else: rounds = val * 14400  # 日/天
            return f"持续{rounds}轮({dur})"
    return f"持续{dur}"


def _resolve_appearance_illusion_target_ids(
    requested_target_ids: list[int],
    result: Any,
) -> list[int]:
    """Appearance illusions with a successful save should not affect that target."""
    successful_save_target_ids: set[int] = set()
    for phase_results in getattr(result, "phase_results", []) or []:
        for effect_result in phase_results or []:
            target_token_id = getattr(effect_result, "target_token_id", None)
            if target_token_id is None:
                continue
            if getattr(effect_result, "save_rolled", False) and getattr(effect_result, "save_succeeded", None) is True:
                successful_save_target_ids.add(int(target_token_id))
    return [target_id for target_id in requested_target_ids if target_id not in successful_save_target_ids]


def _filter_non_current_appearance_disguise_effects(
    effects: list[dict[str, Any]],
    *,
    current_spell_id: str,
) -> tuple[list[dict[str, Any]], bool]:
    filtered = [
        effect
        for effect in effects
        if not (
            effect.get("spell_buff")
            and effect.get("spell_id") != current_spell_id
            and spell_has_illusion_subtype(get_spell_by_id(effect.get("spell_id")), "appearance")
        )
    ]
    return filtered, len(filtered) != len(effects)


async def _apply_cast_appearance_illusion(
    db: AsyncSession,
    *,
    spell_data: dict[str, Any],
    req: SpellCastRequest,
    caster_name: str,
    caster_character_id: int | None,
    target_token_ids: list[int],
) -> list[int]:
    if not spell_has_illusion_subtype(spell_data, "appearance"):
        return []

    illusion_data = dict(req.illusion_data or {})
    disguise_avatar = str(illusion_data.get("image_url") or "").strip()
    if not disguise_avatar:
        return []

    touched_token_ids: list[int] = []
    for target_token_id in target_token_ids:
        token = await db.get(Token, target_token_id)
        if not token:
            continue

        token.disguise_data = normalize_token_disguise_data(
            {
                "spell_id": req.spell_id,
                "spell_name": spell_data.get("name", req.spell_id),
                "disguise_avatar": disguise_avatar,
                "description": illusion_data.get("description") or "",
                "caster_character_id": caster_character_id,
                "caster_name": caster_name,
                "started_at": datetime.now(timezone.utc).isoformat(),
            },
            strict=True,
        )
        flag_modified(token, "disguise_data")
        touched_token_ids.append(target_token_id)

    return touched_token_ids


async def _check_in_combat(db: AsyncSession, campaign_id: int) -> bool:
    """Check if campaign is currently in combat."""
    result = await db.execute(
        select(CampaignStorage).where(
            and_(
                CampaignStorage.campaign_id == campaign_id,
                CampaignStorage.object_type == "combat",
                CampaignStorage.object_id == "current",
                CampaignStorage.is_active == True,
            )
        )
    )
    return result.scalar_one_or_none() is not None


async def _build_target_info(
    token: Token, db: AsyncSession
) -> TargetInfo:
    """Build TargetInfo from a token, loading character/monster data."""
    name = token.instance_name or "目标"
    ac = 10
    current_hp = token.current_hp
    max_hp = None
    ability_scores = {}
    damage_resistances: List[str] = []
    damage_immunities: List[str] = []
    condition_immunities: List[str] = []
    level = 1
    class_id = None
    proficiency_bonus = 2
    creature_type = ""
    # Derive D&D size label from token grid size
    size_idx = GRID_TO_SIZE_IDX.get(token.token_size or "1x1", DEFAULT_SIZE_IDX)
    size = SIZE_CN[size_idx]
    save_override = None

    if token.character_id:
        char = await db.get(Character, token.character_id)
        if char:
            name = char.name or name
            ability_scores = char.ability_scores or {}
            level = char.level or 1
            class_id = char.class_id
            max_hp = calculate_max_hp(char)
            proficiency_bonus = calculate_proficiency_bonus(level)
            if current_hp is None:
                current_hp = char.current_hp
            # Character max_hp is computed on frontend; not stored in DB
            if class_id:
                from app.services.passive_feature_service import get_passive_features
                passive_features = get_passive_features(class_id, level, char.subclass_id)
                passive_resistances = passive_features.get("resistances", [])
                if isinstance(passive_resistances, list):
                    damage_resistances.extend(str(value) for value in passive_resistances if value)
                passive_immunities = passive_features.get("immunities", [])
                if isinstance(passive_immunities, list):
                    extra_damage_immunities, extra_condition_immunities = _split_passive_immunities(
                        [str(value) for value in passive_immunities if value]
                    )
                    damage_immunities.extend(extra_damage_immunities)
                    condition_immunities.extend(extra_condition_immunities)

    if token.monster_instance_id:
        mi = await db.get(MonsterInstance, token.monster_instance_id)
        if mi:
            md = mi.monster_data or {}
            ac = md.get("ac") or mi.armor_class or 10
            name = mi.name_cn or mi.name or name
            if current_hp is None:
                current_hp = mi.current_hp
            max_hp = mi.hit_points or max_hp
            damage_resistances = md.get("damage_resistances") or []
            damage_immunities = md.get("damage_immunities") or []
            condition_immunities = md.get("condition_immunities") or []
            ability_scores = mi.ability_scores or md.get("ability_scores") or {}
            # Monster saving throw overrides
            saves = md.get("saving_throws") or {}
            if saves:
                save_override = saves  # pass whole dict, resolver picks per-check
            creature_type = md.get("type", "") or mi.type or ""
            if not creature_type and mi.monster_id:
                creature_type = resolve_creature_type_from_monster_id(mi.monster_id)
            size = md.get("size", "") or size

    # Transformation overrides (Wild Shape, Polymorph, etc.)
    ws = token.transformation_data
    if ws:
        ac = ws.get("ac", ac)
        current_hp = ws.get("current_hp", current_hp)
        max_hp = ws.get("max_hp", max_hp)

    return TargetInfo(
        token_id=token.id,
        name=name,
        ac=ac,
        current_hp=current_hp,
        max_hp=max_hp,
        character_id=token.character_id,
        monster_instance_id=token.monster_instance_id,
        damage_resistances=damage_resistances if isinstance(damage_resistances, list) else [damage_resistances],
        damage_immunities=damage_immunities if isinstance(damage_immunities, list) else [damage_immunities],
        condition_immunities=condition_immunities if isinstance(condition_immunities, list) else [condition_immunities],
        active_effects=token.active_effects or [],
        ability_scores=ability_scores,
        level=level,
        class_id=class_id,
        proficiency_bonus=proficiency_bonus,
        save_override=save_override if isinstance(save_override, int) else None,
        creature_type=creature_type,
        size=size,
    )


@router.post("/cast", response_model=SpellCastResponse)
async def cast_spell(req: SpellCastRequest, db: AsyncSession = Depends(get_db)):
    """
    Unified spell casting endpoint.
    Resolves spell effects through SpellResolver and broadcasts results.
    """
    # 1. Load spell data
    spell_data = get_spell_by_id(req.spell_id)
    if not spell_data:
        raise HTTPException(404, f"Spell not found: {req.spell_id}")

    effects = spell_data.get("effects")
    cast_options = spell_data.get("castOptions")
    if not effects and not cast_options:
        return SpellCastResponse(
            success=False,
            error="Spell has no structured effects — use legacy path",
        )

    # 2. Load caster token
    caster_token = await db.get(Token, req.caster_token_id)
    if not caster_token:
        raise HTTPException(404, "Caster token not found")

    # 3. Build caster context from character data
    caster_name = caster_token.instance_name or "施法者"
    caster_level = 1
    spellcasting_mod = 0
    prof_bonus = 2
    spell_save_dc = 8
    spell_attack_bonus = 0
    caster_character: Character | None = None
    class_id = None
    subclass_id = None
    caster_ability_scores: Dict[str, int] = {}

    if caster_token.character_id:
        caster_character = await db.get(Character, caster_token.character_id)
        if caster_character:
            caster_name = caster_character.name or caster_name
            caster_level = caster_character.level or 1
            class_id = caster_character.class_id
            subclass_id = caster_character.subclass_id
            caster_ability_scores = caster_character.ability_scores or {}
            prof_bonus = calculate_proficiency_bonus(caster_level)
            ability = CLASS_SPELLCASTING_ABILITY.get(class_id or "", "intelligence")
            score = caster_ability_scores.get(ability, 10)
            spellcasting_mod = calculate_ability_modifier(score)
            spell_save_dc = 8 + prof_bonus + spellcasting_mod
            spell_attack_bonus = prof_bonus + spellcasting_mod

    if (
        req.slot_level > 0
        and not req.freecast
        and not req.ritual_cast
        and caster_character
        and not _has_available_spell_slot(caster_character, req.slot_level)
    ):
        return SpellCastResponse(
            success=False,
            spell_name=spell_data.get("name", req.spell_id),
            error=f"没有可用的{req.slot_level}环法术位",
        )

    # 4. Check combat state
    in_combat = await _check_in_combat(db, req.campaign_id)

    # 5. Build SpellContext
    is_concentration = spell_data.get("concentration", False)
    uses_runtime_engine = spell_uses_runtime_engine(spell_data)
    current_time = await _get_campaign_time(db, req.campaign_id)
    ctx = SpellContext(
        caster_token_id=req.caster_token_id,
        caster_name=caster_name,
        caster_level=caster_level,
        caster_class_id=class_id,
        caster_subclass_id=subclass_id,
        caster_ability_scores=caster_ability_scores,
        spellcasting_mod=spellcasting_mod,
        proficiency_bonus=prof_bonus,
        spell_save_dc=spell_save_dc,
        spell_attack_bonus=spell_attack_bonus,
        spell_level=spell_data.get("level", 0) or 0,
        slot_level=req.slot_level,
        spell_id=req.spell_id,
        spell_name=spell_data.get("name", req.spell_id),
        concentration=is_concentration,
        campaign_id=req.campaign_id,
        in_combat=in_combat,
        selected_option=req.selected_option,
        current_world_time=current_time,
    )
    ctx.target_auto_fail_save = req.target_auto_fail_save

    # 5b. Check Malleable Illusions: wizard illusion school level >= 6, duration >= 1 min
    dur_str_raw = spell_data.get("duration", "")
    dur_rounds_malleable = 0
    m_dur = re.search(r"(\d+)\s*(分钟|小时|轮|日|天)", dur_str_raw)
    if m_dur:
        val, unit = int(m_dur.group(1)), m_dur.group(2)
        if unit == "轮": dur_rounds_malleable = val
        elif unit == "分钟": dur_rounds_malleable = val * 10
        elif unit == "小时": dur_rounds_malleable = val * 600
        else: dur_rounds_malleable = val * 14400
    is_malleable = (
        class_id == "wizard" and subclass_id == "illusion" and caster_level >= 6
        and spell_data.get("school") == "illusion" and dur_rounds_malleable >= 10
    )

    # 6. Load target tokens and build TargetInfo[]
    targets: List[TargetInfo] = []
    for tid in req.target_token_ids:
        token = await db.get(Token, tid)
        if not token:
            logger.warning(f"Target token {tid} not found, skipping")
            continue
        targets.append(await _build_target_info(token, db))

    if not targets:
        raise HTTPException(400, "No valid target tokens")

    # 7. Handle concentration (set on caster, break old)
    concentration_set = False
    removed_old_linked_token_ids: list[int] = []
    old_runtime_touched_token_ids: list[int] = []
    if is_concentration:
        # Use existing concentration API logic inline
        old_conc = caster_token.concentration_spell
        old_spell_id = old_conc.get("spell_id", "") if old_conc else ""

        # Clean up old concentration buffs
        if old_spell_id:
            removed_old_linked_token_ids, old_runtime_touched_token_ids = (
                await _cleanup_replaced_concentration_effects(
                    caster_token,
                    db,
                    concentration_spell=old_conc,
                )
            )

            old_spell_data = get_spell_by_id(old_spell_id) if old_conc else None
            old_selected_option = old_conc.get("selected_option") if old_conc else None

            # Clear transformation_data for old concentration's targets when
            # the ended spell was their source. Covers size-changing spells
            # (Enlarge/Reduce — restore size from `original_size`) and full-
            # replacement transformations (Polymorph — no size delta).
            if old_conc and old_spell_id:
                old_size_delta = get_spell_size_delta(old_spell_data, old_selected_option)
                old_affected = old_conc.get("affected_token_ids", [])
                for old_tid in old_affected:
                    old_t = await db.get(Token, old_tid)
                    if not (old_t and old_t.transformation_data):
                        continue
                    old_source = old_t.transformation_data.get("source", {}) or {}
                    if (old_source.get("spell_id") != old_spell_id
                            and old_source.get("config_id") != old_spell_id):
                        continue
                    restored_size: Optional[str] = None
                    if old_size_delta is not None:
                        orig_label = old_t.transformation_data.get("original_size", "中型")
                        orig_idx = SIZE_CN_TO_IDX.get(orig_label, DEFAULT_SIZE_IDX)
                        restored_size = SIZE_GRIDS[orig_idx]
                        old_t.token_size = restored_size
                    old_t.transformation_data = None
                    flag_modified(old_t, "transformation_data")
                    if restored_size is not None:
                        await realtime_publisher.publish_transformation_updated(
                            req.campaign_id,
                            token_id=old_tid,
                            transformation_data=None,
                            token_size=restored_size,
                        )
                    else:
                        await realtime_publisher.publish_transformation_updated(
                            req.campaign_id,
                            token_id=old_tid,
                            transformation_data=None,
                        )

        dur_rounds = resolve_spell_duration_rounds(spell_data, req.slot_level) or dur_rounds_malleable or 10

        conc_data = {
            "spell_id": req.spell_id,
            "spell_name": spell_data.get("name", ""),
            "slot_level": req.slot_level,
            "duration_rounds": dur_rounds,
            "current_round": 0,
            "affected_token_ids": req.target_token_ids,
            **({"selected_option": req.selected_option} if req.selected_option else {}),
            **({"illumination": spell_data["illumination"]} if spell_data.get("illumination") else {}),
            **({"malleable": True} if is_malleable else {}),
        }
        # Concentration CON-save data so a later damage-induced check uses the
        # caster's real CON save bonus + War Caster advantage (matching the
        # /combat/spell path). Without this the check defaulted to d20+0.
        if caster_character:
            from app.utils.saving_throws import calc_saving_throw_modifier
            _save_info = calc_saving_throw_modifier(
                caster_character.ability_scores or {}, "constitution",
                caster_character.class_id, caster_character.level or 1)
            conc_data["con_save_bonus"] = _save_info["total"]
            _feats = caster_character.feats or []
            if "war_caster" in _feats or "warCaster" in _feats:
                conc_data["has_advantage"] = True
                conc_data["extra_bonus_source"] = "战斗施法者"
        # Write world-time expiration for concentration tracking
        if current_time:
            conc_data["expires_at"] = SpellResolver._calc_expires_at(current_time, dur_rounds)
        caster_token.concentration_spell = normalize_token_concentration_spell(conc_data, strict=True)
        flag_modified(caster_token, "concentration_spell")
        concentration_set = True

    # 7b. Handle unique_instance spells — dismiss previous instance from same caster
    dismissed_token_ids: list[int] = []
    if spell_data.get("unique_instance"):
        result_tokens = await db.execute(
            select(Token).where(Token.campaign_id == req.campaign_id)
        )
        all_tokens = result_tokens.scalars().all()
        for t in all_tokens:
            effs = t.active_effects or []
            new_effs = [
                e for e in effs
                if not (
                    e.get("spell_buff")
                    and e.get("spell_id") == req.spell_id
                    and e.get("from_caster") == caster_name
                )
            ]
            if len(new_effs) < len(effs):
                t.active_effects = new_effs
                flag_modified(t, "active_effects")
                dismissed_token_ids.append(t.id)

    # 8. Resolve spell effects
    runtime_instance = None
    if uses_runtime_engine:
        runtime_instance, result = await create_runtime_spell_instance(
            db,
            spell_data=spell_data,
            spell_context=ctx,
            targets=targets,
            slot_level=req.slot_level,
        )
    else:
        resolver = SpellResolver()
        result = await resolver.resolve(
            spell_data,
            ctx,
            targets,
            db,
            phase_context={"teleport_destination": req.teleport_destination}
            if req.teleport_destination
            else None,
        )

        if result is None:
            return SpellCastResponse(
                success=False,
                error="Spell has no resolvable effects",
            )

    is_appearance_illusion = spell_has_illusion_subtype(spell_data, "appearance")
    appearance_illusion_target_ids = (
        _resolve_appearance_illusion_target_ids(req.target_token_ids, result)
        if is_appearance_illusion
        else list(req.target_token_ids)
    )

    disguise_updated_token_ids = await _apply_cast_appearance_illusion(
        db,
        spell_data=spell_data,
        req=req,
        caster_name=caster_name,
        caster_character_id=caster_token.character_id,
        target_token_ids=appearance_illusion_target_ids,
    )

    # 8b. Ensure spell_buff visual indicator for lasting-duration spells
    dur_raw = spell_data.get("duration", "")
    is_lasting = dur_raw and dur_raw not in ("立即", "瞬间", "Instantaneous")
    if is_lasting:
        # Buff condition badges come ONLY from conditions the spell actually applies
        # (apply_condition effects). The top-level `conditions` field is a loose
        # "related conditions" tag — it also lists conditions the spell removes /
        # prevents / detects, or that belong to an invisible object/sensor — and
        # copying it onto the target buff mis-renders the token (BUG B). See
        # app/utils/spell_buff_conditions.py and tests/unit/test_spell_buff_conditions.py.
        spell_conditions = derive_buff_conditions(spell_data)
        school = spell_data.get("school", "").lower()
        school_icons = {
            "abjuration": "\U0001f6e1\ufe0f", "conjuration": "\u2728",
            "divination": "\U0001f441\ufe0f", "enchantment": "\U0001f4ab",
            "evocation": "\U0001f525", "illusion": "\U0001f300",
            "necromancy": "\U0001f480", "transmutation": "\U0001f504",
        }
        school_colors = {
            "abjuration": "#60a5fa", "conjuration": "#facc15",
            "divination": "#22d3ee", "enchantment": "#f472b6",
            "evocation": "#f87171", "illusion": "#a78bfa",
            "necromancy": "#4ade80", "transmutation": "#fb923c",
        }
        icon_path = spell_data.get("iconPath") or f"/assets/spell-icons/{req.spell_id}.png"
        selected_option_data = get_spell_cast_option(spell_data, req.selected_option) if req.selected_option else None
        selected_option_label = (selected_option_data or {}).get("label")
        dur_rounds_vis = None
        dur_unit = None
        m = re.search(r"(\d+)\s*(分钟|小时|轮|日|天)", dur_raw)
        if m:
            val, unit = int(m.group(1)), m.group(2)
            if unit in ("日", "天"):
                dur_rounds_vis = val
                dur_unit = "day"
            elif unit == "轮": dur_rounds_vis = val
            elif unit == "分钟": dur_rounds_vis = val * 10
            elif unit == "小时": dur_rounds_vis = val * 600

        visual_target_ids = (
            appearance_illusion_target_ids if is_appearance_illusion else req.target_token_ids
        )

        for tid in visual_target_ids:
            token = await db.get(Token, tid)
            if not token:
                continue
            effs = list(token.active_effects or [])
            if is_appearance_illusion:
                effs, removed_old_appearance_buff = _filter_non_current_appearance_disguise_effects(
                    effs,
                    current_spell_id=req.spell_id,
                )
                if removed_old_appearance_buff:
                    token.active_effects = effs
                    flag_modified(token, "active_effects")
            has_buff = any(
                e.get("spell_buff") and e.get("spell_id") == req.spell_id
                for e in effs
            )
            if not has_buff:
                visual_buff = {
                    "id": f"spell_buff_{req.spell_id}",
                    "name": spell_data.get("name", req.spell_id),
                    "spell_buff": True,
                    "spell_id": req.spell_id,
                    "is_concentration": is_concentration,
                    "icon": school_icons.get(school, "\u2728"),
                    "color": school_colors.get(school, "#a78bfa"),
                    "icon_path": icon_path,
                    "from_caster": caster_name,
                    "cast_level": req.slot_level,
                    "source_token_id": req.caster_token_id,
                }
                if req.selected_option:
                    visual_buff["selected_option"] = req.selected_option
                if selected_option_label:
                    visual_buff["selected_option_label"] = selected_option_label
                if spell_conditions:
                    visual_buff["conditions"] = spell_conditions
                if dur_rounds_vis:
                    visual_buff["duration"] = dur_rounds_vis
                    if dur_unit:
                        visual_buff["duration_unit"] = dur_unit
                    # Write world-time expiration for visual buffs
                    if dur_unit != "day" and current_time:
                        visual_buff["expires_at"] = SpellResolver._calc_expires_at(current_time, dur_rounds_vis)
                if spell_data.get("illumination"):
                    visual_buff["illumination"] = spell_data["illumination"]
                # Legacy compatibility projection for visuals like Blur; new spell runtime
                # ownership has not fully replaced tokenFilter-backed rendering yet.
                if spell_data.get("tokenFilter"):
                    visual_buff["tokenFilter"] = spell_data["tokenFilter"]
                if result.items_generated:
                    visual_buff["has_generated_items"] = True
                if is_malleable:
                    visual_buff["malleable"] = True
                effs.append(visual_buff)
                token.active_effects = effs
                flag_modified(token, "active_effects")
            else:
                # SpellResolver may have created a spell_buff without visual fields;
                # patch duration / tokenFilter / illumination / icon_path onto existing buff.
                # tokenFilter remains a compatibility projection, not a new primary runtime path.
                changed = False
                for e in effs:
                    if e.get("spell_buff") and e.get("spell_id") == req.spell_id:
                        if dur_rounds_vis and not e.get("duration"):
                            e["duration"] = dur_rounds_vis
                            if dur_unit:
                                e["duration_unit"] = dur_unit
                            changed = True
                        if dur_rounds_vis and not e.get("expires_at") and dur_unit != "day" and current_time:
                            e["expires_at"] = SpellResolver._calc_expires_at(current_time, dur_rounds_vis)
                            changed = True
                        if is_concentration and not e.get("is_concentration"):
                            e["is_concentration"] = True
                            changed = True
                        tf = spell_data.get("tokenFilter")
                        if tf and not e.get("tokenFilter"):
                            e["tokenFilter"] = tf
                            changed = True
                        illum = spell_data.get("illumination")
                        if illum and not e.get("illumination"):
                            e["illumination"] = illum
                            changed = True
                        if not e.get("icon_path"):
                            e["icon_path"] = icon_path
                            e["icon"] = school_icons.get(school, "\u2728")
                            e["color"] = school_colors.get(school, "#a78bfa")
                            changed = True
                        if not e.get("from_caster"):
                            e["from_caster"] = caster_name
                            changed = True
                        if req.selected_option and not e.get("selected_option"):
                            e["selected_option"] = req.selected_option
                            changed = True
                        if selected_option_label and not e.get("selected_option_label"):
                            e["selected_option_label"] = selected_option_label
                            changed = True
                        if spell_conditions and not e.get("conditions"):
                            e["conditions"] = spell_conditions
                            changed = True
                        break
                if changed:
                    token.active_effects = effs
                    flag_modified(token, "active_effects")

    # 8c. Apply transformation_data for size-changing spells from structured metadata.
    transformation_updates = []
    size_delta = get_spell_size_delta(spell_data, req.selected_option)
    if size_delta is not None:
        delta = size_delta
        selected_option = get_spell_cast_option(spell_data, req.selected_option)
        effect_label = (selected_option or {}).get("label") or spell_data.get("name", req.spell_id)

        # Pre-load race data for character size lookup
        races_data = get_races_data()
        race_size_map = {r["id"]: SIZE_CN_TO_IDX.get(r.get("size", "中型"), DEFAULT_SIZE_IDX)
                         for r in races_data.get("races", [])}

        for tid in req.target_token_ids:
            t = await db.get(Token, tid)
            if not t:
                continue
            # Determine current D&D size index from actual creature data
            cur_idx = GRID_TO_SIZE_IDX.get(t.token_size, DEFAULT_SIZE_IDX)
            if t.character_id:
                char = await db.get(Character, t.character_id)
                if char and char.race_id:
                    cur_idx = race_size_map.get(char.race_id, DEFAULT_SIZE_IDX)
            elif t.monster_instance_id:
                mi = await db.get(MonsterInstance, t.monster_instance_id)
                if mi and mi.size:
                    cur_idx = SIZE_CN_TO_IDX.get(mi.size, DEFAULT_SIZE_IDX)

            new_idx = max(0, min(len(SIZE_KEYS) - 1, cur_idx + delta))
            new_grid = SIZE_GRIDS[new_idx]

            transform_data = {
                "source": {
                    "config_id": req.spell_id,
                    "source_type": "spell",
                    "spell_id": req.spell_id,
                    "spell_name": effect_label,
                    "caster_name": caster_name,
                },
                "type": "modifier",
                "activeMode": req.selected_option,
                "original_size": SIZE_CN[cur_idx],
                "size": SIZE_CN[new_idx],
                "modifiers": [
                    {"stat": "size", "operation": "increase" if delta > 0 else "decrease", "value": abs(delta)},
                    {"stat": "weapon_damage", "value": "1d4" if delta > 0 else "-1d4"},
                ],
                "started_at": None,
            }
            t.transformation_data = transform_data
            t.token_size = new_grid
            flag_modified(t, "transformation_data")
            transformation_updates.append({
                "token_id": tid,
                "transformation_data": transform_data,
                "token_size": new_grid,
            })

    # 8d-pre. Destroy Undead post-processing for Turn Undead
    destroy_undead_token_ids: list[int] = []
    if req.spell_id == "turn_undead" and caster_level >= 5:
        destroy_cr = (
            4.0 if caster_level >= 17 else
            3.0 if caster_level >= 14 else
            2.0 if caster_level >= 11 else
            1.0 if caster_level >= 8 else
            0.5
        )
        for phase_res in result.phase_results:
            for er in phase_res:
                if not er.condition_applied:
                    continue  # only targets that failed save
                tid = er.target_token_id
                if not tid:
                    continue
                t = await db.get(Token, tid)
                if not t or not t.monster_instance_id:
                    continue
                mi = await db.get(MonsterInstance, t.monster_instance_id)
                if not mi:
                    continue
                monster_cr = _parse_cr(mi.challenge_rating)
                if monster_cr <= destroy_cr:
                    t.current_hp = 0
                    flag_modified(t, "current_hp")
                    destroy_undead_token_ids.append(tid)

    # 8d-pre2. Radiance of the Dawn: dispel darkness spells within 30ft of caster
    dispelled_darkness_updates: list[dict] = []
    if req.spell_id == "radiance_of_the_dawn":
        from app.services.aura_service import calculate_distance
        all_tokens_result = await db.execute(
            select(Token).where(
                Token.campaign_id == req.campaign_id,
                Token.map_url == caster_token.map_url,
            )
        )
        for candidate in all_tokens_result.scalars().all():
            conc = candidate.concentration_spell or {}
            conc_spell_id = str(conc.get("spell_id") or "").strip().lower()
            if not spell_has_illumination_type(get_spell_by_id(conc_spell_id), "darkness"):
                continue
            if calculate_distance(caster_token, candidate) > 30:
                continue
            candidate.concentration_spell = None
            flag_modified(candidate, "concentration_spell")
            existing_effects = list(candidate.active_effects or [])
            filtered_effects = [
                e for e in existing_effects
                if not (
                    e.get("spell_buff")
                    and spell_has_illumination_type(
                        get_spell_by_id(str(e.get("spell_id") or "").strip().lower()),
                        "darkness",
                    )
                )
            ]
            effects_changed = len(filtered_effects) != len(existing_effects)
            if effects_changed:
                candidate.active_effects = filtered_effects or None
                flag_modified(candidate, "active_effects")
            dispelled_darkness_updates.append({
                "token_id": candidate.id,
                "effects_changed": effects_changed,
                "active_effects": filtered_effects,
            })

    await db.commit()

    for linked_token_id in removed_old_linked_token_ids:
        await realtime_publisher.publish_map_token_removed(
            req.campaign_id,
            token_id=linked_token_id,
        )

    # Broadcast transformation updates for size-changing spells
    for tu in transformation_updates:
        await realtime_publisher.publish_transformation_updated(
            req.campaign_id,
            token_id=tu["token_id"],
            transformation_data=tu["transformation_data"],
            token_size=tu["token_size"],
        )

    # 8d. Deduct spell slot from caster's character (if not freecast / cantrip)
    if not req.freecast and not req.ritual_cast and req.slot_level > 0 and caster_character:
        consumed, next_spell_slots_state = _consume_character_spell_slot(caster_character, req.slot_level)
        if consumed:
            await db.commit()
            await realtime_publisher.publish_spell_slots_updated(
                req.campaign_id,
                character_id=caster_character.id,
                spell_slots_state=next_spell_slots_state,
            )

    # 8e. Consume material component (if spell consumes material)
    if req.material_id and spell_data.get("materialConsumed") and caster_token.character_id:
        char = await db.get(Character, caster_token.character_id)
        if char and char.equipment:
            equipment = list(char.equipment)
            new_equipment = []
            consumed = False
            for item in equipment:
                if not consumed and item.get("id") == req.material_id:
                    qty = (item.get("quantity") or 1) - 1
                    if qty > 0:
                        new_equipment.append({**item, "quantity": qty})
                    # qty <= 0 → item removed
                    consumed = True
                else:
                    new_equipment.append(item)
            if consumed:
                normalized_equipment = normalize_character_equipment(new_equipment, strict=True)
                char.equipment = normalized_equipment
                flag_modified(char, "equipment")
                await db.commit()
                await realtime_publisher.publish_character_equipment_updated(
                    req.campaign_id,
                    character_id=caster_token.character_id,
                    equipment=normalized_equipment,
                )

    # 9. Build narrative
    narrative_parts = []
    all_results = []
    for phase_res in result.phase_results:
        for er in phase_res:
            all_results.append(er.model_dump())
            if er.damage_dealt > 0:
                narrative_parts.append(f"{er.target_name} 受到 {er.damage_dealt} 点伤害")
            if er.healing_done > 0:
                narrative_parts.append(f"{er.target_name} 恢复 {er.healing_done} 点生命")
            if er.temp_hp_granted > 0:
                narrative_parts.append(f"{er.target_name} 获得 {er.temp_hp_granted} 点临时生命值")
            if er.condition_applied:
                narrative_parts.append(f"{er.target_name} 进入{er.condition_applied}状态")
            if er.condition_immune:
                narrative_parts.append(er.description or "")
            if er.type in ("modify_stat", "modify_roll", "grant_resistance", "grant_advantage") and er.description:
                narrative_parts.append(er.description)
            if er.type == "generate_item" and er.description:
                narrative_parts.append(er.description)
    narrative = "；".join(p for p in narrative_parts if p) or f"{caster_name} 施放了 {spell_data.get('name', '')}"

    duration_hint = _build_duration_hint(spell_data, in_combat)

    # 10. Broadcast spell result
    items_generated_data = [
        {"item_name": g["item"]["name"], "character_id": g["character_id"]}
        for g in result.items_generated
    ]
    broadcast_data = {
        "caster_name": caster_name,
        "caster_token_id": req.caster_token_id,
        "spell_id": req.spell_id,
        "spell_name": spell_data.get("name", ""),
        "slot_level": req.slot_level,
        "in_combat": in_combat,
        "duration_hint": duration_hint,
        "results": all_results,
        "total_damage": result.total_damage,
        "total_healing": result.total_healing,
        "concentration_set": concentration_set,
        "affected_token_ids": req.target_token_ids,
        "narrative": narrative,
        "items_generated": items_generated_data,
    }
    await realtime_publisher.publish_spell_cast_result(
        req.campaign_id,
        data=broadcast_data,
    )

    # 10a2. Broadcast equipment update for each character that received generated items
    for gen_info in result.items_generated:
        char_id = gen_info["character_id"]
        char_obj = await db.get(Character, char_id)
        if char_obj:
            await realtime_publisher.publish_character_equipment_updated(
                req.campaign_id,
                character_id=char_id,
                equipment=char_obj.equipment,
            )

    # 10b. Broadcast concentration update so frontend syncs concentration bar
    if concentration_set:
        conc_broadcast: dict = {
            "token_id": req.caster_token_id,
            "concentration_spell": caster_token.concentration_spell,
            "active_effects": caster_token.active_effects or [],
        }
        if old_spell_id:
            conc_broadcast["replaced_spell"] = old_spell_id
        await realtime_publisher.publish_token_concentration_updated(
            req.campaign_id,
            **conc_broadcast,
        )

    # 10c. Broadcast token_hp_update for each target whose HP/temp_hp changed
    hp_changed_tokens: set[int] = set()
    for phase in result.phase_results:
        for er in phase:
            if er.target_token_id and (
                er.damage_dealt > 0 or er.healing_done > 0 or er.temp_hp_granted > 0
            ):
                hp_changed_tokens.add(er.target_token_id)
    for tid in hp_changed_tokens:
        # Expire cached ORM state so we get the updated HP from DB
        token = await db.get(Token, tid)
        if token:
            await db.refresh(token)
        if token and token.current_hp is not None:
            hp_change = sum(
                er.healing_done - er.damage_dealt
                for phase in result.phase_results
                for er in phase if er.target_token_id == tid
            )
            await realtime_publisher.publish_token_hp_updated(
                req.campaign_id,
                token_id=token.id,
                current_hp=token.current_hp,
                temp_hp=token.temp_hp or 0,
                hp_change=hp_change,
                target_defeated=token.current_hp <= 0,
            )
            if token.current_hp <= 0:
                await notify_target_downed(
                    db,
                    campaign_id=req.campaign_id,
                    target_token_id=token.id,
                )

    # 10c-2. Broadcast HP=0 for Destroy Undead targets
    for tid in destroy_undead_token_ids:
        if tid in hp_changed_tokens:
            continue  # already broadcast above
        token = await db.get(Token, tid)
        if token:
            await db.refresh(token)
            # Token has no max_hp column; resolve the destroyed creature's max HP
            # from its monster instance (the only source here) for the damage-number
            # broadcast. Fall back to the token's current_hp so we never crash.
            destroyed_max_hp = token.current_hp or 0
            if token.monster_instance_id:
                mi = await db.get(MonsterInstance, token.monster_instance_id)
                if mi and mi.hit_points:
                    destroyed_max_hp = mi.hit_points
            await realtime_publisher.publish_token_hp_updated(
                req.campaign_id,
                token_id=token.id,
                current_hp=0,
                temp_hp=0,
                hp_change=-destroyed_max_hp,
                target_defeated=True,
            )
            await notify_target_downed(
                db,
                campaign_id=req.campaign_id,
                target_token_id=token.id,
            )

    # 10c-3. Broadcast darkness dispelling for Radiance of the Dawn
    for entry in dispelled_darkness_updates:
        await realtime_publisher.publish_token_concentration_updated(
            req.campaign_id,
            token_id=entry["token_id"],
            concentration_spell=None,
        )
        if entry["effects_changed"]:
            await realtime_publisher.publish_token_active_effects_updated(
                req.campaign_id,
                token_id=entry["token_id"],
                active_effects=entry["active_effects"],
            )

    # 11. Broadcast active_effects update for each affected token
    affected_ids = set(req.target_token_ids)
    affected_ids.add(req.caster_token_id)
    affected_ids.update(dismissed_token_ids)
    affected_ids.update(result.concentration_broken_token_ids)
    for tid in affected_ids:
        token = await db.get(Token, tid)
        if token and token.active_effects is not None:
            await realtime_publisher.publish_token_active_effects_updated(
                req.campaign_id,
                token_id=token.id,
                active_effects=token.active_effects,
            )

    # 11b. Broadcast concentration_update for casters whose concentration was broken
    for caster_tid in result.concentration_broken_token_ids:
        caster_t = await db.get(Token, caster_tid)
        if caster_t:
            await realtime_publisher.publish_token_concentration_updated(
                req.campaign_id,
                token_id=caster_tid,
                concentration_spell=caster_t.concentration_spell,
                reason="dispelled",
                active_effects=caster_t.active_effects or [],
            )

    for caster_tid in result.concentration_touched_token_ids:
        if caster_tid in result.concentration_broken_token_ids:
            continue
        caster_t = await db.get(Token, caster_tid)
        if caster_t:
            await realtime_publisher.publish_token_concentration_updated(
                req.campaign_id,
                token_id=caster_tid,
                concentration_spell=caster_t.concentration_spell,
                active_effects=caster_t.active_effects or [],
            )

    for token_id in disguise_updated_token_ids:
        token = await db.get(Token, token_id)
        if token:
            await realtime_publisher.publish_token_disguise_updated(
                req.campaign_id,
                token_id=token.id,
                disguise_data=token.disguise_data,
                active_effects=token.active_effects,
            )

    # Self-teleport (Misty Step): TeleportHandler wrote the new position on
    # the caster token via destination context. Broadcast so other clients
    # update their map state — no other route fires for this teleport path.
    if req.teleport_destination and caster_token:
        await realtime_publisher.publish_token_moved(
            req.campaign_id,
            token_id=caster_token.id,
            position_x=caster_token.position_x,
            position_y=caster_token.position_y,
        )

    if runtime_instance:
        touched_token_ids = [
            req.caster_token_id,
            *req.target_token_ids,
            *old_runtime_touched_token_ids,
            *result.runtime_touched_token_ids,
        ]
        await publish_runtime_projection_updates(
            db,
            campaign_id=req.campaign_id,
            token_ids=sorted({token_id for token_id in touched_token_ids if token_id}),
        )
    elif old_runtime_touched_token_ids or result.runtime_touched_token_ids:
        await publish_runtime_projection_updates(
            db,
            campaign_id=req.campaign_id,
            token_ids=sorted({
                *old_runtime_touched_token_ids,
                *result.runtime_touched_token_ids,
            }),
        )
    if old_runtime_touched_token_ids or result.runtime_touched_token_ids:
        await _sync_token_aura_runtime(
            db,
            token_ids=[
                *old_runtime_touched_token_ids,
                *result.runtime_touched_token_ids,
            ],
        )

    return SpellCastResponse(
        success=True,
        spell_id=req.spell_id,
        spell_name=spell_data.get("name", ""),
        caster_token_id=req.caster_token_id,
        in_combat=in_combat,
        duration_hint=duration_hint,
        total_damage=result.total_damage,
        total_healing=result.total_healing,
        concentration_set=concentration_set,
        results=all_results,
        affected_token_ids=req.target_token_ids,
        destroyed_token_ids=destroy_undead_token_ids,
        dispelled_darkness_count=len(dispelled_darkness_updates),
        narrative=narrative,
        items_generated=items_generated_data,
    )


@router.post("/runtime-actions/execute", response_model=RuntimeActionExecuteResponse)
async def execute_spell_runtime_action(
    req: RuntimeActionExecuteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    instance = await db.get(SpellRuntimeInstance, req.runtime_instance_id)
    if not instance:
        raise HTTPException(404, "Spell runtime instance not found")

    await check_campaign_member(instance.campaign_id, current_user, db)

    try:
        updated_instance, touched_token_ids = await execute_runtime_action(
            db,
            runtime_instance_id=req.runtime_instance_id,
            action_id=req.action_id,
            actor_token_id=req.actor_token_id,
            target_token_id=req.target_token_id,
        )
    except ValueError as exc:
        return RuntimeActionExecuteResponse(
            success=False,
            runtime_instance_id=req.runtime_instance_id,
            error=str(exc),
        )
    await _sync_token_aura_runtime(db, token_ids=touched_token_ids)

    return RuntimeActionExecuteResponse(
        success=True,
        runtime_instance_id=updated_instance.id,
        touched_token_ids=touched_token_ids,
    )


# Dispel Evil and Good "Break Enchantment" defaults to cleansing charm / fear /
# possession when the persisted grant entry carries no explicit condition list.
_DEFAULT_REMOVABLE_CONDITIONS = ("charmed", "frightened", "possessed")


def _grant_entry_removable_conditions(entry: Dict[str, Any]) -> list[str]:
    """Removable condition keywords for a `remove_condition` grant. Honor an
    explicit list on the persisted entry (`conditions` / `removable_conditions`)
    if present, else fall back to the Dispel Evil and Good defaults."""
    for key in ("conditions", "removable_conditions"):
        raw = entry.get(key)
        if isinstance(raw, list) and raw:
            cleaned = [str(c).strip().lower() for c in raw if str(c).strip()]
            if cleaned:
                return cleaned
    return list(_DEFAULT_REMOVABLE_CONDITIONS)


def _effect_matches_removable_condition(
    effect: Dict[str, Any], keywords: list[str]
) -> bool:
    """True when an active_effect is a removable condition. The entry must look
    like a condition (`effect_type == "condition"` or a truthy `condition`
    field) so unrelated buffs are never stripped; a keyword then matches its
    `condition` / `name` / `id` by substring, tolerating QA-seeded ids like
    `qa_charmed_by_undead`."""
    if not isinstance(effect, dict):
        return False
    is_condition_like = (
        effect.get("effect_type") == "condition" or bool(effect.get("condition"))
    )
    if not is_condition_like:
        return False
    haystacks = [
        str(effect.get("condition") or "").lower(),
        str(effect.get("name") or "").lower(),
        str(effect.get("id") or "").lower(),
    ]
    return any(kw and kw in hay for kw in keywords for hay in haystacks if hay)


async def _execute_remove_condition_granted_action(
    db: AsyncSession,
    *,
    caster_token: Token,
    entry: Dict[str, Any],
    target_token_id: int,
) -> GrantedActionExecuteResponse:
    """Resolve a `remove_condition` granted action (Dispel Evil and Good
    "Break Enchantment"): strip charm / fear / possession style conditions from
    the chosen target. Freecast — no slot, no new runtime instance.

    Per the spell text ("使用后法术结束"), a *successful* removal also ends the
    source concentration: the caster's `concentration_spell` is cleared and its
    concentration-bound caster effects (visual buff + this grant action) are
    dropped. A no-match / wrong-target click is a no-op and must NOT end the
    spell."""
    target_token = await db.get(Token, target_token_id)
    if not target_token:
        return GrantedActionExecuteResponse(success=False, error="目标 token 不存在")

    keywords = _grant_entry_removable_conditions(entry)
    before = list(target_token.active_effects or [])
    after = [
        e for e in before if not _effect_matches_removable_condition(e, keywords)
    ]
    removed = len(before) - len(after)

    spell_name = entry.get("source") or entry.get("name") or entry.get("spell_id")
    action_name = entry.get("action_name") or spell_name
    caster_name = caster_token.instance_name or "施法者"
    target_name = target_token.instance_name or "目标"

    if removed:
        target_token.active_effects = after
        flag_modified(target_token, "active_effects")

        # "使用后法术结束" — end this grant's source concentration on a real
        # removal only. Reuse `_is_replaced_concentration_effect` (the same
        # predicate the cast-replace flow uses) to drop the caster's
        # concentration-bound effects for that spell (visual buff + this grant
        # action).
        source_spell_id = (
            entry.get("spell_id") or entry.get("spellId") or entry.get("sourceSpell")
        )
        conc = (
            caster_token.concentration_spell
            if isinstance(caster_token.concentration_spell, dict)
            else None
        )
        conc_spell_id = (
            conc.get("spell_id") or conc.get("spellId") or conc.get("sourceSpell")
            if conc
            else None
        )
        ended_concentration: Optional[Dict[str, Any]] = None
        caster_effects_changed = False
        if source_spell_id and conc_spell_id == source_spell_id:
            ended_concentration = conc
            caster_token.concentration_spell = None
            flag_modified(caster_token, "concentration_spell")
            caster_effects = caster_token.active_effects or []
            kept_effects = [
                e
                for e in caster_effects
                if not _is_replaced_concentration_effect(
                    e, source_spell_id, caster_token.id
                )
            ]
            if len(kept_effects) != len(caster_effects):
                caster_token.active_effects = kept_effects
                flag_modified(caster_token, "active_effects")
                caster_effects_changed = True

        await db.commit()
        await realtime_publisher.publish_token_active_effects_updated(
            caster_token.campaign_id,
            token_id=target_token.id,
            active_effects=target_token.active_effects or [],
        )
        if ended_concentration is not None:
            await realtime_publisher.publish_token_concentration_updated(
                caster_token.campaign_id,
                token_id=caster_token.id,
                concentration_spell=None,
                reason="spell_consumed_by_action",
                broken_spell=ended_concentration,
                active_effects=caster_token.active_effects or [],
            )
            if caster_effects_changed:
                await realtime_publisher.publish_token_active_effects_updated(
                    caster_token.campaign_id,
                    token_id=caster_token.id,
                    active_effects=caster_token.active_effects or [],
                )
        narrative = (
            f"{caster_name} 使用 {action_name}，解除了 {target_name} 身上的 {removed} 个状态"
        )
    else:
        narrative = f"{caster_name} 使用 {action_name}，但 {target_name} 没有可解除的状态"

    affected_token_ids = [target_token.id] if removed else []
    await realtime_publisher.publish_spell_cast_result(
        caster_token.campaign_id,
        data={
            "spell_id": entry.get("spell_id"),
            "spell_name": spell_name,
            "action_name": action_name,
            "caster_token_id": caster_token.id,
            "total_damage": 0,
            "total_healing": 0,
            "affected_token_ids": affected_token_ids,
            "narrative": narrative,
        },
    )

    return GrantedActionExecuteResponse(
        success=True,
        spell_name=spell_name,
        action_name=action_name,
        total_damage=0,
        total_healing=0,
        affected_token_ids=affected_token_ids,
        narrative=narrative,
    )


@router.post("/granted-actions/execute", response_model=GrantedActionExecuteResponse)
async def execute_granted_action(
    req: GrantedActionExecuteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Execute a backend-persisted `grant_action` entry on the caster's
    `active_effects` (e.g. Witch Bolt repeat damage). Action-only freecast:
    skips slot consumption, concentration reset, and runtime-instance
    creation; reuses `SpellResolver` so resistance / immunity / pending
    damage hooks remain in effect."""
    await check_campaign_member(req.campaign_id, current_user, db)

    caster_token = await db.get(Token, req.caster_token_id)
    if not caster_token:
        raise HTTPException(404, "Caster token not found")
    if caster_token.campaign_id != req.campaign_id:
        raise HTTPException(403, "Caster token does not belong to this campaign")

    entry = _find_active_effect_grant_action(
        caster_token.active_effects,
        effect_id=req.effect_id,
        spell_id=req.spell_id,
        action_kind=req.action_kind,
        action_name=req.action_name,
    )
    if not entry:
        return GrantedActionExecuteResponse(
            success=False,
            error="施法者没有这个法术动作",
        )

    # Non-damage action kinds branch off before the damage-only path.
    # `remove_condition` (Dispel Evil and Good "Break Enchantment") cleanses
    # charm / fear / possession from the chosen target and carries no damage
    # metadata, so it must not fall through to the damage-formula requirement.
    entry_action_kind = entry.get("action_kind") or req.action_kind
    if entry_action_kind == "remove_condition":
        return await _execute_remove_condition_granted_action(
            db,
            caster_token=caster_token,
            entry=entry,
            target_token_id=req.target_token_id,
        )

    # Locked target enforcement — Witch Bolt persists `target_token_id` so
    # only the original target can be re-hit.
    locked_target_id = entry.get("target_token_id")
    if isinstance(locked_target_id, int) and locked_target_id != req.target_token_id:
        return GrantedActionExecuteResponse(
            success=False,
            error="该法术动作只能对原始目标使用",
        )

    damage_block = entry.get("damage") or {}
    formula = damage_block.get("formula")
    damage_type = damage_block.get("damage_type") or damage_block.get("damageType") or "force"
    if not formula:
        return GrantedActionExecuteResponse(
            success=False,
            error="该法术动作没有可执行的伤害定义",
        )

    target_token = await db.get(Token, req.target_token_id)
    if not target_token:
        raise HTTPException(404, "Target token not found")
    if target_token.campaign_id != req.campaign_id:
        raise HTTPException(403, "Target token does not belong to this campaign")

    spell_id = entry.get("spell_id") or req.spell_id or ""
    source_spell_data = get_spell_by_id(spell_id) if spell_id else None
    spell_name = (
        (source_spell_data or {}).get("name")
        or entry.get("source")
        or entry.get("name")
        or spell_id
    )
    action_name = entry.get("action_name") or spell_name

    # Build caster context (no slot consumption; spell_save_dc / attack
    # bonus mirror the standard cast path so DC-based hooks still apply).
    caster_name = caster_token.instance_name or "施法者"
    caster_level = 1
    spellcasting_mod = 0
    prof_bonus = 2
    spell_save_dc = 8
    spell_attack_bonus = 0
    caster_class_id = None
    caster_subclass_id = None
    caster_ability_scores: Dict[str, int] = {}
    if caster_token.character_id:
        caster_character = await db.get(Character, caster_token.character_id)
        if caster_character:
            caster_name = caster_character.name or caster_name
            caster_level = caster_character.level or 1
            caster_class_id = caster_character.class_id
            caster_subclass_id = caster_character.subclass_id
            caster_ability_scores = caster_character.ability_scores or {}
            prof_bonus = calculate_proficiency_bonus(caster_level)
            ability = CLASS_SPELLCASTING_ABILITY.get(caster_class_id or "", "intelligence")
            score = caster_ability_scores.get(ability, 10)
            spellcasting_mod = calculate_ability_modifier(score)
            spell_save_dc = 8 + prof_bonus + spellcasting_mod
            spell_attack_bonus = prof_bonus + spellcasting_mod

    in_combat = await _check_in_combat(db, req.campaign_id)
    current_time = await _get_campaign_time(db, req.campaign_id)

    # Carry the source spell's rules-data level so cantrip-only damage
    # passives (e.g. Potent Cantrip) do not fire on a level-1 follow-up.
    # Falls back to 0 when rules data is missing.
    raw_source_level = (source_spell_data or {}).get("level")
    try:
        source_spell_level = int(raw_source_level) if raw_source_level is not None else 0
    except (TypeError, ValueError):
        source_spell_level = 0

    # Preserve the grant entry's own attack / save metadata so the follow-up
    # action reproduces its source spell's resolution: Spiritual Weapon
    # (action_kind="attack") rolls a spell attack and only deals damage on a
    # hit; Call Lightning (action_kind="save_damage") rolls a DEX save and
    # honors on_success. Witch Bolt (repeat_damage) has neither → direct hit.
    grant_attack = entry.get("attack") if isinstance(entry.get("attack"), dict) else None
    grant_save = entry.get("save") if isinstance(entry.get("save"), dict) else None

    synthetic_spell_data = _build_synthetic_damage_spell_data(
        spell_id=spell_id,
        spell_name=spell_name,
        action_name=action_name,
        damage_formula=str(formula),
        damage_type=str(damage_type),
        spell_level=source_spell_level,
        attack=grant_attack,
        save=grant_save,
    )

    ctx = SpellContext(
        caster_token_id=req.caster_token_id,
        caster_name=caster_name,
        caster_level=caster_level,
        caster_class_id=caster_class_id,
        caster_subclass_id=caster_subclass_id,
        caster_ability_scores=caster_ability_scores,
        spellcasting_mod=spellcasting_mod,
        proficiency_bonus=prof_bonus,
        spell_save_dc=spell_save_dc,
        spell_attack_bonus=spell_attack_bonus,
        spell_level=source_spell_level,
        slot_level=0,
        spell_id=spell_id,
        spell_name=spell_name,
        concentration=False,
        campaign_id=req.campaign_id,
        in_combat=in_combat,
        current_world_time=current_time,
    )

    target_info = await _build_target_info(target_token, db)

    resolver = SpellResolver()
    result = await resolver.resolve(synthetic_spell_data, ctx, [target_info], db)
    if result is None:
        return GrantedActionExecuteResponse(
            success=False,
            error="该法术动作没有可执行的效果",
        )

    await db.commit()

    all_results = [er.model_dump() for phase in result.phase_results for er in phase]
    narrative_parts: List[str] = []
    for er in (er for phase in result.phase_results for er in phase):
        if er.damage_dealt > 0:
            narrative_parts.append(f"{er.target_name} 受到 {er.damage_dealt} 点伤害")
    narrative = "；".join(p for p in narrative_parts if p) or f"{caster_name} 使用了 {action_name}"

    broadcast_data = {
        "caster_name": caster_name,
        "caster_token_id": req.caster_token_id,
        "spell_id": spell_id,
        "spell_name": spell_name,
        "slot_level": 0,
        "in_combat": in_combat,
        "results": all_results,
        "total_damage": result.total_damage,
        "total_healing": result.total_healing,
        "concentration_set": False,
        "affected_token_ids": [req.target_token_id],
        "narrative": narrative,
        "items_generated": [],
        "granted_action": True,
        "action_name": action_name,
    }
    await realtime_publisher.publish_spell_cast_result(
        req.campaign_id,
        data=broadcast_data,
    )

    # Refresh the target token so the broadcast carries the post-resolver HP.
    await db.refresh(target_token)
    if target_token.current_hp is not None and result.total_damage > 0:
        await realtime_publisher.publish_token_hp_updated(
            req.campaign_id,
            token_id=target_token.id,
            current_hp=target_token.current_hp,
            temp_hp=target_token.temp_hp or 0,
            hp_change=-result.total_damage,
            target_defeated=target_token.current_hp <= 0,
        )
        if target_token.current_hp <= 0:
            await notify_target_downed(
                db,
                campaign_id=req.campaign_id,
                target_token_id=target_token.id,
            )

    return GrantedActionExecuteResponse(
        success=True,
        spell_name=spell_name,
        action_name=action_name,
        total_damage=result.total_damage,
        total_healing=result.total_healing,
        results=all_results,
        narrative=narrative,
        affected_token_ids=[req.target_token_id],
    )


@router.delete("/runtime-instances/{runtime_instance_id}", response_model=RuntimeInstanceEndResponse)
async def delete_spell_runtime_instance(
    runtime_instance_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    instance = await db.get(SpellRuntimeInstance, runtime_instance_id)
    if not instance:
        raise HTTPException(404, "Spell runtime instance not found")

    await check_campaign_member(instance.campaign_id, current_user, db)

    try:
        updated_instance, touched_token_ids = await end_runtime_instance(
            db,
            runtime_instance_id=runtime_instance_id,
        )
    except ValueError as exc:
        return RuntimeInstanceEndResponse(
            success=False,
            runtime_instance_id=runtime_instance_id,
            error=str(exc),
        )
    await _sync_token_aura_runtime(db, token_ids=touched_token_ids)

    return RuntimeInstanceEndResponse(
        success=True,
        runtime_instance_id=updated_instance.id,
        touched_token_ids=touched_token_ids,
    )


@router.post("/start-cast", response_model=StartSpellCastResponse)
async def start_spell_cast(
    req: StartSpellCastRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    await check_campaign_member(req.campaign_id, current_user, db)
    spell_data = get_spell_by_id(req.spell_id)
    if not spell_data:
        raise HTTPException(404, f"Spell not found: {req.spell_id}")

    caster_token = await db.get(Token, req.caster_token_id)
    if not caster_token:
        raise HTTPException(404, "Caster token not found")

    if caster_token.casting_in_progress:
        return StartSpellCastResponse(
            success=False,
            spell_name=spell_data.get("name", req.spell_id),
            error="该角色已经在施法中",
        )

    parsed = _parse_casting_time(spell_data.get("castingTime", "1 action"))
    total_seconds = parsed["seconds"] + (600 if req.ritual_cast else 0)
    if total_seconds < 60:
        return StartSpellCastResponse(
            success=False,
            spell_name=spell_data.get("name", req.spell_id),
            error="该法术不需要长时间施法，请走普通施法流程",
        )

    if req.ritual_cast and not spell_data.get("ritual"):
        return StartSpellCastResponse(
            success=False,
            spell_name=spell_data.get("name", req.spell_id),
            error="该法术不能以仪式施放",
        )

    if req.slot_level > 0 and not req.freecast and not req.ritual_cast and caster_token.character_id:
        caster_character = await db.get(Character, caster_token.character_id)
        if caster_character and not _has_available_spell_slot(caster_character, req.slot_level):
            return StartSpellCastResponse(
                success=False,
                spell_name=spell_data.get("name", req.spell_id),
                error=f"没有可用的{req.slot_level}环法术位",
            )

    if caster_token.concentration_spell and not req.confirm_break_concentration:
        return StartSpellCastResponse(
            success=False,
            requires_confirmation=True,
            confirmation_reason="casting_requires_concentration",
            spell_name=spell_data.get("name", req.spell_id),
        )

    if caster_token.concentration_spell:
        await _break_concentration_for_new_cast(caster_token, db, reason="casting_started")

    current_time = await _get_campaign_time(db, req.campaign_id)
    casting_state = _build_casting_state(spell_data, req, current_time, str(current_user["user_id"]))
    caster_token.casting_in_progress = normalize_token_casting_in_progress(casting_state, strict=True)
    flag_modified(caster_token, "casting_in_progress")
    await db.commit()
    await db.refresh(caster_token)

    await _broadcast_casting_update(caster_token, reason="started")
    return StartSpellCastResponse(
        success=True,
        spell_name=spell_data.get("name", req.spell_id),
        casting_in_progress=casting_state,
    )


@router.delete("/cast/{token_id}")
async def cancel_spell_cast(
    token_id: int,
    db: AsyncSession = Depends(get_db),
):
    token = await db.get(Token, token_id)
    if not token:
        raise HTTPException(404, "Token not found")

    if not token.casting_in_progress:
        return {"success": True, "message": "No active casting"}

    broken = token.casting_in_progress
    token.casting_in_progress = None
    flag_modified(token, "casting_in_progress")
    await db.commit()

    await realtime_publisher.publish_token_casting_interrupted(
        token.campaign_id,
        token_id=token.id,
        casting_in_progress=None,
        broken_cast=broken,
        reason="cancelled",
    )
    await _broadcast_casting_update(token, reason="cancelled")
    return {"success": True}


@router.post("/complete-cast-now")
async def complete_spell_cast_now(
    req: StartSpellCastRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    await check_campaign_member(req.campaign_id, current_user, db)
    campaign = await db.get(Campaign, req.campaign_id)
    if not campaign or campaign.dm_user_id != current_user["user_id"]:
        raise HTTPException(403, "Only the DM can instantly complete long casts")

    caster_token = await db.get(Token, req.caster_token_id)
    if not caster_token or not caster_token.casting_in_progress:
        raise HTTPException(404, "No active casting to complete")

    casting = dict(caster_token.casting_in_progress)
    if casting.get("status") == "ready":
        raise HTTPException(400, "该法术已完成准备，请先选择目标或区域后释放")
    resolve_as_freecast = (
        req.freecast
        or bool(casting.get("freecast"))
        or casting.get("cast_mode") == "ritual"
    )
    caster_token.casting_in_progress = None
    flag_modified(caster_token, "casting_in_progress")
    await db.commit()

    spell_data = get_spell_by_id(req.spell_id)
    if spell_data and (spell_data.get("effects") or spell_data.get("castOptions")):
        result = await cast_spell(
            SpellCastRequest(
                spell_id=req.spell_id,
                slot_level=req.slot_level,
                caster_token_id=req.caster_token_id,
                target_token_ids=req.target_token_ids or casting.get("target_token_ids") or [req.caster_token_id],
                campaign_id=req.campaign_id,
                freecast=resolve_as_freecast,
                ritual_cast=casting.get("cast_mode") == "ritual",
                selected_option=req.selected_option or casting.get("selected_option"),
                material_id=req.material_id or casting.get("material_id"),
            ),
            db,
        )
        payload = result.model_dump()
    else:
        payload = {
            "success": True,
            "spell_name": spell_data.get("name", req.spell_id) if spell_data else req.spell_id,
            "narrative": f"{caster_token.instance_name or '施法者'} 完成了 {casting.get('spell_name', req.spell_id)}",
        }

    refreshed = await db.get(Token, req.caster_token_id)
    if refreshed:
        await _broadcast_casting_update(refreshed, reason="completed")
    await realtime_publisher.publish_token_casting_completed(
        req.campaign_id,
        token_id=req.caster_token_id,
        spell_id=req.spell_id,
        spell_name=casting.get("spell_name", req.spell_id),
        result=payload,
    )
    return payload


async def resolve_due_casts_for_campaign(
    db: AsyncSession,
    campaign_id: int,
    current_time: Dict[str, Any],
) -> List[Dict[str, Any]]:
    normalized_time = _normalize_campaign_time(current_time)
    now_seconds = _campaign_time_to_seconds(normalized_time)
    result = await db.execute(select(Token).where(Token.campaign_id == campaign_id))
    tokens = result.scalars().all()

    completed: List[Dict[str, Any]] = []
    for token in tokens:
        casting = token.casting_in_progress
        if not casting:
            continue
        finish_at = casting.get("finish_at_campaign")
        if not finish_at or _campaign_time_to_seconds(finish_at) > now_seconds:
            continue
        if casting.get("status") == "ready":
            continue

        spell_id = casting.get("spell_id")
        spell_data = get_spell_by_id(spell_id)
        if spell_data and _spell_requires_manual_release(spell_data, casting):
            casting["status"] = "ready"
            token.casting_in_progress = normalize_token_casting_in_progress(casting, strict=True)
            flag_modified(token, "casting_in_progress")
            await db.commit()
            await db.refresh(token)
            await _broadcast_casting_update(token, reason="ready")
            completed.append({"token_id": token.id, "spell_id": spell_id, "status": "ready"})
            continue

        token.casting_in_progress = None
        flag_modified(token, "casting_in_progress")
        await db.commit()
        resolve_as_freecast = bool(casting.get("freecast")) or casting.get("cast_mode") == "ritual"

        if spell_data and (spell_data.get("effects") or spell_data.get("castOptions")):
            cast_result = await cast_spell(
                SpellCastRequest(
                    spell_id=spell_id,
                    slot_level=int(casting.get("slot_level") or 0),
                    caster_token_id=token.id,
                    target_token_ids=casting.get("target_token_ids") or [token.id],
                    campaign_id=campaign_id,
                    freecast=resolve_as_freecast,
                    ritual_cast=casting.get("cast_mode") == "ritual",
                    selected_option=casting.get("selected_option"),
                    material_id=casting.get("material_id"),
                ),
                db,
            )
            payload = cast_result.model_dump()
        else:
            payload = {
                "success": True,
                "spell_name": casting.get("spell_name", spell_id),
                "narrative": f"{token.instance_name or '施法者'} 完成了 {casting.get('spell_name', spell_id)}",
            }

        updated_token = await db.get(Token, token.id)
        if updated_token:
            await _broadcast_casting_update(updated_token, reason="completed")
        await realtime_publisher.publish_token_casting_completed(
            campaign_id,
            token_id=token.id,
            spell_id=spell_id,
            spell_name=casting.get("spell_name", spell_id),
            result=payload,
        )
        completed.append({"token_id": token.id, "spell_id": spell_id, "result": payload})

    return completed


@router.post("/resolve-due-casts")
async def resolve_due_casts(
    req: ResolveDueCastsRequest,
    db: AsyncSession = Depends(get_db),
):
    completed = await resolve_due_casts_for_campaign(db, req.campaign_id, req.current_time)
    return {"success": True, "completed": completed}


@router.post("/ready-cast/{token_id}/clear")
async def clear_ready_cast(
    token_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    token = await db.get(Token, token_id)
    if not token or not token.casting_in_progress:
        raise HTTPException(404, "No active casting")

    casting = dict(token.casting_in_progress)
    if casting.get("status") != "ready":
        raise HTTPException(400, "Casting is not ready for release")

    campaign = await db.get(Campaign, token.campaign_id)
    await check_campaign_member(token.campaign_id, current_user, db)
    if not _can_manage_casting(token, casting, current_user, campaign):
        raise HTTPException(403, "Not allowed to release this cast")

    token.casting_in_progress = None
    flag_modified(token, "casting_in_progress")
    await db.commit()
    await db.refresh(token)
    await _broadcast_casting_update(token, reason="released")
    return {"success": True}


# ── Illusion image generation ──────────────────────────────────────────


class IllusionImageRequest(BaseModel):
    description: str
    spell_id: str
    campaign_id: int


class IllusionImageResponse(BaseModel):
    image_url: str
    avatar_id: int
    display_name: str = ""


@router.post("/generate-illusion-image", response_model=IllusionImageResponse)
async def generate_illusion_image(
    req: IllusionImageRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Generate an illusion image from player description, store in avatar library."""
    import asyncio as _asyncio
    from app.services.avatar_service import AvatarService, sanitize_prompt_for_api
    from app.services.ai_model_service import ai_model_service
    from app.services.ai_service import AIService

    prompt = sanitize_prompt_for_api(
        f"A D&D fantasy illusion image: {req.description}. "
        "Translucent, ethereal, magical shimmer effect. "
        "Game token icon style, centered, dark background."
    )

    # Generate image and display name in parallel
    async def _gen_image():
        svc = AvatarService()
        return await svc.generate_avatar(
            db=db, entity_type="monster", entity_id=0,
            name=req.description[:60], prompt_override=prompt,
            usage_key="avatar_illusion",
        )

    async def _gen_name() -> str:
        """Use FAST LLM to generate a short, realistic display name for the illusion."""
        try:
            usage_params = await ai_model_service.get_usage_params(db, "illusion_naming")
            cfg = usage_params.config
            result = await AIService.chat_completion(
                api_url=cfg.api_url, api_key=cfg.api_key, model=cfg.model_id,
                messages=[
                    {"role": "system", "content": (
                        "你是D&D奇幻世界的命名专家。根据用户对幻象的描述，"
                        "生成一个简短的中文名称（2-6个字），像是真实存在的生物或物品的名称。"
                        "不要包含'幻象'、'幻影'等暴露虚假性质的词。"
                        "只输出名称本身，不要任何解释。"
                    )},
                    {"role": "user", "content": req.description},
                ],
                temperature=0.8, max_tokens=20,
            )
            name = result.strip().strip('"\'""「」').strip()
            return name[:20] if name else ""
        except Exception as e:
            logger.warning(f"Failed to generate illusion name: {e}")
            return ""

    (small_url, large_url), display_name = await _asyncio.gather(
        _gen_image(), _gen_name()
    )

    # Fallback: use truncated description if LLM naming failed
    if not display_name:
        display_name = req.description[:20]

    # Store in monster_avatars library with illusion marker
    avatar = MonsterAvatar(
        monster_id=f"illusion_{req.spell_id}",
        monster_name=f"[幻象] {req.description[:80]}",
        avatar_url=small_url,
        avatar_url_large=large_url,
        created_by=str(current_user["user_id"]),
        usage_count=1,
    )
    db.add(avatar)
    await db.commit()
    await db.refresh(avatar)

    return IllusionImageResponse(
        image_url=large_url or small_url,
        avatar_id=avatar.id,
        display_name=display_name,
    )


@router.get("/illusion-library")
async def get_illusion_library(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Get the current user's all previously generated/uploaded avatars for illusion use."""
    user_id = str(current_user["user_id"])
    avatars_out = []

    # 1. Monster avatars created by this user (all types, not just illusion_*)
    result = await db.execute(
        select(MonsterAvatar)
        .where(MonsterAvatar.created_by == user_id)
        .order_by(MonsterAvatar.created_at.desc())
        .limit(50)
    )
    for a in result.scalars().all():
        url = a.avatar_url_large or a.avatar_url
        if url:
            name = (a.monster_name or "").replace("[幻象] ", "")
            avatars_out.append({
                "id": f"ma_{a.id}",
                "url": url,
                "name": name,
            })

    # 2. User avatars (character portraits etc.)
    result2 = await db.execute(
        select(UserAvatar)
        .where(UserAvatar.user_id == user_id)
        .order_by(UserAvatar.created_at.desc())
        .limit(50)
    )
    for a in result2.scalars().all():
        url = a.avatar_url_large or a.avatar_url
        if url:
            avatars_out.append({
                "id": f"ua_{a.id}",
                "url": url,
                "name": "角色头像",
            })

    # Deduplicate by URL
    seen = set()
    unique = []
    for av in avatars_out:
        if av["url"] not in seen:
            seen.add(av["url"])
            unique.append(av)

    return {"avatars": unique[:60]}
