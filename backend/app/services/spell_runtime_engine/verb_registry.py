"""Verb handler registry for the spell runtime engine.

A verb handler is an async callable `(ctx, effect) -> VerbResult`. Handlers
register themselves with `@register_verb("verb_type", required_ctx={...})`.

`required_ctx` lists `PhaseExecutionContext` field names that must be
non-None for the handler to run. The phase executor checks these before
dispatching, and skips with a recorded failure if missing.
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict, Iterable, Set

from .context import PhaseExecutionContext, VerbResult

VerbHandler = Callable[[PhaseExecutionContext, Dict[str, Any]], Awaitable[VerbResult]]

VERB_HANDLERS: Dict[str, VerbHandler] = {}
VERB_REQUIRED_CTX: Dict[str, Set[str]] = {}


def register_verb(
    verb_type: str,
    *,
    required_ctx: Iterable[str] = (),
) -> Callable[[VerbHandler], VerbHandler]:
    """Decorator that registers a verb handler.

    Raises if the same verb is registered twice; verb modules should import
    cleanly once.
    """

    def _decorate(fn: VerbHandler) -> VerbHandler:
        if verb_type in VERB_HANDLERS:
            raise RuntimeError(f"Duplicate verb handler registration: {verb_type}")
        VERB_HANDLERS[verb_type] = fn
        VERB_REQUIRED_CTX[verb_type] = set(required_ctx)
        return fn

    return _decorate


def get_required_ctx(verb_type: str) -> Set[str]:
    return VERB_REQUIRED_CTX.get(verb_type, set())


def check_required_ctx(verb_type: str, ctx: PhaseExecutionContext) -> list[str]:
    """Return field names from `required_ctx` that are missing on ctx."""
    missing: list[str] = []
    for field_name in get_required_ctx(verb_type):
        value = getattr(ctx, field_name, None)
        if value is None or (isinstance(value, (list, set, dict)) and not value):
            missing.append(field_name)
    return missing
