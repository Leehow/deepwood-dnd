"""
RawEffectHandler — apply_effect verb.

Applies a raw active_effect dict to a token. Adds schema constraints
to prevent arbitrary data injection while preserving flexibility.
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Type

from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm.attributes import flag_modified

from app.models.token import Token
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects


class RawEffectParams(BaseModel):
    type: str = "apply_effect"
    effect_data: Dict[str, Any]

    model_config = ConfigDict(extra="forbid")


class RawEffectHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return RawEffectParams

    async def execute(
        self,
        params: RawEffectParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        ctx = hctx.caster_ctx
        db = hctx.db
        target = hctx.target

        effect_data = dict(params.effect_data)
        # Backfill source metadata
        effect_data.setdefault("source", ctx.spell_name)
        effect_data.setdefault("source_token_id", ctx.caster_token_id)
        effect_data.setdefault("sourceTokenId", ctx.caster_token_id)
        effect_data.setdefault("spell_id", ctx.spell_id)
        effect_data.setdefault("spellId", ctx.spell_id)
        effect_data.setdefault("sourceSpell", ctx.spell_id)
        effect_data.setdefault("cast_level", ctx.slot_level)

        token = await db.get(Token, target.token_id)
        if token:
            current = token.active_effects or []
            eff_id = effect_data.get("id", "")
            current = [e for e in current if e.get("id") != eff_id]
            current.append(effect_data)
            token.active_effects = current
            flag_modified(token, "active_effects")
            await db.flush()

        return HandlerOutcome(
            description=f"Applied effect: {effect_data.get('name', '')}",
        )
