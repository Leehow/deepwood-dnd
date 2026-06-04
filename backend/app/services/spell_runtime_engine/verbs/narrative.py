"""narrative verb — emits a description string."""

from __future__ import annotations

from typing import Any, Dict

from ..context import PhaseExecutionContext, VerbResult
from ..verb_registry import register_verb


@register_verb("narrative")
async def _narrative(ctx: PhaseExecutionContext, effect: Dict[str, Any]) -> VerbResult:
    description = effect.get("description")
    if not description:
        return VerbResult()
    return VerbResult(narrative_parts=[str(description)])
