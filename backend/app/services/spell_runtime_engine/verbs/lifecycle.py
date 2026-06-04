"""Lifecycle verbs: end_spell_instance."""

from __future__ import annotations

from typing import Any, Dict

from ..context import PhaseExecutionContext, VerbResult
from ..verb_registry import register_verb


@register_verb("end_spell_instance")
async def _end_spell_instance(ctx: PhaseExecutionContext, effect: Dict[str, Any]) -> VerbResult:
    instance = ctx.instance
    touched: set[int] = set()
    if instance.caster_token_id is not None:
        touched.add(int(instance.caster_token_id))
    if instance.primary_target_token_id is not None:
        touched.add(int(instance.primary_target_token_id))
    for raw_id in instance.linked_target_token_ids or []:
        try:
            touched.add(int(raw_id))
        except (TypeError, ValueError):
            continue
    return VerbResult(status_change="ended", touched_token_ids=touched)
