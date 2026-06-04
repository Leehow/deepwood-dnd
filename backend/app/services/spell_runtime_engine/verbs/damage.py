"""conditional_extra_damage verb.

Preserves the same dice-rolling behavior as `_roll_runtime_damage()` in
`spell_runtime_service.py`, including critical-hit double-roll dice
flattening and `RuntimeBonusDamage` shape.
"""

from __future__ import annotations

from collections import OrderedDict
from typing import Any, Dict, Sequence

from app.schemas.combat import DiceRoll
from app.schemas.spell_runtime import RuntimeBonusDamage
from app.utils.dice_formula import evaluate as eval_formula

from ..context import PhaseExecutionContext, VerbResult
from ..verb_registry import register_verb


def _build_eval_variables(instance) -> Dict[str, int]:
    params = instance.params or {}
    return {
        "MOD": int(params.get("spellcasting_mod") or 0),
        "PROF": int(params.get("proficiency_bonus") or 0),
        "LEVEL": int(params.get("caster_level") or 1),
    }


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


def roll_runtime_damage(
    *,
    formula: str,
    instance,
    critical: bool,
) -> tuple[int, Dict[str, Any]]:
    """Public helper mirroring the legacy `_roll_runtime_damage()` shape."""
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


@register_verb("conditional_extra_damage")
async def _conditional_extra_damage(
    ctx: PhaseExecutionContext, effect: Dict[str, Any]
) -> VerbResult:
    # Hex's on_hit damage applies when the attacker hits the marked target.
    # Both fields are optional at the verb layer; callers gate by trigger
    # filtering before dispatch.
    #
    # `target_match` (default "primary") gates whether the verb requires the
    # incoming `target_token_id` to equal the instance's primary target.
    # Self-buff spells like Divine Favor set `target_match: "any"` so the
    # bonus applies to whatever the caster hits, not only the primary target.
    instance = ctx.instance
    if ctx.attacker_token_id is not None and instance.caster_token_id != ctx.attacker_token_id:
        return VerbResult()
    # Primary-target equality is the safe default. Only the explicit opt-in
    # value `"any"` (case-insensitive) skips it. Missing keys, `"primary"`,
    # typos, or anything else fall back to primary matching so we never
    # accidentally leak bonus damage onto unrelated targets.
    raw_target_match = effect.get("target_match")
    if raw_target_match is None:
        raw_target_match = effect.get("targetMatch")
    target_match = str(raw_target_match or "").strip().lower()
    if target_match != "any":
        if ctx.target_token_id is not None and instance.primary_target_token_id != ctx.target_token_id:
            return VerbResult()
    if ctx.trigger == "on_weapon_hit" and ctx.attack_kind and ctx.attack_kind != "weapon":
        return VerbResult()

    formula = str(effect.get("formula") or "0")
    damage, roll_data = roll_runtime_damage(
        formula=formula,
        instance=instance,
        critical=bool(ctx.critical),
    )
    bonus = RuntimeBonusDamage(
        runtime_instance_id=instance.id,
        spell_id=instance.spell_id,
        spell_name=instance.spell_name,
        damage=damage,
        damage_type=effect.get("damage_type") or effect.get("damageType"),
        formula=roll_data["formula"],
        breakdown=roll_data["breakdown"],
        roll=roll_data["roll"],
    )
    return VerbResult(bonus_damages=[bonus])
