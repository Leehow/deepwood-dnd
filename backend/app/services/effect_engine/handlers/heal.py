"""
HealHandler — heal verb.

Extracted from SpellResolver._resolve_healing() + _maybe_apply_blessed_healer().
"""
from __future__ import annotations

from typing import Optional, Type

from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm.attributes import flag_modified

from app.models.token import Token
from app.schemas.spell_effect import ScalingConfig
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects
from app.services.runtime_schema_service import normalize_token_death_saves
from app.utils.dice_formula import evaluate as eval_formula


class HealParams(BaseModel):
    type: str = "heal"
    formula: str = "1d4"
    scaling: Optional[ScalingConfig] = None
    heal_target: Optional[str] = None  # "caster" means heal caster instead

    model_config = ConfigDict(extra="forbid")


class HealHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return HealParams

    async def execute(
        self,
        params: HealParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        from app.services.effect_engine.handlers._scaling import scale_formula

        ctx = hctx.caster_ctx
        target = hctx.target

        # Special: "half_damage" heals for half damage dealt this phase
        if params.formula == "half_damage":
            healing = max(0, hctx.phase_damage_dealt // 2)
            breakdown = f"{hctx.phase_damage_dealt}÷2={healing}"
        else:
            formula = scale_formula(
                params.formula,
                (params.scaling.model_dump() if params.scaling else None)
                or hctx.scaling,
                ctx.slot_level,
            )
            roll = eval_formula(formula, ctx.variables)
            healing = max(0, roll.total)
            breakdown = roll.breakdown

            # Maximize healing feature
            feat = _get_caster_feature(hctx, "maximize_healing")
            if feat and roll.dice_groups:
                healing = sum(g.count * g.sides for g in roll.dice_groups) + roll.modifier
                breakdown = f"{breakdown}=>{healing}(至高治疗)"

        # Healing bonus (life domain disciple of life)
        bonus = _get_healing_bonus(hctx)
        if bonus > 0:
            healing += bonus
            breakdown = f"{breakdown}+{bonus}(生命门徒)"

        # Cap at max HP — but only against the actual recipient. When
        # heal_target == "caster" (e.g. Vampiric Touch's half-damage self-heal),
        # the recipient is the caster, NOT `target` (the attack target). Capping
        # against the attack target's HP wrongly zeroes the self-heal whenever the
        # attack target is near full HP. The resolver re-applies the correct
        # caster-side cap downstream (_apply_hp_change_by_id), so leave it raw here.
        if params.heal_target != "caster":
            if target.current_hp is not None and target.max_hp is not None:
                # Clamp headroom at 0: an already-overfull target (current_hp >
                # max_hp from stale/over-seeded HP, a CON drop, or temp buffers)
                # must receive 0, never a negative "healing" that would flow into
                # _apply_hp_change and actually reduce its HP.
                headroom = max(0, target.max_hp - target.current_hp)
                healing = min(healing, headroom)

        # If a downed target regains HP, clear death-save state so the runtime
        # projection matches D&D semantics ("a creature that regains any hit
        # points is no longer dying").
        if (
            healing > 0
            and target.current_hp is not None
            and target.current_hp <= 0
            and params.heal_target != "caster"
            and getattr(target, "token_id", None) is not None
        ):
            token: Token | None = await hctx.db.get(Token, target.token_id)
            if token is not None:
                token.death_saves = normalize_token_death_saves(
                    {"successes": 0, "failures": 0, "stabilized": False},
                    strict=True,
                )
                flag_modified(token, "death_saves")

        return HandlerOutcome(
            healing_done=healing,
            formula_breakdown=breakdown,
            description=None,
        )


def _get_caster_feature(hctx: HandlerContext, feature_type: str):
    ctx = hctx.caster_ctx
    if not ctx.caster_class_id:
        return None
    from app.services.passive_feature_service import get_passive_features
    features = get_passive_features(ctx.caster_class_id, ctx.caster_level, ctx.caster_subclass_id)
    all_feats = (features or {}).get("allFeatures", [])
    return next((f for f in all_feats if f.get("type") == feature_type), None)


def _get_healing_bonus(hctx: HandlerContext) -> int:
    ctx = hctx.caster_ctx
    if ctx.slot_level < 1:
        return 0
    feat = _get_caster_feature(hctx, "healing_bonus")
    if not feat:
        return 0
    effect = feat.get("effect", {})
    return int(effect.get("value", 0) or 0) + int(effect.get("perSpellLevel", 0) or 0) * ctx.slot_level
