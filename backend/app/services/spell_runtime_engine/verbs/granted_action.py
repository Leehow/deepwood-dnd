"""grant_action verb."""

from __future__ import annotations

from typing import Any, Dict

from ..context import PhaseExecutionContext, VerbResult
from ..verb_registry import register_verb


@register_verb("grant_action")
async def _grant_action(ctx: PhaseExecutionContext, effect: Dict[str, Any]) -> VerbResult:
    # The existing service stores the raw effect dict in `granted_actions`.
    return VerbResult(granted_actions_append=[dict(effect)])
