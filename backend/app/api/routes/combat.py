"""Combat action routes - handles attack actions with LLM narrative generation"""
import random
import re
import json
import logging
import httpx
from datetime import datetime
from typing import Any, Optional, List, Tuple, Dict
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy import select

from app.db.session import get_db
from app.schemas.combat import (
    AttackRequest, AttackResponse, AttackResult, DiceRoll,
    AttackOption, AttackerData, TargetData, ExtraDamage,
    SavingThrowRequest, SavingThrowResponse, SavingThrowResult,
    SavingThrowTargetResult, ABILITY_NAMES, AbilityScores,
    AbilityCheckRequest, AbilityCheckResponse, AbilityCheckResult,
    ContestRequest, ContestResponse, ContestResult,
    AbilityCheckParticipant,
    ReactionRequest, ReactionResponse, ReactionResult,
    DAMAGE_TYPE_EN_TO_CN,
)
from app.schemas.spell_effect import EffectResult
from app.services.ai_model_service import AIModelService as ai_model_service
from app.services.websocket_manager import manager
from app.services.spell_resolver import SpellResolver, SpellContext, TargetInfo
from app.models.token import Token
from app.models.character import Character
from app.models.monster_instance import MonsterInstance
from app.models.chat_message import ChatMessage
from app.utils.class_effects import (
    get_rage_damage_bonus,
    check_is_raging,
    check_is_reckless,
    check_is_frenzied,
    is_physical_damage
)
from app.utils.saving_throws import (
    calc_saving_throw_modifier,
    check_advantage_on_save,
)
from app.utils.light_domain import calculate_token_distance_feet, target_has_corona_of_light_save_disadvantage
from app.utils.pending_effects import apply_pending_damage_received_effects
from app.utils.rules_cache import (
    get_spell_by_id,
    get_spell_effect_phases,
    get_spellcasting_data,
    spell_has_effect_type,
)
from app.utils.trickery_domain import (
    get_concentration_linked_token_ids,
    is_invoke_duplicity_concentration,
)
from app.services.spell_runtime_service import resolve_spell_duration_rounds
from app.services.character_progression_service import calculate_max_hp
from app.utils.ability_checks import (
    calc_ability_modifier,
    get_proficiency_bonus,
    calc_ability_check_modifier,
    check_advantage_on_ability_check,
    get_skill_ability,
    SKILL_ABILITIES,
    ABILITY_NAMES_CN
)
from app.utils.dice import compute_final_ability_scores, collect_character_skill_proficiencies
from app.services.effect_service import (
    check_advantage_against_target,
    check_advantage_on_attack,
    check_resistances,
    get_bonus_damage_entries,
    get_modifiers_for_target,
    get_save_success_override,
)
from app.services.immunity_service import (
    get_character_immunities,
    get_monster_immunities,
)
from app.services.spell_effect_cleanup_service import remove_effect_group
from app.services.passive_feature_service import get_passive_save_advantage_sources
from app.services.realtime_publisher import realtime_publisher
from app.services.combat_retaliation_service import apply_on_take_damage_retaliation
from app.services.combat_resolution_service import (
    apply_direct_token_damage as apply_direct_token_damage_service,
    absorb_temp_hp as absorb_temp_hp_service,
    combat_chat_timestamp_ms as combat_chat_timestamp_ms_service,
    create_combat_chat_message as create_combat_chat_message_service,
    extract_passive_save_condition_ids as extract_passive_save_condition_ids_service,
    persist_attack_hp_change as persist_attack_hp_change_service,
    publish_token_active_effects_update as publish_token_active_effects_update_service,
    restore_direct_token_hp as restore_direct_token_hp_service,
    resolve_effective_target_hp as resolve_effective_target_hp_service,
    resolve_attack_damage_mitigation as resolve_attack_damage_mitigation_service,
    resolve_attack_target_meta as resolve_attack_target_meta_service,
    resolve_relentless_endurance as resolve_relentless_endurance_service,
    resolve_thunderbolt_trigger_damage_type as resolve_thunderbolt_trigger_damage_type_service,
    roll_save_d20 as roll_save_d20_service,
)
from app.services.combat_attack_service import (
    build_attack_chat_meta as build_attack_chat_meta_service,
    build_attack_combat_log as build_attack_combat_log_service,
    build_attack_result as build_attack_result_service,
    resolve_brutal_critical_damage as resolve_brutal_critical_damage_service,
    resolve_divine_strike_damage as resolve_divine_strike_damage_service,
    resolve_enlarge_reduce_damage as resolve_enlarge_reduce_damage_service,
    resolve_extra_damage as resolve_extra_damage_service,
    merge_roll_modifier as merge_attack_roll_modifier,
    resolve_savage_attacks_damage as resolve_savage_attacks_damage_service,
    roll_attack_d20 as roll_attack_d20_service,
    roll_base_attack_damage as roll_base_attack_damage_service,
    resolve_attack_outcome as resolve_attack_outcome_service,
    resolve_sneak_attack_damage as resolve_sneak_attack_damage_service,
)
from app.services.combat_reaction_service import (
    build_attack_reaction_description as build_attack_reaction_description_service,
    build_reaction_chat_meta as build_reaction_chat_meta_service,
    build_spell_reaction_description as build_spell_reaction_description_service,
    get_superiority_die as get_reaction_superiority_die_service,
    reaction_display_name as reaction_display_name_service,
    resolve_defense_reaction as resolve_defense_reaction_service,
)
from app.services.combat_saving_throw_service import (
    build_saving_throw_chat_meta as build_saving_throw_chat_meta_service,
    build_saving_throw_combat_log as build_saving_throw_combat_log_service,
    build_saving_throw_narrative as build_saving_throw_narrative_service,
    build_saving_throw_result as build_saving_throw_result_service,
)
from app.services.combat_check_service import (
    build_ability_check_chat_meta as build_ability_check_chat_meta_service,
    build_ability_check_combat_log as build_ability_check_combat_log_service,
    build_ability_check_narrative as build_ability_check_narrative_service,
    build_ability_check_result as build_ability_check_result_service,
    build_contest_chat_meta as build_contest_chat_meta_service,
    build_contest_combat_log as build_contest_combat_log_service,
    build_contest_narrative as build_contest_narrative_service,
    build_contest_result as build_contest_result_service,
    resolve_check_display_name as resolve_check_display_name_service,
)
from app.services.combat_check_usecase_service import (
    resolve_ability_check as resolve_ability_check_usecase_service,
    resolve_contest as resolve_contest_usecase_service,
)
from app.services.combat_auxiliary_service import (
    build_death_save_chat_meta as build_death_save_chat_meta_service,
    build_extra_effect_chat_content as build_extra_effect_chat_content_service,
    build_extra_effect_chat_meta as build_extra_effect_chat_meta_service,
    build_extra_effect_prompt as build_extra_effect_prompt_service,
)
from app.services.combat_control_effect_service import (
    build_batch_ongoing_save_chat_content as build_batch_ongoing_save_chat_content_service,
    build_condition_save_chat_content as build_condition_save_chat_content_service,
    build_condition_save_chat_meta as build_condition_save_chat_meta_service,
    build_condition_save_narrative as build_condition_save_narrative_service,
    build_escape_attempt_chat_content as build_escape_attempt_chat_content_service,
    build_escape_attempt_chat_meta as build_escape_attempt_chat_meta_service,
    build_escape_attempt_narrative as build_escape_attempt_narrative_service,
    build_ongoing_save_chat_content as build_ongoing_save_chat_content_service,
    build_ongoing_save_chat_meta as build_ongoing_save_chat_meta_service,
    build_zone_spell_settle_chat_meta as build_zone_spell_settle_chat_meta_service,
    build_zone_spell_settle_narrative as build_zone_spell_settle_narrative_service,
)
from app.services.combat_area_spell_output_service import (
    build_area_spell_chat_meta as build_area_spell_chat_meta_service,
    build_area_spell_narrative_prompt as build_area_spell_narrative_prompt_service,
)
from app.utils.armor_proficiency import check_armor_proficiency_penalty
from app.utils.nature_domain import get_master_of_nature_restore_data
from app.core.dependencies import resolve_campaign_member_context
from app.core.security import require_auth
from app.services.runtime_schema_service import (
    normalize_character_spell_slots_state,
    normalize_token_concentration_spell,
    normalize_token_death_saves,
)
from app.services.spell_runtime_service import (
    get_runtime_bonus_damage,
    get_token_runtime_modifier_effects,
    strip_bonus_modifiers_from_runtime_effects,
)

logger = logging.getLogger(__name__)
router = APIRouter()


PASSIVE_SAVE_CONDITION_ALIASES = {
    "blinded": "blinded",
    "目盲": "blinded",
    "deafened": "deafened",
    "耳聋": "deafened",
    "incapacitated": "incapacitated",
    "失能": "incapacitated",
}


def _sender_role_from_context(context: Any) -> str:
    return "dm" if getattr(context, "is_dm", False) else "player"


async def _get_character_for_token(db: AsyncSession, token_id: int) -> Optional["Character"]:
    """Load character for a token if it's a character token."""
    token = await db.get(Token, token_id)
    if token and token.character_id:
        return await db.get(Character, token.character_id)
    return None


async def _get_target_conditions(db: AsyncSession, token: "Token") -> List[str]:
    """Get D&D condition IDs from the target's status_effects (character or monster)."""
    se = None
    if token.character_id:
        char = await db.get(Character, token.character_id)
        if char:
            se = char.status_effects
    elif token.monster_instance_id:
        mi = await db.get(MonsterInstance, token.monster_instance_id)
        if mi:
            se = mi.status_effects
    if not se or not isinstance(se, dict):
        return []
    # active_conditions format: [{"condition": "petrified", "duration": {...}}, ...]
    # or legacy: ["petrified", ...]
    raw = se.get("active_conditions", [])
    if not raw:
        return []
    result = []
    for item in raw:
        if isinstance(item, str):
            result.append(item)
        elif isinstance(item, dict) and item.get("condition"):
            result.append(item["condition"])
    return result


def _extract_passive_save_condition_ids(
    active_effects: Optional[List[Dict[str, Any]]],
) -> List[str]:
    return extract_passive_save_condition_ids_service(active_effects)


async def _get_passive_save_advantage_for_token(
    db: AsyncSession,
    token: Optional["Token"],
    save_type: str,
    character: Optional["Character"] = None,
) -> List[str]:
    """Return passive feature names that grant advantage on this save for a token."""
    if not token or not token.character_id:
        return []

    char = character or await db.get(Character, token.character_id)
    if not char:
        return []

    condition_ids = await _get_target_conditions(db, token)
    condition_ids.extend(_extract_passive_save_condition_ids(token.active_effects))
    return get_passive_save_advantage_sources(
        class_id=char.class_id,
        level=char.level or 1,
        subclass_id=char.subclass_id,
        save_type=save_type,
        condition_ids=condition_ids,
    )


def _roll_save_d20(*, advantage: bool = False, disadvantage: bool = False) -> Tuple[int, List[int]]:
    return roll_save_d20_service(advantage=advantage, disadvantage=disadvantage)


async def _get_invoke_duplicity_duplicate_tokens(
    db: AsyncSession,
    caster_token: Optional["Token"],
) -> List["Token"]:
    if not caster_token:
        return []

    conc = caster_token.concentration_spell
    if not is_invoke_duplicity_concentration(conc):
        return []

    duplicate_tokens: List["Token"] = []
    for token_id in get_concentration_linked_token_ids(conc):
        linked_token = await db.get(Token, token_id)
        if not linked_token:
            continue
        if linked_token.campaign_id != caster_token.campaign_id or linked_token.map_url != caster_token.map_url:
            continue
        duplicate_tokens.append(linked_token)
    return duplicate_tokens


async def _has_invoke_duplicity_attack_advantage(
    db: AsyncSession,
    caster_token: Optional["Token"],
    target_token: Optional["Token"],
) -> bool:
    if not caster_token or not target_token:
        return False
    if calculate_token_distance_feet(caster_token, target_token) > 5:
        return False

    duplicate_tokens = await _get_invoke_duplicity_duplicate_tokens(db, caster_token)
    return any(
        calculate_token_distance_feet(duplicate_token, target_token) <= 5
        for duplicate_token in duplicate_tokens
    )


async def _get_best_invoke_duplicity_distance_feet(
    db: AsyncSession,
    caster_token: Optional["Token"],
    target_token: Optional["Token"],
    default_distance_feet: float,
) -> float:
    if not caster_token or not target_token:
        return default_distance_feet

    best_distance = default_distance_feet if default_distance_feet > 0 else calculate_token_distance_feet(caster_token, target_token)
    for duplicate_token in await _get_invoke_duplicity_duplicate_tokens(db, caster_token):
        best_distance = min(best_distance, calculate_token_distance_feet(duplicate_token, target_token))
    return best_distance


async def _broadcast_token_active_effects_update(
    token: Optional["Token"],
    campaign_id: int,
) -> None:
    await publish_token_active_effects_update_service(token, campaign_id)


async def _broadcast_concentration_updates(
    db: AsyncSession,
    campaign_id: int,
    token_ids: List[int],
) -> None:
    for token_id in dict.fromkeys(token_ids):
        token = await db.get(Token, token_id)
        if token:
            await realtime_publisher.publish_token_concentration_updated(
                campaign_id,
                token_id=token_id,
                concentration_spell=token.concentration_spell,
            )


THUNDERBOLT_STRIKE_FEATURE_ID = "thunderbolt_strike"
_THUNDERBOLT_STRIKE_SIZE_ORDER = {
    "tiny": 0,
    "微型": 0,
    "超小型": 0,
    "small": 1,
    "小型": 1,
    "medium": 2,
    "中型": 2,
    "large": 3,
    "大型": 3,
    "huge": 4,
    "巨型": 4,
    "gargantuan": 5,
    "超巨型": 5,
}
_THUNDERBOLT_STRIKE_DAMAGE_TYPE_MAP = {
    "lightning": "lightning",
    "闪电": "lightning",
}


def _parse_token_size_for_combat(size_str: Optional[str]) -> tuple[float, float]:
    raw = str(size_str or "1x1").lower()
    parts = raw.split("x")
    try:
        width = max(0.5, float(parts[0]))
    except (TypeError, ValueError):
        width = 1.0
    try:
        height = max(0.5, float(parts[1] if len(parts) > 1 else parts[0]))
    except (TypeError, ValueError):
        height = width
    return width, height


def _token_center_for_combat(token: "Token") -> tuple[float, float]:
    width, height = _parse_token_size_for_combat(token.token_size)
    return token.position_x + (width / 2), token.position_y + (height / 2)


def _normalize_combat_damage_type(damage_type: Any) -> Optional[str]:
    if damage_type is None:
        return None
    normalized = str(damage_type).strip().lower()
    return _THUNDERBOLT_STRIKE_DAMAGE_TYPE_MAP.get(normalized, normalized)


def _normalize_creature_size(size_value: Any) -> Optional[str]:
    if size_value is None:
        return None
    normalized = str(size_value).strip().lower()
    aliases = {
        "tiny": "tiny",
        "微型": "微型",
        "超小型": "超小型",
        "small": "small",
        "小型": "小型",
        "medium": "medium",
        "中型": "中型",
        "large": "large",
        "大型": "大型",
        "huge": "huge",
        "巨型": "巨型",
        "gargantuan": "gargantuan",
        "超巨型": "超巨型",
        "超大型": "巨型",
    }
    return aliases.get(normalized)


def _creature_size_from_token_size(token_size: Optional[str]) -> str:
    width, height = _parse_token_size_for_combat(token_size)
    max_dim = max(width, height)
    if max_dim < 1:
        return "tiny"
    if max_dim < 2:
        return "medium"
    if max_dim < 3:
        return "large"
    if max_dim < 4:
        return "huge"
    return "gargantuan"


def _creature_size_rank(size_value: Any) -> int:
    normalized = _normalize_creature_size(size_value)
    if normalized is None:
        return _THUNDERBOLT_STRIKE_SIZE_ORDER["medium"]
    return _THUNDERBOLT_STRIKE_SIZE_ORDER.get(normalized, _THUNDERBOLT_STRIKE_SIZE_ORDER["medium"])


def _calculate_push_destination(
    caster_token: "Token",
    target_token: "Token",
    distance_feet: int,
) -> Optional[tuple[int, int]]:
    if distance_feet <= 0:
        return None

    caster_center_x, caster_center_y = _token_center_for_combat(caster_token)
    target_center_x, target_center_y = _token_center_for_combat(target_token)
    dx = target_center_x - caster_center_x
    dy = target_center_y - caster_center_y
    grid_distance = max(abs(dx), abs(dy))
    if grid_distance <= 0:
        return None

    squares = max(1, int(round(distance_feet / 5)))
    delta_x = int(round((dx / grid_distance) * squares))
    delta_y = int(round((dy / grid_distance) * squares))

    if delta_x == 0 and delta_y == 0:
        if abs(dx) >= abs(dy):
            delta_x = squares if dx >= 0 else -squares
        else:
            delta_y = squares if dy >= 0 else -squares

    new_x = int(round(target_token.position_x + delta_x))
    new_y = int(round(target_token.position_y + delta_y))
    if new_x == target_token.position_x and new_y == target_token.position_y:
        return None
    return new_x, new_y


async def _apply_thunderbolt_strike(
    db: AsyncSession,
    *,
    campaign_id: int,
    caster_token_id: Optional[int],
    target_token_id: Optional[int],
    damage_type: Any,
    damage_dealt: int,
    auto_apply: bool,
    caster_name: str,
    target_name: str,
) -> Optional[str]:
    if not auto_apply or damage_dealt <= 0:
        return None
    if _normalize_combat_damage_type(damage_type) != "lightning":
        return None
    if not caster_token_id or not target_token_id:
        return None

    caster_token = await db.get(Token, caster_token_id)
    target_token = await db.get(Token, target_token_id)
    if not caster_token or not target_token:
        return None
    if caster_token.id == target_token.id:
        return None
    if caster_token.map_url != target_token.map_url:
        return None

    caster_char = await _get_character_for_token(db, caster_token.id)
    if not caster_char or not caster_char.class_id:
        return None

    from app.services.passive_feature_service import get_passive_features as _get_pf_thunderbolt

    passive_features = _get_pf_thunderbolt(
        caster_char.class_id,
        caster_char.level or 1,
        caster_char.subclass_id,
    )
    thunderbolt_feature = next(
        (feature for feature in passive_features.get("allFeatures", []) if feature.get("id") == THUNDERBOLT_STRIKE_FEATURE_ID),
        None,
    )
    if not thunderbolt_feature:
        return None

    effect = thunderbolt_feature.get("effect", {})
    max_size = effect.get("maxSize") or "Large"
    push_distance = int(effect.get("distance") or 10)

    target_monster = await db.get(MonsterInstance, target_token.monster_instance_id) if target_token.monster_instance_id else None
    transformed_size = None
    if target_token.transformation_data and isinstance(target_token.transformation_data, dict):
        transformed_size = (
            target_token.transformation_data.get("size")
            or ((target_token.transformation_data.get("form") or {}).get("size") if isinstance(target_token.transformation_data.get("form"), dict) else None)
        )
    target_size = (
        transformed_size
        or (target_monster.size if target_monster else None)
        or ((target_monster.monster_data or {}).get("size") if target_monster and isinstance(target_monster.monster_data, dict) else None)
        or _creature_size_from_token_size(target_token.token_size)
    )

    if _creature_size_rank(target_size) > _creature_size_rank(max_size):
        return None

    destination = _calculate_push_destination(caster_token, target_token, push_distance)
    if destination is None:
        return None

    target_token.position_x, target_token.position_y = destination
    await db.commit()
    await db.refresh(target_token)

    await realtime_publisher.publish_token_moved(
        campaign_id,
        token_id=target_token.id,
        position_x=target_token.position_x,
        position_y=target_token.position_y,
    )

    return f"⚡ **{caster_name}** 的【雷霆打击】将 **{target_name}** 推开{push_distance}尺！"


async def _absorb_temp_hp(token: "Token", damage: int, db: AsyncSession) -> int:
    return await absorb_temp_hp_service(token, damage, db)


async def _call_llm_for_text(
    db: AsyncSession,
    prompt: str,
    usage_key: str,
    max_tokens: int = 200
) -> str:
    """Call LLM API to generate text"""
    usage_params = await ai_model_service.get_usage_params(db, usage_key)
    config = usage_params.config

    endpoint = config.api_url.rstrip('/')
    if not endpoint.endswith('/chat/completions'):
        endpoint = endpoint + '/chat/completions'

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            endpoint,
            json={
                "model": config.model_name,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": max_tokens,
                "temperature": usage_params.temperature or 0.7
            },
            headers={
                "Authorization": f"Bearer {config.api_key}",
                "Content-Type": "application/json",
            },
        )

    if resp.status_code != 200:
        raise Exception(f"LLM API error: {resp.status_code} - {resp.text}")

    data = resp.json()
    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

    if not content:
        raise Exception("Empty response from LLM")

    return content


def parse_damage_dice(damage_str: str) -> Tuple[int, int, int]:
    """Parse damage string like '1d8', '2d6+3' into (num_dice, die_size, modifier)"""
    if not damage_str:
        return (1, 4, 0)  # Default 1d4

    # Handle Chinese damage descriptions like "1+力量"
    if "力量" in damage_str or "敏捷" in damage_str:
        return (0, 0, 1)  # Unarmed strike: just modifier

    # Match patterns: 1d8, 2d6+3, 1d10-1
    match = re.match(r'(\d+)?d(\d+)([+-]\d+)?', damage_str.lower().strip())
    if match:
        num_dice = int(match.group(1)) if match.group(1) else 1
        die_size = int(match.group(2))
        modifier = int(match.group(3)) if match.group(3) else 0
        return (num_dice, die_size, modifier)

    return (1, 4, 0)


def roll_dice(num_dice: int, die_size: int, modifier: int = 0) -> DiceRoll:
    """Roll dice and return result"""
    if num_dice == 0 and die_size == 0:
        # Special case for unarmed strike
        return DiceRoll(
            dice="1",
            rolls=[1],
            modifier=modifier,
            total=1 + modifier
        )

    rolls = [random.randint(1, die_size) for _ in range(num_dice)]
    total = sum(rolls) + modifier
    return DiceRoll(
        dice=f"{num_dice}d{die_size}",
        rolls=rolls,
        modifier=modifier,
        total=total
    )


def calc_attack_bonus(attacker: AttackerData, attack: AttackOption) -> int:
    """Calculate attack bonus based on attacker stats and weapon"""
    details = calc_attack_bonus_details(attacker, attack)
    return details["total"]


def calc_attack_bonus_details(attacker: AttackerData, attack: AttackOption) -> dict:
    """Calculate attack bonus with detailed breakdown"""
    # Determine which ability to use (Str for melee, Dex for ranged/finesse)
    properties = attack.properties or []
    is_ranged = attack.normal_range and attack.normal_range > 10
    has_finesse = any('finesse' in p.lower() or '灵巧' in p for p in properties)

    str_mod = calc_ability_modifier(attacker.ability_scores.strength)
    dex_mod = calc_ability_modifier(attacker.ability_scores.dexterity)

    if is_ranged:
        ability_mod = dex_mod
        ability_name = "敏捷"
    elif has_finesse:
        if dex_mod >= str_mod:
            ability_mod = dex_mod
            ability_name = "敏捷"
        else:
            ability_mod = str_mod
            ability_name = "力量"
    else:
        ability_mod = str_mod
        ability_name = "力量"

    # Proficiency bonus - only add if proficient with the weapon
    # D&D 5E: If not proficient, don't add proficiency bonus to attack rolls
    weapon_proficient = attack.weapon_proficient if attack.weapon_proficient is not None else True
    prof_bonus = attacker.proficiency_bonus if weapon_proficient else 0

    # Fighting Style: Archery — +2 to ranged weapon attack rolls
    fighting_style_atk_bonus = 0
    fighting_style_atk_label = ""
    if attacker.fighting_style == 'archery' and is_ranged:
        fighting_style_atk_bonus = 2
        fighting_style_atk_label = "🏹射箭"

    # Magic weapon bonus (e.g., +1, +2, +3)
    magic_bonus = attack.magic_bonus or 0

    return {
        "ability_name": ability_name,
        "ability_mod": ability_mod,
        "prof_bonus": prof_bonus,
        "weapon_proficient": weapon_proficient,
        "fighting_style_atk_bonus": fighting_style_atk_bonus,
        "fighting_style_atk_label": fighting_style_atk_label,
        "magic_bonus": magic_bonus,
        "total": ability_mod + prof_bonus + fighting_style_atk_bonus + magic_bonus
    }


def calc_damage_bonus(attacker: AttackerData, attack: AttackOption) -> dict:
    """Calculate damage bonus and return details for breakdown display"""
    properties = attack.properties or []
    is_ranged = attack.normal_range and attack.normal_range > 10
    has_finesse = any('finesse' in p.lower() or '灵巧' in p for p in properties)
    has_two_handed = any('two-handed' in p.lower() or '双手' in p for p in properties)

    str_mod = calc_ability_modifier(attacker.ability_scores.strength)
    dex_mod = calc_ability_modifier(attacker.ability_scores.dexterity)

    if is_ranged:
        ability_mod = dex_mod
        ability_name = "敏捷"
    elif has_finesse:
        if dex_mod >= str_mod:
            ability_mod = dex_mod
            ability_name = "敏捷"
        else:
            ability_mod = str_mod
            ability_name = "力量"
    else:
        ability_mod = str_mod
        ability_name = "力量"

    # D&D 5E: Off-hand (bonus action) attacks don't add ability modifier to damage
    # UNLESS the attacker has Two-Weapon Fighting style
    is_off_hand = attack.is_off_hand or False
    if is_off_hand and attacker.fighting_style not in ('two_weapon_fighting', 'two_weapon'):
        ability_mod = 0
        ability_name = "副手"

    # Fighting Style: Dueling — +2 damage when wielding a one-handed melee weapon
    # and no other weapon in the other hand (doesn't apply during dual-wielding)
    dueling_bonus = 0
    if (attacker.fighting_style == 'dueling'
            and not is_ranged and not has_two_handed and not is_off_hand):
        dueling_bonus = 2

    # Magic weapon bonus applies to damage too
    magic_bonus = attack.magic_bonus or 0

    return {
        "bonus": ability_mod + dueling_bonus + magic_bonus,
        "ability_name": ability_name,
        "ability_mod": ability_mod,
        "dueling_bonus": dueling_bonus,
        "magic_bonus": magic_bonus,
        "is_off_hand": is_off_hand,
    }


def _build_attack_narrative_prompt(
    attacker: AttackerData,
    target: TargetData,
    attack: AttackOption,
    hit: bool,
    critical: bool,
    fumble: bool,
    damage_dealt: int,
    target_defeated: bool
) -> str:
    """Build the prompt for attack narrative generation (without calling LLM)"""

    # Build attack result description
    attack_result_desc = ""
    if fumble:
        attack_result_desc = "结果: 大失败(自然1)!"
    elif critical:
        attack_result_desc = "结果: 暴击(自然20)! 命中!"
    elif hit:
        attack_result_desc = "结果: 命中!"
    else:
        attack_result_desc = "结果: 未命中"

    # Build damage context with severity indication
    damage_context = ""
    if hit and damage_dealt > 0:
        target_max_hp = target.max_hp or 50
        target_current_hp = target.current_hp or target_max_hp
        damage_percent = (damage_dealt / target_max_hp) * 100 if target_max_hp > 0 else 0

        if damage_percent >= 50:
            severity = "毁灭性打击"
        elif damage_percent >= 30:
            severity = "重创"
        elif damage_percent >= 15:
            severity = "中等伤害"
        elif damage_percent >= 5:
            severity = "轻伤"
        else:
            severity = "擦伤"

        damage_context = f"""
伤害: {damage_dealt}点{attack.damage_type or ''}伤害 ({severity})
目标生命值: {target_current_hp}/{target_max_hp} HP → 剩余约 {max(0, target_current_hp - damage_dealt)} HP"""

        if target_defeated:
            damage_context += f"\n{target.name}被击倒了!"

    # Build defender equipment description
    defender_desc = ""
    if target.has_shield is not None:
        if target.has_shield:
            defender_desc = "盾牌"
            if target.equipped_weapon:
                defender_desc += f"、{target.equipped_weapon}"
        else:
            if target.equipped_weapon:
                defender_desc = f"{target.equipped_weapon}（无盾牌）"
            else:
                defender_desc = "无盾牌"

    return f"""你是D&D战斗叙述者。用1-2句简短生动的中文描述这次攻击。

【攻击方】
{attacker.name}（{attacker.class_name or '冒险者'}）
武器: {attack.weapon_name or attack.name}

【防御方】
{target.name}
装备: {defender_desc or '未知'}

【战斗结果】
{attack_result_desc}{damage_context}

【伤害程度参考】
- 擦伤(<5%HP): 几乎没感觉
- 轻伤(5-15%HP): 皮肉之苦
- 中等(15-30%HP): 明显受伤
- 重创(30-50%HP): 伤势严重
- 毁灭性(>50%HP): 致命一击

【写作要求】
- 1-2句话，简洁有力
- 根据伤害程度描述反应强度
- 暴击要戏剧化，大失败要滑稽
- 未命中时只能用防御者实际装备来格挡/招架
- 禁止编造不存在的装备
- 直接输出叙事文本"""


