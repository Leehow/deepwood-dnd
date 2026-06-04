"""apply_token_filter verb.

Stage 1 just surfaces the filter dict on `VerbResult.token_filter`. The
executor writes it into `instance.params["token_filter"]` on apply; the
projection builder (in `spell_runtime_service`) will start reading it from
there in a later stage.
"""

from __future__ import annotations

from typing import Any, Dict

from ..context import PhaseExecutionContext, VerbResult
from ..verb_registry import register_verb


@register_verb("apply_token_filter")
async def _apply_token_filter(ctx: PhaseExecutionContext, effect: Dict[str, Any]) -> VerbResult:
    raw = effect.get("tokenFilter") or effect.get("token_filter") or effect.get("filter")
    if not isinstance(raw, dict) or not raw:
        return VerbResult()
    return VerbResult(token_filter=dict(raw))
