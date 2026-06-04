from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.character import Character
from app.models.monster_instance import MonsterInstance
from app.models.token import Token
from app.services.passive_feature_service import get_passive_save_advantage_sources
from app.services.runtime_schema_service import normalize_token_concentration_spell
from app.utils.rules_cache import get_spell_by_id, get_spell_effect_phases


@dataclass
class SpellEffectCleanupResult:
    active_effects_changed: bool = False
    removed_effect_ids: List[str] = field(default_factory=list)
    removed_effects: List[dict] = field(default_factory=list)
    concentration_touched_token_ids: List[int] = field(default_factory=list)


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


async def _flush_if_supported(db: AsyncSession) -> None:
    flush = getattr(db, "flush", None)
    if callable(flush):
        await flush()


async def _get_target_conditions(db: AsyncSession, token: Token) -> List[str]:
    status_effects: dict[str, Any] | None = None
    if token.character_id:
        char = await db.get(Character, token.character_id)
        if char and isinstance(char.status_effects, dict):
            status_effects = char.status_effects
    elif token.monster_instance_id:
        monster = await db.get(MonsterInstance, token.monster_instance_id)
        if monster and isinstance(monster.status_effects, dict):
            status_effects = monster.status_effects

    if not status_effects:
        return []

    raw = status_effects.get("active_conditions") or status_effects.get("conditions") or []
    result: List[str] = []
    for item in raw:
        if isinstance(item, str):
            result.append(item)
        elif isinstance(item, dict) and item.get("condition"):
            result.append(str(item["condition"]))
    return result


def _extract_passive_save_condition_ids(
    active_effects: Optional[List[Dict[str, Any]]],
) -> List[str]:
    aliases = {
        "blinded": "blinded",
        "目盲": "blinded",
        "charmed": "charmed",
        "魅惑": "charmed",
        "deafened": "deafened",
        "耳聋": "deafened",
        "frightened": "frightened",
        "恐惧": "frightened",
        "incapacitated": "incapacitated",
        "失能": "incapacitated",
    }
    result: List[str] = []
    for effect in active_effects or []:
        for raw in (effect.get("condition"), effect.get("id")):
            normalized = aliases.get(str(raw or "").strip().lower())
            if normalized and normalized not in result:
                result.append(normalized)
    return result


async def _resolve_save_modifier(
    db: AsyncSession,
    token: Token,
    save_type: str,
) -> int:
    ability_map = {
        "str": "strength",
        "dex": "dexterity",
        "con": "constitution",
        "int": "intelligence",
        "wis": "wisdom",
        "cha": "charisma",
        "strength": "strength",
        "dexterity": "dexterity",
        "constitution": "constitution",
        "intelligence": "intelligence",
        "wisdom": "wisdom",
        "charisma": "charisma",
    }
    ability_key = ability_map.get(str(save_type or "").lower(), str(save_type or "").lower())

    ability_scores: Any = None
    if token.monster_instance_id:
        monster = await db.get(MonsterInstance, token.monster_instance_id)
        if monster and monster.ability_scores:
            ability_scores = monster.ability_scores
    elif token.character_id:
        char = await db.get(Character, token.character_id)
        if char and char.ability_scores:
            ability_scores = char.ability_scores

    if isinstance(ability_scores, dict):
        score = ability_scores.get(ability_key, 10)
    elif ability_scores is not None:
        score = getattr(ability_scores, ability_key, 10)
    else:
        score = 10
    return (score - 10) // 2


async def _has_passive_save_advantage(
    db: AsyncSession,
    token: Token,
    save_type: str,
) -> bool:
    if not token.character_id:
        return False
    char = await db.get(Character, token.character_id)
    if not char:
        return False
    condition_ids = await _get_target_conditions(db, token)
    condition_ids.extend(_extract_passive_save_condition_ids(token.active_effects))
    sources = get_passive_save_advantage_sources(
        class_id=char.class_id,
        level=char.level or 1,
        subclass_id=char.subclass_id,
        save_type=save_type,
        condition_ids=condition_ids,
    )
    return bool(sources)


def _normalize_break_conditions(effect: dict) -> set[str]:
    raw = effect.get("break_conditions") or effect.get("breakConditions") or []
    values = raw if isinstance(raw, list) else [raw]
    normalized = {str(value).strip().lower() for value in values if value}
    aliases = {
        "damage_taken": "damage",
        "harmful_effect": "damage",
    }
    return {aliases.get(value, value) for value in normalized}


def _same_effect_group(reference: dict, candidate: dict) -> bool:
    ref_spell_id = _effect_source_spell_id(reference)
    cand_spell_id = _effect_source_spell_id(candidate)
    if ref_spell_id and cand_spell_id and ref_spell_id == cand_spell_id:
        ref_source_token_id = _effect_source_token_id(reference)
        cand_source_token_id = _effect_source_token_id(candidate)
        if ref_source_token_id and cand_source_token_id:
            return ref_source_token_id == cand_source_token_id
        return True
    return candidate.get("id") == reference.get("id")


