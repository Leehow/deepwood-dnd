"""
CounterSpellHandler — counter_spell verb.

Records counter-spell capability. The actual interruption logic is
handled at the spell-cast workflow level; this handler stores the
auto-counter threshold and check parameters.
"""
from __future__ import annotations

from typing import Optional, Type

from pydantic import BaseModel, ConfigDict

from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects


class CounterSpellParams(BaseModel):
    type: str = "counter_spell"
    autoCounterLevel: int = 3
    checkAbility: Optional[str] = None  # spellcasting ability
    checkDcFormula: Optional[str] = "10 + spell_level"

    model_config = ConfigDict(extra="forbid")


class CounterSpellHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return CounterSpellParams

    async def execute(
        self,
        params: CounterSpellParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        return HandlerOutcome(
            description=f"反制{params.autoCounterLevel}环及以下法术(高环需检定)",
        )
