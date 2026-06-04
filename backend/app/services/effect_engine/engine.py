"""
Effect Engine — central registry, validation, and dispatch.

Usage:
    engine = get_engine()
    outcome = await engine.execute_effect(effect_dict, hctx, side_effects)
"""
from __future__ import annotations

import logging
from typing import Dict, Optional, Type

from pydantic import BaseModel, ValidationError

from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects
from app.services.effect_engine.handlers.base import EffectHandler

logger = logging.getLogger(__name__)


class UnknownVerbError(ValueError):
    """Raised when an effect type has no registered handler."""

    def __init__(self, verb: str):
        self.verb = verb
        super().__init__(f"No handler registered for effect type: {verb!r}")


class EffectValidationError(ValueError):
    """Raised when effect params fail schema validation."""

    def __init__(self, verb: str, errors: str):
        self.verb = verb
        super().__init__(f"Validation failed for {verb!r}: {errors}")


class EffectEngine:
    """Registry + dispatch for effect handlers."""

    def __init__(self) -> None:
        self._handlers: Dict[str, EffectHandler] = {}

    def register(self, verb: str, handler: EffectHandler) -> None:
        """Register a handler for the given effect verb (type string)."""
        self._handlers[verb] = handler

    @property
    def registered_verbs(self) -> set[str]:
        return set(self._handlers.keys())

    async def execute_effect(
        self,
        effect_dict: Dict,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        """Validate and dispatch a single effect.

        Args:
            effect_dict: Raw effect from JSON (must contain "type" key).
            hctx: Handler context with target, caster, phase, DB.
            side_effects: Mutable accumulator for cross-handler state.

        Returns:
            HandlerOutcome with the effect's results.

        Raises:
            UnknownVerbError: No handler for the effect type.
            EffectValidationError: Params fail schema validation.
        """
        verb = effect_dict.get("type", "")
        handler = self._handlers.get(verb)
        if handler is None:
            raise UnknownVerbError(verb)

        # Schema validation — the core anti-injection measure
        schema_cls = handler.get_param_schema()
        try:
            params = schema_cls.model_validate(effect_dict)
        except ValidationError as exc:
            raise EffectValidationError(verb, str(exc)) from exc

        return await handler.execute(params, hctx, side_effects)

    def can_handle(self, verb: str) -> bool:
        return verb in self._handlers


# ── Global singleton ──────────────────────────────────────────

_engine: Optional[EffectEngine] = None


def get_engine() -> EffectEngine:
    """Return the global EffectEngine singleton (lazily initialized)."""
    global _engine
    if _engine is None:
        from app.services.effect_engine.registry import register_all_handlers

        _engine = EffectEngine()
        register_all_handlers(_engine)
    return _engine


def reset_engine() -> None:
    """Reset global engine (for testing)."""
    global _engine
    _engine = None
