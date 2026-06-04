from __future__ import annotations

import logging
import re
from collections import OrderedDict, defaultdict
from typing import Any, Dict, Iterable, List, Optional, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.spell_runtime_instance import SpellRuntimeInstance
from app.models.token import Token
from app.schemas.combat import DiceRoll
from app.schemas.spell_effect import EffectResult, SpellResolveResult
from app.schemas.spell_runtime import (
    AttachedSpellRuntimeRef,
    RuntimeBonusDamage,
    SpellBadgeUI,
    SpellOverlayUI,
    SpellRuntimeActionUI,
    SpellVisualUI,
    TokenSpellRuntimeProjection,
)
from app.services.realtime_publisher import realtime_publisher
from app.services.spell_runtime_engine import evaluate_phase, execute_phase
from app.services.spell_runtime_engine.audit import audit_pipeline
from app.services.runtime_schema_service import (
    normalize_token_active_effects,
    normalize_token_active_auras,
    normalize_token_concentration_spell,
)
from app.services.aura_service import strip_spell_aura_entries
from app.utils.dice_formula import evaluate as eval_formula
from app.utils.rules_cache import get_spell_by_id, get_spell_effect_phases

logger = logging.getLogger(__name__)

NO_TARGET_ACTION_KINDS = {
    "dash",
    "disengage",
    "dodge",
    "hide",
    "extra_action",
    "command",
}

SUPPORTED_RUNTIME_TRIGGERS = {
    "on_cast",
    "on_hit",
    "on_weapon_hit",
    "on_target_downed",
    "start_of_turn",
    "end_of_turn",
    "on_enter_zone",
    "on_leave_zone",
    "on_take_damage",
    "on_concentration_end",
    "on_action_invoked",
    "on_reaction",
    "start_of_target_turn",
    "end_of_target_turn",
    "narrative",
}

SUPPORTED_RUNTIME_VERBS = {
    "deal_damage",
    "heal",
    "apply_condition",
    "modify_roll",
    "grant_advantage",
    "grant_disadvantage",
    "grant_resistance",
    "grant_immunity",
    "apply_mark",
    "retarget_mark",
    "conditional_extra_damage",
    "grant_action",
    "revoke_action",
    "set_runtime_param",
    "clear_runtime_param",
    "end_spell_instance",
    "create_zone",
    "move_zone",
    "remove_zone",
    "spawn_token",
    "link_entity",
    "unlink_entity",
    "set_visual_effect",
    "set_disguise",
    "generate_item",
    "resize_token",
    "apply_token_filter",
    "set_visibility",
    "spawn_illusion",
    "create_zone_visual",
    "apply_transformation",
    "teleport",
    "modify_movement",
    "restrict_movement",
    "apply_illumination",
    "spawn_summon",
    "remove_condition",
    "forced_movement",
    "create_wall",
    "create_barrier",
    "create_moving_aura",
    "counter_spell",
    "grant_sense",
    "prevent_healing",
    "stabilize",
    "instant_kill",
    "resurrect",
    "stored_trigger",
    "suppress_magic",
    "grant_temp_hp",
    "modify_stat",
    "apply_effect",
    "dispel_magic",
    "narrative",
}

SPELL_OVERLAY_COLORS = {
    "hex": "#7c3aed",
}

SPELL_OVERLAY_ICONS = {
    "hex": "💀",
}

SPELL_SCHOOL_ICONS = {
    "abjuration": "🛡️",
    "conjuration": "✨",
    "divination": "👁️",
    "enchantment": "💫",
    "evocation": "🔥",
    "illusion": "🌀",
    "necromancy": "💀",
    "transmutation": "🔄",
}

SPELL_SCHOOL_COLORS = {
    "abjuration": "#60a5fa",
    "conjuration": "#facc15",
    "divination": "#22d3ee",
    "enchantment": "#f472b6",
    "evocation": "#f87171",
    "illusion": "#a78bfa",
    "necromancy": "#4ade80",
    "transmutation": "#fb923c",
}


