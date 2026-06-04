"""Modifier verbs: grant_advantage / disadvantage / resistance / immunity / modify_roll.

These verbs never mutate the instance — they emit `modifier_effects`
entries shaped exactly like the envelope `get_token_runtime_modifier_effects`
returns today in `spell_runtime_service`. Callers feed these into the
check / saving-throw pipeline.
"""

from __future__ import annotations

from typing import Any, Dict, List

from ..context import PhaseExecutionContext, VerbResult
from ..verb_registry import register_verb


def _envelope(ctx: PhaseExecutionContext, effect_type: str, modifier: Dict[str, Any]) -> Dict[str, Any]:
    instance = ctx.instance
    return {
        "id": f"spell_runtime_{instance.id}_{effect_type}",
        "name": instance.spell_name,
        "spell_id": instance.spell_id,
        "spell_runtime": True,
        "modifiers": [modifier],
    }


def _attach_condition(modifier: Dict[str, Any], effect: Dict[str, Any]) -> None:
    if effect.get("condition"):
        modifier["condition"] = effect.get("condition")


@register_verb("grant_advantage")
async def _grant_advantage(ctx: PhaseExecutionContext, effect: Dict[str, Any]) -> VerbResult:
    modifier = {"target": effect.get("on", "attack_roll"), "type": "advantage"}
    _attach_condition(modifier, effect)
    return VerbResult(modifier_effects=[_envelope(ctx, "grant_advantage", modifier)])


@register_verb("grant_disadvantage")
async def _grant_disadvantage(ctx: PhaseExecutionContext, effect: Dict[str, Any]) -> VerbResult:
    modifier = {"target": effect.get("on", "attack_roll"), "type": "disadvantage"}
    _attach_condition(modifier, effect)
    return VerbResult(modifier_effects=[_envelope(ctx, "grant_disadvantage", modifier)])


@register_verb("grant_resistance")
async def _grant_resistance(ctx: PhaseExecutionContext, effect: Dict[str, Any]) -> VerbResult:
    damage_types: List[str] = list(effect.get("damage_types") or effect.get("damageTypes") or [])
    modifier = {
        "target": "damage_taken",
        "type": "resistance",
        "condition": {"damage_type": damage_types},
    }
    _attach_condition(modifier, effect)
    return VerbResult(modifier_effects=[_envelope(ctx, "grant_resistance", modifier)])


@register_verb("grant_immunity")
async def _grant_immunity(ctx: PhaseExecutionContext, effect: Dict[str, Any]) -> VerbResult:
    damage_types: List[str] = list(effect.get("damage_types") or effect.get("damageTypes") or [])
    modifier = {
        "target": "damage_taken",
        "type": "immunity",
        "condition": {"damage_type": damage_types},
    }
    _attach_condition(modifier, effect)
    return VerbResult(modifier_effects=[_envelope(ctx, "grant_immunity", modifier)])


_MODIFY_ROLL_ALIASES = {
    "attack": "attack_roll",
    "attack_roll": "attack_roll",
    "attackroll": "attack_roll",
    "save": "saving_throw",
    "saving_throw": "saving_throw",
    "saving throw": "saving_throw",
    "savingthrow": "saving_throw",
    "ability_check": "ability_check",
    "ability check": "ability_check",
    "abilitycheck": "ability_check",
}


def _normalize_roll_target(raw: Any) -> str:
    key = str(raw or "").strip().lower()
    return _MODIFY_ROLL_ALIASES.get(key, str(raw))


@register_verb("modify_roll")
async def _modify_roll(ctx: PhaseExecutionContext, effect: Dict[str, Any]) -> VerbResult:
    roll_types = list(effect.get("roll_types") or effect.get("rollTypes") or [])
    if not roll_types:
        roll_types = ["attack_roll"]

    envelopes: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for raw_target in roll_types:
        target_name = _normalize_roll_target(raw_target)
        if target_name in seen:
            continue
        seen.add(target_name)
        modifier: Dict[str, Any] = {
            "target": target_name,
            "type": "bonus",
            "value": effect.get("formula", "0"),
        }
        operation = effect.get("operation")
        if operation:
            modifier["operation"] = operation
        _attach_condition(modifier, effect)
        envelopes.append(_envelope(ctx, f"modify_roll_{target_name}", modifier))

    return VerbResult(modifier_effects=envelopes)
