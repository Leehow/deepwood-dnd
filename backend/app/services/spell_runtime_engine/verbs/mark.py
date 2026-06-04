"""Mark verbs: apply_mark, retarget_mark."""

from __future__ import annotations

from typing import Any, Dict

from ..context import PhaseExecutionContext, VerbResult
from ..verb_registry import register_verb


@register_verb("apply_mark", required_ctx={"primary_target"})
async def _apply_mark(ctx: PhaseExecutionContext, effect: Dict[str, Any]) -> VerbResult:
    target = ctx.primary_target
    token_id = getattr(target, "token_id", None)
    name = getattr(target, "name", None)

    param_updates: Dict[str, Any] = {}
    if token_id is not None:
        param_updates["marked_token_id"] = token_id
    if name is not None:
        param_updates["marked_target_name"] = name
    extra = effect.get("params") or {}
    if isinstance(extra, dict):
        param_updates.update(extra)

    touched: set[int] = set()
    if token_id is not None:
        try:
            touched.add(int(token_id))
        except (TypeError, ValueError):
            pass

    spell_name = ctx.instance.spell_name
    narrative = f"{spell_name} 标记了 {name or '目标'}"

    return VerbResult(
        param_updates=param_updates,
        touched_token_ids=touched,
        narrative_parts=[narrative],
    )


@register_verb("retarget_mark", required_ctx={"invoked_target_token_id"})
async def _retarget_mark(ctx: PhaseExecutionContext, effect: Dict[str, Any]) -> VerbResult:
    new_target_id = ctx.invoked_target_token_id
    if new_target_id is None:
        return VerbResult()

    touched: set[int] = {int(new_target_id)}
    previous = ctx.instance.primary_target_token_id
    if previous is not None:
        try:
            touched.add(int(previous))
        except (TypeError, ValueError):
            pass

    return VerbResult(
        primary_target_change=int(new_target_id),
        linked_targets_change=[int(new_target_id)],
        param_updates={
            "marked_token_id": int(new_target_id),
            "transfer_available": False,
        },
        touched_token_ids=touched,
    )
