"""
NarrativeHandler — narrative verb.

Simplest handler: returns the description text with no mechanical effect.
"""
from __future__ import annotations

from typing import Optional, Type

from pydantic import BaseModel, ConfigDict

from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects


class NarrativeParams(BaseModel):
    type: str = "narrative"
    description: Optional[str] = None

    model_config = ConfigDict(extra="forbid")


class NarrativeHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return NarrativeParams

    async def execute(
        self,
        params: NarrativeParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        return HandlerOutcome(description=params.description or "")
