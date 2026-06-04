"""
DamageHandler — deal_damage verb.

Extracted from SpellResolver._resolve_damage().
"""
from __future__ import annotations

from typing import Optional, Type

from pydantic import BaseModel, ConfigDict

from app.schemas.spell_effect import ScalingConfig
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects
from app.utils.dice_formula import evaluate as eval_formula


class DamageParams(BaseModel):
    """Schema for deal_damage effects. Rejects unknown fields."""

    type: str = "deal_damage"
    formula: str = "1d4"
    damage_type: str = ""
    half_on_save: bool = False
    scaling: Optional[ScalingConfig] = None

    model_config = ConfigDict(extra="forbid")


class DamageHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return DamageParams

    async def execute(
        self,
        params: DamageParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        from app.services.effect_engine.handlers._scaling import scale_formula

        ctx = hctx.caster_ctx
        target = hctx.target

        formula = scale_formula(
            params.formula,
            (params.scaling.model_dump() if params.scaling else None)
            or hctx.scaling,
            ctx.slot_level,
        )

        # Critical hit: double all dice
        if hctx.is_critical:
            roll1 = eval_formula(formula, ctx.variables)
            roll2 = eval_formula(formula, ctx.variables)
            dice_total = (
                sum(g.total for g in roll1.dice_groups)
                + sum(g.total for g in roll2.dice_groups)
            )
            damage = max(0, dice_total + roll1.modifier)
            breakdown = f"{roll1.breakdown}+{roll2.breakdown}(暴击)"
        else:
            roll = eval_formula(formula, ctx.variables)
            damage = max(0, roll.total)
            breakdown = roll.breakdown

        # Cantrip damage bonus (potent cantrip, etc.)
        cantrip_bonus = _get_cantrip_damage_bonus(hctx)
        if cantrip_bonus > 0:
            damage += cantrip_bonus
            breakdown = f"{breakdown}+{cantrip_bonus}(强力施法)" if breakdown else str(damage)

        # Half damage on save
        if hctx.save_succeeded and hctx.save_cfg:
            if hctx.save_cfg.get("on_success") == "half_damage":
                damage = damage // 2
            from app.services.effect_service import get_save_success_override

            save_success_override = get_save_success_override(
                target.active_effects,
                scope="spell",
            )
            if save_success_override and save_success_override.get("mode") == "no_damage_on_success":
                damage = 0

        # Half damage on miss
        if hctx.attack_hit is False:
            damage = damage // 2

        # Immunity / resistance
        dmg_type = params.damage_type
        if _check_immunity(dmg_type, target.damage_immunities):
            damage = 0
            desc = f"{target.name} 免疫{dmg_type}伤害"
        else:
            desc = None
            has_resistance = _check_resistance(dmg_type, target.damage_resistances)
            has_immunity = False
            if target.active_effects:
                from app.services.effect_service import check_resistances

                effect_resistance, effect_immunity = check_resistances(
                    target.active_effects,
                    dmg_type,
                    damage_source="spell",
                )
                has_resistance = has_resistance or effect_resistance
                has_immunity = has_immunity or effect_immunity
            if has_immunity:
                damage = 0
                desc = f"{target.name} 免疫{dmg_type}伤害"
            elif has_resistance:
                damage = damage // 2

        return HandlerOutcome(
            damage_dealt=damage,
            formula_breakdown=breakdown,
            description=desc,
        )


# ── Helpers (shared with resolver, kept local to avoid circular imports) ──

def _check_immunity(dmg_type: str, immunities: list[str]) -> bool:
    if not dmg_type or not immunities:
        return False
    return dmg_type.lower() in [i.lower() for i in immunities]


def _check_resistance(dmg_type: str, resistances: list[str]) -> bool:
    if not dmg_type or not resistances:
        return False
    return dmg_type.lower() in [r.lower() for r in resistances]


def _get_cantrip_damage_bonus(hctx: HandlerContext) -> int:
    ctx = hctx.caster_ctx
    if ctx.spell_level != 0:
        return 0
    if not ctx.caster_class_id:
        return 0
    from app.services.passive_feature_service import get_passive_features

    features = get_passive_features(
        ctx.caster_class_id, ctx.caster_level, ctx.caster_subclass_id,
    )
    all_feats = (features or {}).get("allFeatures", [])
    feat = next((f for f in all_feats if f.get("type") == "cantrip_damage_bonus"), None)
    if not feat:
        return 0
    ability_name = feat.get("effect", {}).get("abilityModifier", "wisdom")
    score = (ctx.caster_ability_scores or {}).get(ability_name, 10)
    return max(0, (int(score) - 10) // 2)