async def generate_attack_narrative(
    db: AsyncSession,
    attacker: AttackerData,
    target: TargetData,
    attack: AttackOption,
    attack_roll: DiceRoll,
    damage_roll: Optional[DiceRoll],
    hit: bool,
    critical: bool,
    fumble: bool,
    damage_dealt: int,
    target_defeated: bool
) -> str:
    """Generate narrative description of the attack using LLM"""
    prompt = _build_attack_narrative_prompt(
        attacker, target, attack, hit, critical, fumble, damage_dealt, target_defeated
    )
    try:
        narrative = await _call_llm_for_text(
            db=db,
            prompt=prompt,
            usage_key="combat_attack_narrative",
            max_tokens=150
        )
        return narrative.strip()
    except Exception as e:
        logger.error(f"Failed to generate narrative: {e}")
        if fumble:
            return f"{attacker.name}的攻击完全失误了!"
        elif critical:
            return f"{attacker.name}打出暴击! {attack.weapon_name or attack.name}造成{damage_dealt}点{attack.damage_type or ''}伤害!"
        elif hit:
            return f"{attacker.name}的{attack.weapon_name or attack.name}命中{target.name}，造成{damage_dealt}点伤害。"
        else:
            return f"{attacker.name}的攻击被{target.name}躲开了。"