def _calc_runtime_expires_at(current_time: Optional[Dict[str, Any]], duration_rounds: Optional[int]) -> Optional[Dict[str, int]]:
    if not current_time or duration_rounds is None:
        return None
    total_seconds = (
        int(current_time.get("day", 1)) * 86400
        + int(current_time.get("hour", 0)) * 3600
        + int(current_time.get("minute", 0)) * 60
        + int(current_time.get("second", 0))
        + int(duration_rounds) * 6
    )
    return {
        "day": max(1, total_seconds // 86400),
        "hour": (total_seconds % 86400) // 3600,
        "minute": (total_seconds % 3600) // 60,
        "second": total_seconds % 60,
    }


def _world_time_to_seconds(time_data: Optional[Dict[str, Any]]) -> Optional[int]:
    if not time_data:
        return None
    try:
        day = int(time_data.get("day", 1) or 1)
        hour = int(time_data.get("hour", 0) or 0)
        minute = int(time_data.get("minute", 0) or 0)
        second = int(time_data.get("second", 0) or 0)
    except (TypeError, ValueError, AttributeError):
        return None
    return (((day * 24) + hour) * 60 + minute) * 60 + second


def spell_uses_runtime_engine(spell_data: Optional[Dict[str, Any]]) -> bool:
    runtime = (spell_data or {}).get("runtime") or {}
    return runtime.get("engine") == "v2"


def resolve_spell_duration_rounds(
    spell_data: Optional[Dict[str, Any]],
    slot_level: int,
) -> Optional[int]:
    runtime = (spell_data or {}).get("runtime") or {}
    duration_by_slot = runtime.get("durationBySlotLevel") or {}
    selected: Optional[int] = None
    selected_floor = -1
    for raw_key, raw_value in duration_by_slot.items():
        try:
            floor = int(raw_key)
            rounds = int(raw_value)
        except (TypeError, ValueError):
            continue
        if slot_level >= floor and floor > selected_floor:
            selected_floor = floor
            selected = rounds
    if selected is not None:
        return selected

    duration_text = str((spell_data or {}).get("duration") or "")
    match = re.search(r"(\d+)\s*(分钟|小时|轮|日|天)", duration_text)
    if not match:
        return None
    value = int(match.group(1))
    unit = match.group(2)
    if unit == "轮":
        return value
    if unit == "分钟":
        return value * 10
    if unit == "小时":
        return value * 600
    return value * 14400


def audit_spell_pipeline_support() -> Dict[str, Any]:
    """Bridge the legacy service-level audit onto the engine audit.

    Preserves the legacy `triggers_used` / `verbs_used` /
    `unsupported_triggers` / `unsupported_verbs` contract (legacy
    `unsupported_*` is still set-membership against the declared
    `SUPPORTED_RUNTIME_*` sets, not real handler/callsite presence).
    Also surfaces the new engine-audit fields so callers can see real
    executability without scanning spells.json twice.
    """
    engine_audit = audit_pipeline()
    triggers_used = set(engine_audit["declared_triggers"])
    verbs_used = set(engine_audit["declared_verbs"])

    return {
        "triggers_used": sorted(triggers_used),
        "verbs_used": sorted(verbs_used),
        "unsupported_triggers": sorted(triggers_used - SUPPORTED_RUNTIME_TRIGGERS),
        "unsupported_verbs": sorted(verbs_used - SUPPORTED_RUNTIME_VERBS),
        "registered_verbs": engine_audit["registered_verbs"],
        "dispatched_verbs": engine_audit["dispatched_verbs"],
        "declared_only_verbs": engine_audit["declared_only_verbs"],
        "dispatched_triggers": engine_audit["dispatched_triggers"],
        "declared_only_triggers": engine_audit["declared_only_triggers"],
    }


def _build_eval_variables(instance: SpellRuntimeInstance) -> Dict[str, int]:
    params = instance.params or {}
    return {
        "MOD": int(params.get("spellcasting_mod") or 0),
        "PROF": int(params.get("proficiency_bonus") or 0),
        "LEVEL": int(params.get("caster_level") or 1),
    }


def _action_id(raw_action: Dict[str, Any], index: int) -> str:
    return str(raw_action.get("action_id") or raw_action.get("actionId") or f"action_{index}")


def _action_requires_target(raw_action: Dict[str, Any]) -> bool:
    if raw_action.get("requires_target") is not None:
        return bool(raw_action.get("requires_target"))
    if raw_action.get("requiresTarget") is not None:
        return bool(raw_action.get("requiresTarget"))
    kind = str(raw_action.get("action_kind") or raw_action.get("actionKind") or "")
    return kind not in NO_TARGET_ACTION_KINDS


def _action_visible(instance: SpellRuntimeInstance, raw_action: Dict[str, Any]) -> bool:
    trigger_condition = str(raw_action.get("trigger_condition") or raw_action.get("triggerCondition") or "")
    params = instance.params or {}
    if trigger_condition == "target_drops_to_0":
        return bool(params.get("transfer_available"))
    return True


def _action_semantic_key(
    *,
    spell_id: str,
    action_name: str,
    action_kind: Optional[str],
    action_type: Optional[str],
) -> str:
    return "|".join(
        [
            spell_id,
            action_name,
            action_kind or "",
            action_type or "",
        ]
    )


def _legacy_action_visible(
    raw_action: Dict[str, Any],
    *,
    concentration_spell: Optional[Dict[str, Any]],
    token_hp_map: Dict[int, Optional[int]],
) -> bool:
    trigger_condition = str(raw_action.get("trigger_condition") or raw_action.get("triggerCondition") or "")
    if trigger_condition != "target_drops_to_0":
        return True

    affected_token_ids = (concentration_spell or {}).get("affected_token_ids") or []
    for raw_token_id in affected_token_ids:
        try:
            token_id = int(raw_token_id)
        except (TypeError, ValueError):
            continue
        current_hp = token_hp_map.get(token_id)
        if current_hp is not None and current_hp <= 0:
            return True
    return False


def _runtime_color_for_spell(spell_id: str) -> str:
    return SPELL_OVERLAY_COLORS.get(spell_id, "#f59e0b")


def _runtime_icon_for_spell(spell_id: str) -> str:
    return SPELL_OVERLAY_ICONS.get(spell_id, "✦")


def _matches_runtime_spell_buff(
    effect: Dict[str, Any],
    *,
    spell_id: str,
    source_token_id: int,
) -> bool:
    if not effect.get("spell_buff"):
        return False
    if effect.get("spell_id") != spell_id:
        return False
    effect_source = effect.get("source_token_id")
    if effect_source is None:
        return True
    try:
        return int(effect_source) == int(source_token_id)
    except (TypeError, ValueError):
        return False


def _build_runtime_visual_spell_buff(
    instance: SpellRuntimeInstance,
    spell_data: Optional[Dict[str, Any]],
    existing_effect: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    params = instance.params or {}
    payload = dict(existing_effect or {})
    school = str((spell_data or {}).get("school") or "").lower()
    payload.update({
        "id": payload.get("id") or f"spell_buff_{instance.spell_id}",
        "name": payload.get("name") or instance.spell_name,
        "spell_buff": True,
        "spell_id": instance.spell_id,
        "is_concentration": True,
        "source_token_id": instance.caster_token_id,
        "icon": payload.get("icon") or SPELL_SCHOOL_ICONS.get(school, "✨"),
        "color": payload.get("color") or SPELL_SCHOOL_COLORS.get(school, "#a78bfa"),
    })
    if (spell_data or {}).get("iconPath") and not payload.get("icon_path"):
        payload["icon_path"] = spell_data["iconPath"]
    if instance.selected_option and not payload.get("selected_option"):
        payload["selected_option"] = instance.selected_option
    selected_option_label = params.get("selected_option_label")
    if selected_option_label and not payload.get("selected_option_label"):
        payload["selected_option_label"] = selected_option_label
    if params.get("expires_at") and not payload.get("expires_at"):
        payload["expires_at"] = params["expires_at"]
    return payload


def _build_spell_visual_projection_from_effect(effect: Dict[str, Any]) -> Optional[SpellVisualUI]:
    token_filter = effect.get("tokenFilter") or effect.get("token_filter")
    if not isinstance(token_filter, dict) or not token_filter:
        return None

    raw_duration = effect.get("duration")
    duration_rounds: Optional[int] = None
    if raw_duration is not None:
        try:
            duration_rounds = int(raw_duration)
        except (TypeError, ValueError):
            duration_rounds = None

    source = "runtime" if effect.get("runtime_instance_id") else "legacy"
    return SpellVisualUI(
        source=source,
        visual_id=str(effect.get("id") or f"spell_visual_{effect.get('spell_id') or effect.get('name') or 'effect'}"),
        spell_id=effect.get("spell_id"),
        spell_name=str(effect.get("name") or effect.get("spell_id") or "视觉效果"),
        icon=effect.get("icon"),
        color=effect.get("color"),
        source_token_id=effect.get("source_token_id"),
        runtime_instance_id=effect.get("runtime_instance_id"),
        token_filter=token_filter,
        expires_at=effect.get("expires_at"),
        duration_rounds=duration_rounds,
        remaining_rounds=duration_rounds,
    )


def _move_runtime_spell_buffs_between_targets(
    instance: SpellRuntimeInstance,
    *,
    spell_data: Optional[Dict[str, Any]],
    old_target_effects: Sequence[Dict[str, Any]] | None,
    new_target_effects: Sequence[Dict[str, Any]] | None,
) -> tuple[list[dict[str, Any]] | None, list[dict[str, Any]] | None]:
    old_effects = [dict(effect) for effect in (old_target_effects or [])]
    new_effects = [dict(effect) for effect in (new_target_effects or [])]

    moved_effects = [
        effect for effect in old_effects
        if _matches_runtime_spell_buff(
            effect,
            spell_id=instance.spell_id,
            source_token_id=instance.caster_token_id,
        )
    ]

    next_old_effects = [
        effect for effect in old_effects
        if not _matches_runtime_spell_buff(
            effect,
            spell_id=instance.spell_id,
            source_token_id=instance.caster_token_id,
        )
    ]
    next_new_effects = [
        effect for effect in new_effects
        if not _matches_runtime_spell_buff(
            effect,
            spell_id=instance.spell_id,
            source_token_id=instance.caster_token_id,
        )
    ]

    payloads_to_add = moved_effects or [None]
    for moved_effect in payloads_to_add:
        next_new_effects.append(
            _build_runtime_visual_spell_buff(instance, spell_data, moved_effect),
        )

    return (
        next_old_effects or None,
        next_new_effects or None,
    )


def _remove_runtime_spell_buffs_from_effects(
    instance: SpellRuntimeInstance,
    *,
    effects: Sequence[Dict[str, Any]] | None,
) -> list[dict[str, Any]] | None:
    next_effects = [
        dict(effect)
        for effect in (effects or [])
        if not _matches_runtime_spell_buff(
            effect,
            spell_id=instance.spell_id,
            source_token_id=instance.caster_token_id,
        )
    ]
    return next_effects or None


async def _sync_runtime_visual_spell_buff_targets(
    db: AsyncSession,
    *,
    instance: SpellRuntimeInstance,
    spell_data: Optional[Dict[str, Any]],
    old_target_token_id: Optional[int],
    new_target_token_id: Optional[int],
) -> list[Token]:
    if not old_target_token_id or not new_target_token_id or old_target_token_id == new_target_token_id:
        return []

    old_target = await db.get(Token, old_target_token_id)
    new_target = await db.get(Token, new_target_token_id)
    if not old_target or not new_target:
        return []

    next_old_effects, next_new_effects = _move_runtime_spell_buffs_between_targets(
        instance,
        spell_data=spell_data,
        old_target_effects=old_target.active_effects,
        new_target_effects=new_target.active_effects,
    )

    changed_tokens: list[Token] = []
    if next_old_effects != (old_target.active_effects or None):
        old_target.active_effects = normalize_token_active_effects(next_old_effects, strict=True)
        flag_modified(old_target, "active_effects")
        changed_tokens.append(old_target)
    if next_new_effects != (new_target.active_effects or None):
        new_target.active_effects = normalize_token_active_effects(next_new_effects, strict=True)
        flag_modified(new_target, "active_effects")
        changed_tokens.append(new_target)

    return changed_tokens


async def _sync_concentration_affected_targets(
    db: AsyncSession,
    *,
    instance: SpellRuntimeInstance,
    old_target_token_id: Optional[int],
    new_target_token_id: Optional[int],
) -> Optional[Token]:
    """Swap a retargeted primary target inside the concentration owner's
    ``concentration_spell`` target lists.

    Hex / Hunter's Mark style ``transfer`` actions move the runtime primary
    target via the engine, but the concentration owner token still carries the
    original target in ``concentration_spell.affected_token_ids`` /
    ``linked_token_ids``. The concentration-break sweep
    (``backend/app/api/routes/tokens.py``) reads ``affected_token_ids`` to know
    which tokens to clean up, so a stale list leaves the new target's spell buff
    orphaned. Replace the old target id with the new one (deduplicated) so a
    later concentration break sweeps the correct token. Returns the owner token
    when it changed, otherwise ``None``.
    """
    owner_token_id = instance.concentration_owner_token_id
    if (
        not owner_token_id
        or not old_target_token_id
        or not new_target_token_id
        or old_target_token_id == new_target_token_id
    ):
        return None

    owner_token = await db.get(Token, owner_token_id)
    if not owner_token:
        return None

    concentration_spell = normalize_token_concentration_spell(
        owner_token.concentration_spell, strict=False
    )
    if not concentration_spell:
        return None

    changed = False
    for field_name in ("affected_token_ids", "linked_token_ids"):
        raw_ids = concentration_spell.get(field_name)
        if not raw_ids:
            continue
        next_ids: list[int] = []
        seen: set[int] = set()
        field_changed = False
        for raw_id in raw_ids:
            try:
                token_id = int(raw_id)
            except (TypeError, ValueError):
                continue
            if token_id == int(old_target_token_id):
                token_id = int(new_target_token_id)
                field_changed = True
            if token_id in seen:
                field_changed = True
                continue
            seen.add(token_id)
            next_ids.append(token_id)
        if field_changed:
            concentration_spell[field_name] = next_ids
            changed = True

    if not changed:
        return None

    owner_token.concentration_spell = normalize_token_concentration_spell(
        concentration_spell, strict=True
    )
    flag_modified(owner_token, "concentration_spell")
    return owner_token


async def create_runtime_spell_instance(
    db: AsyncSession,
    *,
    spell_data: Dict[str, Any],
    spell_context: Any,
    targets: Sequence[Any],
    slot_level: int,
) -> tuple[SpellRuntimeInstance, SpellResolveResult]:
    phases = get_spell_effect_phases(spell_data, getattr(spell_context, "selected_option", None))
    result = SpellResolveResult()
    primary_target = targets[0] if targets else None
    linked_target_token_ids: list[int] = []
    _seen_linked_targets: set[int] = set()
    for _target in targets or []:
        _tid = getattr(_target, "token_id", None)
        if _tid is None:
            continue
        try:
            _tid_int = int(_tid)
        except (TypeError, ValueError):
            continue
        if _tid_int in _seen_linked_targets:
            continue
        _seen_linked_targets.add(_tid_int)
        linked_target_token_ids.append(_tid_int)
    selected_option = getattr(spell_context, "selected_option", None)
    selected_option_label = None
    for option in spell_data.get("castOptions") or []:
        if option.get("key") == selected_option:
            selected_option_label = option.get("label")
            break

    params: Dict[str, Any] = {
        "caster_level": getattr(spell_context, "caster_level", 1),
        "spellcasting_mod": getattr(spell_context, "spellcasting_mod", 0),
        "proficiency_bonus": getattr(spell_context, "proficiency_bonus", 0),
        "spell_save_dc": getattr(spell_context, "spell_save_dc", 0),
        "slot_level": slot_level,
        "selected_option": selected_option,
        "selected_option_label": selected_option_label,
        "transfer_available": False,
    }
    duration_rounds = resolve_spell_duration_rounds(spell_data, slot_level)
    current_world_time = getattr(spell_context, "current_world_time", None)
    expires_at = _calc_runtime_expires_at(current_world_time, duration_rounds)
    if expires_at:
        params["expires_at"] = expires_at

    # Pre-seed grant_action effects declared on non-on_cast phases. The
    # on_cast grant_action verbs run through the engine below.
    granted_actions: List[Dict[str, Any]] = []
    for phase in phases:
        trigger = str(phase.get("trigger") or "on_cast")
        if trigger == "on_cast":
            continue
        for effect in phase.get("effects") or []:
            if effect.get("type") == "grant_action":
                granted_actions.append(dict(effect))

    instance = SpellRuntimeInstance(
        campaign_id=getattr(spell_context, "campaign_id", None),
        spell_id=spell_context.spell_id,
        spell_name=spell_context.spell_name,
        caster_token_id=spell_context.caster_token_id,
        concentration_owner_token_id=spell_context.caster_token_id if getattr(spell_context, "concentration", False) else None,
        primary_target_token_id=getattr(primary_target, "token_id", None),
        linked_target_token_ids=list(linked_target_token_ids),
        selected_option=selected_option,
        params=params,
        duration_rounds=duration_rounds,
        current_round=0,
        status="active",
        granted_actions=granted_actions,
        host_entities=[],
        ui_projection_version=1,
    )

    # Delegate on_cast effects to the runtime engine before insert so JSON
    # column writes (params, granted_actions) happen in-memory and do not
    # need flag_modified.
    phase_result = await execute_phase(
        db,
        instance,
        "on_cast",
        {
            "primary_target": primary_target,
            "targets": list(targets),
            "current_world_time": current_world_time,
        },
        spell_data=spell_data,
        apply=True,
    )

    effect_results = [
        EffectResult(
            type="narrative",
            target_token_id=getattr(primary_target, "token_id", None),
            target_name=getattr(primary_target, "name", None),
            description=narrative,
        )
        for narrative in phase_result.narrative_parts
    ]
    if effect_results:
        result.phase_results.append(effect_results)
    result.narrative_parts.extend(phase_result.narrative_parts)

    db.add(instance)
    await db.flush()

    return instance, result


async def _load_runtime_instances_for_campaign(
    db: AsyncSession,
    campaign_id: int,
) -> List[SpellRuntimeInstance]:
    result = await db.execute(
        select(SpellRuntimeInstance).where(
            SpellRuntimeInstance.campaign_id == campaign_id,
            SpellRuntimeInstance.status == "active",
        )
    )
    return list(result.scalars().all())


async def _token_name_map(
    db: AsyncSession,
    token_ids: Iterable[int],
) -> Dict[int, str]:
    unique_ids = {int(token_id) for token_id in token_ids if token_id}
    if not unique_ids:
        return {}
    result = await db.execute(select(Token).where(Token.id.in_(unique_ids)))
    names: Dict[int, str] = {}
    for token in result.scalars().all():
        names[token.id] = token.instance_name or f"Token {token.id}"
    return names


def _build_runtime_action_ui(
    instance: SpellRuntimeInstance,
    raw_action: Dict[str, Any],
    *,
    index: int,
) -> SpellRuntimeActionUI:
    return SpellRuntimeActionUI(
        runtime_instance_id=instance.id,
        action_id=_action_id(raw_action, index),
        spell_id=instance.spell_id,
        spell_name=instance.spell_name,
        slot_level=int((instance.params or {}).get("slot_level") or 0),
        action_type=raw_action.get("action_type") or raw_action.get("actionType"),
        action_name=raw_action.get("action_name") or raw_action.get("actionName") or instance.spell_name,
        action_name_en=raw_action.get("action_name_en") or raw_action.get("actionNameEn"),
        icon=raw_action.get("icon"),
        action_kind=raw_action.get("action_kind") or raw_action.get("actionKind"),
        trigger_condition=raw_action.get("trigger_condition") or raw_action.get("triggerCondition"),
        requires_target=_action_requires_target(raw_action),
        description=raw_action.get("description"),
        source_token_id=instance.caster_token_id,
        available=_action_visible(instance, raw_action),
    )


def _iter_spell_grant_actions(spell_data: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not spell_data:
        return []

    actions: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for phase in get_spell_effect_phases(spell_data, None):
        for effect in phase.get("effects") or []:
            if str(effect.get("type") or "") != "grant_action":
                continue
            effect_dump = repr(effect)
            if effect_dump in seen:
                continue
            seen.add(effect_dump)
            actions.append(effect)
    return actions


def _build_legacy_action_ui(
    *,
    spell_id: str,
    spell_name: str,
    source_token_id: int,
    slot_level: int,
    raw_action: Dict[str, Any],
    available: bool,
) -> SpellRuntimeActionUI:
    action_name = raw_action.get("action_name") or raw_action.get("actionName") or spell_name
    action_kind = raw_action.get("action_kind") or raw_action.get("actionKind")
    action_type = raw_action.get("action_type") or raw_action.get("actionType")
    action_id = str(
        raw_action.get("action_id")
        or raw_action.get("actionId")
        or f"legacy:{spell_id}:{action_kind or 'action'}:{action_name}"
    )
    return SpellRuntimeActionUI(
        source="legacy",
        runtime_instance_id=0,
        action_id=action_id,
        spell_id=spell_id,
        spell_name=spell_name,
        slot_level=slot_level,
        action_type=action_type,
        action_name=action_name,
        action_name_en=raw_action.get("action_name_en") or raw_action.get("actionNameEn"),
        icon=raw_action.get("icon"),
        action_kind=action_kind,
        trigger_condition=raw_action.get("trigger_condition") or raw_action.get("triggerCondition"),
        requires_target=_action_requires_target(raw_action),
        description=raw_action.get("description"),
        source_token_id=source_token_id,
        available=available,
    )


def _append_legacy_granted_actions_projection(
    *,
    projection: Dict[str, Any],
    token: Token,
    token_hp_map: Dict[int, Optional[int]],
) -> None:
    seen_semantic_keys = {
        _action_semantic_key(
            spell_id=str(action.get("spell_id") or ""),
            action_name=str(action.get("action_name") or ""),
            action_kind=action.get("action_kind"),
            action_type=action.get("action_type"),
        )
        for action in projection.get("granted_actions_ui") or []
        if action.get("spell_id") and action.get("action_name")
    }

    def add_spell_actions(
        *,
        spell_id: Optional[str],
        spell_name: Optional[str],
        slot_level: Optional[int],
        concentration_spell: Optional[Dict[str, Any]] = None,
    ) -> None:
        if not spell_id:
            return
        spell_data = get_spell_by_id(spell_id)
        if not spell_data or spell_uses_runtime_engine(spell_data):
            return
        for raw_action in _iter_spell_grant_actions(spell_data):
            available = _legacy_action_visible(
                raw_action,
                concentration_spell=concentration_spell,
                token_hp_map=token_hp_map,
            )
            if not available:
                continue
            action_name = str(raw_action.get("action_name") or raw_action.get("actionName") or spell_name or spell_id)
            semantic_key = _action_semantic_key(
                spell_id=spell_id,
                action_name=action_name,
                action_kind=raw_action.get("action_kind") or raw_action.get("actionKind"),
                action_type=raw_action.get("action_type") or raw_action.get("actionType"),
            )
            if semantic_key in seen_semantic_keys:
                continue
            seen_semantic_keys.add(semantic_key)
            projection["granted_actions_ui"].append(
                _build_legacy_action_ui(
                    spell_id=spell_id,
                    spell_name=spell_name or str(spell_data.get("name") or spell_id),
                    source_token_id=int(token.id),
                    slot_level=int(slot_level or spell_data.get("level") or 0),
                    raw_action=raw_action,
                    available=available,
                ).model_dump(mode="json")
            )

    concentration_spell = normalize_token_concentration_spell(token.concentration_spell, strict=False) or {}
    add_spell_actions(
        spell_id=concentration_spell.get("spell_id"),
        spell_name=concentration_spell.get("spell_name"),
        slot_level=concentration_spell.get("slot_level"),
        concentration_spell=concentration_spell,
    )

    for effect in normalize_token_active_effects(token.active_effects, strict=False) or []:
        # `spell_buff` markers re-derive their spell's granted actions. A
        # `grant_action` entry — written directly by the legacy
        # GrantActionHandler (e.g. Spiritual Weapon's non-concentration
        # bonus-action attack) — must also drive surfacing; otherwise such
        # actions only appear for concentration spells (handled above) and
        # the non-concentration ones are silently dropped. The semantic-key
        # dedup inside add_spell_actions keeps concentration spells (already
        # surfaced above) from double-counting.
        effect_type = effect.get("effect_type") or effect.get("effectType")
        if not effect.get("spell_buff") and effect_type != "grant_action":
            continue
        source_token_id = effect.get("source_token_id")
        if source_token_id is not None and int(source_token_id) != int(token.id):
            continue
        spell_id = effect.get("spell_id")
        if not spell_id:
            continue
        add_spell_actions(
            spell_id=spell_id,
            spell_name=effect.get("name"),
            slot_level=effect.get("cast_level"),
        )


def _append_legacy_spell_visual_projection(
    *,
    projection: Dict[str, Any],
    token: Token,
) -> None:
    for effect in normalize_token_active_effects(token.active_effects, strict=False) or []:
        visual = _build_spell_visual_projection_from_effect(effect)
        if visual is None:
            continue
        projection["spell_visuals"].append(visual.model_dump(mode="json"))


async def build_token_spell_projection_map(
    db: AsyncSession,
    *,
    campaign_id: int,
    token_ids: Sequence[int],
) -> Dict[int, Dict[str, Any]]:
    projections = {
        int(token_id): TokenSpellRuntimeProjection().model_dump(mode="json")
        for token_id in token_ids
    }
    if not projections:
        return projections

    token_result = await db.execute(
        select(Token).where(
            Token.campaign_id == campaign_id,
            Token.id.in_(list(projections.keys())),
        )
    )
    projection_tokens = list(token_result.scalars().all())
    token_hp_map: Dict[int, Optional[int]] = {
        int(token.id): token.current_hp
        for token in projection_tokens
    }

    extra_hp_ids: set[int] = set()
    for token in projection_tokens:
        concentration_spell = normalize_token_concentration_spell(token.concentration_spell, strict=False) or {}
        for raw_token_id in concentration_spell.get("affected_token_ids") or []:
            try:
                extra_id = int(raw_token_id)
            except (TypeError, ValueError):
                continue
            if extra_id not in token_hp_map:
                extra_hp_ids.add(extra_id)
    if extra_hp_ids:
        extra_hp_result = await db.execute(select(Token).where(Token.id.in_(sorted(extra_hp_ids))))
        for extra_token in extra_hp_result.scalars().all():
            token_hp_map[int(extra_token.id)] = extra_token.current_hp

    instances = await _load_runtime_instances_for_campaign(db, campaign_id)
    relevant_instances = [
        instance for instance in instances
        if instance.caster_token_id in projections
        or instance.primary_target_token_id in projections
        or any(linked_id in projections for linked_id in (instance.linked_target_token_ids or []))
    ]

    names: Dict[int, str] = {}
    if relevant_instances:
        linked_name_ids: set[int] = set()
        for instance in relevant_instances:
            for raw_id in instance.linked_target_token_ids or []:
                try:
                    linked_name_ids.add(int(raw_id))
                except (TypeError, ValueError):
                    continue
        names = await _token_name_map(
            db,
            {
                *(instance.caster_token_id for instance in relevant_instances),
                *(instance.primary_target_token_id for instance in relevant_instances if instance.primary_target_token_id),
                *linked_name_ids,
            },
        )

    for instance in relevant_instances:
        params = instance.params or {}
        target_name = names.get(instance.primary_target_token_id or 0) or params.get("marked_target_name")
        option_label = params.get("selected_option_label") or params.get("selected_option")
        suffix = f"（{option_label}）" if option_label else ""
        color = _runtime_color_for_spell(instance.spell_id)
        icon = _runtime_icon_for_spell(instance.spell_id)
        duration_rounds = instance.duration_rounds
        remaining_rounds = None
        expires_at = params.get("expires_at")
        if duration_rounds is not None:
            remaining_rounds = max(0, duration_rounds - int(instance.current_round or 0))

        if instance.caster_token_id in projections:
            source_projection = projections[instance.caster_token_id]
            source_projection["spell_overlays"].append(
                SpellOverlayUI(
                    runtime_instance_id=instance.id,
                    spell_id=instance.spell_id,
                    spell_name=instance.spell_name,
                    role="source",
                    label=f"{instance.spell_name} -> {target_name or '未指定目标'}{suffix}",
                    icon=icon,
                    color=color,
                    target_token_id=instance.primary_target_token_id,
                    target_name=target_name,
                    selected_option=instance.selected_option,
                    selected_option_label=option_label,
                    duration_rounds=duration_rounds,
                    remaining_rounds=remaining_rounds,
                    expires_at=expires_at,
                ).model_dump(mode="json")
            )
            source_projection["spell_badges"].append(
                SpellBadgeUI(
                    runtime_instance_id=instance.id,
                    spell_id=instance.spell_id,
                    label=f"{instance.spell_name}{suffix}",
                    icon=icon,
                    color=color,
                    duration_rounds=duration_rounds,
                    remaining_rounds=remaining_rounds,
                    expires_at=expires_at,
                ).model_dump(mode="json")
            )
            source_projection["attached_runtime_refs"].append(
                AttachedSpellRuntimeRef(
                    runtime_instance_id=instance.id,
                    spell_id=instance.spell_id,
                    role="source",
                ).model_dump(mode="json")
            )
            for index, raw_action in enumerate(instance.granted_actions or []):
                if not _action_visible(instance, raw_action):
                    continue
                source_projection["granted_actions_ui"].append(
                    _build_runtime_action_ui(instance, raw_action, index=index).model_dump(mode="json")
                )

        # Build the set of all target token ids for this instance: primary + linked.
        instance_target_ids: list[int] = []
        seen_target_ids: set[int] = set()
        if instance.primary_target_token_id:
            instance_target_ids.append(int(instance.primary_target_token_id))
            seen_target_ids.add(int(instance.primary_target_token_id))
        for raw_id in instance.linked_target_token_ids or []:
            try:
                lid = int(raw_id)
            except (TypeError, ValueError):
                continue
            if lid in seen_target_ids:
                continue
            seen_target_ids.add(lid)
            instance_target_ids.append(lid)

        runtime_token_filter = (
            params.get("token_filter") if isinstance(params.get("token_filter"), dict) else None
        )

        for target_token_id in instance_target_ids:
            if target_token_id not in projections:
                continue
            target_projection = projections[target_token_id]
            this_target_name = names.get(target_token_id) or (
                target_name if target_token_id == instance.primary_target_token_id else None
            )
            target_projection["spell_overlays"].append(
                SpellOverlayUI(
                    runtime_instance_id=instance.id,
                    spell_id=instance.spell_id,
                    spell_name=instance.spell_name,
                    role="target",
                    label=f"{instance.spell_name}{suffix}",
                    icon=icon,
                    color=color,
                    target_token_id=target_token_id,
                    target_name=this_target_name,
                    selected_option=instance.selected_option,
                    selected_option_label=option_label,
                    duration_rounds=duration_rounds,
                    remaining_rounds=remaining_rounds,
                    expires_at=expires_at,
                ).model_dump(mode="json")
            )
            target_projection["spell_badges"].append(
                SpellBadgeUI(
                    runtime_instance_id=instance.id,
                    spell_id=instance.spell_id,
                    label=f"{instance.spell_name}{suffix}",
                    icon=icon,
                    color=color,
                    duration_rounds=duration_rounds,
                    remaining_rounds=remaining_rounds,
                    expires_at=expires_at,
                ).model_dump(mode="json")
            )
            target_projection["attached_runtime_refs"].append(
                AttachedSpellRuntimeRef(
                    runtime_instance_id=instance.id,
                    spell_id=instance.spell_id,
                    role="target",
                ).model_dump(mode="json")
            )
            if runtime_token_filter:
                target_projection["spell_visuals"].append(
                    SpellVisualUI(
                        source="runtime",
                        visual_id=f"spell_runtime_{instance.id}_token_filter_{target_token_id}",
                        spell_id=instance.spell_id,
                        spell_name=instance.spell_name,
                        icon=icon,
                        color=color,
                        source_token_id=instance.caster_token_id,
                        runtime_instance_id=instance.id,
                        token_filter=dict(runtime_token_filter),
                        expires_at=expires_at,
                        duration_rounds=duration_rounds,
                        remaining_rounds=remaining_rounds,
                    ).model_dump(mode="json")
                )

    for token in projection_tokens:
        projection = projections.get(int(token.id))
        if not projection:
            continue
        _append_legacy_spell_visual_projection(
            projection=projection,
            token=token,
        )
        _append_legacy_granted_actions_projection(
            projection=projection,
            token=token,
            token_hp_map=token_hp_map,
        )

    return projections


async def publish_runtime_projection_updates(
    db: AsyncSession,
    *,
    campaign_id: int,
    token_ids: Sequence[int],
) -> None:
    projection_map = await build_token_spell_projection_map(
        db,
        campaign_id=campaign_id,
        token_ids=token_ids,
    )
    for token_id, payload in projection_map.items():
        await realtime_publisher.publish_token_updated(
            campaign_id,
            token={
                "id": token_id,
                **payload,
            },
        )


async def cleanup_expired_runtime_instances(
    db: AsyncSession,
    *,
    campaign_id: int,
    current_world_time: Optional[Dict[str, Any]],
) -> List[int]:
    current_seconds = _world_time_to_seconds(current_world_time)
    if current_seconds is None:
        return []

    instances = await _load_runtime_instances_for_campaign(db, campaign_id)
    touched_token_ids: set[int] = set()
    changed = False

    for instance in instances:
        expires_at = dict(instance.params or {}).get("expires_at")
        expire_seconds = _world_time_to_seconds(expires_at)
        if expire_seconds is None or current_seconds < expire_seconds:
            continue

        instance.status = "ended"
        changed = True
        touched_token_ids.add(instance.caster_token_id)
        if instance.primary_target_token_id:
            touched_token_ids.add(instance.primary_target_token_id)
        for raw_token_id in instance.linked_target_token_ids or []:
            try:
                touched_token_ids.add(int(raw_token_id))
            except (TypeError, ValueError):
                continue

    if not changed:
        return []

    await db.commit()
    await publish_runtime_projection_updates(
        db,
        campaign_id=campaign_id,
        token_ids=sorted(touched_token_ids),
    )
    return sorted(touched_token_ids)


async def end_concentration_runtime_instances(
    db: AsyncSession,
    *,
    campaign_id: int,
    concentration_owner_token_ids: Sequence[int],
) -> List[int]:
    owner_ids = {int(token_id) for token_id in concentration_owner_token_ids if token_id}
    if not owner_ids:
        return []

    result = await db.execute(
        select(SpellRuntimeInstance).where(
            SpellRuntimeInstance.campaign_id == campaign_id,
            SpellRuntimeInstance.status == "active",
            SpellRuntimeInstance.concentration_owner_token_id.in_(owner_ids),
        )
    )
    instances = list(result.scalars().all())
    if not instances:
        return []

    touched_token_ids: set[int] = set()
    for instance in instances:
        spell_data = get_spell_by_id(instance.spell_id)
        if spell_data:
            phase_result = await execute_phase(
                db,
                instance,
                "on_concentration_end",
                {},
                spell_data=spell_data,
                apply=True,
            )
            touched_token_ids.update(phase_result.touched_token_ids)
        # Service-owned fallback: ensure the instance is marked ended even
        # when spell_data is missing or its on_concentration_end phase does
        # not include end_spell_instance.
        instance.status = "ended"
        touched_token_ids.add(instance.caster_token_id)
        if instance.primary_target_token_id:
            touched_token_ids.add(instance.primary_target_token_id)
        for raw_id in instance.linked_target_token_ids or []:
            try:
                touched_token_ids.add(int(raw_id))
            except (TypeError, ValueError):
                continue

    await db.flush()
    return sorted(touched_token_ids)


def strip_bonus_modifiers_from_runtime_effects(
    effects: Sequence[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Return shallow copies of runtime modifier envelopes with `type: "bonus"`
    modifiers removed; envelopes with no remaining modifiers are dropped.

    Used when the same runtime envelope list feeds both a bonus aggregation
    (where formula values like Bless's `1d4` are evaluated via
    `eval_formula`) and an advantage/disadvantage check (which internally
    re-runs `get_modifiers_for_target` against the same target). Without
    this filter, the second pass would re-roll the same `1d4` formula and
    surface a mismatched bonus reason in combat logs while not actually
    being applied to the attack/save bonus.
    """
    stripped: List[Dict[str, Any]] = []
    for envelope in effects:
        if not isinstance(envelope, dict):
            continue
        modifiers = envelope.get("modifiers") or []
        non_bonus = [
            mod for mod in modifiers
            if isinstance(mod, dict) and mod.get("type") != "bonus"
        ]
        if not non_bonus:
            continue
        new_envelope = dict(envelope)
        new_envelope["modifiers"] = non_bonus
        stripped.append(new_envelope)
    return stripped


async def get_token_runtime_modifier_effects(
    db: AsyncSession,
    *,
    campaign_id: int,
    token_id: int,
) -> List[Dict[str, Any]]:
    instances = await _load_runtime_instances_for_campaign(db, campaign_id)
    runtime_effects: List[Dict[str, Any]] = []

    for instance in instances:
        linked_ids: set[int] = set()
        for raw_id in instance.linked_target_token_ids or []:
            try:
                linked_ids.add(int(raw_id))
            except (TypeError, ValueError):
                continue
        if instance.primary_target_token_id != token_id and token_id not in linked_ids:
            continue

        spell_data = get_spell_by_id(instance.spell_id)
        if not spell_data:
            continue

        phase_result = await evaluate_phase(
            db,
            instance,
            "on_cast",
            {},
            spell_data=spell_data,
        )
        runtime_effects.extend(phase_result.modifier_effects)

    return runtime_effects


def _roll_runtime_damage(
    *,
    formula: str,
    instance: SpellRuntimeInstance,
    critical: bool,
) -> tuple[int, Dict[str, Any]]:
    def _flatten_dice_groups(results: Sequence[Any]) -> tuple[str, list[int], int]:
        combined_groups: "OrderedDict[int, int]" = OrderedDict()
        rolls: list[int] = []
        modifier = 0

        for index, result in enumerate(results):
            if index == 0:
                modifier = int(getattr(result, "modifier", 0) or 0)
            for group in getattr(result, "dice_groups", []) or []:
                sides = int(getattr(group, "sides", 0) or 0)
                count = int(getattr(group, "count", 0) or 0)
                if sides <= 0 or count <= 0:
                    continue
                combined_groups[sides] = combined_groups.get(sides, 0) + count
                rolls.extend(int(roll) for roll in (getattr(group, "rolls", []) or []))

        dice_parts = [f"{count}d{sides}" for sides, count in combined_groups.items()]
        return "+".join(dice_parts), rolls, modifier

    variables = _build_eval_variables(instance)
    if critical:
        roll1 = eval_formula(formula, variables)
        roll2 = eval_formula(formula, variables)
        dice_expr, rolls, modifier = _flatten_dice_groups((roll1, roll2))
        dice_total = sum(getattr(group, "total", 0) for group in roll1.dice_groups) + sum(
            getattr(group, "total", 0) for group in roll2.dice_groups
        )
        total = max(0, dice_total + modifier)
        roll = DiceRoll(
            dice=dice_expr or formula,
            rolls=rolls or [total],
            modifier=modifier if rolls else 0,
            total=total,
        )
        return total, {
            "formula": formula,
            "breakdown": f"{roll1.breakdown}+{roll2.breakdown}(暴击)",
            "roll": roll.model_dump(),
        }

    rolled = eval_formula(formula, variables)
    dice_expr, rolls, modifier = _flatten_dice_groups((rolled,))
    roll = DiceRoll(
        dice=dice_expr or formula,
        rolls=rolls or [rolled.total],
        modifier=modifier if rolls else 0,
        total=max(0, rolled.total),
    )
    return max(0, rolled.total), {
        "formula": formula,
        "breakdown": rolled.breakdown,
        "roll": roll.model_dump(),
    }


async def get_runtime_bonus_damage(
    db: AsyncSession,
    *,
    campaign_id: int,
    attacker_token_id: int,
    target_token_id: int,
    attack_kind: str,
    critical: bool = False,
) -> List[RuntimeBonusDamage]:
    instances = await _load_runtime_instances_for_campaign(db, campaign_id)
    bonuses: List[RuntimeBonusDamage] = []

    triggers: List[str] = ["on_hit"]
    if attack_kind == "weapon":
        triggers.append("on_weapon_hit")

    for instance in instances:
        if instance.caster_token_id != attacker_token_id:
            continue
        # Target matching is delegated to the verb layer so self-buff spells
        # (e.g. Divine Favor) can opt out of primary-target equality via
        # `target_match: "any"`. Hex / Hunter's Mark keep the default
        # primary-target gate inside `conditional_extra_damage`.

        spell_data = get_spell_by_id(instance.spell_id)
        if not spell_data:
            continue

        ctx_overrides = {
            "attacker_token_id": attacker_token_id,
            "target_token_id": target_token_id,
            "attack_kind": attack_kind,
            "critical": critical,
        }
        for trigger in triggers:
            phase_result = await evaluate_phase(
                db,
                instance,
                trigger,
                ctx_overrides,
                spell_data=spell_data,
            )
            bonuses.extend(phase_result.bonus_damages)

    return bonuses


def _snapshot_runtime_instance_state(instance: SpellRuntimeInstance) -> Dict[str, Any]:
    return {
        "params": dict(instance.params or {}),
        "granted_actions": [dict(action) for action in (instance.granted_actions or [])],
        "status": instance.status,
        "primary_target_token_id": instance.primary_target_token_id,
        "linked_target_token_ids": list(instance.linked_target_token_ids or []),
    }


async def notify_target_downed(
    db: AsyncSession,
    *,
    campaign_id: int,
    target_token_id: int,
) -> List[int]:
    instances = await _load_runtime_instances_for_campaign(db, campaign_id)
    touched_token_ids: set[int] = set()
    changed = False

    for instance in instances:
        if instance.primary_target_token_id != target_token_id:
            continue

        spell_data = get_spell_by_id(instance.spell_id)
        if not spell_data:
            continue

        before = _snapshot_runtime_instance_state(instance)
        phase_result = await execute_phase(
            db,
            instance,
            "on_target_downed",
            {"target_token_id": target_token_id},
            spell_data=spell_data,
            apply=True,
        )
        after = _snapshot_runtime_instance_state(instance)
        if after == before:
            continue

        changed = True
        touched_token_ids.add(instance.caster_token_id)
        if instance.primary_target_token_id:
            touched_token_ids.add(instance.primary_target_token_id)
        touched_token_ids.update(phase_result.touched_token_ids)

    if changed:
        await db.commit()
        await publish_runtime_projection_updates(
            db,
            campaign_id=campaign_id,
            token_ids=sorted(touched_token_ids),
        )

    return sorted(touched_token_ids)


async def execute_runtime_turn_triggers(
    db: AsyncSession,
    *,
    campaign_id: int,
    ending_token_id: Optional[int] = None,
    starting_token_id: Optional[int] = None,
    current_round: Optional[int] = None,
    current_world_time: Optional[Dict[str, Any]] = None,
) -> List[int]:
    """Dispatch combat turn triggers for the active runtime instances.

    For ``ending_token_id`` we fire ``end_of_turn`` on instances whose caster
    is that token, and ``end_of_target_turn`` on instances whose primary or
    linked target is that token. ``starting_token_id`` does the same with the
    ``start_of_*`` triggers. Caller passes ``None`` when there is no token on
    that side (e.g. combat just started: ``ending_token_id=None``).
    """

    if ending_token_id is None and starting_token_id is None:
        return []

    instances = await _load_runtime_instances_for_campaign(db, campaign_id)
    if not instances:
        return []

    touched_token_ids: set[int] = set()
    changed = False

    def _instance_targets(instance: SpellRuntimeInstance) -> set[int]:
        ids: set[int] = set()
        if instance.primary_target_token_id:
            ids.add(int(instance.primary_target_token_id))
        for raw_id in instance.linked_target_token_ids or []:
            if raw_id:
                ids.add(int(raw_id))
        return ids

    async def _dispatch(
        instance: SpellRuntimeInstance,
        trigger: str,
        token_id: int,
    ) -> None:
        nonlocal changed
        spell_data = get_spell_by_id(instance.spell_id)
        if not spell_data:
            return
        before = _snapshot_runtime_instance_state(instance)
        phase_result = await execute_phase(
            db,
            instance,
            trigger,
            {
                "turn_token_id": token_id,
                "current_round": current_round,
                "current_world_time": current_world_time,
                "target_token_id": (
                    token_id if trigger.endswith("_of_target_turn") else None
                ),
            },
            spell_data=spell_data,
            apply=True,
        )
        after = _snapshot_runtime_instance_state(instance)
        instance_changed = after != before or bool(phase_result.touched_token_ids)
        if not instance_changed:
            return
        changed = True
        touched_token_ids.add(int(instance.caster_token_id))
        if instance.primary_target_token_id:
            touched_token_ids.add(int(instance.primary_target_token_id))
        for raw_id in instance.linked_target_token_ids or []:
            if raw_id:
                touched_token_ids.add(int(raw_id))
        touched_token_ids.update(phase_result.touched_token_ids)
        touched_token_ids.add(int(token_id))

    for instance in instances:
        # The instance may have ended during a previous dispatch in this loop;
        # skip those rather than firing further turn triggers on them.
        if instance.status != "active":
            continue
        targets = _instance_targets(instance)

        if ending_token_id is not None:
            if int(instance.caster_token_id) == int(ending_token_id):
                await _dispatch(instance, "end_of_turn", int(ending_token_id))
            if instance.status == "active" and int(ending_token_id) in targets:
                await _dispatch(
                    instance, "end_of_target_turn", int(ending_token_id)
                )

        if starting_token_id is not None and instance.status == "active":
            if int(instance.caster_token_id) == int(starting_token_id):
                await _dispatch(instance, "start_of_turn", int(starting_token_id))
            if instance.status == "active" and int(starting_token_id) in targets:
                await _dispatch(
                    instance, "start_of_target_turn", int(starting_token_id)
                )

    if not changed:
        return []

    await db.commit()
    await publish_runtime_projection_updates(
        db,
        campaign_id=campaign_id,
        token_ids=sorted(touched_token_ids),
    )
    return sorted(touched_token_ids)


async def execute_runtime_zone_triggers(
    db: AsyncSession,
    *,
    campaign_id: int,
    caster_token_id: int,
    spell_id: str,
    target_token_ids: List[int],
    timing: str,
    current_world_time: Optional[Dict[str, Any]] = None,
) -> List[int]:
    """Dispatch zone-entry/exit triggers for active runtime instances.

    Scope: instances in ``campaign_id`` whose ``caster_token_id`` and
    ``spell_id`` match (i.e. the host of the persistent zone). ``timing``
    is the structured-zone alias (``enter`` / ``leave``) or the canonical
    trigger name (``on_enter_zone`` / ``on_leave_zone``).

    Returns sorted touched token ids. Caller is expected to handle the
    response payload; mutations are committed and projection updates are
    published here so behavior mirrors ``execute_runtime_turn_triggers``.
    """

    if not target_token_ids:
        return []

    trigger_by_timing = {
        "enter": "on_enter_zone",
        "leave": "on_leave_zone",
        "on_enter_zone": "on_enter_zone",
        "on_leave_zone": "on_leave_zone",
    }
    trigger = trigger_by_timing.get(str(timing or "").strip().lower())
    if not trigger:
        return []

    instances = await _load_runtime_instances_for_campaign(db, campaign_id)
    if not instances:
        return []

    matching = [
        inst
        for inst in instances
        if int(inst.caster_token_id) == int(caster_token_id)
        and str(inst.spell_id) == str(spell_id)
        and inst.status == "active"
    ]
    if not matching:
        return []

    touched_token_ids: set[int] = set()
    changed = False

    for instance in matching:
        spell_data = get_spell_by_id(instance.spell_id)
        if not spell_data:
            continue
        for raw_target_id in target_token_ids:
            if raw_target_id is None:
                continue
            if instance.status != "active":
                break
            target_id = int(raw_target_id)
            before = _snapshot_runtime_instance_state(instance)
            phase_result = await execute_phase(
                db,
                instance,
                trigger,
                {
                    "zone_token_id": target_id,
                    "target_token_id": target_id,
                    "current_world_time": current_world_time,
                },
                spell_data=spell_data,
                apply=True,
            )
            after = _snapshot_runtime_instance_state(instance)
            # A runtime-only zone phase can legitimately dispatch with no
            # state mutation and no touched ids (pure narrative / runtime
            # bookkeeping). Treat ``phase_result.applied`` — set iff at
            # least one phase matched and ran with apply=True — as the
            # authoritative "phase fired" signal, with state/touched diffs
            # as additional triggers for backwards compatibility.
            phase_fired = (
                phase_result.applied
                or after != before
                or bool(phase_result.touched_token_ids)
            )
            if not phase_fired:
                continue
            changed = True
            touched_token_ids.add(int(instance.caster_token_id))
            if instance.primary_target_token_id:
                touched_token_ids.add(int(instance.primary_target_token_id))
            for raw_id in instance.linked_target_token_ids or []:
                if raw_id:
                    touched_token_ids.add(int(raw_id))
            touched_token_ids.update(phase_result.touched_token_ids)
            touched_token_ids.add(target_id)

    if not changed:
        return []

    await db.commit()
    await publish_runtime_projection_updates(
        db,
        campaign_id=campaign_id,
        token_ids=sorted(touched_token_ids),
    )
    return sorted(touched_token_ids)


async def execute_runtime_action(
    db: AsyncSession,
    *,
    runtime_instance_id: int,
    action_id: str,
    actor_token_id: int,
    target_token_id: Optional[int],
) -> tuple[SpellRuntimeInstance, List[int]]:
    instance = await db.get(SpellRuntimeInstance, runtime_instance_id)
    if not instance or instance.status != "active":
        raise ValueError("Spell runtime instance not found")
    if instance.caster_token_id != actor_token_id:
        raise ValueError("Only the original caster can execute this runtime action")

    spell_data = get_spell_by_id(instance.spell_id)
    if not spell_data:
        raise ValueError("Spell definition not found")

    phases = get_spell_effect_phases(spell_data, instance.selected_option)
    raw_action = None
    for index, granted_action in enumerate(instance.granted_actions or []):
        if _action_id(granted_action, index) == action_id:
            raw_action = granted_action
            break
    if raw_action is None:
        raise ValueError("Runtime action is not defined for this spell")
    if not _action_visible(instance, raw_action):
        raise ValueError("This runtime action is not currently available")

    matched_phase = None
    for phase in phases:
        if str(phase.get("trigger") or "") != "on_action_invoked":
            continue
        condition = phase.get("condition") or {}
        if str(condition.get("action_id") or "") == action_id:
            matched_phase = phase
            break
    if matched_phase is None:
        raise ValueError("Runtime action is not defined for this spell")

    # Preserve legacy missing-target validation. The engine's retarget_mark
    # verb silently skips when invoked_target_token_id is missing; the
    # service layer still surfaces this as a user-facing ValueError.
    requires_retarget_target = any(
        str(effect.get("type") or "") == "retarget_mark"
        for effect in (matched_phase.get("effects") or [])
    )
    if requires_retarget_target and not target_token_id:
        raise ValueError("This runtime action requires a target token")

    previous_target_token_id = instance.primary_target_token_id
    touched_token_ids: set[int] = {instance.caster_token_id}
    if previous_target_token_id:
        touched_token_ids.add(previous_target_token_id)

    phase_result = await execute_phase(
        db,
        instance,
        "on_action_invoked",
        {
            "invoked_action_id": action_id,
            "invoked_target_token_id": target_token_id,
        },
        spell_data=spell_data,
        apply=True,
    )
    touched_token_ids.update(phase_result.touched_token_ids)

    effect_sync_tokens: list[Token] = []
    concentration_owner_token: Optional[Token] = None
    if (
        previous_target_token_id
        and instance.primary_target_token_id
        and previous_target_token_id != instance.primary_target_token_id
    ):
        effect_sync_tokens = await _sync_runtime_visual_spell_buff_targets(
            db,
            instance=instance,
            spell_data=spell_data,
            old_target_token_id=previous_target_token_id,
            new_target_token_id=instance.primary_target_token_id,
        )
        concentration_owner_token = await _sync_concentration_affected_targets(
            db,
            instance=instance,
            old_target_token_id=previous_target_token_id,
            new_target_token_id=instance.primary_target_token_id,
        )
        if concentration_owner_token:
            touched_token_ids.add(concentration_owner_token.id)

    await db.commit()
    for token in effect_sync_tokens:
        await realtime_publisher.publish_token_active_effects_updated(
            instance.campaign_id,
            token_id=token.id,
            active_effects=token.active_effects or [],
            character_id=token.character_id,
            monster_instance_id=token.monster_instance_id,
        )
    if concentration_owner_token:
        await realtime_publisher.publish_token_concentration_updated(
            instance.campaign_id,
            token_id=concentration_owner_token.id,
            concentration_spell=concentration_owner_token.concentration_spell,
        )
    await publish_runtime_projection_updates(
        db,
        campaign_id=instance.campaign_id,
        token_ids=sorted(touched_token_ids),
    )
    return instance, sorted(touched_token_ids)


async def end_runtime_instance(
    db: AsyncSession,
    *,
    runtime_instance_id: int,
) -> tuple[SpellRuntimeInstance, List[int]]:
    instance = await db.get(SpellRuntimeInstance, runtime_instance_id)
    if not instance or instance.status != "active":
        raise ValueError("Spell runtime instance not found")

    target_token_ids: set[int] = {instance.caster_token_id}
    if instance.primary_target_token_id:
        target_token_ids.add(instance.primary_target_token_id)
    for raw_token_id in instance.linked_target_token_ids or []:
        try:
            target_token_ids.add(int(raw_token_id))
        except (TypeError, ValueError):
            continue

    changed_tokens: list[Token] = []
    for token_id in target_token_ids:
        token = await db.get(Token, token_id)
        if not token:
            continue
        next_effects = _remove_runtime_spell_buffs_from_effects(
            instance,
            effects=token.active_effects,
        )
        if next_effects != (token.active_effects or None):
            token.active_effects = normalize_token_active_effects(next_effects, strict=True)
            flag_modified(token, "active_effects")
            changed_tokens.append(token)
        next_auras = strip_spell_aura_entries(
            token.active_auras,
            spell_id=instance.spell_id,
            source_token_id=instance.caster_token_id,
        )
        if next_auras != token.active_auras:
            token.active_auras = normalize_token_active_auras(next_auras, strict=True)
            flag_modified(token, "active_auras")
            if token not in changed_tokens:
                changed_tokens.append(token)

    instance.status = "ended"
    await db.commit()

    for token in changed_tokens:
        await realtime_publisher.publish_token_active_effects_updated(
            instance.campaign_id,
            token_id=token.id,
            active_effects=token.active_effects or [],
            character_id=token.character_id,
            monster_instance_id=token.monster_instance_id,
        )

    touched_token_ids = sorted(target_token_ids)
    await publish_runtime_projection_updates(
        db,
        campaign_id=instance.campaign_id,
        token_ids=touched_token_ids,
    )
    return instance, touched_token_ids