async def _cleanup_caster_concentration_state(
    db: AsyncSession,
    effect: dict,
    target_token_id: int,
) -> Optional[int]:
    caster_id = effect.get("source_token_id") or effect.get("sourceTokenId")
    spell_id = effect.get("spell_id") or effect.get("sourceSpell") or effect.get("spellId")
    if not caster_id or not spell_id:
        return None

    caster = await db.get(Token, caster_id)
    if not caster or not caster.concentration_spell:
        return None

    conc = dict(caster.concentration_spell)
    conc_spell_id = conc.get("spell_id") or conc.get("sourceSpell") or conc.get("spellId")
    if conc_spell_id != spell_id:
        return None

    affected = conc.get("affected_token_ids")
    if affected is None:
        affected = conc.get("affectedTokenIds", [])

    target_token_id_str = str(target_token_id)
    next_affected = [tid for tid in list(affected or []) if str(tid) != target_token_id_str]

    if not next_affected:
        if conc.get("area_effect"):
            conc["affected_token_ids"] = []
            conc.pop("affectedTokenIds", None)
            caster.concentration_spell = normalize_token_concentration_spell(conc, strict=True)
        else:
            caster.concentration_spell = None
    else:
        conc["affected_token_ids"] = next_affected
        conc.pop("affectedTokenIds", None)
        caster.concentration_spell = normalize_token_concentration_spell(conc, strict=True)

    flag_modified(caster, "concentration_spell")
    return int(caster.id)


async def remove_effect_group(
    *,
    db: AsyncSession,
    token: Token,
    effect: dict,
    cleanup_concentration: bool = True,
) -> SpellEffectCleanupResult:
    effects = list(token.active_effects or [])
    removed_effects = [candidate for candidate in effects if _same_effect_group(effect, candidate)]
    if not removed_effects:
        return SpellEffectCleanupResult(active_effects_changed=False)

    token.active_effects = [candidate for candidate in effects if candidate not in removed_effects]
    flag_modified(token, "active_effects")

    for removed in removed_effects:
        await _remove_matching_status_entries(db, token, removed)

    concentration_touched_token_ids: List[int] = []
    if cleanup_concentration:
        touched = await _cleanup_caster_concentration_state(db, effect, token.id)
        if touched is not None:
            concentration_touched_token_ids.append(touched)

    await _flush_if_supported(db)
    return SpellEffectCleanupResult(
        active_effects_changed=True,
        removed_effect_ids=[
            str(removed.get("id") or "")
            for removed in removed_effects
            if removed.get("id")
        ],
        removed_effects=removed_effects,
        concentration_touched_token_ids=concentration_touched_token_ids,
    )


async def _should_remove_on_damage(
    *,
    db: AsyncSession,
    token: Token,
    effect: dict,
) -> bool:
    break_conditions = _normalize_break_conditions(effect)
    if "damage" in break_conditions:
        return True

    spell_id = _effect_source_spell_id(effect)
    if not spell_id:
        return False

    spell_data = get_spell_by_id(spell_id)
    if not spell_data:
        return False

    phases = [
        phase
        for phase in get_spell_effect_phases(spell_data)
        if str(phase.get("trigger") or "").strip().lower() == "on_take_damage"
    ]
    if not phases:
        return False

    for phase in phases:
        save_cfg = phase.get("save") or {}
        if not save_cfg:
            continue
        save_type = str(save_cfg.get("ability") or "wisdom")
        save_dc = (
            effect.get("spell_save_dc")
            or effect.get("saveDc")
            or effect.get("save_dc")
            or spell_data.get("saveDc")
            or 10
        )
        modifier = await _resolve_save_modifier(db, token, save_type)
        conditions = save_cfg.get("conditions") or {}
        has_advantage = bool(conditions.get("advantage_on_damage_trigger"))
        if not has_advantage:
            has_advantage = await _has_passive_save_advantage(db, token, save_type)
        if has_advantage:
            import random

            roll_1 = random.randint(1, 20)
            roll_2 = random.randint(1, 20)
            nat_roll = max(roll_1, roll_2)
        else:
            import random

            nat_roll = random.randint(1, 20)
        total = nat_roll + modifier
        if total >= int(save_dc) and save_cfg.get("on_success") == "partial":
            return True

    return False


async def apply_damage_break_cleanup(
    *,
    token: Optional[Token],
    damage_amount: int,
    db: AsyncSession,
) -> SpellEffectCleanupResult:
    if token is None or damage_amount <= 0 or not token.active_effects:
        return SpellEffectCleanupResult(active_effects_changed=False)

    result = SpellEffectCleanupResult(active_effects_changed=False)
    seen_group_keys: set[tuple[str, str]] = set()

    for effect in list(token.active_effects or []):
        spell_id = _effect_source_spell_id(effect) or str(effect.get("id") or "")
        source_token_id = _effect_source_token_id(effect) or ""
        group_key = (spell_id, source_token_id)
        if group_key in seen_group_keys:
            continue
        seen_group_keys.add(group_key)

        if not await _should_remove_on_damage(db=db, token=token, effect=effect):
            continue

        group_result = await remove_effect_group(
            db=db,
            token=token,
            effect=effect,
            cleanup_concentration=True,
        )
        if not group_result.active_effects_changed:
            continue

        result.active_effects_changed = True
        result.removed_effect_ids.extend(group_result.removed_effect_ids)
        for token_id in group_result.concentration_touched_token_ids:
            if token_id not in result.concentration_touched_token_ids:
                result.concentration_touched_token_ids.append(token_id)

    return result