@router.post("/attack", response_model=AttackResponse)
async def perform_attack(
    request: AttackRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Perform an attack action.

    1. Calculate attack bonus
    2. Roll attack dice
    3. Determine hit/miss
    4. Roll damage if hit
    5. Generate narrative via LLM
    6. Broadcast result via WebSocket
    """
    try:
        context = await resolve_campaign_member_context(db, request.campaign_id, current_user)
        user_id = context.user_id
        role = _sender_role_from_context(context)

        # 1. Calculate attack bonus with details
        # Use override if provided (for monsters with pre-calculated attack bonus)
        if request.attack_bonus_override is not None:
            attack_bonus = request.attack_bonus_override
            # For monsters, we don't have a detailed breakdown, so use generic labels
            ability_name = "怪物"
            ability_mod = attack_bonus  # Show total as the "mod"
            prof_bonus = 0  # No separate proficiency for monsters
            weapon_proficient = True  # Monsters are assumed proficient
            fighting_style_atk_bonus = 0
            fighting_style_atk_label = ""
            magic_bonus = 0
        else:
            attack_details = calc_attack_bonus_details(request.attacker, request.attack)
            attack_bonus = attack_details["total"]
            ability_name = attack_details["ability_name"]
            ability_mod = attack_details["ability_mod"]
            prof_bonus = attack_details["prof_bonus"]
            weapon_proficient = attack_details["weapon_proficient"]
            fighting_style_atk_bonus = attack_details["fighting_style_atk_bonus"]
            fighting_style_atk_label = attack_details["fighting_style_atk_label"]
            magic_bonus = attack_details.get("magic_bonus", 0)

        # Calculate damage bonus (use override if provided)
        damage_ability_name = "力量"  # Default for display
        damage_ability_mod = 0
        dueling_bonus = 0
        if request.damage_bonus_override is not None:
            damage_bonus = request.damage_bonus_override
            damage_ability_mod = request.damage_bonus_override
        else:
            damage_bonus_details = calc_damage_bonus(request.attacker, request.attack)
            damage_bonus = damage_bonus_details["bonus"]
            damage_ability_name = damage_bonus_details["ability_name"]
            damage_ability_mod = damage_bonus_details["ability_mod"]
            dueling_bonus = damage_bonus_details["dueling_bonus"]

        # Pre-fetch attacker character for feat checks (GWM, Sharpshooter, Tavern Brawler, etc.)
        attacker_char_for_feat = (
            await _get_character_for_token(db, request.attacker_token_id)
            if request.attacker_token_id else None
        )
        feat_ids = []
        if attacker_char_for_feat:
            char_feats = attacker_char_for_feat.feats or []
            feat_ids = [f if isinstance(f, str) else (f.get('value') or f.get('id', '')) for f in char_feats]

        # Feat: Great Weapon Master / Sharpshooter power attack (-5 hit / +10 damage)
        power_attack_active = False
        if request.power_attack and request.attack_bonus_override is None:
            if 'great_weapon_master' in feat_ids or 'sharpshooter' in feat_ids:
                attack_bonus -= 5
                damage_bonus += 10
                power_attack_active = True
                feat_name = 'GWM' if 'great_weapon_master' in feat_ids else 'Sharpshooter'
                logger.info(f"[Combat] Power Attack active: -5 hit / +10 damage (feat: {feat_name})")

        # Charger feat: +5 damage on bonus action melee attack after Dash
        charger_bonus = 0
        if 'charger' in feat_ids and request.attack.is_off_hand and request.attack.key and request.attack.key.startswith('charger_'):
            charger_bonus = 5
            damage_bonus += charger_bonus
            logger.info("[Combat] Charger feat: +5 damage on charge attack")

        # Check if attacker is raging (Barbarian feature)
        attacker_is_raging = False
        attacker_is_reckless = False
        rage_damage_bonus = 0
        attacker_token = None
        attacker_runtime_modifier_effects: List[Dict[str, Any]] = []
        if request.attacker_token_id:
            attacker_token = await db.get(Token, request.attacker_token_id)
            if attacker_token and attacker_token.active_effects:
                attacker_is_raging = check_is_raging(attacker_token.active_effects)
                attacker_is_reckless = check_is_reckless(attacker_token.active_effects)
                if attacker_is_raging:
                    # Rage only applies to melee attacks using Strength
                    is_melee = not (request.attack.normal_range and request.attack.normal_range > 10)
                    if is_melee and request.attacker.class_id and request.attacker.class_id.lower() == "barbarian":
                        rage_damage_bonus = get_rage_damage_bonus(request.attacker.level or 1)
                        logger.info(f"[Combat] Rage damage bonus: +{rage_damage_bonus}")
                if attacker_is_reckless:
                    logger.info(f"[Combat] Attacker is using Reckless Attack")
            if attacker_token:
                attacker_runtime_modifier_effects = await get_token_runtime_modifier_effects(
                    db,
                    campaign_id=request.campaign_id,
                    token_id=attacker_token.id,
                )

        # Spell modifiers on attack rolls come from BOTH the legacy
        # active_effects.modifiers (e.g. Bane's -1d4, written by ModifierHandler)
        # and the v2 runtime envelope (e.g. Bless's +1d4). Evaluate formula bonuses
        # exactly once across the merged list — mirroring the saving-throw path —
        # so legacy debuffs/buffs are not silently dropped. adv/disadv is folded
        # below alongside attacker_condition_adv/_disadv via check_advantage_on_attack.
        base_attacker_effects = list(attacker_token.active_effects or []) if attacker_token else []
        runtime_attack_reasons: List[str] = []
        if base_attacker_effects or attacker_runtime_modifier_effects:
            runtime_atk_mods = get_modifiers_for_target(
                base_attacker_effects + attacker_runtime_modifier_effects,
                "attack_roll",
            )
            runtime_atk_bonus = sum(int(value) for value in runtime_atk_mods.get("bonuses", []))
            if runtime_atk_bonus:
                attack_bonus += runtime_atk_bonus
                logger.info(
                    f"[Combat] Runtime spell modifier attack bonus +{runtime_atk_bonus} "
                    f"({', '.join(runtime_atk_mods.get('reasons') or [])})"
                )
            runtime_attack_reasons = list(runtime_atk_mods.get("reasons") or [])

        # Check attacker's status conditions (prone, blinded, poisoned → attack disadvantage).
        # Strip `bonus` modifiers from runtime envelopes before feeding them into the
        # adv/disadv check — bonuses are already summed above; re-evaluating them here
        # would re-roll the same formula (e.g. Bless 1d4) and surface a mismatched
        # reason without being applied to attack_bonus.
        attacker_condition_adv = False
        attacker_condition_disadv = False
        attacker_condition_reasons = []
        if request.attacker_token_id:
            _atk_token = attacker_token or await db.get(Token, request.attacker_token_id)
            if _atk_token:
                atk_conditions = await _get_target_conditions(db, _atk_token)
                base_attacker_effects = list(_atk_token.active_effects or [])
                runtime_adv_effects = strip_bonus_modifiers_from_runtime_effects(
                    attacker_runtime_modifier_effects
                )
                merged_attacker_effects = base_attacker_effects + runtime_adv_effects
                if atk_conditions or base_attacker_effects or runtime_adv_effects:
                    attacker_condition_adv, attacker_condition_disadv, attacker_condition_reasons = check_advantage_on_attack(
                        merged_attacker_effects,
                        attacker_conditions=atk_conditions
                    )
                    if attacker_condition_adv:
                        logger.info(f"[Combat] Attacker conditions grant advantage: {attacker_condition_reasons}")
                    if attacker_condition_disadv:
                        logger.info(f"[Combat] Attacker conditions grant disadvantage: {attacker_condition_reasons}")

        # Check armor proficiency penalty (D&D 5E: non-proficient armor → attack disadvantage)
        attacker_armor_penalty = False
        if request.attacker_token_id:
            attacker_char = await _get_character_for_token(db, request.attacker_token_id)
            if attacker_char:
                penalty = check_armor_proficiency_penalty(attacker_char)
                if penalty["has_penalty"]:
                    attacker_armor_penalty = True
                    items_str = ", ".join(i["name"] for i in penalty["items"])
                    logger.info(f"[Combat] Attacker wearing non-proficient armor: {items_str}")

        # Check if target has Dodge effect (gives disadvantage on incoming attacks)
        target_has_dodge = False
        target_gives_advantage = False
        target_auto_crit = False
        effect_reasons = []
        target_token_for_dodge = None
        if request.target_token_id:
            target_token_for_dodge = await db.get(Token, request.target_token_id)
            if target_token_for_dodge:
                # Load D&D status conditions (petrified, stunned, etc.)
                target_conditions = await _get_target_conditions(db, target_token_for_dodge)
                # check_advantage_against_target returns (advantage, disadvantage, auto_crit, reasons)
                target_gives_advantage, target_gives_disadvantage, target_auto_crit, effect_reasons = check_advantage_against_target(
                    target_token_for_dodge.active_effects,
                    is_melee=True,  # TODO: determine from attack type
                    target_conditions=target_conditions
                )
                if target_gives_advantage:
                    logger.info(f"[Combat] Target condition grants attacker advantage. Reasons: {effect_reasons}")
                if target_gives_disadvantage:
                    target_has_dodge = True
                    logger.info(f"[Combat] Target has Dodge effect, attacker has disadvantage. Reasons: {effect_reasons}")

        # 2. Roll attack (1d20 + bonus) with possible advantage/disadvantage
        roll_modifier = request.roll_modifier  # 'advantage' | 'disadvantage' | None

        # Crossbow Expert: no disadvantage on ranged attacks within 5ft
        if roll_modifier == 'disadvantage' and 'crossbow_expert' in feat_ids:
            is_ranged = request.attack.normal_range and request.attack.normal_range > 10
            if is_ranged:
                roll_modifier = None
                logger.info("[Combat] Crossbow Expert: disadvantage removed for ranged attack within 5ft")

        # Apply target's condition effects
        # D&D 5e rules: advantage and disadvantage cancel each other out

        # First apply advantage from target conditions (paralyzed, unconscious, etc.)
        if target_gives_advantage:
            next_modifier = merge_attack_roll_modifier(roll_modifier, grants_advantage=True)
            if roll_modifier == 'disadvantage' and next_modifier is None:
                logger.info(f"[Combat] Target condition advantage cancels attacker's disadvantage")
            elif roll_modifier is None and next_modifier == 'advantage':
                logger.info(f"[Combat] Applying advantage due to target condition")
            roll_modifier = next_modifier

        # Then apply disadvantage from Dodge effect
        if target_has_dodge:
            next_modifier = merge_attack_roll_modifier(roll_modifier, grants_disadvantage=True)
            if roll_modifier == 'advantage' and next_modifier is None:
                logger.info(f"[Combat] Target's Dodge cancels attacker's advantage")
            elif roll_modifier is None and next_modifier == 'disadvantage':
                logger.info(f"[Combat] Applying disadvantage due to target's Dodge")
            roll_modifier = next_modifier

        # Apply disadvantage from non-proficient armor
        if attacker_armor_penalty:
            next_modifier = merge_attack_roll_modifier(roll_modifier, grants_disadvantage=True)
            if roll_modifier == 'advantage' and next_modifier is None:
                logger.info(f"[Combat] Armor non-proficiency disadvantage cancels advantage")
            elif roll_modifier is None and next_modifier == 'disadvantage':
                logger.info(f"[Combat] Applying disadvantage due to non-proficient armor")
            roll_modifier = next_modifier

        # Apply attacker's condition-based advantage/disadvantage (prone, blinded, poisoned, etc.)
        if attacker_condition_adv:
            next_modifier = merge_attack_roll_modifier(roll_modifier, grants_advantage=True)
            if roll_modifier == 'disadvantage' and next_modifier is None:
                logger.info(f"[Combat] Attacker condition advantage cancels disadvantage")
            elif roll_modifier is None and next_modifier == 'advantage':
                logger.info(f"[Combat] Applying advantage from attacker condition")
            roll_modifier = next_modifier
        if attacker_condition_disadv:
            next_modifier = merge_attack_roll_modifier(roll_modifier, grants_disadvantage=True)
            if roll_modifier == 'advantage' and next_modifier is None:
                logger.info(f"[Combat] Attacker condition disadvantage cancels advantage")
            elif roll_modifier is None and next_modifier == 'disadvantage':
                logger.info(f"[Combat] Applying disadvantage from attacker condition")
            roll_modifier = next_modifier
        # Merge attacker condition reasons into effect_reasons for display
        if attacker_condition_reasons:
            effect_reasons = effect_reasons + attacker_condition_reasons
        if runtime_attack_reasons:
            effect_reasons = effect_reasons + runtime_attack_reasons

        # Trickery Domain: Invoke Duplicity grants attack advantage when both cleric and duplicate threaten the target.
        if await _has_invoke_duplicity_attack_advantage(db, attacker_token, target_token_for_dodge):
            next_modifier = merge_attack_roll_modifier(roll_modifier, grants_advantage=True)
            if roll_modifier == 'disadvantage' and next_modifier is None:
                logger.info("[Combat] Invoke Duplicity advantage cancels disadvantage")
            elif roll_modifier is None and next_modifier == 'advantage':
                logger.info("[Combat] Applying advantage from Invoke Duplicity")
            roll_modifier = next_modifier
            effect_reasons = effect_reasons + ["诡术通道分身干扰"]

        # Portent: replace d20 with stored value (Divination Wizard)
        portent_used = False
        effective_forced_d20 = request.forced_d20
        if request.portent_value is not None and request.forced_d20 is None:
            effective_forced_d20 = request.portent_value
            portent_used = True
            logger.info(f"[Combat] Portent: using stored d20={request.portent_value}")

        # Guided Strike / Post-roll bonus: use forced d20 value instead of rolling
        attack_roll_state = roll_attack_d20_service(
            roll_modifier=roll_modifier,
            forced_d20=effective_forced_d20,
        )
        attack_d20 = attack_roll_state.attack_d20
        d20_rolls = list(attack_roll_state.d20_rolls)
        dice_notation = attack_roll_state.dice_notation
        if request.forced_d20 is not None:
            logger.info(f"[Combat] Forced d20={attack_d20} (post-roll bonus replay, +{request.attack_bonus_add})")
        elif roll_modifier == 'advantage':
            logger.info(f"[Combat] Advantage roll: {d20_rolls[0]}, {d20_rolls[1]} -> using {attack_d20}")
        elif roll_modifier == 'disadvantage':
            logger.info(f"[Combat] Disadvantage roll: {d20_rolls[0]}, {d20_rolls[1]} -> using {attack_d20}")

        # Roll Bardic Inspiration die if provided
        inspiration_roll = None
        inspiration_value = 0
        if request.inspiration_die:
            # Parse die size (e.g., 'd6' -> 6, 'd8' -> 8)
            die_match = re.match(r'd(\d+)', request.inspiration_die.lower())
            if die_match:
                insp_die_size = int(die_match.group(1))
                insp_roll_value = random.randint(1, insp_die_size)
                inspiration_value = insp_roll_value
                inspiration_roll = DiceRoll(
                    dice=f"1{request.inspiration_die}",
                    rolls=[insp_roll_value],
                    modifier=0,
                    total=insp_roll_value
                )
                logger.info(f"[Combat] Bardic Inspiration: {request.inspiration_die} rolled {insp_roll_value}")

        # Halfling Lucky: reroll natural 1 on d20
        halfling_lucky_reroll = False
        if attack_d20 == 1:
            from app.utils.race_effects import check_lucky
            if check_lucky(request.attacker.race_id or ''):
                attack_d20 = random.randint(1, 20)
                d20_rolls.append(attack_d20)
                halfling_lucky_reroll = True
                logger.info(f"[Combat] Halfling Lucky: rerolled nat 1 -> {attack_d20}")

        crit_range = request.attacker.crit_range or 20  # Default to 20 if not specified
        attack_outcome = resolve_attack_outcome_service(
            attack_d20=attack_d20,
            attack_bonus=attack_bonus,
            target_ac=request.target.ac,
            crit_range=crit_range,
            inspiration_value=inspiration_value,
            attack_bonus_add=request.attack_bonus_add,
            target_auto_crit=target_auto_crit,
        )
        critical = attack_outcome.critical
        fumble = attack_outcome.fumble
        total_attack = attack_outcome.total_attack

        attack_roll = DiceRoll(
            dice=dice_notation,
            rolls=d20_rolls,
            modifier=attack_bonus,
            total=total_attack
        )

        hit = attack_outcome.hit
        if hit and target_auto_crit and attack_d20 < crit_range:
            logger.info(f"[Combat] Auto-crit applied due to target condition (paralyzed/unconscious)")

        # 4. Roll damage if hit
        damage_roll = None
        damage_dealt = 0
        extra_damage_roll = None
        extra_damage_dealt = 0
        extra_damage_type = None
        runtime_bonus_damage_notes: list[str] = []
        savage_attacks_roll = None
        savage_attacks_damage = 0
        brutal_critical_roll = None
        brutal_critical_damage = 0
        sneak_attack_roll = None
        sneak_attack_damage = 0
        divine_strike_roll = None
        divine_strike_damage = 0
        divine_strike_type = None
        enlarge_reduce_roll = None
        enlarge_reduce_damage = 0
        enlarge_reduce_mode = None

        gwf_rerolled = False
        gwf_original_rolls = []  # Track original rolls for display
        if hit:
            chosen_element = None
            if attacker_char_for_feat:
                feat_choice = (attacker_char_for_feat.feat_choices or {}).get("elemental_adept", {})
                chosen_element = feat_choice.get("element")

            base_damage_result = roll_base_attack_damage_service(
                attack_damage=request.attack.damage,
                feat_ids=feat_ids,
                attack_properties=request.attack.properties,
                normal_range=request.attack.normal_range,
                fighting_style=request.attacker.fighting_style,
                damage_bonus=damage_bonus,
                rage_damage_bonus=rage_damage_bonus,
                critical=critical,
                chosen_element=chosen_element,
                damage_type=request.attack.damage_type,
                parse_damage_dice=parse_damage_dice,
                roll_dice=roll_dice,
            )
            if base_damage_result.tavern_brawler_applied:
                logger.info("[Combat] Tavern Brawler: unarmed damage upgraded to 1d4")
            if base_damage_result.gwf_rerolled:
                logger.info("[Combat] Great Weapon Fighting reroll applied")
            if base_damage_result.savage_attacker_applied:
                logger.info("[Combat] Savage Attacker: took higher rerolled damage")
            if base_damage_result.elemental_adept_applied and chosen_element:
                logger.info(f"[Combat] Elemental Adept: 1s treated as 2s for {chosen_element}")

            damage_roll = base_damage_result.damage_roll
            damage_dealt = base_damage_result.damage_dealt
            die_size = base_damage_result.die_size
            gwf_rerolled = base_damage_result.gwf_rerolled
            gwf_original_rolls = base_damage_result.gwf_original_rolls

            enlarge_reduce_result = resolve_enlarge_reduce_damage_service(
                transformation_data=attacker_token.transformation_data if attacker_token else None,
                critical=critical,
                parse_damage_dice=parse_damage_dice,
                roll_dice=roll_dice,
            )
            if enlarge_reduce_result.roll:
                enlarge_reduce_roll = enlarge_reduce_result.roll
                enlarge_reduce_damage = enlarge_reduce_result.damage
                enlarge_reduce_mode = enlarge_reduce_result.mode
                if enlarge_reduce_damage >= 0:
                    damage_dealt += enlarge_reduce_damage
                    logger.info(f"[Combat] Enlarge bonus: +{enlarge_reduce_damage} damage")
                else:
                    damage_dealt = max(1, damage_dealt + enlarge_reduce_damage)
                    logger.info(f"[Combat] Reduce penalty: {enlarge_reduce_damage} damage")

            is_melee = not (request.attack.normal_range and request.attack.normal_range > 10)
            savage_attacks_result = resolve_savage_attacks_damage_service(
                critical=critical,
                race_id=request.attacker.race_id,
                is_melee=is_melee,
                die_size=die_size,
                roll_dice=roll_dice,
            )
            if savage_attacks_result.roll:
                savage_attacks_roll = savage_attacks_result.roll
                savage_attacks_damage = savage_attacks_result.damage
                damage_dealt += savage_attacks_damage
                logger.info(f"[Combat] Savage Attacks triggered: +{savage_attacks_damage} damage (1d{die_size})")

            # Class feature: Brutal Critical (Barbarian) - extra damage dice on critical
            brutal_critical_result = resolve_brutal_critical_damage_service(
                critical=critical,
                class_id=request.attacker.class_id,
                level=request.attacker.level or 1,
                die_size=die_size,
                roll_dice=roll_dice,
            )
            if brutal_critical_result.roll:
                brutal_critical_roll = brutal_critical_result.roll
                brutal_critical_damage = brutal_critical_result.damage
                damage_dealt += brutal_critical_damage
                logger.info(
                    f"[Combat] Brutal Critical triggered: +{brutal_critical_damage} damage "
                    f"({brutal_critical_roll.dice})"
                )

            # Sneak Attack (Rogue)
            sneak_attack_result = resolve_sneak_attack_damage_service(
                sneak_attack_enabled=request.sneak_attack,
                attacker_class_id=request.attacker.class_id,
                attacker_level=request.attacker.level or 1,
                critical=critical,
                parse_damage_dice=parse_damage_dice,
                roll_dice=roll_dice,
            )
            if sneak_attack_result.roll:
                sneak_attack_roll = sneak_attack_result.roll
                sneak_attack_damage = sneak_attack_result.damage
                damage_dealt += sneak_attack_damage
                logger.info(
                    f"[Combat] Sneak Attack triggered: +{sneak_attack_damage} damage "
                    f"({sneak_attack_roll.dice})"
                )

            # Divine Strike (Cleric domain feature, once per turn on weapon hit)
            divine_strike_result = resolve_divine_strike_damage_service(
                attacker_class_id=request.attacker.class_id,
                attacker_level=request.attacker.level or 1,
                subclass_id=request.attacker.subclass_id,
                critical=critical,
                parse_damage_dice=parse_damage_dice,
                roll_dice=roll_dice,
            )
            if divine_strike_result.roll:
                divine_strike_roll = divine_strike_result.roll
                divine_strike_damage = divine_strike_result.damage
                divine_strike_type = divine_strike_result.damage_type
                damage_dealt += divine_strike_damage
                logger.info(
                    f"[Combat] Divine Strike triggered: +{divine_strike_damage} "
                    f"{divine_strike_type} damage ({divine_strike_roll.dice})"
                )

            # Roll extra damage if present (e.g., poison damage)
            extra_damage_result = resolve_extra_damage_service(
                extra_damage_dice=request.attack.extra_damage.dice if request.attack.extra_damage else None,
                extra_damage_type=request.attack.extra_damage.type if request.attack.extra_damage else None,
                critical=critical,
                parse_damage_dice=parse_damage_dice,
                roll_dice=roll_dice,
            )
            if extra_damage_result.roll:
                extra_damage_roll = extra_damage_result.roll
                extra_damage_dealt = extra_damage_result.damage
                extra_damage_type = extra_damage_result.damage_type

            if request.target_token_id:
                runtime_bonus_damages = await get_runtime_bonus_damage(
                    db,
                    campaign_id=request.campaign_id,
                    attacker_token_id=request.attacker_token_id,
                    target_token_id=request.target_token_id,
                    attack_kind="weapon",
                    critical=critical,
                )
                for runtime_bonus in runtime_bonus_damages:
                    applied_damage = runtime_bonus.damage
                    runtime_damage_type = runtime_bonus.damage_type or ""
                    if check_damage_immunity(runtime_damage_type, request.target.damage_immunities):
                        applied_damage = 0
                    elif check_damage_resistance(runtime_damage_type, request.target.damage_resistances):
                        applied_damage = applied_damage // 2
                    extra_damage_dealt += applied_damage
                    if extra_damage_roll is None and runtime_bonus.roll:
                        extra_damage_roll = DiceRoll(**runtime_bonus.roll)
                    if extra_damage_type is None and runtime_damage_type:
                        extra_damage_type = runtime_damage_type
                    if applied_damage > 0:
                        runtime_bonus_damage_notes.append(
                            f"{runtime_bonus.spell_name} 额外造成 {applied_damage} 点{runtime_damage_type or '额外'}伤害"
                        )
                if attacker_token and attacker_token.active_effects:
                    from app.utils.dice_formula import evaluate as eval_formula

                    aura_bonus_entries = get_bonus_damage_entries(
                        attacker_token.active_effects,
                        attack_kind="weapon",
                    )
                    for aura_bonus in aura_bonus_entries:
                        formula = str(aura_bonus.get("formula") or "").strip()
                        if not formula:
                            continue
                        if critical:
                            roll1 = eval_formula(formula)
                            roll2 = eval_formula(formula)
                            dice_total = (
                                sum(group.total for group in roll1.dice_groups)
                                + sum(group.total for group in roll2.dice_groups)
                            )
                            applied_damage = max(0, dice_total + roll1.modifier)
                        else:
                            applied_damage = max(0, eval_formula(formula).total)

                        aura_damage_type = str(aura_bonus.get("damage_type") or "")
                        if check_damage_immunity(aura_damage_type, request.target.damage_immunities):
                            applied_damage = 0
                        elif check_damage_resistance(aura_damage_type, request.target.damage_resistances):
                            applied_damage = applied_damage // 2

                        extra_damage_dealt += applied_damage
                        if applied_damage > 0:
                            runtime_bonus_damage_notes.append(
                                f"{aura_bonus.get('_effect_name') or '光环'} 额外造成 {applied_damage} 点{aura_damage_type or '额外'}伤害"
                            )

        # 5. Calculate HP changes (total damage = base + extra)
        total_damage = damage_dealt + extra_damage_dealt

        mitigation_result = await resolve_attack_damage_mitigation_service(
            db,
            hit=hit,
            total_damage=total_damage,
            damage_type=request.attack.damage_type,
            target_token_id=request.target_token_id,
            auto_apply=request.auto_apply,
        )
        damage_before_resistance = mitigation_result.damage_before_resistance
        rage_resistance_applied = mitigation_result.rage_resistance_applied
        pending_damage_resistance_applied = mitigation_result.pending_damage_resistance_applied
        target_active_effects_changed = mitigation_result.target_active_effects_changed
        concentration_touched_token_ids = mitigation_result.concentration_touched_token_ids
        ham_reduction = mitigation_result.heavy_armor_master_reduction
        passive_resistance_applied = mitigation_result.passive_resistance_applied
        total_damage = mitigation_result.total_damage

        if rage_resistance_applied:
            logger.info(f"[Combat] Rage resistance applied: {damage_before_resistance} -> {total_damage}")
        if ham_reduction > 0:
            logger.info(f"[Combat] Heavy Armor Master: damage reduced by {ham_reduction}")
        if passive_resistance_applied:
            logger.info(f"[Combat] Additional resistance applied: {request.attack.damage_type}")

        new_hp = None
        target_defeated = False
        hp_change = None
        # Snapshot the defender's buffs + temp HP BEFORE absorption so an
        # on_take_damage retaliation (e.g. Armor of Agathys) still fires on the
        # hit that depletes the temp HP and removes the buff.
        retaliation_active_effects_snapshot = None
        retaliation_temp_hp_before = 0
        thunderbolt_trigger_damage_type = resolve_thunderbolt_trigger_damage_type_service(
            normalize_damage_type=_normalize_combat_damage_type,
            base_damage_type=request.attack.damage_type,
            base_damage=damage_dealt,
            extra_damage_type=extra_damage_type,
            extra_damage=extra_damage_dealt,
            divine_strike_type=divine_strike_type,
            divine_strike_damage=divine_strike_damage,
        )

        if hit:
            hp_resolution = await resolve_effective_target_hp_service(
                db,
                request_current_hp=request.target.current_hp,
                request_max_hp=request.target.max_hp,
                target_token_id=request.target_token_id,
            )
            effective_hp = hp_resolution.effective_hp
            effective_max_hp = hp_resolution.effective_max_hp
            logger.info(f"[Combat HP] Final effective_hp={effective_hp}, effective_max_hp={effective_max_hp}")

            if effective_hp is not None:
                actual_damage = total_damage
                # Temp HP absorption (D&D 5E)
                if request.target_token_id:
                    _tkn = await db.get(Token, request.target_token_id)
                    if _tkn:
                        retaliation_active_effects_snapshot = list(_tkn.active_effects or [])
                        retaliation_temp_hp_before = _tkn.temp_hp or 0
                        actual_damage = await _absorb_temp_hp(_tkn, actual_damage, db)
                hp_change = -actual_damage
                new_hp = max(0, effective_hp + hp_change)
                target_defeated = new_hp <= 0

        # Relentless Endurance (Half-Orc): HP→0 becomes HP→1, once per long rest
        relentless_result = await resolve_relentless_endurance_service(
            db,
            target_token_id=request.target_token_id,
            effective_hp=effective_hp if hit else None,
            new_hp=new_hp,
            hp_change=hp_change,
            target_defeated=target_defeated,
        )
        relentless_triggered = relentless_result.triggered
        new_hp = relentless_result.new_hp
        hp_change = relentless_result.hp_change
        target_defeated = relentless_result.target_defeated
        if relentless_triggered:
            logger.info("[Combat] Relentless Endurance triggered")

        # 5.5. Persist HP changes if auto_apply is true
        hp_persistence = None
        if request.auto_apply and hp_change is not None and new_hp is not None:
            logger.info(
                f"[Combat HP] Persisting HP change: target_token_id={request.target_token_id}, "
                f"hp_change={hp_change}, new_hp={new_hp}"
            )
            hp_persistence = await persist_attack_hp_change_service(
                db,
                campaign_id=request.campaign_id,
                target_token_id=request.target_token_id,
                target_character_id=getattr(request, "target_character_id", None),
                target_monster_instance_id=getattr(request, "target_monster_instance_id", None),
                hp_change=hp_change,
                new_hp=new_hp,
                target_defeated=target_defeated,
                auto_apply=request.auto_apply,
            )
            new_hp = hp_persistence.new_hp
            target_defeated = hp_persistence.target_defeated
            logger.info("[Combat HP] HP changes committed successfully")
        else:
            logger.warning(f"[Combat HP] NOT persisting HP: auto_apply={request.auto_apply}, hp_change={hp_change}, new_hp={new_hp}")

        thunderbolt_strike_note = await _apply_thunderbolt_strike(
            db,
            campaign_id=request.campaign_id,
            caster_token_id=request.attacker_token_id,
            target_token_id=request.target_token_id,
            damage_type=thunderbolt_trigger_damage_type,
            damage_dealt=total_damage,
            auto_apply=request.auto_apply,
            caster_name=request.attacker.name,
            target_name=request.target.name,
        )

        # 5.6. On-take-damage retaliation (Armor of Agathys, Fire Shield): a
        # melee hit on a token carrying a retaliation buff deals damage back to
        # the attacker. Defender-side mirror of get_runtime_bonus_damage above.
        retaliation_notes = await apply_on_take_damage_retaliation(
            db,
            campaign_id=request.campaign_id,
            defender_active_effects=retaliation_active_effects_snapshot,
            defender_temp_hp_before=retaliation_temp_hp_before,
            defender_token_id=request.target_token_id,
            attacker_token_id=request.attacker_token_id,
            attacker_name=request.attacker.name,
            defender_name=request.target.name,
            is_melee=not (request.attack.normal_range and request.attack.normal_range > 10),
            hit=hit,
            auto_apply=request.auto_apply,
        )

        # 6. Build narrative prompt (stored in meta for on-demand generation)
        narrative_prompt = _build_attack_narrative_prompt(
            attacker=request.attacker,
            target=request.target,
            attack=request.attack,
            hit=hit,
            critical=critical,
            fumble=fumble,
            damage_dealt=total_damage,
            target_defeated=target_defeated
        )
        if power_attack_active:
            narrative_prompt += "\n注意：攻击者使用了「强力打击」（牺牲命中精度换取更大的破坏力），如果命中请体现出这种蓄力猛击的力量感。"
        if enlarge_reduce_mode == "enlarge":
            narrative_prompt += "\n注意：攻击者处于「变巨术」效果下，体型增大，武器造成额外伤害。请描述出巨大化身躯带来的冲击力。"
        elif enlarge_reduce_mode == "reduce":
            narrative_prompt += "\n注意：攻击者处于「缩小术」效果下，体型缩小，武器伤害减弱。请体现出缩小后攻击力不足的感觉。"
        if runtime_bonus_damage_notes:
            narrative_prompt += "\n注意：本次命中还触发了持续法术的额外伤害：" + "；".join(runtime_bonus_damage_notes)
        narrative = ""

        attack_name = request.attack.weapon_name or request.attack.name
        result = build_attack_result_service(
            hit=hit,
            critical=critical,
            fumble=fumble,
            attack_roll=attack_roll,
            damage_roll=damage_roll,
            extra_damage_roll=extra_damage_roll,
            savage_attacks_roll=savage_attacks_roll,
            brutal_critical_roll=brutal_critical_roll,
            inspiration_roll=inspiration_roll,
            total_attack=total_attack,
            target_ac=request.target.ac,
            damage_dealt=damage_dealt,
            damage_type=request.attack.damage_type,
            extra_damage_dealt=extra_damage_dealt,
            extra_damage_type=extra_damage_type,
            savage_attacks_damage=savage_attacks_damage,
            brutal_critical_damage=brutal_critical_damage,
            sneak_attack_roll=sneak_attack_roll,
            sneak_attack_damage=sneak_attack_damage,
            enlarge_reduce_roll=enlarge_reduce_roll,
            enlarge_reduce_damage=enlarge_reduce_damage,
            enlarge_reduce_mode=enlarge_reduce_mode,
            narrative=narrative,
            hp_change=hp_change,
            new_hp=new_hp,
            target_defeated=target_defeated,
            attacker_name=request.attacker.name,
            target_name=request.target.name,
            attack_name=attack_name,
        )
        combat_content = build_attack_combat_log_service(
            attacker_name=request.attacker.name,
            target_name=request.target.name,
            weapon_name=attack_name,
            is_off_hand=request.attack.is_off_hand,
            roll_modifier=roll_modifier,
            attack_d20=attack_d20,
            d20_rolls=d20_rolls,
            advantage_reasons=request.advantage_reasons,
            effect_reasons=effect_reasons,
            attack_bonus_override=request.attack_bonus_override,
            attack_bonus=attack_bonus,
            ability_mod=ability_mod,
            ability_name=ability_name,
            prof_bonus=prof_bonus,
            weapon_proficient=weapon_proficient,
            fighting_style_atk_bonus=fighting_style_atk_bonus,
            fighting_style_atk_label=fighting_style_atk_label,
            power_attack_active=power_attack_active,
            magic_bonus=magic_bonus,
            inspiration_roll=inspiration_roll,
            inspiration_value=inspiration_value,
            inspiration_die=request.inspiration_die,
            attack_bonus_add=request.attack_bonus_add,
            attack_bonus_add_source=request.attack_bonus_add_source,
            total_attack=total_attack,
            hit=hit,
            critical=critical,
            fumble=fumble,
            crit_range=crit_range,
            attacker_class_id=request.attacker.class_id,
            attacker_level=request.attacker.level or 1,
            damage_roll=damage_roll,
            attack_damage_type=request.attack.damage_type,
            damage_ability_mod=damage_ability_mod,
            damage_ability_name=damage_ability_name,
            dueling_bonus=dueling_bonus,
            rage_damage_bonus=rage_damage_bonus,
            gwf_rerolled=gwf_rerolled,
            gwf_original_rolls=gwf_original_rolls,
            extra_damage_roll=extra_damage_roll,
            extra_damage_dealt=extra_damage_dealt,
            extra_damage_type=extra_damage_type,
            savage_attacks_roll=savage_attacks_roll,
            savage_attacks_damage=savage_attacks_damage,
            brutal_critical_roll=brutal_critical_roll,
            brutal_critical_damage=brutal_critical_damage,
            sneak_attack_roll=sneak_attack_roll,
            sneak_attack_damage=sneak_attack_damage,
            divine_strike_roll=divine_strike_roll,
            divine_strike_damage=divine_strike_damage,
            divine_strike_type=divine_strike_type,
            enlarge_reduce_roll=enlarge_reduce_roll,
            enlarge_reduce_damage=enlarge_reduce_damage,
            damage_before_resistance=damage_before_resistance,
            total_damage=total_damage,
            rage_resistance_applied=rage_resistance_applied,
            attacker_is_reckless=attacker_is_reckless,
            halfling_lucky_reroll=halfling_lucky_reroll,
            relentless_triggered=relentless_triggered,
            target_defeated=target_defeated,
            thunderbolt_strike_note=thunderbolt_strike_note,
            damage_type_labels=DAMAGE_TYPE_EN_TO_CN,
        )

        if retaliation_notes:
            combat_content += "\n" + "\n".join(retaliation_notes)

        target_meta = await resolve_attack_target_meta_service(
            db,
            target_token_id=request.target_token_id,
            target_defeated=target_defeated,
        )
        chat_meta = build_attack_chat_meta_service(
            attacker_token_id=request.attacker_token_id,
            attacker_character_id=request.attacker_character_id,
            attacker_monster_instance_id=request.attacker_monster_instance_id,
            target_token_id=request.target_token_id,
            target_character_id=target_meta.target_character_id,
            target_monster_instance_id=target_meta.target_monster_instance_id,
            attacker_name=request.attacker.name,
            target_name=request.target.name,
            target_ac=request.target.ac,
            attack_name=attack_name,
            is_ranged=bool(request.attack.normal_range and request.attack.normal_range > 10),
            total_attack=total_attack,
            hit=hit,
            critical=critical,
            fumble=fumble,
            total_damage=total_damage,
            attack_damage_type=request.attack.damage_type,
            base_damage=damage_dealt,
            extra_damage=extra_damage_dealt,
            extra_damage_type=extra_damage_type,
            savage_attacks_damage=savage_attacks_damage,
            brutal_critical_damage=brutal_critical_damage,
            sneak_attack_damage=sneak_attack_damage,
            divine_strike_damage=divine_strike_damage,
            divine_strike_type=divine_strike_type,
            rage_damage_bonus=rage_damage_bonus,
            rage_resistance_applied=rage_resistance_applied,
            damage_before_resistance=damage_before_resistance,
            target_defeated=target_defeated,
            xp_value=target_meta.xp_value,
            attack_roll=attack_roll,
            damage_roll=damage_roll,
            extra_damage_roll=extra_damage_roll,
            savage_attacks_roll=savage_attacks_roll,
            brutal_critical_roll=brutal_critical_roll,
            sneak_attack_roll=sneak_attack_roll,
            divine_strike_roll=divine_strike_roll,
            inspiration_roll=inspiration_roll,
            inspiration_die=request.inspiration_die,
            narrative_prompt=narrative_prompt,
            damage_type_labels=DAMAGE_TYPE_EN_TO_CN,
        )
        chat_msg = await create_combat_chat_message_service(
            db,
            campaign_id=request.campaign_id,
            sender_user_id=user_id,
            sender_role=role,
            content=combat_content,
            meta=chat_meta,
        )

        # 9. Broadcast chat message
        await realtime_publisher.publish_chat_message(
            request.campaign_id,
            chat_id=chat_msg.id,
            user_id=user_id,
            role=role,
            message=combat_content,
            message_type="combat",
            recipients=[],
            is_private=False,
            meta=chat_msg.meta,
            timestamp=combat_chat_timestamp_ms_service(chat_msg),
        )

        # 10. Broadcast combat result for map updates
        await realtime_publisher.publish_combat_attack_result(
            request.campaign_id,
            attacker_token_id=request.attacker_token_id,
            target_token_id=request.target_token_id,
            target_monster_instance_id=target_meta.target_monster_instance_id,
            xp_value=target_meta.xp_value if target_defeated and target_meta.target_monster_instance_id else 0,
            result=result.model_dump(),
            auto_apply=request.auto_apply,
            message=combat_content,
        )

        # 11. Broadcast HP update for token sync if damage was applied
        if request.auto_apply and hp_change is not None and new_hp is not None and request.target_token_id:
            await realtime_publisher.publish_token_hp_updated(
                request.campaign_id,
                token_id=request.target_token_id,
                current_hp=new_hp,
                temp_hp=hp_persistence.temp_hp if hp_persistence else None,
                hp_change=hp_change,
                target_defeated=target_defeated,
                character_id=(
                    hp_persistence.character_id
                    if hp_persistence
                    else getattr(request, "target_character_id", None)
                ),
                active_effects=hp_persistence.active_effects if hp_persistence else None,
            )

        if request.auto_apply and target_active_effects_changed and request.target_token_id:
            await _broadcast_token_active_effects_update(
                await db.get(Token, request.target_token_id),
                request.campaign_id,
            )

        await _broadcast_concentration_updates(
            db,
            request.campaign_id,
            concentration_touched_token_ids,
        )

        return AttackResponse(
            success=True,
            result=result,
            pending_confirmation=not request.auto_apply
        )

    except Exception as e:
        logger.error(f"Attack action failed: {e}")
        return AttackResponse(
            success=False,
            error=str(e)
        )


# ============== Reaction Endpoint ==============

@router.post("/reaction", response_model=ReactionResponse)
async def use_reaction(
    request: ReactionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Player uses a reaction (defensive, attack, or spell).
    - defense: modify original attack damage/hit
    - attack: perform a melee attack (opportunity attack, riposte, sentinel)
    - spell: cast a reaction spell (counterspell, hellish rebuke, etc.)
    """
    try:
        context = await resolve_campaign_member_context(db, request.campaign_id, current_user)
        user_id = context.user_id
        role = _sender_role_from_context(context)

        rid = request.reaction_id
        cat = request.category
        logger.info(f"[Reaction] {request.reactor_name} uses {rid} (category={cat})")

        # Verify reactor token exists
        reactor_token = await db.get(Token, request.reactor_token_id)
        if not reactor_token:
            return ReactionResponse(success=False, error="反应者token不存在")

        # Load reactor character if needed
        reactor_char = None
        if reactor_token.character_id:
            reactor_char = await db.get(Character, reactor_token.character_id)

        ability_scores = request.reactor_ability_scores
        dex_mod = calc_ability_modifier(ability_scores.dexterity) if ability_scores else 0
        prof_bonus = request.reactor_proficiency_bonus
        level = request.reactor_level

        # Fallback reactor_name when frontend omits it (e.g. counterspell trigger
        # from a spell-cast card may only know the actor token).
        if not (request.reactor_name or "").strip():
            fallback_name = None
            if reactor_char and getattr(reactor_char, "name", None):
                fallback_name = reactor_char.name
            elif getattr(reactor_token, "instance_name", None):
                fallback_name = reactor_token.instance_name
            request.reactor_name = fallback_name or "反应者"

        result = ReactionResult(
            reaction_id=rid,
            reaction_name=reaction_display_name_service(rid),
            reactor_name=request.reactor_name,
        )
        meta_target_token_id = request.target_token_id

        # ── Defense reactions ──
        if cat == "defense":
            if not request.original_chat_message_id:
                return ReactionResponse(success=False, error="防御反应需要提供原始攻击消息")

            original_msg = await db.get(ChatMessage, request.original_chat_message_id)
            if not original_msg or not original_msg.meta:
                return ReactionResponse(success=False, error="找不到原始攻击消息")

            meta = dict(original_msg.meta)
            original_damage = meta.get("damage_dealt", 0)
            attack_total = meta.get("attack_total", 0)
            target_ac = meta.get("target_ac", 10)
            meta_target_token_id = meta.get("target_token_id")
            defense_outcome = resolve_defense_reaction_service(
                reaction_id=rid,
                reactor_name=request.reactor_name,
                original_damage=original_damage,
                attack_total=attack_total,
                target_ac=target_ac,
                dex_mod=dex_mod,
                level=level,
                proficiency_bonus=prof_bonus,
                roll_dice=roll_dice,
            )

            # Apply HP rollback
            damage_diff = max(0, original_damage - defense_outcome.new_damage)
            result.damage_reduced = damage_diff
            result.original_damage = original_damage
            result.new_damage = defense_outcome.new_damage
            result.ac_bonus = defense_outcome.ac_bonus
            result.attack_now_misses = defense_outcome.attack_now_misses
            result.description = defense_outcome.description

            if damage_diff > 0:
                # Rollback HP on the target token
                target_tid = meta.get("target_token_id")
                meta_target_token_id = target_tid
                hp_restore = await restore_direct_token_hp_service(
                    db,
                    target_token_id=target_tid,
                    restore_amount=damage_diff,
                )
                result.new_hp = hp_restore.new_hp
                result.hp_restored = hp_restore.hp_change

                if target_tid and hp_restore.new_hp is not None:
                    await realtime_publisher.publish_token_hp_updated(
                        request.campaign_id,
                        token_id=target_tid,
                        current_hp=hp_restore.new_hp,
                        temp_hp=hp_restore.temp_hp,
                        active_effects=hp_restore.active_effects,
                        character_id=hp_restore.character_id,
                        monster_instance_id=hp_restore.monster_instance_id,
                        hp_change=hp_restore.hp_change,
                        target_defeated=hp_restore.target_defeated,
                    )

            # Consume spell slot if needed
            if rid == "shield_spell" and reactor_char and request.spell_slot_level:
                await _consume_spell_slot(
                    db,
                    reactor_char,
                    request.spell_slot_level,
                    campaign_id=request.campaign_id,
                )

        # ── Attack reactions ──
        elif cat == "attack":
            if not request.attack or not request.attacker_data or not request.target_data:
                return ReactionResponse(success=False, error="攻击反应需要提供 attack/attacker_data/target_data")
            # Reuse existing attack calculation (simplified — single melee attack)
            atk_details = calc_attack_bonus_details(request.attacker_data, request.attack)
            atk_bonus = atk_details["total"]
            atk_roll = roll_dice(1, 20, 0)
            attack_d20 = atk_roll.rolls[0]
            total_attack = attack_d20 + atk_bonus
            crit = attack_d20 >= request.attacker_data.crit_range
            hit = crit or (attack_d20 != 1 and total_attack >= request.target_data.ac)

            total_damage = 0
            damage_roll = None
            if hit and request.attack.damage:
                num_dice, die_size, mod = parse_damage_dice(request.attack.damage)
                if crit:
                    num_dice *= 2
                dmg_bonus_details = calc_damage_bonus(request.attacker_data, request.attack)
                damage_mod = dmg_bonus_details["bonus"]
                damage_roll = roll_dice(num_dice, die_size, damage_mod)
                total_damage = max(0, damage_roll.total)
                # Riposte: add superiority die
                if rid == "riposte":
                    sup_die = get_reaction_superiority_die_service(level)
                    sup_roll = roll_dice(1, sup_die, 0)
                    total_damage += sup_roll.total

            # Build description
            weapon_name = request.attack.weapon_name or request.attack.name
            description = build_attack_reaction_description_service(
                reaction_id=rid,
                reactor_name=request.reactor_name,
                target_name=request.target_data.name,
                total_attack=total_attack,
                target_ac=request.target_data.ac,
                hit=hit,
                total_damage=total_damage,
            )

            # Apply damage if hit
            new_hp = None
            hp_change = None
            target_defeated = False
            if hit and total_damage > 0 and request.target_token_id:
                hp_change_result = await apply_direct_token_damage_service(
                    db,
                    target_token_id=request.target_token_id,
                    damage_amount=total_damage,
                )
                new_hp = hp_change_result.new_hp
                hp_change = hp_change_result.hp_change
                target_defeated = hp_change_result.target_defeated
                if new_hp is not None:
                    await realtime_publisher.publish_token_hp_updated(
                        request.campaign_id,
                        token_id=request.target_token_id,
                        current_hp=new_hp,
                        temp_hp=hp_change_result.temp_hp,
                        active_effects=hp_change_result.active_effects,
                        character_id=hp_change_result.character_id,
                        monster_instance_id=hp_change_result.monster_instance_id,
                        hp_change=hp_change_result.hp_change,
                        target_defeated=hp_change_result.target_defeated,
                    )

            attack_result = build_attack_result_service(
                hit=hit,
                critical=crit,
                fumble=(attack_d20 == 1),
                attack_roll=DiceRoll(dice="1d20", rolls=atk_roll.rolls, modifier=atk_bonus, total=total_attack),
                damage_roll=damage_roll,
                extra_damage_roll=None,
                savage_attacks_roll=None,
                brutal_critical_roll=None,
                inspiration_roll=None,
                total_attack=total_attack,
                target_ac=request.target_data.ac,
                damage_dealt=total_damage,
                damage_type=request.attack.damage_type,
                extra_damage_dealt=0,
                extra_damage_type=None,
                savage_attacks_damage=0,
                brutal_critical_damage=0,
                sneak_attack_roll=None,
                sneak_attack_damage=0,
                enlarge_reduce_roll=None,
                enlarge_reduce_damage=0,
                enlarge_reduce_mode=None,
                narrative="",
                hp_change=hp_change if hit else None,
                new_hp=new_hp,
                target_defeated=target_defeated,
                attacker_name=request.reactor_name,
                target_name=request.target_data.name,
                attack_name=weapon_name,
            )
            result.attack_result = attack_result
            result.description = description
            result.new_hp = new_hp

        # ── Spell reactions ──
        elif cat == "spell":
            total_damage = 0
            if rid == "counterspell":
                # V1 counterspell: if the target caster currently has an
                # in-progress cast (long-cast / pending release), clear it and
                # broadcast the interruption. Instant spells already resolved
                # before the reaction reached us are NOT rolled back here.
                interrupted_name: Optional[str] = None
                if request.target_token_id:
                    target_caster = await db.get(Token, request.target_token_id)
                    if target_caster and target_caster.casting_in_progress:
                        broken = dict(target_caster.casting_in_progress)
                        interrupted_name = broken.get("spell_name") or broken.get("spell_id")
                        target_caster.casting_in_progress = None
                        flag_modified(target_caster, "casting_in_progress")
                        await db.commit()
                        await realtime_publisher.publish_token_casting_interrupted(
                            request.campaign_id,
                            token_id=target_caster.id,
                            casting_in_progress=None,
                            broken_cast=broken,
                            reason="counterspell",
                        )
                        result.countered = True
                        result.interrupted_spell_name = interrupted_name
                if interrupted_name:
                    result.description = (
                        f"🚫 {request.reactor_name} 施放【反制法术】"
                        f"打断了【{interrupted_name}】！"
                    )
                else:
                    base_desc = build_spell_reaction_description_service(
                        reaction_id=rid,
                        reactor_name=request.reactor_name,
                        spell_slot_level=request.spell_slot_level,
                    )
                    # Be honest: instant spells already applied effects.
                    result.description = (
                        f"{base_desc}（已记录反制；该法术效果若已结算则不会回滚）"
                    )
            elif rid == "hellish_rebuke":
                # 2d10 fire + 1d10 per slot above 1
                slot = request.spell_slot_level or 1
                num_dice = 1 + slot  # 2d10 at level 1, 3d10 at level 2, etc.
                dmg_roll = roll_dice(num_dice, 10, 0)
                total_damage = dmg_roll.total
                description = build_spell_reaction_description_service(
                    reaction_id=rid,
                    reactor_name=request.reactor_name,
                    spell_slot_level=slot,
                    total_damage=total_damage,
                )
                # Apply damage to attacker
                if request.target_token_id:
                    hp_change_result = await apply_direct_token_damage_service(
                        db,
                        target_token_id=request.target_token_id,
                        damage_amount=total_damage,
                    )
                    result.new_hp = hp_change_result.new_hp
                    result.damage_reduced = hp_change_result.hp_change
                    if result.new_hp is not None:
                        await realtime_publisher.publish_token_hp_updated(
                            request.campaign_id,
                            token_id=request.target_token_id,
                            current_hp=result.new_hp,
                            temp_hp=hp_change_result.temp_hp,
                            active_effects=hp_change_result.active_effects,
                            character_id=hp_change_result.character_id,
                            monster_instance_id=hp_change_result.monster_instance_id,
                            hp_change=hp_change_result.hp_change,
                            target_defeated=hp_change_result.target_defeated,
                        )
                else:
                    result.damage_reduced = -total_damage
                result.description = description
            elif rid == "absorb_elements":
                result.description = build_spell_reaction_description_service(
                    reaction_id=rid,
                    reactor_name=request.reactor_name,
                    spell_slot_level=request.spell_slot_level,
                )
            elif rid == "feather_fall":
                result.description = build_spell_reaction_description_service(
                    reaction_id=rid,
                    reactor_name=request.reactor_name,
                    spell_slot_level=request.spell_slot_level,
                )
            else:
                result.description = build_spell_reaction_description_service(
                    reaction_id=rid,
                    reactor_name=request.reactor_name,
                    spell_slot_level=request.spell_slot_level,
                    total_damage=total_damage,
                )

            # Consume spell slot
            if reactor_char and request.spell_slot_level:
                await _consume_spell_slot(
                    db,
                    reactor_char,
                    request.spell_slot_level,
                    campaign_id=request.campaign_id,
                )
        else:
            return ReactionResponse(success=False, error=f"未知反应类别: {cat}")

        # Broadcast reaction chat message
        chat_meta = build_reaction_chat_meta_service(
            reaction_id=rid,
            reactor_token_id=request.reactor_token_id,
            target_token_id=meta_target_token_id,
            damage_reduced=result.damage_reduced,
            attack_now_misses=result.attack_now_misses,
        )
        chat_msg = await create_combat_chat_message_service(
            db,
            campaign_id=request.campaign_id,
            sender_user_id=user_id,
            sender_role=role,
            content=result.description,
            meta=chat_meta,
        )
        await realtime_publisher.publish_chat_message(
            request.campaign_id,
            chat_id=chat_msg.id,
            user_id=user_id,
            role=role,
            message=result.description,
            message_type="combat",
            recipients=[],
            is_private=False,
            meta=chat_msg.meta,
            timestamp=combat_chat_timestamp_ms_service(chat_msg),
        )

        # Broadcast reaction-used event so CombatPanel can sync
        await realtime_publisher.publish_combat_reaction_used(
            request.campaign_id,
            reactor_token_id=request.reactor_token_id,
            reaction_id=rid,
        )

        return ReactionResponse(success=True, result=result)

    except Exception as e:
        logger.error(f"Reaction failed: {e}", exc_info=True)
        return ReactionResponse(success=False, error=str(e))

class GenerateNarrativeRequest(BaseModel):
    """Request to generate combat narrative on demand"""
    chat_message_id: int
    campaign_id: int


class GenerateNarrativeResponse(BaseModel):
    """Response with generated narrative"""
    success: bool
    narrative: Optional[str] = None
    error: Optional[str] = None


@router.post("/generate-narrative", response_model=GenerateNarrativeResponse)
async def generate_combat_narrative(
    request: GenerateNarrativeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Generate combat narrative on demand for a specific chat message."""
    try:
        context = await resolve_campaign_member_context(db, request.campaign_id, current_user)
        user_id = context.user_id
        role = _sender_role_from_context(context)

        chat_msg = await db.get(ChatMessage, request.chat_message_id)
        if not chat_msg:
            raise HTTPException(status_code=404, detail="Chat message not found")
        if chat_msg.campaign_id != request.campaign_id:
            raise HTTPException(status_code=403, detail="Campaign mismatch")

        meta = chat_msg.meta or {}
        if meta.get("has_narrative"):
            return GenerateNarrativeResponse(
                success=True,
                narrative=meta.get("narrative", "")
            )

        narrative_prompt = meta.get("narrative_prompt")
        if not narrative_prompt:
            return GenerateNarrativeResponse(
                success=False,
                error="No narrative prompt stored for this message"
            )

        # Determine usage_key and max_tokens based on combat_type
        combat_type = meta.get("combat_type", "attack")
        if combat_type == "attack":
            usage_key = "combat_attack_narrative"
            max_tokens = 150
        elif combat_type in ("spell", "area_spell"):
            usage_key = "combat_spell_narrative"
            max_tokens = 200
        else:
            usage_key = "combat_attack_narrative"
            max_tokens = 150

        narrative = await _call_llm_for_text(
            db=db,
            prompt=narrative_prompt,
            usage_key=usage_key,
            max_tokens=max_tokens
        )
        narrative = narrative.strip().strip('"\'')

        # Update chat message content with narrative
        if combat_type == "area_spell":
            new_content = chat_msg.content + f"\n> {narrative}"
        else:
            new_content = chat_msg.content + f"\n_{narrative}_"

        chat_msg.content = new_content
        chat_msg.meta = {**meta, "has_narrative": True, "narrative": narrative}
        flag_modified(chat_msg, "meta")
        await db.commit()

        # Broadcast narrative update
        await realtime_publisher.publish_combat_narrative_updated(
            request.campaign_id,
            chat_message_id=chat_msg.id,
            narrative=narrative,
            content=new_content,
        )

        return GenerateNarrativeResponse(success=True, narrative=narrative)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate narrative: {e}")
        return GenerateNarrativeResponse(success=False, error=str(e))


class ExtraEffectRequest(BaseModel):
    """Request to generate extra effect for critical/fumble"""
    effect_type: str  # "critical" or "fumble"
    attacker_name: str
    target_name: str
    attack_name: str
    damage_dealt: int = 0
    campaign_id: int


class ExtraEffectResponse(BaseModel):
    """Response with generated extra effect"""
    success: bool
    effect: Optional[str] = None
    effect_type: str = ""
    error: Optional[str] = None


@router.post("/extra-effect", response_model=ExtraEffectResponse)
async def generate_extra_effect(
    request: ExtraEffectRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Generate extra effect description for critical hit or fumble.
    Uses AI to create dramatic, game-appropriate effects.
    """
    try:
        context = await resolve_campaign_member_context(db, request.campaign_id, current_user)
        user_id = context.user_id
        role = _sender_role_from_context(context)

        try:
            prompt = build_extra_effect_prompt_service(
                effect_type=request.effect_type,
                attacker_name=request.attacker_name,
                target_name=request.target_name,
                attack_name=request.attack_name,
                damage_dealt=request.damage_dealt,
            )
        except ValueError as exc:
            return ExtraEffectResponse(
                success=False,
                error=str(exc),
            )

        effect = await _call_llm_for_text(
            db=db,
            prompt=prompt,
            usage_key="combat_extra_effect",
            max_tokens=200
        )

        chat_content = build_extra_effect_chat_content_service(
            effect_type=request.effect_type,
            effect=effect,
        )
        chat_meta = build_extra_effect_chat_meta_service(
            effect_type=request.effect_type,
            attacker_name=request.attacker_name,
            target_name=request.target_name,
        )
        chat_msg = await create_combat_chat_message_service(
            db,
            campaign_id=request.campaign_id,
            sender_user_id=user_id,
            sender_role=role,
            content=chat_content,
            meta=chat_meta,
        )

        await realtime_publisher.publish_chat_message(
            request.campaign_id,
            chat_id=chat_msg.id,
            user_id=user_id,
            role=role,
            message=chat_content,
            message_type="combat",
            recipients=[],
            is_private=False,
            meta=chat_msg.meta,
            timestamp=combat_chat_timestamp_ms_service(chat_msg),
        )

        return ExtraEffectResponse(
            success=True,
            effect=effect.strip(),
            effect_type=request.effect_type
        )

    except Exception as e:
        logger.error(f"Failed to generate extra effect: {e}", exc_info=True)
        return ExtraEffectResponse(
            success=False,
            error=str(e)
        )


@router.post("/saving-throw", response_model=SavingThrowResponse)
async def perform_saving_throw(
    request: SavingThrowRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Perform saving throws for one or more targets.

    1. Calculate saving throw modifier for each target
    2. Roll saving throw (d20 + modifier)
    3. Compare to DC
    4. Roll damage if applicable
    5. Apply damage based on success/failure
    6. Broadcast result via WebSocket
    """
    try:
        context = await resolve_campaign_member_context(db, request.campaign_id, current_user)
        user_id = context.user_id
        role = _sender_role_from_context(context)

        target_results = []
        successful_saves = 0
        failed_saves = 0
        tokens_with_effect_updates: set[int] = set()
        concentration_touched_token_ids: List[int] = []
        source_token = await db.get(Token, request.source_token_id) if request.source_token_id else None

        # Roll damage once for all targets (if applicable)
        damage_roll = None
        base_damage = 0
        if request.damage_dice:
            num_dice, die_size, modifier = parse_damage_dice(request.damage_dice)
            damage_roll = roll_dice(num_dice, die_size, modifier)
            base_damage = max(0, damage_roll.total)

        # Process each target
        for target in request.targets:
            # Calculate saving throw modifier
            if target.saving_throw_override is not None:
                # Use override for monsters
                save_mod = target.saving_throw_override
                save_details = {
                    "ability_mod": save_mod,
                    "proficiency_bonus": 0,
                    "is_proficient": False,
                    "total": save_mod,
                    "ability_name_cn": ABILITY_NAMES.get(request.save_type.lower(), request.save_type)
                }
            else:
                # Calculate from ability scores
                ability_scores_dict = {
                    "strength": target.ability_scores.strength,
                    "dexterity": target.ability_scores.dexterity,
                    "constitution": target.ability_scores.constitution,
                    "intelligence": target.ability_scores.intelligence,
                    "wisdom": target.ability_scores.wisdom,
                    "charisma": target.ability_scores.charisma
                }

                # Extract feat-granted saving throw proficiencies (Resilient)
                extra_save_profs = []
                if target.character_id:
                    target_char_st = await db.get(Character, target.character_id)
                    if target_char_st:
                        st_feats = target_char_st.feats or []
                        st_feat_ids = [f if isinstance(f, str) else (f.get('value') or f.get('id', '')) for f in st_feats]
                        if 'resilient' in st_feat_ids:
                            fc = (target_char_st.feat_choices or {}).get('resilient', {})
                            ability_choice = fc.get('abilityChoice')
                            if ability_choice:
                                extra_save_profs.append(ability_choice)
                                logger.info(f"[SavingThrow] Resilient feat: {target.name} has extra proficiency in {ability_choice}")

                save_details = calc_saving_throw_modifier(
                    ability_scores=ability_scores_dict,
                    save_type=request.save_type,
                    class_id=target.class_id,
                    level=target.level,
                    proficiency_bonus=target.proficiency_bonus,
                    extra_proficient_saves=extra_save_profs if extra_save_profs else None
                )
                save_mod = save_details["total"]

            # Check for advantage/disadvantage
            target_token = await db.get(Token, target.token_id) if target.token_id else None
            base_active_effects = list(target_token.active_effects or []) if target_token else []
            runtime_save_effects: List[Dict[str, Any]] = []
            if target_token:
                runtime_save_effects = await get_token_runtime_modifier_effects(
                    db,
                    campaign_id=request.campaign_id,
                    token_id=target_token.id,
                )
            save_ability = {
                "str": "strength",
                "dex": "dexterity",
                "con": "constitution",
                "int": "intelligence",
                "wis": "wisdom",
                "cha": "charisma",
            }.get(request.save_type.lower(), request.save_type.lower())
            # Evaluate bonus formulas exactly once across the merged envelope list.
            effect_save_modifiers = get_modifiers_for_target(
                base_active_effects + runtime_save_effects,
                "saving_throw",
                {"ability": save_ability},
            )
            effect_save_bonus = sum(int(value) for value in effect_save_modifiers.get("bonuses", []))
            if effect_save_bonus:
                save_mod += effect_save_bonus
                logger.info(
                    f"[SavingThrow] Active effects bonus +{effect_save_bonus} for {target.name} "
                    f"({', '.join(effect_save_modifiers.get('reasons') or [])})"
                )
            # For downstream advantage/disadvantage and effect lookups, strip the
            # `bonus` modifiers from runtime envelopes — re-running
            # get_modifiers_for_target inside check_advantage_on_save would otherwise
            # re-roll the same formula (e.g. Bless 1d4) for an unrelated bonus reason.
            active_effects = base_active_effects + strip_bonus_modifiers_from_runtime_effects(
                runtime_save_effects
            )

            # Check armor proficiency for saving throw penalty
            target_char = None
            target_armor_non_prof = False
            if target.character_id:
                target_char = await db.get(Character, target.character_id)
                if target_char:
                    penalty = check_armor_proficiency_penalty(target_char)
                    target_armor_non_prof = penalty["has_penalty"]

            adv_disadv = check_advantage_on_save(
                request.save_type, active_effects,
                armor_non_proficient=target_armor_non_prof
            )

            passive_save_sources = await _get_passive_save_advantage_for_token(
                db,
                target_token,
                request.save_type,
                target_char,
            )
            if passive_save_sources:
                adv_disadv["advantage"] = True
                logger.info(
                    f"[SavingThrow] Passive save advantage: {target.name} <- {', '.join(passive_save_sources)}"
                )

            # Mage Slayer: advantage on saves vs spells within 5ft
            if request.source_token_id and target_token:
                ms_char = target_char if target_char else (
                    await db.get(Character, target.character_id) if target.character_id else None
                )
                if ms_char:
                    ms_feats = ms_char.feats or []
                    ms_ids = [f if isinstance(f, str) else (f.get('value') or f.get('id', '')) for f in ms_feats]
                    if 'mage_slayer' in ms_ids:
                        source_token = await db.get(Token, request.source_token_id)
                        if source_token:
                            dx = abs((target_token.position_x or 0) - (source_token.position_x or 0))
                            dy = abs((target_token.position_y or 0) - (source_token.position_y or 0))
                            distance = max(dx, dy) * 5  # Each grid cell = 5ft
                            if distance <= 5:
                                adv_disadv["advantage"] = True
                                logger.info(f"[SavingThrow] Mage Slayer: {target.name} has advantage (source within 5ft)")

            # Racial saving throw advantages (e.g., Dwarf vs poison, Elf vs charm, Halfling vs fear)
            if target.character_id:
                _race_char = target_char if target_char else await db.get(Character, target.character_id)
                if _race_char:
                    from app.utils.race_effects import get_saving_throw_advantages
                    race_id = _race_char.subrace_id or _race_char.race_id or ''
                    racial_advs = get_saving_throw_advantages(race_id)
                    for adv in racial_advs:
                        adv_lower = adv.lower()
                        save_lower = request.save_type.lower()
                        effect_lower = (request.effect_name or '').lower()
                        if (adv_lower == save_lower
                            or adv_lower in effect_lower
                            or (adv_lower == 'poison' and ('毒' in effect_lower or 'poison' in effect_lower))
                            or (adv_lower == 'charm' and ('魅惑' in effect_lower or 'charm' in effect_lower))
                            or (adv_lower == 'charmed' and ('魅惑' in effect_lower or 'charm' in effect_lower))
                            or (adv_lower == 'fear' and ('恐惧' in effect_lower or 'fright' in effect_lower or 'fear' in effect_lower))):
                            adv_disadv["advantage"] = True
                            logger.info(f"[SavingThrow] Racial advantage: {target.name} has advantage vs {adv}")
                            break

            if target_has_corona_of_light_save_disadvantage(
                source_token,
                target_token,
                request.damage_type,
            ):
                adv_disadv["disadvantage"] = True
                logger.info(f"[SavingThrow] Corona of Light: {target.name} has disadvantage vs {request.effect_name}")

            # Portent: replace d20 with stored value
            portent_used_save = False
            if target.portent_value is not None:
                save_d20 = target.portent_value
                rolls = [save_d20]
                portent_used_save = True
                logger.info(f"[SavingThrow] Portent: {target.name} using stored d20={save_d20}")
            else:
                # Roll saving throw
                save_d20, rolls = _roll_save_d20(
                    advantage=adv_disadv["advantage"],
                    disadvantage=adv_disadv["disadvantage"],
                )

            # Halfling Lucky: reroll natural 1 on saving throw
            halfling_lucky_reroll_save = False
            if save_d20 == 1:
                _race_char_hl = target_char if target_char else (
                    await db.get(Character, target.character_id) if target.character_id else None
                )
                if _race_char_hl:
                    from app.utils.race_effects import check_lucky
                    if check_lucky(_race_char_hl.subrace_id or _race_char_hl.race_id or ''):
                        save_d20 = random.randint(1, 20)
                        rolls.append(save_d20)
                        halfling_lucky_reroll_save = True
                        logger.info(f"[SavingThrow] Halfling Lucky: {target.name} rerolled nat 1 -> {save_d20}")

            # Lucky feat: roll extra d20, pick best
            lucky_used = False
            if target.character_id and target.character_id in request.use_lucky_character_ids:
                extra_d20 = random.randint(1, 20)
                rolls.append(extra_d20)
                save_d20 = max(save_d20, extra_d20)
                lucky_used = True
                logger.info(f"[SavingThrow] Lucky feat: {target.name} rolled extra d20={extra_d20}, using {save_d20}")

            # Bardic Inspiration on saving throw
            save_inspiration_value = 0
            if (request.inspiration_die
                    and target.character_id
                    and target.character_id in request.inspiration_character_ids):
                die_match = re.match(r'd(\d+)', request.inspiration_die.lower())
                if die_match:
                    insp_die_size = int(die_match.group(1))
                    save_inspiration_value = random.randint(1, insp_die_size)
                    logger.info(f"[SavingThrow] Bardic Inspiration: {target.name} rolled {request.inspiration_die} = {save_inspiration_value}")

            save_total = save_d20 + save_mod + save_inspiration_value
            success = save_total >= request.save_dc

            if success:
                successful_saves += 1
            else:
                failed_saves += 1

            # Calculate damage for this target
            target_damage = 0
            hp_change = None
            new_hp = None
            target_defeated = False

            if base_damage > 0:
                if success and request.half_on_success:
                    save_success_override = get_save_success_override(active_effects, scope="spell")
                    if save_success_override and save_success_override.get("mode") == "no_damage_on_success":
                        target_damage = 0
                    else:
                        target_damage = base_damage // 2
                elif not success:
                    target_damage = base_damage

                # Check for resistance / immunity from base stats and active effects
                if target_damage > 0 and request.damage_type:
                    base_immunity = check_damage_immunity(request.damage_type, target.damage_immunities)
                    base_resistance = check_damage_resistance(request.damage_type, target.damage_resistances)
                    effect_resistance = False
                    effect_immunity = False
                    if active_effects:
                        effect_resistance, effect_immunity = check_resistances(
                            active_effects,
                            request.damage_type,
                            damage_source="spell",
                        )
                    if base_immunity or effect_immunity:
                        target_damage = 0
                    elif base_resistance or effect_resistance:
                        target_damage = target_damage // 2

                # Check for rage resistance
                if target_damage > 0 and target_token and target_token.active_effects:
                    if check_is_raging(target_token.active_effects):
                        if is_physical_damage(request.damage_type):
                            target_damage = target_damage // 2
                            logger.info(f"[SavingThrow] Rage resistance applied for {target.name}")

                if target_damage > 0 and target_token:
                    pending_damage_result = await apply_pending_damage_received_effects(
                        token=target_token,
                        damage_amount=target_damage,
                        damage_type=request.damage_type,
                        db=db,
                        consume_effects=request.auto_apply,
                    )
                    target_damage = pending_damage_result.damage_after_effects
                    if pending_damage_result.active_effects_changed:
                        tokens_with_effect_updates.add(target_token.id)
                    concentration_touched_token_ids.extend(
                        pending_damage_result.concentration_touched_token_ids
                    )

                # Heavy Armor Master: reduce non-magical physical damage by 3
                if target_damage > 0 and is_physical_damage(request.damage_type) and target.character_id:
                    ham_char = target_char if target_char else await db.get(Character, target.character_id)
                    if ham_char:
                        ham_feats = ham_char.feats or []
                        ham_ids = [f if isinstance(f, str) else (f.get('value') or f.get('id', '')) for f in ham_feats]
                        if 'heavy_armor_master' in ham_ids:
                            equipment = ham_char.equipment or []
                            wearing_heavy = any(
                                item.get('type') == 'heavy'
                                for item in equipment
                                if isinstance(item, dict) and item.get('equippedSlot') == 'armor'
                            )
                            if wearing_heavy:
                                ham_red = min(3, target_damage)
                                target_damage -= ham_red
                                logger.info(f"[SavingThrow] Heavy Armor Master: {target.name} damage reduced by {ham_red}")

                # Calculate HP changes
                if target_damage > 0:
                    effective_hp = target.current_hp
                    if effective_hp is None and target_token:
                        effective_hp = target_token.current_hp

                    if effective_hp is not None:
                        # Temp HP absorption (D&D 5E)
                        actual_damage = target_damage
                        if target_token:
                            actual_damage = await _absorb_temp_hp(target_token, actual_damage, db)
                        hp_change = -actual_damage
                        new_hp = max(0, effective_hp + hp_change)
                        target_defeated = new_hp <= 0

                        # Persist HP changes if auto_apply
                        if request.auto_apply:
                            if target_token:
                                target_token.current_hp = new_hp
                            if target.character_id:
                                char = await db.get(Character, target.character_id)
                                if char:
                                    char.current_hp = new_hp
                            elif target.monster_instance_id:
                                monster = await db.get(MonsterInstance, target.monster_instance_id)
                                if monster:
                                    monster.current_hp = new_hp

            # Build target result
            save_roll = DiceRoll(
                dice="1d20" if len(rolls) == 1 else "2d20",
                rolls=rolls,
                modifier=save_mod,
                total=save_total
            )

            target_result = SavingThrowTargetResult(
                target_name=target.name,
                target_token_id=target.token_id,
                save_roll=save_roll,
                save_modifier=save_mod,
                save_total=save_total,
                save_dc=request.save_dc,
                success=success,
                damage_roll=damage_roll,
                damage_dealt=target_damage,
                damage_type=request.damage_type,
                hp_change=hp_change,
                new_hp=new_hp,
                target_defeated=target_defeated
            )
            target_results.append(target_result)

        # Commit HP changes
        if request.auto_apply:
            await db.commit()

        narrative = build_saving_throw_narrative_service(
            source_name=request.source_name,
            effect_name=request.effect_name,
            save_type=request.save_type,
            save_dc=request.save_dc,
            target_results=target_results,
            successful_saves=successful_saves,
            failed_saves=failed_saves,
            damage_type=request.damage_type,
            half_on_success=request.half_on_success,
            ability_names=ABILITY_NAMES,
        )
        result = build_saving_throw_result_service(
            effect_name=request.effect_name,
            source_name=request.source_name,
            save_type=request.save_type,
            save_dc=request.save_dc,
            target_results=target_results,
            successful_saves=successful_saves,
            failed_saves=failed_saves,
            narrative=narrative,
        )
        combat_content = build_saving_throw_combat_log_service(
            source_name=request.source_name,
            effect_name=request.effect_name,
            save_type=request.save_type,
            save_dc=request.save_dc,
            target_results=target_results,
            damage_type=request.damage_type,
            half_on_success=request.half_on_success,
            narrative=narrative,
            ability_names=ABILITY_NAMES,
        )
        chat_meta = build_saving_throw_chat_meta_service(
            effect_name=request.effect_name,
            source_name=request.source_name,
            save_type=request.save_type,
            save_dc=request.save_dc,
            total_targets=len(request.targets),
            successful_saves=successful_saves,
            failed_saves=failed_saves,
            damage_roll=damage_roll,
        )
        chat_msg = await create_combat_chat_message_service(
            db,
            campaign_id=request.campaign_id,
            sender_user_id=user_id,
            sender_role=role,
            content=combat_content,
            meta=chat_meta,
        )
        await realtime_publisher.publish_chat_message(
            request.campaign_id,
            chat_id=chat_msg.id,
            user_id=user_id,
            role=role,
            message=combat_content,
            message_type="combat",
            recipients=[],
            is_private=False,
            meta=chat_msg.meta,
            timestamp=combat_chat_timestamp_ms_service(chat_msg),
        )

        # Broadcast HP updates for affected tokens
        # Pre-fetch character_ids and temp_hp for sidebar HP sync
        if request.auto_apply:
            _hp_token_ids = [
                t.target_token_id
                for t in target_results
                if t.hp_change is not None and t.new_hp is not None and t.target_token_id
            ]
            _token_info_map: Dict[int, dict] = {}
            if _hp_token_ids:
                _tokens_result = await db.execute(select(Token).where(Token.id.in_(_hp_token_ids)))
                for _t in _tokens_result.scalars().all():
                    _token_info_map[_t.id] = {
                        "character_id": _t.character_id,
                        "monster_instance_id": _t.monster_instance_id,
                        "temp_hp": _t.temp_hp,
                        "active_effects": _t.active_effects,
                    }

            for t in target_results:
                if t.hp_change is not None and t.new_hp is not None:
                    _info = _token_info_map.get(t.target_token_id, {})
                    await realtime_publisher.publish_token_hp_updated(
                        request.campaign_id,
                        token_id=t.target_token_id,
                        current_hp=t.new_hp,
                        temp_hp=_info.get("temp_hp"),
                        active_effects=_info.get("active_effects"),
                        character_id=_info.get("character_id"),
                        monster_instance_id=_info.get("monster_instance_id"),
                        hp_change=t.hp_change,
                        target_defeated=t.target_defeated,
                    )

        for token_id in tokens_with_effect_updates:
            await _broadcast_token_active_effects_update(
                await db.get(Token, token_id),
                request.campaign_id,
            )

        await _broadcast_concentration_updates(
            db,
            request.campaign_id,
            concentration_touched_token_ids,
        )

        return SavingThrowResponse(
            success=True,
            result=result
        )

    except Exception as e:
        logger.error(f"Saving throw failed: {e}", exc_info=True)
        return SavingThrowResponse(
            success=False,
            error=str(e)
        )


@router.post("/ability-check", response_model=AbilityCheckResponse)
async def perform_ability_check(
    request: AbilityCheckRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Perform an ability check or skill check.

    1. Determine ability and skill
    2. Calculate modifier (ability + proficiency/expertise)
    3. Check for advantage/disadvantage
    4. Roll d20 + modifier
    5. Compare to DC if provided
    6. Broadcast result via WebSocket
    """
    try:
        context = await resolve_campaign_member_context(db, request.campaign_id, current_user)
        user_id = context.user_id
        role = _sender_role_from_context(context)

        execution = await resolve_ability_check_usecase_service(
            db=db,
            request=request,
        )
        chat_msg = await create_combat_chat_message_service(
            db,
            campaign_id=request.campaign_id,
            sender_user_id=user_id,
            sender_role=role,
            content=execution.combat_content,
            meta=execution.chat_meta,
        )
        await realtime_publisher.publish_chat_message(
            request.campaign_id,
            chat_id=chat_msg.id,
            user_id=user_id,
            role=role,
            message=execution.combat_content,
            message_type="combat",
            recipients=[],
            is_private=False,
            meta=chat_msg.meta,
            timestamp=combat_chat_timestamp_ms_service(chat_msg),
        )

        return AbilityCheckResponse(
            success=True,
            result=execution.result
        )

    except Exception as e:
        logger.error(f"Ability check failed: {e}", exc_info=True)
        return AbilityCheckResponse(
            success=False,
            error=str(e)
        )


@router.post("/contest", response_model=ContestResponse)
async def perform_contest(
    request: ContestRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Perform a contested ability check (e.g., grapple, shove).

    1. Determine check types for attacker and defender
    2. Roll checks for both sides
    3. Compare results (ties go to defender)
    4. Broadcast result via WebSocket
    """
    try:
        context = await resolve_campaign_member_context(db, request.campaign_id, current_user)
        user_id = context.user_id
        role = _sender_role_from_context(context)

        execution = await resolve_contest_usecase_service(
            db=db,
            request=request,
        )
        chat_msg = await create_combat_chat_message_service(
            db,
            campaign_id=request.campaign_id,
            sender_user_id=user_id,
            sender_role=role,
            content=execution.combat_content,
            meta=execution.chat_meta,
        )
        await realtime_publisher.publish_chat_message(
            request.campaign_id,
            chat_id=chat_msg.id,
            user_id=user_id,
            role=role,
            message=execution.combat_content,
            message_type="combat",
            recipients=[],
            is_private=False,
            meta=chat_msg.meta,
            timestamp=combat_chat_timestamp_ms_service(chat_msg),
        )

        if execution.effect_update:
            await realtime_publisher.publish_token_effects_updated(
                request.campaign_id,
                token_id=execution.effect_update.token_id,
                active_effects=execution.effect_update.active_effects,
                reason=execution.effect_update.reason,
                monster_instance_id=execution.effect_update.monster_instance_id,
                monster_status_effects=execution.effect_update.monster_status_effects,
                character_id=execution.effect_update.character_id,
                character_status_effects=execution.effect_update.character_status_effects,
            )

        return ContestResponse(
            success=True,
            result=execution.result
        )

    except Exception as e:
        logger.error(f"Contest failed: {e}", exc_info=True)
        return ContestResponse(
            success=False,
            error=str(e)
        )


# ============== Spell Casting ==============

# Import spell-related schemas
from app.schemas.combat import (
    SpellCastRequest, SpellCastResponse, SpellCastResult,
    SpellData, CasterData, SpellTargetData,
    DAMAGE_TYPE_EN_TO_CN, SAVE_TYPE_CN,
    AreaSpellCastRequest, AreaSpellCastResponse, AreaSpellCastResult, AreaSpellTargetResult
)


def calc_spell_attack_bonus(caster: CasterData) -> int:
    """Calculate spell attack bonus: proficiency + spellcasting ability modifier"""
    ability = caster.spellcasting_ability.lower()
    ability_score = getattr(caster.ability_scores, ability, 10)
    ability_mod = calc_ability_modifier(ability_score)
    return caster.proficiency_bonus + ability_mod


def calc_spell_save_dc(caster: CasterData) -> int:
    """Calculate spell save DC: 8 + proficiency + spellcasting ability modifier"""
    ability = caster.spellcasting_ability.lower()
    ability_score = getattr(caster.ability_scores, ability, 10)
    ability_mod = calc_ability_modifier(ability_score)
    return 8 + caster.proficiency_bonus + ability_mod


def calc_spellcasting_mod(caster: CasterData) -> int:
    """Get spellcasting ability modifier"""
    ability = caster.spellcasting_ability.lower()
    ability_score = getattr(caster.ability_scores, ability, 10)
    return calc_ability_modifier(ability_score)


def get_scaled_damage(spell: SpellData, slot_level: int, caster_level: int) -> str:
    """Get damage dice scaled by slot level or character level"""
    # For cantrips - scale by character level
    if spell.level == 0 and spell.damage_at_character_level:
        levels = sorted([int(k) for k in spell.damage_at_character_level.keys()], reverse=True)
        for lvl in levels:
            if caster_level >= lvl:
                return spell.damage_at_character_level[str(lvl)]
        return spell.damage or "1d4"

    # For leveled spells - scale by slot level
    if spell.damage_at_slot_level and slot_level > 0:
        slot_key = str(slot_level)
        if slot_key in spell.damage_at_slot_level:
            return spell.damage_at_slot_level[slot_key]

    return spell.damage or "1d4"


def get_scaled_healing(spell: SpellData, slot_level: int, spellcasting_mod: int) -> str:
    """Get healing dice scaled by slot level, replacing MOD with actual modifier"""
    healing = spell.healing

    # For leveled spells - scale by slot level
    if spell.healing_at_slot_level and slot_level > 0:
        slot_key = str(slot_level)
        if slot_key in spell.healing_at_slot_level:
            healing = spell.healing_at_slot_level[slot_key]

    # Replace MOD with actual spellcasting modifier
    if healing and "MOD" in healing:
        healing = healing.replace("MOD", str(spellcasting_mod))

    return healing or "1d4"


def parse_healing_dice(healing_str: str) -> Tuple[int, int, int]:
    """Parse healing string like '1d4 + 3' into (num_dice, die_size, modifier)"""
    if not healing_str:
        return (1, 4, 0)

    # Match patterns: 1d4, 2d8+3, 1d6 + 2
    healing_str = healing_str.replace(" ", "")
    match = re.match(r'(\d+)?d(\d+)([+-]\d+)?', healing_str.lower())
    if match:
        num_dice = int(match.group(1)) if match.group(1) else 1
        die_size = int(match.group(2))
        modifier = int(match.group(3)) if match.group(3) else 0
        return (num_dice, die_size, modifier)

    # Try to match just a modifier (e.g., "5")
    try:
        return (0, 0, int(healing_str))
    except ValueError:
        return (1, 4, 0)


def check_damage_resistance(damage_type: str, resistances: Optional[List[str]], ignore_types: Optional[List[str]] = None) -> bool:
    """Check if target has resistance to damage type.
    ignore_types: damage types to bypass resistance (e.g., Elemental Adept)"""
    if not resistances or not damage_type:
        return False

    # Elemental Adept: ignore resistance for chosen element
    if ignore_types:
        damage_type_lower = damage_type.lower()
        for it in ignore_types:
            it_lower = it.lower()
            if damage_type_lower == it_lower:
                return False
            # Check CN ↔ EN mapping
            if it_lower in DAMAGE_TYPE_EN_TO_CN and damage_type_lower == DAMAGE_TYPE_EN_TO_CN[it_lower]:
                return False
            for en, cn in DAMAGE_TYPE_EN_TO_CN.items():
                if it_lower == cn and damage_type_lower == en:
                    return False

    damage_type_lower = damage_type.lower()
    for resist in resistances:
        resist_lower = resist.lower()
        if resist_lower == damage_type_lower:
            return True
        # Also check Chinese names
        if damage_type_lower in DAMAGE_TYPE_EN_TO_CN:
            if resist_lower == DAMAGE_TYPE_EN_TO_CN[damage_type_lower]:
                return True
        # Check if damage type CN matches resistance
        for en, cn in DAMAGE_TYPE_EN_TO_CN.items():
            if damage_type_lower == cn and resist_lower == en:
                return True
    return False


def check_damage_immunity(damage_type: str, immunities: Optional[List[str]]) -> bool:
    """Check if target is immune to damage type"""
    if not immunities or not damage_type:
        return False

    damage_type_lower = damage_type.lower()
    for immune in immunities:
        immune_lower = immune.lower()
        if immune_lower == damage_type_lower:
            return True
        # Also check Chinese names
        if damage_type_lower in DAMAGE_TYPE_EN_TO_CN:
            if immune_lower == DAMAGE_TYPE_EN_TO_CN[damage_type_lower]:
                return True
        # Check if damage type CN matches immunity
        for en, cn in DAMAGE_TYPE_EN_TO_CN.items():
            if damage_type_lower == cn and immune_lower == en:
                return True
    return False


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

    raw_slots = (
        ((spellcasting_data.get("slotTables") or {}).get(table_key) or {}).get(str(character.level or 1))
        or []
    )
    slots = [0, *[max(0, int(value or 0)) for value in raw_slots]]
    while len(slots) < 10:
        slots.append(0)
    return normalize_character_spell_slots_state(slots[:10], strict=True) or slots[:10]


def _ensure_character_spell_slots_state(character: Character) -> Any:
    current_state = getattr(character, "spell_slots_state", None)
    if current_state is not None:
        return current_state

    default_state = _build_default_spell_slots_state_for_character(character)
    if default_state is None:
        return None

    character.spell_slots_state = default_state
    flag_modified(character, "spell_slots_state")
    return default_state


async def _consume_spell_slot(
    db: AsyncSession,
    character_or_id: int | Character,
    slot_level: int,
    use_pact_slot: bool = False,
    campaign_id: Optional[int] = None,
) -> None:
    """
    Consume a spell slot from a character's spell_slots_state.
    Handles both regular slots and warlock pact slots.
    """
    character: Character | None
    character_id: Optional[int]

    if isinstance(character_or_id, Character):
        character = character_or_id
        character_id = character.id
    else:
        character_id = int(character_or_id)
        result = await db.execute(
            select(Character).where(Character.id == character_id)
        )
        character = result.scalar_one_or_none()

    if not character or slot_level < 1:
        return

    spell_slots = _ensure_character_spell_slots_state(character)
    if not spell_slots:
        return

    slot_consumed = False
    normalized_spell_slots: Any = spell_slots

    if isinstance(spell_slots, dict) and 'slots' in spell_slots:
        # Multiclass format: {"slots": [...], "pact_slots": [...]}
        normalized_spell_slots = dict(spell_slots)
        slots = _normalize_spell_slot_array(normalized_spell_slots.get('slots'))
        pact_slots = _normalize_spell_slot_array(normalized_spell_slots.get('pact_slots'))
        pact_level = int(normalized_spell_slots.get('pact_level') or 0)

        if use_pact_slot and 0 < pact_level < len(pact_slots) and pact_slots[pact_level] > 0:
            pact_slots[pact_level] -= 1
            slot_consumed = True
        else:
            # Use regular slot, allowing higher-level slots as fallback.
            for lvl in range(slot_level, 10):
                if slots[lvl] and slots[lvl] > 0:
                    slots[lvl] -= 1
                    slot_consumed = True
                    break
            if not slot_consumed and 0 < pact_level < len(pact_slots) and pact_slots[pact_level] > 0:
                pact_slots[pact_level] -= 1
                slot_consumed = True

        normalized_spell_slots['slots'] = slots
        normalized_spell_slots['pact_slots'] = pact_slots
    elif isinstance(spell_slots, list):
        # Array format: [0, slots1, slots2, ...]
        slots = _normalize_spell_slot_array(spell_slots)
        for lvl in range(slot_level, 10):
            if slots[lvl] and slots[lvl] > 0:
                slots[lvl] -= 1
                slot_consumed = True
                break
        normalized_spell_slots = normalize_character_spell_slots_state(slots, strict=True) or slots

    if slot_consumed:
        character.spell_slots_state = normalized_spell_slots
        flag_modified(character, 'spell_slots_state')
        await db.commit()

        if campaign_id is not None and character_id is not None:
            await realtime_publisher.publish_spell_slots_updated(
                campaign_id,
                character_id=character_id,
                spell_slots_state=normalized_spell_slots,
            )


def _get_spell_color_theme(spell: SpellData) -> str:
    """
    Get color theme for spell area effect based on damage type or school.
    """
    # Check damage type first
    if spell.damage_type:
        damage_lower = spell.damage_type.lower()
        if "fire" in damage_lower or "火" in damage_lower:
            return "fire"
        if "cold" in damage_lower or "ice" in damage_lower or "冰" in damage_lower:
            return "ice"
        if "lightning" in damage_lower or "闪电" in damage_lower:
            return "lightning"
        if "thunder" in damage_lower or "雷" in damage_lower:
            return "thunder"
        if "acid" in damage_lower or "酸" in damage_lower:
            return "acid"
        if "poison" in damage_lower or "毒" in damage_lower:
            return "poison"
        if "necrotic" in damage_lower or "黯蚀" in damage_lower:
            return "necrotic"
        if "radiant" in damage_lower or "光耀" in damage_lower:
            return "radiant"
        if "force" in damage_lower or "力场" in damage_lower:
            return "force"
        if "psychic" in damage_lower or "心灵" in damage_lower:
            return "psychic"

    # Check spell school for control/environmental spells
    if spell.school:
        school_lower = spell.school.lower()
        if school_lower == "conjuration":
            return "ice"  # Fog cloud, etc.
        if school_lower == "illusion":
            return "psychic"
        if school_lower == "necromancy":
            return "necrotic"
        if school_lower == "evocation":
            return "fire"

    return "ice"  # Default for environmental spells


async def _set_concentration_with_area_effect(
    db: AsyncSession,
    caster_token_id: int,
    spell_id: str,
    spell_name: str,
    slot_level: int,
    shape_type: str,
    center_x: float,
    center_y: float,
    origin_x: Optional[float],
    origin_y: Optional[float],
    direction: Optional[float],
    radius: int,
    color: str,
    map_url: str,
    campaign_id: int,
    affected_token_ids: Optional[List[int]] = None,
) -> None:
    """
    Set concentration on caster token with area effect data.
    This enables persistent area rendering on the map.
    """
    from app.utils.saving_throws import calc_saving_throw_modifier

    result = await db.execute(select(Token).where(Token.id == caster_token_id))
    token = result.scalar_one_or_none()
    if not token:
        logger.warning(f"Token {caster_token_id} not found for concentration")
        return

    # Build concentration spell data
    # Spells where the caster can reposition the area (bonus action / action)
    PLAYER_MOVABLE_SPELLS = {
        "flaming_sphere", "moonbeam", "dancing_lights",
        "cloud_of_daggers", "bigbys_hand", "arcane_hand",
    }
    conc_data = {
        "spell_id": spell_id,
        "spell_name": spell_name,
        "slot_level": slot_level,
        "duration_rounds": resolve_spell_duration_rounds(get_spell_by_id(spell_id), slot_level) or 10,
        "current_round": 0,
        "con_save_bonus": 0,
        "has_advantage": False,
        "affected_token_ids": affected_token_ids or [],
        "area_effect": {
            "shape": shape_type,
            "center_x": center_x,
            "center_y": center_y,
            "origin_x": origin_x,
            "origin_y": origin_y,
            "direction": direction,
            "radius": radius,
            "color": color,
            "map_url": map_url,
            "playerMovable": spell_id in PLAYER_MOVABLE_SPELLS,
        }
    }

    # For character tokens, compute CON save data
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

    from app.models.campaign import Campaign
    campaign_obj = await db.get(Campaign, int(campaign_id))
    campaign_meta = campaign_obj.meta if campaign_obj and campaign_obj.meta else {}
    current_time = campaign_meta.get("time_of_day") or None
    if current_time:
        conc_data["expires_at"] = SpellResolver._calc_expires_at(
            current_time,
            conc_data["duration_rounds"],
        )

    token.concentration_spell = normalize_token_concentration_spell(conc_data, strict=True)
    flag_modified(token, "concentration_spell")
    await db.commit()

    # Broadcast concentration update
    await realtime_publisher.publish_token_concentration_updated(
        campaign_id,
        token_id=caster_token_id,
        concentration_spell=conc_data,
    )

    logger.info(f"Set concentration for token {caster_token_id} with area effect: {spell_name}")


async def _set_concentration_for_control_spell(
    db: AsyncSession,
    caster_token_id: int,
    spell_id: str,
    spell_name: str,
    slot_level: int,
    affected_token_ids: List[int],
    campaign_id: int,
    target_name: Optional[str] = None,
) -> None:
    """
    Set concentration on caster token for control spells.
    Tracks affected_token_ids so effects can be removed when concentration breaks.
    """
    from app.utils.saving_throws import calc_saving_throw_modifier

    result = await db.execute(select(Token).where(Token.id == caster_token_id))
    token = result.scalar_one_or_none()
    if not token:
        logger.warning(f"Token {caster_token_id} not found for concentration")
        return

    # Build concentration spell data
    conc_data = {
        "spell_id": spell_id,
        "spell_name": spell_name,
        "slot_level": slot_level,
        "duration_rounds": resolve_spell_duration_rounds(get_spell_by_id(spell_id), slot_level) or 10,
        "current_round": 0,
        "con_save_bonus": 0,
        "has_advantage": False,
        "affected_token_ids": affected_token_ids,
    }
    if target_name:
        conc_data["target_name"] = target_name

    # For character tokens, compute CON save data
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

    from app.models.campaign import Campaign
    campaign_obj = await db.get(Campaign, int(campaign_id))
    campaign_meta = campaign_obj.meta if campaign_obj and campaign_obj.meta else {}
    current_time = campaign_meta.get("time_of_day") or None
    if current_time:
        conc_data["expires_at"] = SpellResolver._calc_expires_at(
            current_time,
            conc_data["duration_rounds"],
        )

    token.concentration_spell = normalize_token_concentration_spell(conc_data, strict=True)
    flag_modified(token, "concentration_spell")
    await db.commit()

    # Broadcast concentration update
    await realtime_publisher.publish_token_concentration_updated(
        campaign_id,
        token_id=caster_token_id,
        concentration_spell=conc_data,
    )

    logger.info(f"Set concentration for token {caster_token_id} on control spell: {spell_name}, affecting {affected_token_ids}")


@router.post("/spell", response_model=SpellCastResponse)
async def cast_spell(
    request: SpellCastRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Cast a spell on a target.

    Handles:
    1. Spell attack rolls (ranged/melee spell attacks)
    2. Saving throw spells
    3. Auto-hit spells (healing, etc.)
    4. Damage resistance/immunity
    5. HP updates
    6. WebSocket broadcast
    """
    try:
        context = await resolve_campaign_member_context(db, request.campaign_id, current_user)
        user_id = context.user_id
        role = _sender_role_from_context(context)

        spell = request.spell
        caster = request.caster
        target = request.target
        caster_token_obj = await db.get(Token, caster.token_id) if caster.token_id else None
        target_token_obj = await db.get(Token, target.token_id) if target.token_id else None

        # Check spell range
        spell_range = spell.range
        distance_feet = request.distance_feet or 0
        distance_feet = await _get_best_invoke_duplicity_distance_feet(
            db,
            caster_token_obj,
            target_token_obj,
            distance_feet,
        )

        # Spell Sniper: double spell attack range
        spell_sniper_active = False
        _caster_char = None
        if caster.token_id:
            _caster_char = await _get_character_for_token(db, caster.token_id)
            if _caster_char:
                _ss_feats = _caster_char.feats or []
                _ss_ids = [f if isinstance(f, str) else (f.get('value') or f.get('id', '')) for f in _ss_feats]
                if 'spell_sniper' in _ss_ids and spell.attack_type in ('ranged_spell', 'melee_spell'):
                    spell_sniper_active = True

        # Elemental Adept: ignore resistance for chosen element
        ea_ignore_types: List[str] = []
        if _caster_char:
            _ea_feats = _caster_char.feats or []
            _ea_ids = [f if isinstance(f, str) else (f.get('value') or f.get('id', '')) for f in _ea_feats]
            if 'elemental_adept' in _ea_ids:
                _ea_fc = (_caster_char.feat_choices or {}).get('elemental_adept', {})
                _ea_element = _ea_fc.get('element')
                if _ea_element:
                    element_map = {'acid': ['强酸', 'acid'], 'cold': ['寒冷', 'cold'], 'fire': ['火焰', 'fire'], 'lightning': ['闪电', 'lightning'], 'thunder': ['雷鸣', 'thunder']}
                    ea_ignore_types = element_map.get(_ea_element, [_ea_element])
                    logger.info(f"[Spell] Elemental Adept: ignoring resistance for {_ea_element}")

        if spell_range:
            # Parse range (e.g., "60 feet", "60尺", "Touch", "Self")
            range_lower = spell_range.lower().strip()
            if range_lower in ('self', '自身'):
                # Self spells - no distance check needed (target should be self)
                pass
            elif range_lower in ('touch', '触及'):
                # Touch spells - must be within 5 feet
                if distance_feet > 5:
                    return SpellCastResponse(
                        success=False,
                        error=f"目标超出法术射程（触及需要5尺内，当前距离{distance_feet:.1f}尺）"
                    )
            else:
                # Parse numeric range
                range_match = re.search(r'(\d+)', spell_range)
                if range_match:
                    max_range = int(range_match.group(1))
                    # Spell Sniper: double range for spell attacks
                    if spell_sniper_active:
                        max_range *= 2
                    if distance_feet > max_range:
                        return SpellCastResponse(
                            success=False,
                            error=f"目标超出法术射程（{spell_range}，当前距离{distance_feet:.1f}尺）"
                        )

        # D&D 5E: Cannot cast spells while wearing non-proficient armor/shield
        if caster.token_id:
            caster_char = await _get_character_for_token(db, caster.token_id)
            if caster_char:
                penalty = check_armor_proficiency_penalty(caster_char)
                if penalty["has_penalty"]:
                    items_str = "、".join(i["name"] for i in penalty["items"])
                    return SpellCastResponse(
                        success=False,
                        error=f"穿戴不熟练的{items_str}，无法施放法术"
                    )

        # Calculate spell attack bonus and save DC
        spell_attack_bonus = calc_spell_attack_bonus(caster)
        spell_save_dc = calc_spell_save_dc(caster)
        spellcasting_mod = calc_spellcasting_mod(caster)

        # ── SpellResolver: check if spell has structured effects ──
        spell_raw = spell.model_dump() if hasattr(spell, 'model_dump') else {}
        if spell_raw.get("effects"):
            resolver = SpellResolver()
            ctx = SpellContext(
                caster_token_id=caster.token_id,
                caster_name=caster.name,
                caster_level=caster.level or 1,
                caster_class_id=caster.class_id,
                caster_subclass_id=caster.subclass_id,
                caster_ability_scores=caster.ability_scores.model_dump() if caster.ability_scores else {},
                spellcasting_mod=spellcasting_mod,
                proficiency_bonus=caster.proficiency_bonus,
                spell_save_dc=spell_save_dc,
                spell_attack_bonus=spell_attack_bonus,
                spell_level=spell.level or 0,
                slot_level=request.slot_level,
                spell_id=spell.id,
                spell_name=spell.name,
                concentration=spell.concentration,
                campaign_id=request.campaign_id,
            )
            resolver_target = TargetInfo(
                token_id=target.token_id,
                name=target.name,
                ac=target.ac,
                current_hp=target.current_hp,
                max_hp=target.max_hp,
                character_id=target.character_id,
                monster_instance_id=target.monster_instance_id,
                damage_resistances=target.damage_resistances,
                damage_immunities=target.damage_immunities,
                condition_immunities=target.condition_immunities,
                active_effects=getattr(target, "active_effects", None) or [],
                ability_scores=target.ability_scores.model_dump() if target.ability_scores else {},
                level=target.level,
                class_id=target.class_id,
                proficiency_bonus=target.proficiency_bonus,
                save_override=target.saving_throw_override,
            )
            resolve_result = await resolver.resolve(
                spell_raw, ctx, [resolver_target], db
            )
            if resolve_result is not None:
                await db.commit()
                # Build narrative from resolver results
                narrative_parts = []
                for phase_res in resolve_result.phase_results:
                    for er in phase_res:
                        if er.damage_dealt > 0:
                            narrative_parts.append(
                                f"{er.target_name} 受到 {er.damage_dealt} 点伤害"
                            )
                        if er.healing_done > 0:
                            narrative_parts.append(
                                f"{er.target_name} 恢复 {er.healing_done} 点生命"
                            )
                        if er.condition_applied:
                            narrative_parts.append(
                                f"{er.target_name} 进入{er.condition_applied}状态"
                            )
                        if er.condition_immune:
                            narrative_parts.append(er.description or "")
                narrative = "；".join(p for p in narrative_parts if p) or f"{caster.name} 施放了 {spell.name}"
                thunderbolt_strike_note = await _apply_thunderbolt_strike(
                    db,
                    campaign_id=request.campaign_id,
                    caster_token_id=caster.token_id,
                    target_token_id=target.token_id,
                    damage_type=spell.damage_type,
                    damage_dealt=resolve_result.total_damage,
                    auto_apply=request.auto_apply,
                    caster_name=caster.name,
                    target_name=target.name,
                )
                if thunderbolt_strike_note:
                    narrative = f"{narrative}；{thunderbolt_strike_note}"

                await realtime_publisher.publish_spell_result(
                    request.campaign_id,
                    data={
                        "caster_name": caster.name,
                        "spell_name": spell.name,
                        "total_damage": resolve_result.total_damage,
                        "total_healing": resolve_result.total_healing,
                        "narrative": narrative,
                        "resolved_by": "spell_resolver",
                    },
                )

                refreshed_target_token = await db.get(Token, target.token_id) if target.token_id else None
                if refreshed_target_token and (
                    resolve_result.total_damage > 0 or resolve_result.total_healing > 0
                ):
                    previous_hp = target.current_hp if target.current_hp is not None else refreshed_target_token.current_hp
                    current_hp = refreshed_target_token.current_hp if refreshed_target_token.current_hp is not None else 0
                    await realtime_publisher.publish_token_hp_updated(
                        request.campaign_id,
                        token_id=refreshed_target_token.id,
                        current_hp=current_hp,
                        temp_hp=refreshed_target_token.temp_hp,
                        active_effects=refreshed_target_token.active_effects,
                        character_id=refreshed_target_token.character_id,
                        monster_instance_id=refreshed_target_token.monster_instance_id,
                        hp_change=current_hp - (previous_hp or current_hp),
                        target_defeated=current_hp <= 0,
                    )
                if refreshed_target_token:
                    await _broadcast_token_active_effects_update(
                        refreshed_target_token,
                        request.campaign_id,
                    )
                await _broadcast_concentration_updates(
                    db,
                    request.campaign_id,
                    resolve_result.concentration_touched_token_ids,
                )

                # Consume spell slot
                if request.slot_level > 0:
                    await _consume_spell_slot(
                        db, caster.token_id, request.slot_level,
                        request.use_pact_slot, request.campaign_id
                    )

                return SpellCastResponse(
                    success=True,
                    result=SpellCastResult(
                        hit=True,
                        damage_dealt=resolve_result.total_damage,
                        damage_type=spell.damage_type,
                        damage_type_cn=spell.damage_type_cn,
                        healing_done=resolve_result.total_healing,
                        spell_save_dc=spell_save_dc,
                        spell_attack_bonus=spell_attack_bonus,
                        narrative=narrative,
                        caster_name=caster.name,
                        target_name=target.name,
                        spell_name=spell.name,
                        slot_consumed=request.slot_level,
                    )
                )
        # ── End SpellResolver check ──

        # All spells have structured effects — if we reach here,
        # something went wrong with the resolver.
        raise HTTPException(
            status_code=400,
            detail=f"Spell '{spell.name}' could not be resolved. All spells should have structured effects."
        )
    except Exception as e:
        logger.error(f"Spell casting failed: {e}", exc_info=True)
        return SpellCastResponse(
            success=False,
            error=str(e)
        )


# ============== Area Spell Casting ==============

def _hydrate_area_spell_raw(spell_raw: dict, spell_id: str) -> dict:
    """Return spell_raw augmented with effects/area_of_effect from the rules
    cache when the frontend payload omitted those fields.

    Priority for area_of_effect:
      1. top-level areaOfEffect / area_of_effect in the cached spell
      2. area_of_effect nested inside the first grant_action effect (e.g.
         call_lightning has grant_action.area_of_effect = cylinder/5)
    Never mutates the input dict.
    """
    if not spell_id:
        return spell_raw
    cached = get_spell_by_id(spell_id)
    if not cached:
        return spell_raw
    result = dict(spell_raw)
    if not result.get("effects") and cached.get("effects"):
        result["effects"] = cached["effects"]
    # The rules cache is authoritative for a known spell_id.  Override even a
    # present value, because spell.model_dump() always emits the Pydantic
    # default concentration=False when the frontend omits the field — without
    # this override a concentration spell (e.g. call_lightning) would resolve
    # to is_concentration=False on the Chrome path.
    if cached.get("concentration") is not None:
        result["concentration"] = bool(cached["concentration"])
    if not result.get("area_of_effect"):
        aoe = cached.get("areaOfEffect") or cached.get("area_of_effect")
        if not aoe:
            for phase in (result.get("effects") or []):
                for eff in (phase.get("effects") or []):
                    if eff.get("type") == "grant_action" and eff.get("area_of_effect"):
                        aoe = eff["area_of_effect"]
                        break
                if aoe:
                    break
        if aoe:
            result["area_of_effect"] = aoe
    return result


def _match_active_grant_action(
    spell_raw: dict, active_effects: Optional[List[dict]]
) -> Optional[dict]:
    """Find the active ``grant_action`` entry an area-cast payload refers to.

    The frontend exposes a persisted grant_action, such as Call Lightning's
    ``召唤闪电`` follow-up, as a SpellOption whose id is
    ``granted_<spell_id>_<action_kind>`` and whose name may be emoji-prefixed.
    Matching stays conservative so a normal initial cast never skips slot or
    concentration handling.
    """
    if not active_effects:
        return None

    spell_id = (spell_raw or {}).get("id") or ""
    name = (spell_raw or {}).get("name") or ""
    grant_entries = [
        entry
        for entry in active_effects
        if isinstance(entry, dict)
        and entry.get("effect_type") == "grant_action"
        and entry.get("spell_id")
    ]
    if not grant_entries:
        return None

    if spell_id.startswith("granted_"):
        for entry in grant_entries:
            composite = f"granted_{entry.get('spell_id')}_{entry.get('action_kind') or ''}"
            if composite == spell_id:
                return entry

    # Name fallback only when the id is not a real spell, so a canonical initial
    # cast (id="call_lightning") can never be mistaken for a follow-up.
    if not get_spell_by_id(spell_id):
        for entry in grant_entries:
            action_name = entry.get("action_name") or entry.get("name") or ""
            if action_name and action_name in name:
                return entry

    return None


# move_effect spells whose canonical JSON carries no top-level areaOfEffect.
# Their relocated zone still needs a concrete shape so concentration storage
# writes a real area_effect. Keyed by canonical spell id; mirrors the frontend
# MOVE_EFFECT_AREA_FALLBACK in grantedActions.ts. NOT a generic default.
_MOVE_EFFECT_AREA_FALLBACK = {
    "flaming_sphere": {"type": "sphere", "size": 5},
}


def _build_granted_action_area_raw(spell_raw: dict, entry: dict) -> dict:
    """Build a freecast synthetic area spell from a persisted grant_action."""
    result = dict(spell_raw)
    damage = entry.get("damage") or {}
    formula = damage.get("formula") or spell_raw.get("damage") or ""
    damage_type = (
        damage.get("damage_type")
        or damage.get("damageType")
        or spell_raw.get("damage_type")
        or "force"
    )
    attack = entry.get("attack") if isinstance(entry.get("attack"), dict) else None
    save = entry.get("save") if isinstance(entry.get("save"), dict) else None

    phase: dict = {
        "trigger": "on_cast",
        "target": {"type": "area"},
        "effects": [
            {"type": "deal_damage", "formula": str(formula), "damage_type": str(damage_type)}
        ],
    }
    # attack and save are mutually exclusive in the resolver; attack wins.
    if attack:
        phase["attack"] = attack
    elif save:
        phase["save"] = save

    result["id"] = entry.get("spell_id") or spell_raw.get("id")
    result["effects"] = [phase]
    # `move_effect` (Moonbeam / Flaming Sphere) relocates the *persistent*
    # concentration area, so it must remain a concentration cast; Call Lightning
    # style `save_damage` is a transient, non-concentration follow-up.
    is_move_effect = entry.get("action_kind") == "move_effect"
    result["concentration"] = bool(is_move_effect)
    aoe = entry.get("area_of_effect") or spell_raw.get("area_of_effect")
    if not aoe and is_move_effect:
        # The grant entry / payload often omits the shape; fall back to the
        # canonical spell's top-level area so the relocated zone keeps its size.
        spell_id = entry.get("spell_id") or ""
        cached = get_spell_by_id(spell_id)
        if cached:
            aoe = cached.get("areaOfEffect") or cached.get("area_of_effect")
        # Some move_effect spells (e.g. Flaming Sphere) carry no top-level shape
        # at all; use a concrete small area so concentration relocation still
        # writes an area_effect instead of nothing.
        if not aoe:
            aoe = _MOVE_EFFECT_AREA_FALLBACK.get(spell_id)
    if aoe:
        result["area_of_effect"] = aoe

    return result


def _area_spell_slot_source(caster, caster_char):
    """Return the spell-slot owner for an area cast.

    _consume_spell_slot looks up by Character.id, so it must receive an
    already-fetched Character or a character id — NEVER caster.token_id, which
    would silently resolve the wrong (or no) character.  Prefer the Character
    the route already fetched; otherwise fall back to caster.character_id.
    Returns None when neither is available (the route then tries a token-based
    character lookup).
    """
    if caster_char is not None:
        return caster_char
    if getattr(caster, "character_id", None):
        return caster.character_id
    return None


@router.post("/spell-area", response_model=AreaSpellCastResponse)
async def cast_area_spell(
    request: AreaSpellCastRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Cast an area spell affecting multiple targets.

    Handles:
    1. Roll damage once (shared across all targets)
    2. Each target makes individual saving throw
    3. Apply damage with resistance/immunity per target
    4. Update HP for each target
    5. Generate combined narrative
    6. WebSocket broadcast
    """
    try:
        context = await resolve_campaign_member_context(db, request.campaign_id, current_user)
        user_id = context.user_id
        role = _sender_role_from_context(context)

        spell = request.spell
        caster = request.caster
        targets = request.targets

        # Resolve a persisted grant_action follow-up early. A `move_effect`
        # relocation (Moonbeam / Flaming Sphere) may move the area onto an empty
        # square, so the empty-target guard must let it through; Call Lightning
        # style follow-ups still require a target in range.
        spell_raw = spell.model_dump() if hasattr(spell, 'model_dump') else {}
        granted_entry = None
        _caster_token_obj = None
        _orig_conc_slot_level = None
        if caster.token_id:
            _caster_token_obj = await db.get(Token, caster.token_id)
            if _caster_token_obj is not None:
                granted_entry = _match_active_grant_action(
                    spell_raw, _caster_token_obj.active_effects
                )
        is_move_effect = bool(
            granted_entry and granted_entry.get("action_kind") == "move_effect"
        )
        if is_move_effect and _caster_token_obj is not None:
            _cs = _caster_token_obj.concentration_spell
            if isinstance(_cs, dict) and _cs.get("slot_level") is not None:
                _orig_conc_slot_level = _cs.get("slot_level")

        if not targets and not is_move_effect:
            return AreaSpellCastResponse(
                success=False,
                error="没有目标在范围内"
            )

        # D&D 5E: Cannot cast spells while wearing non-proficient armor/shield
        caster_char = None
        if caster.token_id:
            caster_char = await _get_character_for_token(db, caster.token_id)
            if caster_char:
                penalty = check_armor_proficiency_penalty(caster_char)
                if penalty["has_penalty"]:
                    items_str = "、".join(i["name"] for i in penalty["items"])
                    return AreaSpellCastResponse(
                        success=False,
                        error=f"穿戴不熟练的{items_str}，无法施放法术"
                    )

        # Elemental Adept: ignore resistance for chosen element
        ea_ignore_types: List[str] = []
        _ea_char = caster_char if caster_char else (await _get_character_for_token(db, caster.token_id) if caster.token_id else None)
        if _ea_char:
                _ea_feats = _ea_char.feats or []
                _ea_ids = [f if isinstance(f, str) else (f.get('value') or f.get('id', '')) for f in _ea_feats]
                if 'elemental_adept' in _ea_ids:
                    _ea_fc = (_ea_char.feat_choices or {}).get('elemental_adept', {})
                    _ea_element = _ea_fc.get('element')
                    if _ea_element:
                        element_map = {'acid': ['强酸', 'acid'], 'cold': ['寒冷', 'cold'], 'fire': ['火焰', 'fire'], 'lightning': ['闪电', 'lightning'], 'thunder': ['雷鸣', 'thunder']}
                        ea_ignore_types = element_map.get(_ea_element, [_ea_element])

        # Calculate spell save DC (use pre-calculated DC if provided, e.g., breath weapons)
        spell_save_dc = spell.spell_save_dc if spell.spell_save_dc else calc_spell_save_dc(caster)
        save_type = spell.save_type or 'dex'
        save_type_cn = spell.save_type_cn or SAVE_TYPE_CN.get(save_type.lower(), save_type)
        spellcasting_mod = calc_spellcasting_mod(caster)

        # ── SpellResolver: check if spell has structured effects ──
        # `spell_raw` / `granted_entry` were resolved above (the empty-target
        # guard needed `is_move_effect`). A granted-action follow-up (e.g. Call
        # Lightning 召唤闪电, or a Moonbeam / Flaming Sphere `move_effect`
        # relocation) is a freecast: no slot, no duplicate grant.
        if granted_entry is not None:
            spell_raw = _build_granted_action_area_raw(spell_raw, granted_entry)
            effective_spell_id = spell_raw.get("id") or spell.id
            effective_spell_name = granted_entry.get("source") or spell.name
        else:
            spell_raw = _hydrate_area_spell_raw(spell_raw, spell.id)
            effective_spell_id = spell.id
            effective_spell_name = spell.name
        # Derive concentration from the hydrated dict (may differ from the
        # Pydantic default of False when the frontend omits the field).
        is_concentration = bool(spell_raw.get("concentration", spell.concentration))
        if spell_raw.get("effects"):
            resolver = SpellResolver()
            ctx = SpellContext(
                caster_token_id=caster.token_id,
                caster_name=caster.name,
                caster_level=caster.level or 1,
                caster_class_id=caster.class_id,
                caster_subclass_id=caster.subclass_id,
                caster_ability_scores=caster.ability_scores.model_dump() if caster.ability_scores else {},
                spellcasting_mod=spellcasting_mod,
                proficiency_bonus=caster.proficiency_bonus,
                spell_save_dc=spell_save_dc,
                spell_attack_bonus=calc_spell_attack_bonus(caster),
                spell_level=spell.level or 0,
                slot_level=request.slot_level,
                spell_id=effective_spell_id,
                spell_name=effective_spell_name,
                concentration=is_concentration,
                campaign_id=request.campaign_id,
            )
            resolver_targets = [
                TargetInfo(
                    token_id=t.token_id, name=t.name, ac=t.ac,
                    current_hp=t.current_hp, max_hp=t.max_hp,
                    character_id=t.character_id,
                    monster_instance_id=t.monster_instance_id,
                    damage_resistances=t.damage_resistances,
                    damage_immunities=t.damage_immunities,
                    condition_immunities=t.condition_immunities,
                    active_effects=getattr(t, "active_effects", None) or [],
                    ability_scores=t.ability_scores.model_dump() if t.ability_scores else {},
                    level=t.level, class_id=t.class_id,
                    proficiency_bonus=t.proficiency_bonus,
                    save_override=t.saving_throw_override,
                ) for t in targets
            ]
            # Backfill HP from the DB source of truth when the client payload
            # omitted current_hp/max_hp. The area-cast path builds targets from
            # browser data, and a failed monster-instance fetch can leave
            # current_hp=None — which previously made the resolver count damage
            # but never persist it (HP unchanged despite "影响 N 个目标").
            for rt in resolver_targets:
                if rt.current_hp is not None and rt.max_hp is not None:
                    continue
                if rt.monster_instance_id:
                    mi_obj = await db.get(MonsterInstance, rt.monster_instance_id)
                    if mi_obj:
                        if rt.current_hp is None:
                            rt.current_hp = mi_obj.current_hp
                        if rt.max_hp is None:
                            rt.max_hp = mi_obj.hit_points
                elif rt.character_id:
                    ch_obj = await db.get(Character, rt.character_id)
                    if ch_obj and rt.current_hp is None:
                        rt.current_hp = ch_obj.current_hp

            # Save original HP before resolve so we can compute deltas
            orig_hp_map = {t.token_id: t.current_hp for t in resolver_targets}
            resolve_result = await resolver.resolve(
                spell_raw, ctx, resolver_targets, db
            )
            if resolve_result is not None:
                await db.commit()
                narrative = "；".join(resolve_result.narrative_parts) or f"{caster.name} 施放了 {spell.name}"
                # Unified hydrated area — used for chat meta AND concentration storage
                _conc_aoe = spell_raw.get("area_of_effect") or spell.area_of_effect

                # Determine if this is a zone spell with deferred saves
                has_deferred_saves = any(
                    p.get("trigger") in ("start_of_target_turn", "end_of_target_turn")
                    and p.get("save")
                    for p in spell_raw.get("effects", [])
                )

                # Build zone spell narrative with target info
                if has_deferred_saves and targets:
                    slot_text = f"({request.slot_level}环)" if request.slot_level > 0 else "(戏法)"
                    conc_tag = " 🎯专注" if is_concentration else ""
                    lines = [f"🔮 **{caster.name}** 施放了 **{spell.name}** {slot_text}{conc_tag}"]
                    lines.append("")
                    # Show save info from the deferred phase
                    deferred_phase = next(
                        (p for p in spell_raw.get("effects", [])
                         if p.get("trigger") in ("start_of_target_turn", "end_of_target_turn") and p.get("save")),
                        None
                    )
                    if deferred_phase:
                        save_ability = deferred_phase["save"].get("ability", "con")
                        save_cn = SAVE_TYPE_CN.get(save_ability, save_ability)
                        trigger_cn = "回合开始" if deferred_phase["trigger"] == "start_of_target_turn" else "回合结束"
                        lines.append(f"**豁免**: DC {spell_save_dc} {save_cn}（{trigger_cn}时检定）")
                    lines.append("")
                    lines.append(f"**目标** ({len(targets)}个):")
                    for t in targets:
                        lines.append(f"  • {t.name}")
                    # Concentration maintenance note
                    if is_concentration:
                        lines.append("")
                        lines.append(f"⚡ **{caster.name}** 正在专注维持 **{spell.name}**，效果区域将持续存在直到专注中断")
                    combat_content = "\n".join(lines)
                else:
                    combat_content = narrative

                target_damage_map: dict[int, int] = {}
                save_results_map: dict[int, dict] = {}
                for phase_res in resolve_result.phase_results:
                    for er in phase_res:
                        if er.target_token_id and er.damage_dealt > 0:
                            target_damage_map[er.target_token_id] = (
                                target_damage_map.get(er.target_token_id, 0) + er.damage_dealt
                            )
                        if er.target_token_id and er.save_rolled:
                            save_results_map[er.target_token_id] = {
                                "save_succeeded": er.save_succeeded,
                                "save_total": er.save_total,
                            }

                thunderbolt_strike_notes: List[str] = []
                for spell_target in targets:
                    target_damage = target_damage_map.get(spell_target.token_id, 0)
                    if target_damage <= 0:
                        continue
                    thunderbolt_strike_note = await _apply_thunderbolt_strike(
                        db,
                        campaign_id=request.campaign_id,
                        caster_token_id=caster.token_id,
                        target_token_id=spell_target.token_id,
                        damage_type=spell.damage_type,
                        damage_dealt=target_damage,
                        auto_apply=request.auto_apply,
                        caster_name=caster.name,
                        target_name=spell_target.name,
                    )
                    if thunderbolt_strike_note:
                        thunderbolt_strike_notes.append(thunderbolt_strike_note)

                if thunderbolt_strike_notes:
                    combat_content += "\n" + "\n".join(thunderbolt_strike_notes)

                chat_msg = await create_combat_chat_message_service(
                    db,
                    campaign_id=request.campaign_id,
                    sender_user_id=user_id,
                    sender_role=role,
                    content=combat_content,
                    meta=build_area_spell_chat_meta_service(
                        spell_id=effective_spell_id,
                        spell_name=effective_spell_name,
                        caster_token_id=caster.token_id,
                        target_count=len(targets),
                        total_damage=resolve_result.total_damage,
                        center_position=request.center_position,
                        slot_consumed=(
                            request.slot_level
                            if request.slot_level > 0 and granted_entry is None
                            else 0
                        ),
                        is_concentration=is_concentration,
                        has_persistent_area=is_concentration and (_conc_aoe is not None),
                        resolved_by="spell_resolver",
                    ),
                )

                await realtime_publisher.publish_chat_message(
                    request.campaign_id,
                    chat_id=chat_msg.id,
                    user_id=user_id,
                    role=role,
                    message=combat_content,
                    message_type="combat",
                    recipients=[],
                    is_private=False,
                    meta=chat_msg.meta,
                    timestamp=combat_chat_timestamp_ms_service(chat_msg),
                )

                await realtime_publisher.publish_area_spell_result(
                    request.campaign_id,
                    event_type="area_spell_result",
                    data={
                        "caster_name": caster.name,
                        "spell_name": spell.name,
                        "total_damage": resolve_result.total_damage,
                        "total_healing": resolve_result.total_healing,
                        "narrative": combat_content,
                        "resolved_by": "spell_resolver",
                    },
                )

                # ── Broadcast token_hp_update for each target ──
                resolver_hp_updates = []
                # Build per-target info from resolver targets
                target_lookup = {t.token_id: t for t in resolver_targets}
                req_target_lookup = {t.token_id: t for t in targets}

                for tid, dmg in target_damage_map.items():
                    rt = target_lookup.get(tid)
                    rq = req_target_lookup.get(tid)
                    if not rt:
                        continue
                    new_hp = rt.current_hp if rt.current_hp is not None else 0
                    orig = orig_hp_map.get(tid, new_hp + dmg)
                    # Fetch temp_hp from DB token
                    token_obj = await db.get(Token, tid)
                    temp_hp_val = token_obj.temp_hp if token_obj else None
                    active_fx = token_obj.active_effects if token_obj else None
                    hp_upd = {
                        "token_id": tid,
                        "new_hp": new_hp,
                        "hp_change": new_hp - orig,
                        "damage_dealt": dmg,
                        "target_defeated": new_hp <= 0,
                        "character_id": rt.character_id,
                        "temp_hp": temp_hp_val,
                        "active_effects": active_fx,
                    }
                    resolver_hp_updates.append(hp_upd)
                    await realtime_publisher.publish_token_hp_updated(
                        request.campaign_id,
                        token_id=tid,
                        current_hp=new_hp,
                        temp_hp=temp_hp_val,
                        active_effects=active_fx,
                        character_id=rt.character_id,
                        monster_instance_id=rt.monster_instance_id,
                        hp_change=new_hp - orig,
                        target_defeated=new_hp <= 0,
                    )

                for resolver_target in resolver_targets:
                    await _broadcast_token_active_effects_update(
                        await db.get(Token, resolver_target.token_id),
                        request.campaign_id,
                    )

                await _broadcast_concentration_updates(
                    db,
                    request.campaign_id,
                    resolve_result.concentration_touched_token_ids,
                )

                if request.slot_level > 0 and granted_entry is None:
                    # Pass the Character (already fetched) or character_id, not
                    # the token_id — _consume_spell_slot looks up by Character.id.
                    # granted_entry is a freecast follow-up: never spend a slot.
                    _slot_source = _area_spell_slot_source(caster, caster_char)
                    if _slot_source is None and caster.token_id:
                        _slot_source = await _get_character_for_token(db, caster.token_id)
                    if _slot_source is not None:
                        await _consume_spell_slot(
                            db, _slot_source, request.slot_level,
                            request.use_pact_slot, request.campaign_id
                        )

                # Set concentration with area effect (same as legacy path).
                # _conc_aoe was set above (hydrated from spell_raw / cache).
                # For a `move_effect` relocation use the canonical spell id/name
                # (never the synthetic `granted_*` id) and preserve the original
                # concentration slot level so the moved zone stays the same cast.
                if is_concentration and _conc_aoe and caster.token_id:
                    affected_ids = [t.token_id for t in targets]
                    _conc_slot_level = (
                        _orig_conc_slot_level
                        if (is_move_effect and _orig_conc_slot_level is not None)
                        else request.slot_level
                    )
                    await _set_concentration_with_area_effect(
                        db=db,
                        caster_token_id=caster.token_id,
                        spell_id=effective_spell_id,
                        spell_name=effective_spell_name,
                        slot_level=_conc_slot_level,
                        shape_type=request.shape_type or _conc_aoe.get("type", "sphere"),
                        center_x=request.center_position.get("x", 0),
                        center_y=request.center_position.get("y", 0),
                        origin_x=request.origin_position.get("x") if request.origin_position else None,
                        origin_y=request.origin_position.get("y") if request.origin_position else None,
                        direction=request.direction,
                        radius=_conc_aoe.get("size", 20),
                        color=_get_spell_color_theme(spell),
                        map_url=request.map_url or "",
                        campaign_id=request.campaign_id,
                        affected_token_ids=affected_ids,
                    )

                return AreaSpellCastResponse(
                    success=True,
                    results=AreaSpellCastResult(
                        total_targets=len(targets),
                        successful_saves=len([v for v in save_results_map.values() if v.get("save_succeeded")]),
                        failed_saves=len([v for v in save_results_map.values() if not v.get("save_succeeded")]),
                        total_damage=resolve_result.total_damage,
                        target_results=[],
                        hp_updates=resolver_hp_updates,
                        spell_save_dc=spell_save_dc,
                        caster_name=caster.name,
                        spell_name=spell.name,
                        narrative=combat_content,
                    )
                )
        # ── End SpellResolver check ──

        # All spells have structured effects — if we reach here,
        # something went wrong with the resolver.
        raise HTTPException(
            status_code=400,
            detail=f"Area spell '{spell.name}' could not be resolved. All spells should have structured effects."
        )
    except Exception as e:
        logger.error(f"Area spell casting failed: {e}", exc_info=True)
        return AreaSpellCastResponse(
            success=False,
            error=str(e)
        )


# ============== Zone Spell Settlement ==============

def _merge_area_concentration_affected_target(
    concentration_spell: Optional[dict],
    spell_id: str,
    target_token_id: int,
) -> Tuple[Optional[dict], bool]:
    """Merge a target into area concentration tracking without duplication."""
    if not concentration_spell:
        return concentration_spell, False

    conc_spell_id = (
        concentration_spell.get("spell_id")
        or concentration_spell.get("sourceSpell")
        or concentration_spell.get("spellId")
    )
    if conc_spell_id != spell_id or not concentration_spell.get("area_effect"):
        return concentration_spell, False

    updated = dict(concentration_spell)
    affected = updated.get("affected_token_ids")
    used_legacy_key = affected is None and "affectedTokenIds" in updated
    if affected is None:
        affected = updated.get("affectedTokenIds", [])

    affected_ids = list(affected or [])
    target_token_id_str = str(target_token_id)
    if any(str(tid) == target_token_id_str for tid in affected_ids):
        if used_legacy_key:
            updated["affected_token_ids"] = affected_ids
            updated.pop("affectedTokenIds", None)
            return updated, True
        return concentration_spell, False

    affected_ids.append(target_token_id)
    updated["affected_token_ids"] = affected_ids
    updated.pop("affectedTokenIds", None)
    return updated, True

class ZoneSpellSettleRequest(BaseModel):
    """Request to settle zone spell effects for targets in the area"""
    campaign_id: int
    caster_token_id: int
    spell_id: str
    target_token_ids: List[int]
    timing: Optional[str] = None


class ZoneSpellTargetResult(BaseModel):
    """Result for a single target in zone spell settlement"""
    target_token_id: int
    target_name: str
    save_roll: DiceRoll
    save_modifier: int
    save_total: int
    save_succeeded: bool
    effect_applied: Optional[str] = None
    damage_dealt: int = 0
    hp_change: Optional[int] = None
    new_hp: Optional[int] = None


class ZoneSpellSettleResponse(BaseModel):
    """Response for zone spell settlement"""
    success: bool
    spell_id: str
    spell_name: str
    caster_name: str
    save_dc: int
    save_type: str
    save_type_cn: str
    target_results: List[ZoneSpellTargetResult]
    narrative: str
    error: Optional[str] = None


_ZONE_SETTLEMENT_TRIGGER_BY_TIMING = {
    "enter": "on_enter_zone",
    "leave": "on_leave_zone",
    "start_turn": "start_of_target_turn",
    "end_turn": "end_of_target_turn",
}

_ZONE_SETTLEMENT_TIMING_ALIASES = {
    "on_enter_zone": "enter",
    "on_leave_zone": "leave",
    "start_of_target_turn": "start_turn",
    "end_of_target_turn": "end_turn",
}

_ZONE_RUNTIME_TIMING_BY_ALIAS = {
    "enter": "on_enter_zone",
    "leave": "on_leave_zone",
}


def _normalize_zone_settlement_timing(raw_timing: Optional[str]) -> Optional[str]:
    if not raw_timing:
        return None
    normalized = str(raw_timing).strip().lower()
    return _ZONE_SETTLEMENT_TIMING_ALIASES.get(normalized, normalized)


# Legacy structured-zone settlement only knows how to execute these effect
# verbs via the effect_engine path. Phases whose effects list is purely
# runtime-engine verbs (narrative, set_runtime_param, ...) must fall through
# to execute_runtime_zone_triggers instead of being swallowed here.
_LEGACY_STRUCTURED_ZONE_EFFECT_TYPES = frozenset({"deal_damage", "apply_condition"})


def _phase_has_legacy_zone_effect(phase: Dict[str, Any]) -> bool:
    for effect in phase.get("effects") or []:
        if str(effect.get("type") or "") in _LEGACY_STRUCTURED_ZONE_EFFECT_TYPES:
            return True
    return False


def _spell_has_structured_zone_settlement(spell_data: Optional[Dict[str, Any]]) -> bool:
    for phase in get_spell_effect_phases(spell_data, None):
        if str(phase.get("trigger") or "") not in _ZONE_SETTLEMENT_TIMING_ALIASES:
            continue
        target_type = str((phase.get("target") or {}).get("type") or "")
        if target_type not in {"single", "all_in_area"}:
            continue
        if _phase_has_legacy_zone_effect(phase):
            return True
    return False


def _resolve_zone_settlement_timing(
    spell_data: Optional[Dict[str, Any]],
    requested_timing: Optional[str],
) -> Optional[str]:
    normalized = _normalize_zone_settlement_timing(requested_timing)
    if normalized in _ZONE_SETTLEMENT_TRIGGER_BY_TIMING:
        return normalized

    # Infer from structured effects phases — only legacy-supported verbs.
    triggers = {
        str(phase.get("trigger") or "")
        for phase in get_spell_effect_phases(spell_data, None)
        if str((phase.get("target") or {}).get("type") or "") in {"single", "all_in_area"}
        and _phase_has_legacy_zone_effect(phase)
    }
    if "start_of_target_turn" in triggers:
        return "start_turn"
    if "end_of_target_turn" in triggers:
        return "end_turn"
    if "on_enter_zone" in triggers:
        return "enter"
    return None


def _get_structured_zone_settlement_phases(
    spell_data: Optional[Dict[str, Any]],
    *,
    timing: Optional[str],
) -> List[Dict[str, Any]]:
    resolved_timing = _normalize_zone_settlement_timing(timing)
    trigger = _ZONE_SETTLEMENT_TRIGGER_BY_TIMING.get(resolved_timing or "")
    if not trigger:
        return []

    phases: List[Dict[str, Any]] = []
    for phase in get_spell_effect_phases(spell_data, None):
        if str(phase.get("trigger") or "") != trigger:
            continue
        target_type = str((phase.get("target") or {}).get("type") or "")
        if target_type not in {"single", "all_in_area"}:
            continue
        if not _phase_has_legacy_zone_effect(phase):
            continue
        phases.append(phase)
    return phases


def _empty_zone_settle_save_roll() -> DiceRoll:
    return DiceRoll(dice="0", rolls=[], modifier=0, total=0)


def _resolve_zone_target_max_hp(
    target_character: Optional[Character],
    target_monster: Optional[MonsterInstance],
) -> Optional[int]:
    if target_character:
        return calculate_max_hp(target_character)
    if target_monster:
        return target_monster.hit_points
    return None


def _resolve_zone_target_ability_scores(
    target_character: Optional[Character],
    target_monster: Optional[MonsterInstance],
) -> Dict[str, int]:
    if target_character:
        return compute_final_ability_scores(
            {
                "ability_scores": target_character.ability_scores or {},
                "race_id": target_character.race_id,
                "subrace_id": target_character.subrace_id,
                "race_choices": target_character.race_choices or {},
            }
        )
    if target_monster and target_monster.ability_scores:
        return dict(target_monster.ability_scores)
    return {}


async def _settle_structured_zone_spell(
    *,
    request: ZoneSpellSettleRequest,
    db: AsyncSession,
    caster_token: Token,
    spell_source: Dict[str, Any],
    spell_data: Dict[str, Any],
    spell_name: str,
    caster_name: str,
    spell_save_dc: int,
    caster_level: int,
    spellcasting_mod: int,
    proficiency_bonus: int,
    caster_class_id: Optional[str],
    caster_subclass_id: Optional[str],
    caster_ability_scores: Optional[Dict[str, int]],
    user_id: str,
    role: str,
) -> Optional[ZoneSpellSettleResponse]:
    if not _spell_has_structured_zone_settlement(spell_data):
        return None

    resolved_timing = _resolve_zone_settlement_timing(spell_data, request.timing)
    if not resolved_timing:
        return None

    matching_phases = _get_structured_zone_settlement_phases(
        spell_data,
        timing=resolved_timing,
    )

    if request.timing and not matching_phases:
        return ZoneSpellSettleResponse(
            success=True,
            spell_id=request.spell_id,
            spell_name=spell_name,
            caster_name=caster_name,
            save_dc=spell_save_dc,
            save_type="",
            save_type_cn="",
            target_results=[],
            narrative=f"{spell_name} 在当前时机没有需要结算的效果",
        )
    if not matching_phases:
        return None

    from app.models.campaign import Campaign

    campaign_obj = await db.get(Campaign, request.campaign_id)
    campaign_meta = campaign_obj.meta if campaign_obj and campaign_obj.meta else {}
    current_world_time = campaign_meta.get("time_of_day") or {}
    from app.services.effect_engine import (
        EffectSource, HandlerContext as HCtx, SideEffects, get_engine,
    )
    _effect_engine = get_engine()
    selected_option = spell_source.get("selected_option")
    slot_level = int(spell_source.get("slot_level") or spell_data.get("level") or 0)
    ctx = SpellContext(
        caster_token_id=caster_token.id,
        caster_name=caster_name,
        caster_level=caster_level,
        caster_class_id=caster_class_id,
        caster_subclass_id=caster_subclass_id,
        caster_ability_scores=caster_ability_scores,
        spellcasting_mod=spellcasting_mod,
        proficiency_bonus=proficiency_bonus,
        spell_save_dc=spell_save_dc,
        spell_attack_bonus=spellcasting_mod + proficiency_bonus,
        spell_level=slot_level,
        slot_level=slot_level,
        spell_id=request.spell_id,
        spell_name=spell_name,
        concentration=bool(caster_token.concentration_spell and caster_token.concentration_spell.get("spell_id") == request.spell_id),
        campaign_id=request.campaign_id,
        in_combat=True,
        selected_option=selected_option,
        current_world_time=current_world_time,
    )

    first_save_cfg = next((phase.get("save") for phase in matching_phases if phase.get("save")), {}) or {}
    save_type = str(first_save_cfg.get("ability") or spell_data.get("saveType") or "")
    save_type_cn = spell_data.get("saveTypeCn") or {
        "con": "体质", "dex": "敏捷", "wis": "感知",
        "str": "力量", "int": "智力", "cha": "魅力"
    }.get(save_type, "")
    first_damage_effect = next(
        (
            effect
            for phase in matching_phases
            for effect in (phase.get("effects") or [])
            if effect.get("type") == "deal_damage"
        ),
        None,
    )
    first_condition_effect = next(
        (
            effect
            for phase in matching_phases
            for effect in (phase.get("effects") or [])
            if effect.get("type") == "apply_condition"
        ),
        None,
    )
    damage_formula = first_damage_effect.get("formula") if first_damage_effect else None
    damage_type = first_damage_effect.get("damage_type") if first_damage_effect else spell_data.get("damageType")
    damage_type_cn = spell_data.get("damageTypeCn", damage_type or "")
    condition_cn = first_condition_effect.get("condition_cn") if first_condition_effect else None
    should_persist_effect = bool(first_condition_effect)
    save_effect = str(first_save_cfg.get("on_success") or "no_effect")

    target_results: List[ZoneSpellTargetResult] = []
    tokens_with_new_effects: set[int] = set()
    tokens_with_effect_updates: set[int] = set()
    concentration_touched_token_ids: List[int] = []
    concentration_tracking_changed = False
    had_any_save = False

    ability_key_lookup = {
        "con": "constitution",
        "dex": "dexterity",
        "wis": "wisdom",
        "str": "strength",
        "int": "intelligence",
        "cha": "charisma",
    }

    for target_id in request.target_token_ids:
        target_token = await db.get(Token, target_id)
        if not target_token:
            continue

        target_name = target_token.instance_name or "目标"
        target_character = await db.get(Character, target_token.character_id) if target_token.character_id else None
        target_monster = await db.get(MonsterInstance, target_token.monster_instance_id) if target_token.monster_instance_id else None
        target_ability_scores = _resolve_zone_target_ability_scores(target_character, target_monster)
        target_damage_immunities: List[str] = []
        target_condition_immunities: List[str] = []
        target_damage_resistances: List[str] = []
        save_overrides: Dict[str, int] = {}
        if target_character:
            target_immunities = get_character_immunities(
                {
                    "race_id": target_character.race_id,
                    "class_id": target_character.class_id,
                    "level": target_character.level or 1,
                    "subclass_id": target_character.subclass_id,
                },
                target_token.active_effects,
            )
            target_damage_immunities = list(target_immunities.get("damage_immunities") or [])
            target_condition_immunities = list(target_immunities.get("condition_immunities") or [])
        elif target_monster and target_monster.monster_data:
            target_immunities = get_monster_immunities(target_monster.monster_data)
            target_damage_immunities = list(target_immunities.get("damage_immunities") or [])
            target_condition_immunities = list(target_immunities.get("condition_immunities") or [])
            target_damage_resistances = list(target_monster.monster_data.get("damage_resistances") or [])
            save_overrides = dict(target_monster.monster_data.get("saving_throws") or {})

        target_info = TargetInfo(
            token_id=target_id,
            name=target_name,
            current_hp=target_token.current_hp,
            max_hp=_resolve_zone_target_max_hp(target_character, target_monster),
            character_id=target_token.character_id,
            monster_instance_id=target_token.monster_instance_id,
            damage_resistances=target_damage_resistances,
            damage_immunities=target_damage_immunities,
            condition_immunities=target_condition_immunities,
            active_effects=target_token.active_effects or [],
            ability_scores=target_ability_scores,
            level=(target_character.level if target_character else 1) or 1,
            class_id=target_character.class_id if target_character else None,
            proficiency_bonus=get_proficiency_bonus((target_character.level if target_character else 1) or 1),
            save_override=None,
            creature_type=(target_monster.type if target_monster else None),
            size=(target_monster.size if target_monster else None),
        )

        applied_labels: List[str] = []
        total_damage_dealt = 0
        hp_change = None
        new_hp = None
        last_save_roll = _empty_zone_settle_save_roll()
        last_save_modifier = 0
        last_save_total = 0
        last_save_succeeded = True
        target_had_save = False

        for phase in matching_phases:
            phase_save = phase.get("save") or {}
            phase_save_type = str(phase_save.get("ability") or save_type or "")
            save_modifier = 0
            save_succeeded: Optional[bool] = None
            if phase_save_type:
                if target_character:
                    save_info = calc_saving_throw_modifier(
                        target_ability_scores,
                        ability_key_lookup.get(phase_save_type, phase_save_type),
                        target_character.class_id,
                        target_character.level or 1,
                    )
                    save_modifier = save_info["total"]
                elif target_monster:
                    save_modifier = int(save_overrides.get(phase_save_type, 0) or 0)

            save_rolls: List[int] = []
            if phase_save:
                passive_save_sources = await _get_passive_save_advantage_for_token(
                    db,
                    target_token,
                    phase_save_type,
                    target_character if target_token.character_id else None,
                )
                corona_disadvantage = target_has_corona_of_light_save_disadvantage(
                    caster_token,
                    target_token,
                    damage_type,
                )
                nat_roll, save_rolls = _roll_save_d20(
                    advantage=bool(passive_save_sources),
                    disadvantage=corona_disadvantage,
                )
                save_total = nat_roll + save_modifier
                save_succeeded = save_total >= spell_save_dc
                last_save_roll = DiceRoll(
                    dice="2d20" if len(save_rolls) > 1 else "1d20",
                    rolls=save_rolls,
                    modifier=save_modifier,
                    total=save_total,
                )
                last_save_modifier = save_modifier
                last_save_total = save_total
                last_save_succeeded = save_succeeded
                target_had_save = True
                had_any_save = True

            for effect in phase.get("effects") or []:
                effect_type = str(effect.get("type") or "")
                if effect_type == "deal_damage":
                    er = EffectResult(
                        type=effect_type,
                        target_token_id=target_id,
                        target_name=target_name,
                    )
                    if phase_save:
                        er.save_rolled = True
                        er.save_succeeded = save_succeeded
                        er.save_total = last_save_total
                        er.save_dc = spell_save_dc
                    _hctx = HCtx(
                        source=EffectSource(
                            type="spell", id=ctx.spell_id, name=ctx.spell_name,
                            caster_token_id=ctx.caster_token_id,
                            concentration=ctx.concentration, slot_level=ctx.slot_level,
                        ),
                        target=target_info, caster_ctx=ctx, phase=phase, db=db,
                        save_cfg=phase_save or None, save_succeeded=save_succeeded,
                        scaling=phase.get("scaling"),
                    )
                    _outcome = await _effect_engine.execute_effect(effect, _hctx, SideEffects())
                    er.damage_dealt = _outcome.damage_dealt
                    er.formula_breakdown = _outcome.formula_breakdown
                    if _outcome.description:
                        er.description = _outcome.description
                    if er.damage_dealt > 0:
                        pending_damage_result = await apply_pending_damage_received_effects(
                            token=target_token,
                            damage_amount=er.damage_dealt,
                            damage_type=effect.get("damage_type"),
                            db=db,
                            resistance_already_applied=check_damage_resistance(
                                effect.get("damage_type", ""),
                                target_info.damage_resistances,
                            ),
                            immunity_already_applied=check_damage_immunity(
                                effect.get("damage_type", ""),
                                target_info.damage_immunities,
                            ),
                            consume_effects=True,
                        )
                        er.damage_dealt = pending_damage_result.damage_after_effects
                        if pending_damage_result.active_effects_changed:
                            tokens_with_effect_updates.add(target_token.id)
                        concentration_touched_token_ids.extend(
                            pending_damage_result.concentration_touched_token_ids
                        )

                    if er.damage_dealt > 0:
                        actual_damage = await _absorb_temp_hp(target_token, er.damage_dealt, db)
                        old_hp = target_token.current_hp or 0
                        target_token.current_hp = max(0, old_hp - actual_damage)
                        hp_change = -actual_damage if hp_change is None else hp_change - actual_damage
                        new_hp = target_token.current_hp
                        total_damage_dealt += er.damage_dealt
                        if target_character:
                            target_character.current_hp = target_token.current_hp
                        elif target_monster:
                            # current_hp, NOT hit_points (the max-HP column) — writing
                            # max HP here permanently corrupts the monster (a zeroed
                            # monster could never be healed/reset).
                            target_monster.current_hp = target_token.current_hp

                elif effect_type == "apply_condition":
                    if phase_save and save_succeeded:
                        continue
                    before_effects = list(target_token.active_effects or [])
                    er = EffectResult(
                        type=effect_type,
                        target_token_id=target_id,
                        target_name=target_name,
                    )
                    if phase_save:
                        er.save_rolled = True
                        er.save_succeeded = save_succeeded
                        er.save_total = last_save_total
                        er.save_dc = spell_save_dc
                    _hctx = HCtx(
                        source=EffectSource(
                            type="spell", id=ctx.spell_id, name=ctx.spell_name,
                            caster_token_id=ctx.caster_token_id,
                            concentration=ctx.concentration, slot_level=ctx.slot_level,
                        ),
                        target=target_info, caster_ctx=ctx, phase=phase, db=db,
                        save_cfg=phase_save or None, save_succeeded=save_succeeded,
                    )
                    _outcome = await _effect_engine.execute_effect(effect, _hctx, SideEffects())
                    er.condition_applied = _outcome.condition_applied
                    if er.condition_applied:
                        applied_labels.append(str(effect.get("condition_cn") or er.condition_applied))
                        if list(target_token.active_effects or []) != before_effects:
                            tokens_with_new_effects.add(target_id)
                        updated_concentration, conc_changed = _merge_area_concentration_affected_target(
                            caster_token.concentration_spell,
                            request.spell_id,
                            target_id,
                        )
                        if conc_changed:
                            caster_token.concentration_spell = normalize_token_concentration_spell(
                                updated_concentration,
                                strict=True,
                            )
                            concentration_tracking_changed = True

        target_results.append(
            ZoneSpellTargetResult(
                target_token_id=target_id,
                target_name=target_name,
                save_roll=last_save_roll if target_had_save else _empty_zone_settle_save_roll(),
                save_modifier=last_save_modifier,
                save_total=last_save_total,
                save_succeeded=last_save_succeeded if target_had_save else True,
                effect_applied="、".join(dict.fromkeys(applied_labels)) or None,
                damage_dealt=total_damage_dealt,
                hp_change=hp_change,
                new_hp=new_hp,
            )
        )

    if concentration_tracking_changed:
        flag_modified(caster_token, "concentration_spell")
    await db.commit()

    if had_any_save:
        failed = [r for r in target_results if not r.save_succeeded]
        passed = [r for r in target_results if r.save_succeeded]
        narrative = build_zone_spell_settle_narrative_service(
            spell_name=spell_name,
            spell_save_dc=spell_save_dc,
            save_type_cn=save_type_cn,
            failed_results=failed,
            passed_results=passed,
            condition_cn=condition_cn,
            should_persist_effect=should_persist_effect,
            damage_formula=damage_formula,
            save_effect=save_effect,
            damage_type_cn=damage_type_cn or damage_type,
        )
        chat_meta = build_zone_spell_settle_chat_meta_service(
            spell_id=request.spell_id,
            spell_name=spell_name,
            caster_token_id=request.caster_token_id,
            target_results=target_results,
            failed_count=len(failed),
            passed_count=len(passed),
            should_persist_effect=should_persist_effect,
            condition_cn=condition_cn,
            damage_type_label=damage_type_cn or damage_type,
        )
    else:
        detail_parts = []
        for result in target_results:
            detail = result.target_name
            if result.damage_dealt:
                detail += f" ({result.damage_dealt}{damage_type_cn or damage_type or ''}伤害)"
            if result.effect_applied:
                detail += f" [{result.effect_applied}]"
            detail_parts.append(detail)
        narrative = (
            f"🌫️ **{spell_name}** 环境效果结算\n"
            + ("、".join(detail_parts) if detail_parts else "当前没有目标受到影响")
        )
        chat_meta = {
            "combat_type": "zone_spell_settle",
            "spell_id": request.spell_id,
            "spell_name": spell_name,
            "caster_token_id": request.caster_token_id,
            "target_count": len(target_results),
            "failed_count": 0,
            "passed_count": 0,
            "effect_persisted": should_persist_effect and bool(target_results),
            "condition": condition_cn if should_persist_effect else None,
            "total_damage": sum(result.damage_dealt for result in target_results),
            "damage_type": damage_type_cn or damage_type,
        }

    await _broadcast_combat_chat(
        db,
        request.campaign_id,
        narrative,
        chat_meta,
        sender_user_id=user_id,
        sender_role=role,
    )

    if concentration_tracking_changed:
        await realtime_publisher.publish_token_concentration_updated(
            request.campaign_id,
            token_id=caster_token.id,
            concentration_spell=caster_token.concentration_spell,
        )

    for token_id in tokens_with_new_effects:
        token = await db.get(Token, token_id)
        if token:
            if token.monster_instance_id:
                mi = await db.get(MonsterInstance, token.monster_instance_id)
                if mi:
                    await realtime_publisher.publish_token_effects_updated(
                        request.campaign_id,
                        token_id=token_id,
                        active_effects=token.active_effects,
                        reason=f"zone_spell_settle:{spell_name}",
                        monster_instance_id=mi.id,
                        monster_status_effects=mi.status_effects,
                    )
            elif token.character_id:
                ch = await db.get(Character, token.character_id)
                if ch:
                    await realtime_publisher.publish_token_effects_updated(
                        request.campaign_id,
                        token_id=token_id,
                        active_effects=token.active_effects,
                        reason=f"zone_spell_settle:{spell_name}",
                        character_id=ch.id,
                        character_status_effects=ch.status_effects,
                    )

    for token_id in tokens_with_effect_updates:
        await _broadcast_token_active_effects_update(
            await db.get(Token, token_id),
            request.campaign_id,
        )

    await _broadcast_concentration_updates(
        db,
        request.campaign_id,
        concentration_touched_token_ids,
    )

    for result in target_results:
        if result.hp_change is not None and result.hp_change != 0:
            token = await db.get(Token, result.target_token_id)
            if token:
                await realtime_publisher.publish_token_hp_updated(
                    request.campaign_id,
                    token_id=result.target_token_id,
                    current_hp=token.current_hp,
                    temp_hp=token.temp_hp,
                    hp_change=result.hp_change,
                    target_defeated=(token.current_hp or 0) <= 0,
                    character_id=token.character_id,
                    monster_instance_id=token.monster_instance_id,
                )

    return ZoneSpellSettleResponse(
        success=True,
        spell_id=request.spell_id,
        spell_name=spell_name,
        caster_name=caster_name,
        save_dc=spell_save_dc,
        save_type=save_type,
        save_type_cn=save_type_cn,
        target_results=target_results,
        narrative=narrative,
    )


@router.post("/zone-spell-settle", response_model=ZoneSpellSettleResponse)
async def settle_zone_spell(
    request: ZoneSpellSettleRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Settle zone spell effects for targets at the start of their turn.

    Used for spells like Stinking Cloud, Entangle, Moonbeam that require
    saving throws when creatures start their turn in the area.
    """
    from app.utils.rules_cache import get_spell_by_id
    from datetime import datetime

    try:
        context = await resolve_campaign_member_context(db, request.campaign_id, current_user)
        user_id = context.user_id
        role = _sender_role_from_context(context)

        # Get caster token and concentration spell data
        caster_token = await db.get(Token, request.caster_token_id)
        if not caster_token:
            raise HTTPException(status_code=404, detail="Caster token not found")

        # Check concentration_spell first, then fall back to active_effects
        conc = caster_token.concentration_spell
        spell_source = None
        if conc and conc.get("spell_id") == request.spell_id:
            spell_source = conc
        else:
            # Check non-concentration zone spells (e.g. Grease) in active_effects
            for eff in (caster_token.active_effects or []):
                eff_id = eff.get("spell_id") or eff.get("id")
                if eff.get("spell_buff") and eff_id == request.spell_id:
                    spell_source = eff
                    break

        if not spell_source:
            raise HTTPException(status_code=400, detail="Spell not found on caster")

        spell_name = spell_source.get("spell_name") or spell_source.get("name", request.spell_id)
        caster_name = caster_token.instance_name or "施法者"

        # Load spell data from rules cache
        spell_data = get_spell_by_id(request.spell_id)

        structured_zone_spell = _spell_has_structured_zone_settlement(spell_data)

        # Validate: only spells with structured zone settlement should be settled
        if spell_data and not structured_zone_spell:
            raise HTTPException(
                status_code=400,
                detail=f"Spell '{spell_name}' does not have environmental settlement configured"
            )

        # Caster stats for structured settlement
        spell_save_dc = 10
        caster_level = 1
        spellcasting_mod = 0
        proficiency_bonus = 2
        caster_class_id = None
        caster_subclass_id = None
        caster_ability_scores = None

        if caster_token.character_id:
            char = await db.get(Character, caster_token.character_id)
            if char:
                # Calculate spell save DC
                ability_scores = char.ability_scores or {}
                level = char.level or 1
                prof_bonus = (level - 1) // 4 + 2
                # Get spellcasting ability
                class_id = char.class_id
                spell_ability = "intelligence"
                if class_id in ["cleric", "druid", "ranger"]:
                    spell_ability = "wisdom"
                elif class_id in ["bard", "paladin", "sorcerer", "warlock"]:
                    spell_ability = "charisma"
                ability_score = ability_scores.get(spell_ability, 10)
                ability_mod = (ability_score - 10) // 2
                spell_save_dc = 8 + prof_bonus + ability_mod
                caster_level = level
                spellcasting_mod = ability_mod
                proficiency_bonus = prof_bonus
                caster_class_id = char.class_id
                caster_subclass_id = char.subclass_id
                caster_ability_scores = ability_scores

        structured_settlement = await _settle_structured_zone_spell(
            request=request,
            db=db,
            caster_token=caster_token,
            spell_source=spell_source,
            spell_data=spell_data or {},
            spell_name=spell_name,
            caster_name=caster_name,
            spell_save_dc=spell_save_dc,
            caster_level=caster_level,
            spellcasting_mod=spellcasting_mod,
            proficiency_bonus=proficiency_bonus,
            caster_class_id=caster_class_id,
            caster_subclass_id=caster_subclass_id,
            caster_ability_scores=caster_ability_scores,
            user_id=user_id,
            role=role,
        )
        if structured_settlement is not None:
            return structured_settlement

        # Stage 10: runtime engine dispatch for zone enter/leave triggers.
        # Only spells whose runtime instance matches this caster/spell will
        # fire here, so legacy structured-zone spells (Web/Grease/Entangle)
        # remain on the structured path above.
        normalized_timing = _normalize_zone_settlement_timing(request.timing)
        runtime_trigger_timing = _ZONE_RUNTIME_TIMING_BY_ALIAS.get(
            normalized_timing or ""
        )
        if runtime_trigger_timing:
            from app.models.campaign import Campaign
            from app.services.spell_runtime_service import (
                execute_runtime_zone_triggers,
            )

            campaign_obj = await db.get(Campaign, request.campaign_id)
            campaign_meta = (
                campaign_obj.meta if campaign_obj and campaign_obj.meta else {}
            )
            current_world_time = campaign_meta.get("time_of_day") or {}

            touched = await execute_runtime_zone_triggers(
                db,
                campaign_id=request.campaign_id,
                caster_token_id=request.caster_token_id,
                spell_id=request.spell_id,
                target_token_ids=request.target_token_ids,
                timing=runtime_trigger_timing,
                current_world_time=current_world_time,
            )
            if touched:
                action_cn = "进入" if runtime_trigger_timing == "on_enter_zone" else "离开"
                return ZoneSpellSettleResponse(
                    success=True,
                    spell_id=request.spell_id,
                    spell_name=spell_name,
                    caster_name=caster_name,
                    save_dc=spell_save_dc,
                    save_type="",
                    save_type_cn="",
                    target_results=[],
                    narrative=f"{spell_name} 触发了 {len(touched)} 个目标的{action_cn}效果",
                )

        if structured_zone_spell:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Spell '{spell_name}' 已迁移到 structured zone settlement，"
                    "当前请求没有命中受支持的结算时机"
                ),
            )

        raise HTTPException(
            status_code=400,
            detail=f"Spell '{spell_name}' does not have zone settlement support",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Zone spell settlement failed: {e}", exc_info=True)
        return ZoneSpellSettleResponse(
            success=False,
            spell_id=request.spell_id,
            spell_name="",
            caster_name="",
            save_dc=0,
            save_type="",
            save_type_cn="",
            target_results=[],
            narrative="",
            error=str(e)
        )


# ============== Control Effect Management ==============

class OngoingSaveRequest(BaseModel):
    """Request to roll ongoing save for a control effect"""
    campaign_id: int
    token_id: int
    effect_id: str  # The effect to try to save against
    # Target info for calculating save
    ability_scores: Optional[AbilityScores] = None
    saving_throw_override: Optional[int] = None
    class_id: Optional[str] = None
    level: int = 1
    proficiency_bonus: int = 2


class OngoingSaveResult(BaseModel):
    """Result of ongoing save attempt"""
    success: bool
    effect_id: str
    effect_name: str
    save_type: str
    save_dc: int
    save_roll: DiceRoll
    save_total: int
    effect_removed: bool
    narrative: str


class BatchOngoingSaveRequest(BaseModel):
    """Request to batch-roll ongoing saves for all matching effects on a token"""
    campaign_id: int
    token_id: int
    timing: str = "end_of_turn"  # "end_of_turn" | "start_of_turn"


class BatchOngoingSaveResponse(BaseModel):
    """Response for batch ongoing saves"""
    success: bool
    results: List[OngoingSaveResult] = []
    chat_message_id: Optional[int] = None


async def _resolve_save_modifier(token, save_type: str, db) -> Tuple[int, str]:
    """Auto-resolve save modifier and target name from token's character/monster data."""
    save_modifier = 0
    target_name = token.instance_name or token.character_name or token.monster_name or "目标"
    ability_scores = None

    if token.monster_instance_id:
        from app.models.monster_instance import MonsterInstance
        monster = await db.get(MonsterInstance, token.monster_instance_id)
        if monster and monster.ability_scores:
            ability_scores = monster.ability_scores
            target_name = monster.name or target_name
    elif token.character_id:
        from app.models.character import Character
        character = await db.get(Character, token.character_id)
        if character and character.ability_scores:
            ability_scores = character.ability_scores
            target_name = character.name or target_name

    if ability_scores:
        ability_map = {
            'str': 'strength', 'dex': 'dexterity', 'con': 'constitution',
            'int': 'intelligence', 'wis': 'wisdom', 'cha': 'charisma',
            'strength': 'strength', 'dexterity': 'dexterity', 'constitution': 'constitution',
            'intelligence': 'intelligence', 'wisdom': 'wisdom', 'charisma': 'charisma'
        }
        ability_key = ability_map.get(save_type.lower(), save_type.lower())
        if isinstance(ability_scores, dict):
            ability_score = ability_scores.get(ability_key, 10)
        else:
            ability_score = getattr(ability_scores, ability_key, 10)
        save_modifier = (ability_score - 10) // 2

    return save_modifier, target_name


async def _broadcast_combat_chat(
    db,
    campaign_id: int,
    content: str,
    meta: dict | None = None,
    *,
    sender_user_id: str = "system",
    sender_role: str = "system",
) -> int | None:
    """Create a combat chat message and broadcast it via WebSocket. Returns message id or None."""
    try:
        chat_msg = await create_combat_chat_message_service(
            db,
            campaign_id=campaign_id,
            sender_user_id=sender_user_id,
            sender_role=sender_role,
            content=content,
            meta=meta or {},
            recipients=[],
            is_private=False,
        )

        await realtime_publisher.publish_chat_message(
            campaign_id,
            chat_id=chat_msg.id,
            user_id=sender_user_id,
            role=sender_role,
            message=content,
            message_type="combat",
            recipients=[],
            is_private=False,
            meta=chat_msg.meta,
            timestamp=combat_chat_timestamp_ms_service(chat_msg),
        )
        return chat_msg.id
    except Exception:
        return None


async def _cleanup_caster_concentration(
    db: AsyncSession, effect: dict, target_token_id: int, campaign_id: int
) -> None:
    """When a target saves out of an effect, update the caster's concentration tracking.
    Removes target from affected_token_ids.

    For single-target concentration spells, an empty affected list means concentration can end.
    For persistent area concentration spells (area_effect present), concentration must remain
    active even when no targets are currently affected, because creatures can re-enter later.
    """
    caster_id = effect.get("source_token_id") or effect.get("sourceTokenId")
    spell_id = effect.get("spell_id") or effect.get("sourceSpell") or effect.get("spellId")
    if not caster_id or not spell_id:
        return
    try:
        caster = await db.get(Token, caster_id)
        if not caster or not caster.concentration_spell:
            return
        conc = caster.concentration_spell
        conc_spell_id = conc.get("spell_id") or conc.get("sourceSpell") or conc.get("spellId")
        if conc_spell_id != spell_id:
            return
        affected = conc.get("affected_token_ids")
        if affected is None:
            affected = conc.get("affectedTokenIds", [])

        target_token_id_str = str(target_token_id)
        affected = [tid for tid in affected if str(tid) != target_token_id_str]

        if not affected:
            if conc.get("area_effect"):
                conc["affected_token_ids"] = []
                conc.pop("affectedTokenIds", None)
                caster.concentration_spell = normalize_token_concentration_spell(conc, strict=True)
            else:
                caster.concentration_spell = None
        else:
            conc["affected_token_ids"] = affected
            conc.pop("affectedTokenIds", None)
            caster.concentration_spell = normalize_token_concentration_spell(conc, strict=True)
        flag_modified(caster, "concentration_spell")
        await realtime_publisher.publish_token_concentration_updated(
            campaign_id,
            token_id=caster_id,
            concentration_spell=caster.concentration_spell,
        )
    except Exception as e:
        logger.error(f"[ConcentrationCleanup] Failed: {e}")


def _effect_source_spell_id(effect: dict) -> Optional[str]:
    value = (
        effect.get("sourceSpell")
        or effect.get("source_spell")
        or effect.get("spell_id")
        or effect.get("spellId")
        or ""
    )
    normalized = str(value).strip().lower()
    return normalized or None


def _effect_source_feature_id(effect: dict) -> Optional[str]:
    value = (
        effect.get("sourceFeatureId")
        or (effect.get("metadata") or {}).get("sourceFeatureId")
        or ""
    )
    normalized = str(value).strip().lower()
    return normalized or None


def _effect_source_token_id(effect: dict) -> Optional[str]:
    value = (
        effect.get("sourceTokenId")
        or effect.get("source_token_id")
        or (effect.get("metadata") or {}).get("sourceTokenId")
    )
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _status_entry_matches_effect(entry: Any, effect: dict) -> bool:
    if not isinstance(entry, dict):
        return False

    condition = str(effect.get("condition") or "").strip().lower()
    if condition and str(entry.get("condition") or "").strip().lower() != condition:
        return False

    source = entry.get("source") or {}
    source_spell_id = _effect_source_spell_id(effect)
    if source_spell_id:
        return str(source.get("spell_id") or "").strip().lower() == source_spell_id

    source_feature_id = _effect_source_feature_id(effect)
    if source_feature_id:
        if str(source.get("feature_id") or "").strip().lower() != source_feature_id:
            return False
        source_token_id = _effect_source_token_id(effect)
        if source_token_id is None:
            return True
        return str(source.get("source_token_id") or "").strip() == source_token_id

    return bool(condition)


async def _remove_matching_status_entries(
    db: AsyncSession,
    token: Token,
    effect: dict,
) -> None:
    condition = str(effect.get("condition") or "").strip().lower()
    if not condition:
        return

    if token.character_id:
        char = await db.get(Character, token.character_id)
        if char:
            status = dict(char.status_effects or {})
            active_conditions = list(status.get("active_conditions", []))
            filtered = [entry for entry in active_conditions if not _status_entry_matches_effect(entry, effect)]
            if len(filtered) != len(active_conditions):
                status["active_conditions"] = filtered
                char.status_effects = status
                flag_modified(char, "status_effects")
    elif token.monster_instance_id:
        monster = await db.get(MonsterInstance, token.monster_instance_id)
        if monster:
            status = dict(monster.status_effects or {})
            conditions = list(status.get("conditions", []))
            filtered = [entry for entry in conditions if not _status_entry_matches_effect(entry, effect)]
            if len(filtered) != len(conditions):
                status["conditions"] = filtered
                monster.status_effects = status
                flag_modified(monster, "status_effects")


async def _resolve_token_status_sync_payload(
    db: AsyncSession,
    token: Token,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "character_id": token.character_id,
        "monster_instance_id": token.monster_instance_id,
        "character_status_effects": None,
        "monster_status_effects": None,
    }

    if token.character_id:
        char = await db.get(Character, token.character_id)
        if char:
            payload["character_status_effects"] = char.status_effects
    elif token.monster_instance_id:
        monster = await db.get(MonsterInstance, token.monster_instance_id)
        if monster:
            payload["monster_instance_id"] = monster.id
            payload["monster_status_effects"] = monster.status_effects

    return payload


async def _do_single_save(token, effect: dict, db) -> OngoingSaveResult:
    """Roll a single ongoing save for one effect. Mutates token.active_effects but does NOT commit."""
    ongoing_save = effect.get("ongoing_save") or effect.get("ongoingSave") or {}
    save_dc = ongoing_save.get("dc") or effect.get("saveDc") or effect.get("spell_save_dc") or 10
    save_type = ongoing_save.get("save_type") or ongoing_save.get("saveType") or "wisdom"

    save_modifier, target_name = await _resolve_save_modifier(token, save_type, db)

    passive_save_sources = await _get_passive_save_advantage_for_token(db, token, save_type)
    nat_roll, save_rolls = _roll_save_d20(
        advantage=bool(passive_save_sources),
        disadvantage=False,
    )
    save_total = nat_roll + save_modifier
    success = save_total >= save_dc

    save_roll = DiceRoll(
        dice="2d20" if len(save_rolls) > 1 else "1d20",
        rolls=save_rolls,
        modifier=save_modifier,
        total=save_total,
    )

    effect_removed = False
    if success:
        cleanup_result = await remove_effect_group(
            db=db,
            token=token,
            effect=effect,
            cleanup_concentration=False,
        )
        effect_removed = cleanup_result.active_effects_changed

    effect_name = effect.get("name", effect.get("id", "未知"))
    save_type_cn = SAVE_TYPE_CN.get(save_type.lower(), save_type)

    if success:
        narrative = f"{target_name}通过了DC {save_dc}的{save_type_cn}豁免（{save_total}），摆脱了{effect_name}！"
    else:
        narrative = f"{target_name}未能通过DC {save_dc}的{save_type_cn}豁免（{save_total}），{effect_name}持续。"

    return OngoingSaveResult(
        success=success,
        effect_id=effect.get("id", ""),
        effect_name=effect_name,
        save_type=save_type,
        save_dc=save_dc,
        save_roll=save_roll,
        save_total=save_total,
        effect_removed=effect_removed,
        narrative=narrative
    )


@router.post("/ongoing-save", response_model=OngoingSaveResult)
async def roll_ongoing_save(
    request: OngoingSaveRequest,
    db: AsyncSession = Depends(get_db)
):
    """Roll ongoing save to try to end a control effect (single effect, manual trigger)."""
    token = await db.get(Token, request.token_id)
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    effects = token.active_effects or []
    effect = next((e for e in effects if e.get("id") == request.effect_id), None)
    if not effect:
        raise HTTPException(status_code=404, detail="Effect not found on token")
    if not (effect.get("ongoing_save") or effect.get("ongoingSave")):
        raise HTTPException(status_code=400, detail="Effect does not have ongoing save")

    result = await _do_single_save(token, effect, db)
    if result.effect_removed:
        # If this was a size-changing spell buff, restore transformation_data
        spell_id = effect.get("spell_id", "")
        if (spell_id and token.transformation_data
                and token.transformation_data.get("source", {}).get("config_id") == spell_id):
            SIZE_CN_TO_IDX = {"微型": 0, "小型": 1, "中型": 2, "大型": 3, "巨型": 4, "超巨型": 5}
            SIZE_GRIDS = ["0.4x0.4", "0.65x0.65", "1x1", "2x2", "3x3", "4x4"]
            orig_label = token.transformation_data.get("original_size", "中型")
            orig_idx = SIZE_CN_TO_IDX.get(orig_label, 2)
            token.transformation_data = None
            token.token_size = SIZE_GRIDS[orig_idx]
            flag_modified(token, "transformation_data")
            await realtime_publisher.publish_transformation_updated(
                request.campaign_id,
                token_id=request.token_id,
                transformation_data=None,
                token_size=token.token_size,
            )
        # Clean up caster's concentration tracking
        await _cleanup_caster_concentration(db, effect, request.token_id, request.campaign_id)
        await db.commit()

    status_sync_payload = await _resolve_token_status_sync_payload(db, token)

    # Broadcast token effects update using the message type the map actually consumes.
    await realtime_publisher.publish_token_active_effects_updated(
        request.campaign_id,
        token_id=request.token_id,
        active_effects=token.active_effects or [],
        character_id=status_sync_payload["character_id"],
        monster_instance_id=status_sync_payload["monster_instance_id"],
        character_status_effects=status_sync_payload["character_status_effects"],
        monster_status_effects=status_sync_payload["monster_status_effects"],
    )

    # Build and broadcast chat message
    token_name = token.instance_name or token.character_name or token.monster_name or "目标"
    save_type_cn = SAVE_TYPE_CN.get(result.save_type.lower(), result.save_type)
    rolls_str = str(result.save_roll.rolls[0]) if result.save_roll.rolls else "?"
    chat_content = build_ongoing_save_chat_content_service(
        token_name=token_name,
        effect_name=result.effect_name,
        save_dc=result.save_dc,
        save_type_cn=save_type_cn,
        nat_roll=rolls_str,
        modifier=result.save_roll.modifier,
        save_total=result.save_total,
        success=result.success,
        effect_removed=result.effect_removed,
    )

    await _broadcast_combat_chat(
        db,
        request.campaign_id,
        chat_content,
        build_ongoing_save_chat_meta_service(token_id=request.token_id),
    )

    return result


@router.post("/batch-ongoing-saves", response_model=BatchOngoingSaveResponse)
async def batch_ongoing_saves(
    request: BatchOngoingSaveRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Batch-roll ongoing saves for all effects matching the given timing on a token.
    Called automatically at turn end/start during combat, or manually outside combat.
    """
    token = await db.get(Token, request.token_id)
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    effects = list(token.active_effects or [])
    # Find effects that need saves at this timing (check both snake_case and camelCase)
    save_effects = [
        e for e in effects
        if (e.get("ongoing_save") or e.get("ongoingSave"))
        and (e.get("ongoing_save") or e.get("ongoingSave", {})).get("timing") == request.timing
    ]

    if not save_effects:
        return BatchOngoingSaveResponse(success=True, results=[])

    results: List[OngoingSaveResult] = []
    for effect in save_effects:
        r = await _do_single_save(token, effect, db)
        results.append(r)

    # Commit all changes at once
    any_removed = any(r.effect_removed for r in results)
    if any_removed:
        # Restore transformation_data for any removed size-changing spell buffs
        for r in results:
            if not r.effect_removed:
                continue
            spell_id = next((e.get("spell_id", "") for e in save_effects if e.get("id") == r.effect_id), "")
            if (spell_id and token.transformation_data
                    and token.transformation_data.get("source", {}).get("config_id") == spell_id):
                SIZE_CN_TO_IDX = {"微型": 0, "小型": 1, "中型": 2, "大型": 3, "巨型": 4, "超巨型": 5}
                SIZE_GRIDS = ["0.4x0.4", "0.65x0.65", "1x1", "2x2", "3x3", "4x4"]
                orig_label = token.transformation_data.get("original_size", "中型")
                orig_idx = SIZE_CN_TO_IDX.get(orig_label, 2)
                token.transformation_data = None
                token.token_size = SIZE_GRIDS[orig_idx]
                flag_modified(token, "transformation_data")
                await realtime_publisher.publish_transformation_updated(
                    request.campaign_id,
                    token_id=request.token_id,
                    transformation_data=None,
                    token_size=token.token_size,
                )
        # Clean up caster concentration for all removed effects
        for r in results:
            if r.effect_removed:
                eff = next((e for e in save_effects if e.get("id") == r.effect_id), None)
                if eff:
                    await _cleanup_caster_concentration(db, eff, request.token_id, request.campaign_id)
        await db.commit()

    status_sync_payload = await _resolve_token_status_sync_payload(db, token)

    # Build chat message summarizing all saves
    token_name = token.instance_name or token.character_name or token.monster_name or "目标"
    chat_content = build_batch_ongoing_save_chat_content_service(
        token_name=token_name,
        timing=request.timing,
        results=results,
        save_type_cn_lookup=SAVE_TYPE_CN,
    )

    chat_msg_id = await _broadcast_combat_chat(
        db,
        request.campaign_id,
        chat_content,
        build_ongoing_save_chat_meta_service(token_id=request.token_id, timing=request.timing),
    )

    # Broadcast effect update if any were removed
    if any_removed:
        try:
            await realtime_publisher.publish_token_active_effects_updated(
                request.campaign_id,
                token_id=token.id,
                active_effects=token.active_effects,
                character_id=status_sync_payload["character_id"],
                monster_instance_id=status_sync_payload["monster_instance_id"],
                character_status_effects=status_sync_payload["character_status_effects"],
                monster_status_effects=status_sync_payload["monster_status_effects"],
            )
        except Exception as e:
            logger.error(f"[BatchOngoingSaves] Failed to broadcast effect update: {e}")

    return BatchOngoingSaveResponse(success=True, results=results, chat_message_id=chat_msg_id)


# ─── Condition Save (generic save to remove a condition from zone spells etc.) ───

class ConditionSaveRequest(BaseModel):
    campaign_id: int
    token_id: int
    effect_id: str

@router.post("/condition-save", response_model=OngoingSaveResult)
async def roll_condition_save(
    request: ConditionSaveRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Roll a saving throw to remove a condition (e.g. prone from Grease).
    Uses saveDc and saveType stored on the effect.
    On success, removes from both token.active_effects and monster/character status_effects.
    """
    token = await db.get(Token, request.token_id)
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    effects = list(token.active_effects or [])
    effect = None
    effect_idx = -1
    for i, e in enumerate(effects):
        if e.get("id") == request.effect_id:
            effect = e
            effect_idx = i
            break
    if not effect:
        raise HTTPException(status_code=404, detail="Effect not found on token")

    condition = effect.get("condition")
    if not condition:
        raise HTTPException(status_code=400, detail="Effect has no condition to save against")

    # Get save DC and type from the effect (stored at creation by zone-spell-settle)
    # The condition handler stores the DC under spell_save_dc, so fall back to it
    # before defaulting to 10 (otherwise every repeat save is rolled vs DC 10).
    save_dc = effect.get("saveDc") or effect.get("save_dc") or effect.get("spell_save_dc") or 10
    save_type = effect.get("saveType") or effect.get("save_type", "dex")
    if not effect.get("saveDc") and effect.get("sourceSpell"):
        from app.utils.rules_cache import get_spell_by_id
        spell_data = get_spell_by_id(effect["sourceSpell"])
        if spell_data:
            save_type = spell_data.get("saveType", save_type)

    # Calculate save modifier from token's entity
    save_modifier = 0
    target_name = token.instance_name or "目标"
    if token.monster_instance_id:
        monster = await db.get(MonsterInstance, token.monster_instance_id)
        if monster:
            target_name = monster.name or token.instance_name or "怪物"
            if monster.monster_data:
                saves = monster.monster_data.get("saving_throws", {})
                save_modifier = saves.get(save_type, 0)
    elif token.character_id:
        char = await db.get(Character, token.character_id)
        if char:
            target_name = char.name or token.instance_name or "角色"
            save_info = calc_saving_throw_modifier(
                char.ability_scores or {},
                {"con": "constitution", "dex": "dexterity", "wis": "wisdom",
                 "str": "strength", "int": "intelligence", "cha": "charisma"}.get(save_type, "constitution"),
                char.class_id, char.level or 1
            )
            save_modifier = save_info["total"]

    passive_save_sources = await _get_passive_save_advantage_for_token(db, token, save_type, char if token.character_id else None)
    nat_roll, save_rolls = _roll_save_d20(
        advantage=bool(passive_save_sources),
        disadvantage=False,
    )
    save_total = nat_roll + save_modifier
    success = save_total >= save_dc
    save_roll = DiceRoll(
        dice="2d20" if len(save_rolls) > 1 else "1d20",
        rolls=save_rolls,
        modifier=save_modifier,
        total=save_total,
    )

    effect_removed = False
    effect_name = effect.get("name", request.effect_id)
    save_type_cn = SAVE_TYPE_CN.get(save_type.lower(), save_type)

    if success:
        effects.pop(effect_idx)
        token.active_effects = effects
        flag_modified(token, "active_effects")
        await _remove_matching_status_entries(db, token, effect)

        await _cleanup_caster_concentration(db, effect, request.token_id, request.campaign_id)
        await db.commit()
        effect_removed = True

        if token.monster_instance_id:
            mi = await db.get(MonsterInstance, token.monster_instance_id)
            if mi:
                await realtime_publisher.publish_token_effects_updated(
                    request.campaign_id,
                    token_id=request.token_id,
                    active_effects=token.active_effects,
                    reason=f"condition_save:{effect_name}",
                    monster_instance_id=mi.id,
                    monster_status_effects=mi.status_effects,
                )
        elif token.character_id:
            ch = await db.get(Character, token.character_id)
            if ch:
                await realtime_publisher.publish_token_effects_updated(
                    request.campaign_id,
                    token_id=request.token_id,
                    active_effects=token.active_effects,
                    reason=f"condition_save:{effect_name}",
                    character_id=ch.id,
                    character_status_effects=ch.status_effects,
                )

    narrative = build_condition_save_narrative_service(
        target_name=target_name,
        success=success,
        save_dc=save_dc,
        save_type_cn=save_type_cn,
        save_total=save_total,
        effect_name=effect_name,
    )

    chat_content = build_condition_save_chat_content_service(
        target_name=target_name,
        success=success,
        effect_name=effect_name,
        save_dc=save_dc,
        save_type_cn=save_type_cn,
        nat_roll=nat_roll,
        save_modifier=save_modifier,
        save_total=save_total,
        effect_removed=effect_removed,
    )
    await _broadcast_combat_chat(
        db,
        request.campaign_id,
        chat_content,
        build_condition_save_chat_meta_service(token_id=request.token_id),
    )

    return OngoingSaveResult(
        success=success, effect_id=request.effect_id, effect_name=effect_name,
        save_type=save_type, save_dc=save_dc, save_roll=save_roll,
        save_total=save_total, effect_removed=effect_removed, narrative=narrative
    )


class EscapeAttemptRequest(BaseModel):
    """Request to attempt escape from a control effect"""
    campaign_id: int
    token_id: int
    effect_id: str
    # Target info
    ability_scores: Optional[AbilityScores] = None
    skill_override: Optional[int] = None  # For athletics/acrobatics
    level: int = 1
    proficiency_bonus: int = 2
    proficient_skills: Optional[List[str]] = None


class EscapeAttemptResult(BaseModel):
    """Result of escape attempt"""
    success: bool
    effect_id: str
    effect_name: str
    check_type: str  # 'check' or 'save'
    ability: str
    dc: int
    roll: DiceRoll
    total: int
    effect_removed: bool
    narrative: str


@router.post("/escape-attempt", response_model=EscapeAttemptResult)
async def attempt_escape(
    request: EscapeAttemptRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Attempt to escape from a control effect using an action.
    Used for effects like Web (strength check) or Entangle.
    """
    # Get the token
    token = await db.get(Token, request.token_id)
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    # Find the effect
    effects = token.active_effects or []
    effect = None
    effect_idx = -1
    for i, e in enumerate(effects):
        if e.get("id") == request.effect_id:
            effect = e
            effect_idx = i
            break

    if not effect:
        raise HTTPException(status_code=404, detail="Effect not found on token")

    escape_action = effect.get("escape_action")
    if not escape_action:
        raise HTTPException(status_code=400, detail="Effect cannot be escaped with an action")

    # Get DC and ability
    dc = escape_action.get("dc", effect.get("spell_save_dc", 10))
    ability = escape_action.get("ability", "strength")
    check_type = escape_action.get("type", "check")
    chosen_skill_cn = None  # Track which skill was chosen for narrative

    # Calculate modifier - auto-fetch from token if not provided
    modifier = 0
    target_name = token.instance_name or "目标"
    proficiency_bonus = request.proficiency_bonus
    proficient_skills = []

    if request.skill_override is not None:
        modifier = request.skill_override
    else:
        # Auto-fetch ability scores from token's monster_instance or character
        ability_scores = None
        if request.ability_scores:
            ability_scores = request.ability_scores
            proficient_skills = [s.lower() for s in (request.proficient_skills or [])]
        elif token.monster_instance_id:
            from app.models.monster_instance import MonsterInstance
            monster = await db.get(MonsterInstance, token.monster_instance_id)
            if monster and monster.ability_scores:
                ability_scores = monster.ability_scores
                target_name = monster.name or token.instance_name or "怪物"
                # Monsters may have skill proficiencies in their data
                proficient_skills = [s.lower() for s in (monster.skills or [])] if hasattr(monster, 'skills') and monster.skills else []
        elif token.character_id:
            from app.models.character import Character
            character = await db.get(Character, token.character_id)
            if character:
                character_payload = {
                    "ability_scores": character.ability_scores or {},
                    "race_id": character.race_id,
                    "subrace_id": character.subrace_id,
                    "race_choices": character.race_choices or {},
                    "selected_skills": character.selected_skills or [],
                    "expertise_skills": character.expertise_skills or [],
                    "class_id": character.class_id,
                    "subclass_id": character.subclass_id,
                    "subclass_choices": character.subclass_choices or {},
                    "background_id": character.background_id,
                    "status_effects": character.status_effects or {},
                    "feat_choices": character.feat_choices or {},
                    "level": character.level or 1,
                }
                ability_scores = compute_final_ability_scores(character_payload)
                target_name = character.name or token.instance_name or "角色"
                proficiency_bonus = get_proficiency_bonus(character.level or 1)
                proficient_skills = [
                    skill.lower() for skill in collect_character_skill_proficiencies(character_payload)
                ]

        if ability_scores:
            def _get_score(scores, key):
                if isinstance(scores, dict):
                    return scores.get(key, 10)
                return getattr(scores, key, 10)

            if ability == "athletics_or_acrobatics":
                # Grapple escape: pick the better of Athletics (STR) or Acrobatics (DEX)
                str_score = _get_score(ability_scores, 'strength')
                dex_score = _get_score(ability_scores, 'dexterity')
                str_mod = (str_score - 10) // 2
                dex_mod = (dex_score - 10) // 2
                athletics_mod = str_mod + (proficiency_bonus if 'athletics' in proficient_skills else 0)
                acrobatics_mod = dex_mod + (proficiency_bonus if 'acrobatics' in proficient_skills else 0)
                if athletics_mod >= acrobatics_mod:
                    modifier = athletics_mod
                    ability = "strength"
                    chosen_skill_cn = "运动"
                else:
                    modifier = acrobatics_mod
                    ability = "dexterity"
                    chosen_skill_cn = "杂技"
            elif ability == "str_or_dex":
                # e.g. Evard's Black Tentacles: STR or DEX check, your choice (raw
                # ability, no skill proficiency). Pick the better modifier.
                str_mod = (_get_score(ability_scores, 'strength') - 10) // 2
                dex_mod = (_get_score(ability_scores, 'dexterity') - 10) // 2
                if str_mod >= dex_mod:
                    modifier = str_mod
                    ability = "strength"
                else:
                    modifier = dex_mod
                    ability = "dexterity"
            else:
                ability_map = {
                    'str': 'strength', 'dex': 'dexterity', 'con': 'constitution',
                    'int': 'intelligence', 'wis': 'wisdom', 'cha': 'charisma',
                    'strength': 'strength', 'dexterity': 'dexterity', 'constitution': 'constitution',
                    'intelligence': 'intelligence', 'wisdom': 'wisdom', 'charisma': 'charisma'
                }
                ability_key = ability_map.get(ability.lower(), ability.lower())
                ability_score = _get_score(ability_scores, ability_key)
                modifier = (ability_score - 10) // 2
                # Add proficiency if using Athletics for strength check
                if ability.lower() in ['str', 'strength'] and 'athletics' in proficient_skills:
                    modifier += proficiency_bonus

    # Roll
    nat_roll = random.randint(1, 20)
    total = nat_roll + modifier
    success = total >= dc

    roll = DiceRoll(
        dice="1d20",
        rolls=[nat_roll],
        modifier=modifier,
        total=total
    )

    # If successful, remove the effect and sync status_effects
    effect_removed = False
    if success:
        effects.pop(effect_idx)
        token.active_effects = effects
        flag_modified(token, "active_effects")
        await _remove_matching_status_entries(db, token, effect)

        await _cleanup_caster_concentration(db, effect, request.token_id, request.campaign_id)
        await db.commit()
        effect_removed = True

        if token.monster_instance_id:
            mi = await db.get(MonsterInstance, token.monster_instance_id)
            if mi:
                await realtime_publisher.publish_token_effects_updated(
                    request.campaign_id,
                    token_id=token.id,
                    active_effects=token.active_effects or [],
                    reason=f"escape:{effect.get('name', '')}",
                    monster_instance_id=mi.id,
                    monster_status_effects=mi.status_effects,
                )
        elif token.character_id:
            ch = await db.get(Character, token.character_id)
            if ch:
                await realtime_publisher.publish_token_effects_updated(
                    request.campaign_id,
                    token_id=token.id,
                    active_effects=token.active_effects or [],
                    reason=f"escape:{effect.get('name', '')}",
                    character_id=ch.id,
                    character_status_effects=ch.status_effects,
                )

    effect_name = effect.get("name", request.effect_id)
    skill_label = chosen_skill_cn or ABILITY_NAMES_CN.get(ability.lower(), ability)
    check_text = "检定" if check_type == "check" else "豁免"

    narrative = build_escape_attempt_narrative_service(
        target_name=target_name,
        success=success,
        dc=dc,
        skill_label=skill_label,
        check_text=check_text,
        nat_roll=nat_roll,
        modifier=modifier,
        total=total,
        effect_name=effect_name,
    )

    chat_content = build_escape_attempt_chat_content_service(
        target_name=target_name,
        success=success,
        effect_name=effect_name,
        dc=dc,
        skill_label=skill_label,
        check_text=check_text,
        nat_roll=nat_roll,
        modifier=modifier,
        total=total,
    )
    await _broadcast_combat_chat(
        db,
        request.campaign_id,
        chat_content,
        build_escape_attempt_chat_meta_service(token_id=request.token_id),
    )

    return EscapeAttemptResult(
        success=success,
        effect_id=request.effect_id,
        effect_name=effect_name,
        check_type=check_type,
        ability=ability,
        dc=dc,
        roll=roll,
        total=total,
        effect_removed=effect_removed,
        narrative=narrative
    )


@router.post("/remove-effect")
async def remove_effect(
    campaign_id: int,
    token_id: int,
    effect_id: str,
    reason: str = "manual",  # 'manual', 'damage', 'shaken', 'concentration_lost'
    db: AsyncSession = Depends(get_db)
):
    """
    Remove an effect from a token.
    Used when break conditions are met (damage, shaken awake, etc.)
    """
    from app.services import aura_service

    token = await db.get(Token, token_id)
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    effects = token.active_effects or []
    effect = None
    effect_idx = -1
    for i, e in enumerate(effects):
        if e.get("id") == effect_id:
            effect = e
            effect_idx = i
            break

    if not effect:
        raise HTTPException(status_code=404, detail="Effect not found")

    cleanup_result = await remove_effect_group(
        db=db,
        token=token,
        effect=effect,
        cleanup_concentration=(reason != "concentration_lost"),
    )
    if not cleanup_result.active_effects_changed:
        raise HTTPException(status_code=404, detail="Effect group not found")

    removed_effects = cleanup_result.removed_effects or [effect]
    effect_name = effect.get("name", effect_id)

    # Cleanup spell-generated items bound to this effect
    from app.utils.spell_item_cleanup import cleanup_spell_generated_items
    await cleanup_spell_generated_items(db, removed_effects, token, campaign_id)

    token_update_payload = None
    faction_changed = False

    broadcast_character_status_effects: Any = None
    broadcast_monster_instance_id: Any = None
    broadcast_monster_status_effects: Any = None

    status_sync_payload = await _resolve_token_status_sync_payload(db, token)
    broadcast_character_status_effects = status_sync_payload["character_status_effects"]
    broadcast_monster_instance_id = status_sync_payload["monster_instance_id"]
    broadcast_monster_status_effects = status_sync_payload["monster_status_effects"]

    restore_control = get_master_of_nature_restore_data(effect)
    if restore_control and token.monster_instance_id:
        monster = await db.get(MonsterInstance, token.monster_instance_id)
        if monster:
            monster.controller_character_id = restore_control.get("original_controller_character_id")
            monster.control_type = restore_control.get("original_control_type")
        original_user_id = restore_control.get("original_user_id")
        original_faction = restore_control.get("original_faction") or "enemy"
        token.user_id = original_user_id
        faction_changed = token.faction != original_faction
        token.faction = original_faction
        token_update_payload = {
            "id": token.id,
            "user_id": token.user_id,
            "faction": token.faction,
            "controller_character_id": restore_control.get("original_controller_character_id"),
            "control_type": restore_control.get("original_control_type"),
        }

    await db.commit()

    if token_update_payload:
        await realtime_publisher.publish_token_updated(
            campaign_id,
            token=token_update_payload,
        )

    await realtime_publisher.publish_token_active_effects_updated(
        campaign_id,
        token_id=token.id,
        active_effects=token.active_effects,
        character_id=token.character_id,
        monster_instance_id=broadcast_monster_instance_id if broadcast_monster_instance_id is not None else token.monster_instance_id,
        character_status_effects=broadcast_character_status_effects,
        monster_status_effects=broadcast_monster_status_effects,
    )

    await _broadcast_concentration_updates(
        db,
        campaign_id,
        cleanup_result.concentration_touched_token_ids,
    )

    if faction_changed:
        await aura_service.on_token_move(token.id, campaign_id, token.map_url, db)

    reason_text = {
        "manual": "手动移除",
        "damage": "受到伤害",
        "shaken": "被摇醒",
        "stand_up": "站了起来",
        "concentration_lost": "施法者失去专注"
    }.get(reason, reason)

    return {
        "success": True,
        "effect_id": effect_id,
        "effect_name": effect_name,
        "reason": reason,
        "narrative": f"{token.instance_name or '目标'}的{effect_name}效果结束（{reason_text}）。"
    }


# ============== Death Saving Throw Endpoint ==============

class DeathSaveRequest(BaseModel):
    campaign_id: int
    token_id: int

class DeathSaveResponse(BaseModel):
    success: bool
    roll: int
    successes: int
    failures: int
    stabilized: bool
    revived: bool = False  # nat 20 → regain 1 HP
    dead: bool = False  # 3 failures
    halfling_lucky_reroll: bool = False
    message: str


@router.post("/death-save", response_model=DeathSaveResponse)
async def perform_death_save(
    request: DeathSaveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Perform a death saving throw for a token at 0 HP."""
    context = await resolve_campaign_member_context(db, request.campaign_id, current_user)
    user_id = context.user_id
    role = _sender_role_from_context(context)

    token = await db.get(Token, request.token_id)
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")
    if not token.character_id:
        raise HTTPException(status_code=400, detail="Only character tokens can make death saves")

    ds = token.death_saves or {"successes": 0, "failures": 0, "stabilized": False}
    if ds.get("stabilized"):
        raise HTTPException(status_code=400, detail="Character is already stabilized")

    # Roll d20
    roll = random.randint(1, 20)
    lucky_reroll = False

    # Halfling Lucky: reroll nat 1
    if roll == 1:
        char = await db.get(Character, token.character_id)
        if char:
            from app.utils.race_effects import check_lucky
            race_id = (char.subrace_id or char.race_id or '')
            if check_lucky(race_id):
                roll = random.randint(1, 20)
                lucky_reroll = True

    revived = False
    dead = False

    if roll == 20:
        # Natural 20: regain 1 HP, clear death saves
        revived = True
        token.current_hp = 1
        token.death_saves = None
        flag_modified(token, "death_saves")
        char = await db.get(Character, token.character_id)
        if char:
            char.current_hp = 1
        ds = {"successes": 0, "failures": 0, "stabilized": False}
        message = f"🌟 **自然20！** {token.instance_name} 恢复1点生命值，重返战斗！"
    elif roll == 1:
        # Natural 1: 2 failures
        ds["failures"] = min(3, ds.get("failures", 0) + 2)
        message = f"💀 **自然1！** {token.instance_name} 死亡豁免失败x2"
    elif roll >= 10:
        ds["successes"] = ds.get("successes", 0) + 1
        message = f"✅ {token.instance_name} 死亡豁免成功 ({roll})"
    else:
        ds["failures"] = ds.get("failures", 0) + 1
        message = f"❌ {token.instance_name} 死亡豁免失败 ({roll})"

    # Check for stabilization or death
    if ds.get("successes", 0) >= 3:
        ds["stabilized"] = True
        message += f"\n🛡️ **稳定！** {token.instance_name} 已稳定，不再需要死亡豁免"
    if ds.get("failures", 0) >= 3:
        dead = True
        message += f"\n💀 **死亡！** {token.instance_name} 三次死亡豁免失败，角色死亡"

    if lucky_reroll:
        message += f"\n> 🍀 **半身人幸运**: 自然1重投 → {roll}"

    if not revived:
        token.death_saves = normalize_token_death_saves(ds, strict=True)
        flag_modified(token, "death_saves")

    await db.commit()

    await realtime_publisher.publish_death_save_updated(
        request.campaign_id,
        token_id=token.id,
        roll=roll,
        death_saves=token.death_saves,
        revived=revived,
        dead=dead,
        message=message,
    )

    chat_msg = await create_combat_chat_message_service(
        db,
        campaign_id=request.campaign_id,
        sender_user_id=user_id,
        sender_role=role,
        content=message,
        meta=build_death_save_chat_meta_service(token_id=token.id, roll=roll),
    )
    await realtime_publisher.publish_chat_message(
        request.campaign_id,
        chat_id=chat_msg.id,
        user_id=user_id,
        role=role,
        message=message,
        message_type="combat",
        recipients=[],
        is_private=False,
        meta=chat_msg.meta,
        timestamp=combat_chat_timestamp_ms_service(chat_msg),
    )

    return DeathSaveResponse(
        success=True,
        roll=roll,
        successes=ds.get("successes", 0),
        failures=ds.get("failures", 0),
        stabilized=ds.get("stabilized", False),
        revived=revived,
        dead=dead,
        halfling_lucky_reroll=lucky_reroll,
        message=message,
    )


# ── 预言骰 (Portent) ────────────────────────────────────

class PortentRollRequest(BaseModel):
    campaign_id: int
    character_id: int

class PortentRollResponse(BaseModel):
    success: bool
    values: List[int] = []
    error: Optional[str] = None

class PortentUseRequest(BaseModel):
    campaign_id: int
    character_id: int
    value: int

class PortentUseResponse(BaseModel):
    success: bool
    remaining: List[int] = []
    error: Optional[str] = None


@router.post("/portent/roll", response_model=PortentRollResponse)
async def roll_portent(
    request: PortentRollRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """长休时投预言骰（占卜系法师）"""
    try:
        from app.services.portent_service import roll_portent_dice
        values = await roll_portent_dice(db, request.character_id)
        await db.commit()
        if not values:
            return PortentRollResponse(success=False, error="角色不是占卜系法师或等级不足")
        return PortentRollResponse(success=True, values=values)
    except Exception as e:
        logger.error(f"Portent roll failed: {e}", exc_info=True)
        return PortentRollResponse(success=False, error=str(e))


class CuttingWordsRequest(BaseModel):
    campaign_id: int
    bard_character_id: int
    target_token_id: int
    roll_type: str  # "attack" | "check" | "damage"
    original_total: int
    inspiration_die_size: str  # "d6" | "d8" | "d10" | "d12"

class CuttingWordsResponse(BaseModel):
    success: bool
    die_rolled: int = 0
    new_total: int = 0
    error: Optional[str] = None


@router.post("/cutting-words", response_model=CuttingWordsResponse)
async def apply_cutting_words(
    request: CuttingWordsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """辛辣嘲讽 — 博识吟游诗人消耗激励骰削减敌方投骰"""
    try:
        die_match = re.match(r'd(\d+)', request.inspiration_die_size.lower())
        if not die_match:
            return CuttingWordsResponse(success=False, error="无效的激励骰")
        die_size = int(die_match.group(1))
        die_rolled = random.randint(1, die_size)
        new_total = max(0, request.original_total - die_rolled)

        # 消耗吟游诗人的激励次数
        bard = await db.get(Character, request.bard_character_id)
        if bard:
            uses = dict(bard.class_feature_uses or {})
            insp = uses.get("bardic_inspiration", {})
            current = insp.get("current", 0)
            if current > 0:
                insp["current"] = current - 1
                uses["bardic_inspiration"] = insp
                bard.class_feature_uses = uses
                flag_modified(bard, "class_feature_uses")
            else:
                return CuttingWordsResponse(success=False, error="没有剩余激励次数")
        else:
            return CuttingWordsResponse(success=False, error="找不到吟游诗人角色")

        await db.commit()
        logger.info(
            f"[CuttingWords] Bard {request.bard_character_id} rolled {request.inspiration_die_size}={die_rolled}, "
            f"{request.original_total} -> {new_total}"
        )
        return CuttingWordsResponse(
            success=True,
            die_rolled=die_rolled,
            new_total=new_total,
        )
    except Exception as e:
        logger.error(f"Cutting words failed: {e}", exc_info=True)
        return CuttingWordsResponse(success=False, error=str(e))


@router.post("/portent/use", response_model=PortentUseResponse)
async def use_portent(
    request: PortentUseRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """使用一个预言骰值"""
    try:
        from app.services.portent_service import use_portent_die
        remaining = await use_portent_die(db, request.character_id, request.value)
        if remaining is None:
            return PortentUseResponse(success=False, error="该预言骰值不存在")
        await db.commit()
        return PortentUseResponse(success=True, remaining=remaining)
    except Exception as e:
        logger.error(f"Portent use failed: {e}", exc_info=True)
        return PortentUseResponse(success=False, error=str(e))
