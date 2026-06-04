"""
Effect Handler abstract base class.

Every handler declares a Pydantic param schema and an async execute method.
The engine validates incoming effect dicts against the schema before dispatch.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Type

from pydantic import BaseModel

from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects


class EffectHandler(ABC):
    """Abstract base for all effect handlers."""

    @abstractmethod
    def get_param_schema(self) -> Type[BaseModel]:
        """Return the Pydantic model class that validates this handler's params."""
        ...

    @abstractmethod
    async def execute(
        self,
        params: BaseModel,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        """Execute the effect and return the outcome.

        Args:
            params: Validated parameters (instance of get_param_schema()).
            hctx: Execution context with target, caster, phase, DB.
            side_effects: Mutable accumulator for cross-handler side effects.
        """
        ...
