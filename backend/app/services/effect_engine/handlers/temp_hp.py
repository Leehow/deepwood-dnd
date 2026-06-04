"""
TempHpHandler — grant_temp_hp verb.

Extracted from SpellResolver._resolve_temp_hp().
"""
from __future__ import annotations

from typing import Optional, Type

from pydantic import BaseModel, ConfigDict

from app.models.token import Token
from app.schemas.spell_effect import ScalingConfig
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects
from app.utils.dice_formula import evaluate as eval_formula


class TempHpParams(BaseModel):
    type: str = "grant_temp_hp"
    formula: str = "0"
    scaling: Optional[ScalingConfig] = None

    model_config = ConfigDict(extra="forbid")


class TempHpHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return TempHpParams

    async def execute(
        self,
        params: TempHpParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        from app.services.effect_engine.handlers._scaling import scale_formula

        ctx = hctx.caster_ctx
        target = hctx.target
        db = hctx.db

        formula = scale_formula(
            params.formula,
            (params.scaling.model_dump() if params.scaling else None) or hctx.scaling,
            ctx.slot_level,
        )
        roll = eval_formula(formula, ctx.variables)
        temp_hp = max(0, roll.total)

        token = await db.get(Token, target.token_id)
        if token:
            current_temp = token.temp_hp or 0
            token.temp_hp = max(current_temp, temp_hp)  # D&D 5E: take higher
            await db.flush()

        return HandlerOutcome(
            temp_hp_granted=temp_hp,
            formula_breakdown=roll.breakdown,
        )
