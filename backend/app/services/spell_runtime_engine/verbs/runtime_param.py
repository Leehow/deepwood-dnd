"""Runtime param verbs: set_runtime_param, clear_runtime_param."""

from __future__ import annotations

from typing import Any, Dict

from ..context import PhaseExecutionContext, VerbResult
from ..verb_registry import register_verb


@register_verb("set_runtime_param")
async def _set_runtime_param(ctx: PhaseExecutionContext, effect: Dict[str, Any]) -> VerbResult:
    key = str(effect.get("key") or "")
    if not key:
        return VerbResult()
    return VerbResult(param_updates={key: effect.get("value")})


@register_verb("clear_runtime_param")
async def _clear_runtime_param(ctx: PhaseExecutionContext, effect: Dict[str, Any]) -> VerbResult:
    key = str(effect.get("key") or "")
    if not key:
        return VerbResult()
    return VerbResult(param_clears=[key])
