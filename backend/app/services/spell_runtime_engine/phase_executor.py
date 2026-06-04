"""Phase executor for the spell runtime engine.

Public entry point: `execute_phase(db, instance, trigger, ctx_overrides,
*, spell_data=None, apply=True)`.

When `apply=False`, the executor never mutates `instance` — used by
read-only projection flows (e.g. modifier collection) so they cannot
accidentally append granted actions repeatedly.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.spell_runtime_instance import SpellRuntimeInstance
from app.utils.rules_cache import get_spell_by_id, get_spell_effect_phases

from .context import PhaseExecutionContext, PhaseResult, VerbResult
from .verb_registry import VERB_HANDLERS, check_required_ctx

logger = logging.getLogger(__name__)


def _phase_matches(
    phase: Dict[str, Any],
    trigger: str,
    ctx_overrides: Dict[str, Any],
) -> bool:
    phase_trigger = str(phase.get("trigger") or "on_cast")
    if phase_trigger != trigger:
        return False

    condition = phase.get("condition") or {}
    if not condition:
        return True

    # `on_action_invoked` carries `action_id` in the condition. Any other
    # condition.* key uses simple equality against ctx_overrides[key].
    for key, expected in condition.items():
        if key == "action_id":
            if str(ctx_overrides.get("invoked_action_id") or "") != str(expected or ""):
                return False
            continue
        if ctx_overrides.get(key) != expected:
            return False
    return True


def _merge_verb_result(aggregate: PhaseResult, result: VerbResult) -> None:
    aggregate.narrative_parts.extend(result.narrative_parts)
    aggregate.bonus_damages.extend(result.bonus_damages)
    aggregate.modifier_effects.extend(result.modifier_effects)
    aggregate.touched_token_ids.update(result.touched_token_ids)
    # Per-key last-write-wins: a later update on a key cancels any pending
    # clear of that key, and a later clear cancels any pending update. The
    # aggregate is later applied as "clears then updates" by
    # `_apply_to_instance()`, so without this reconciliation an earlier
    # update + later clear would still leave the (stale) update in place.
    if result.param_updates:
        for key, value in result.param_updates.items():
            if aggregate.param_clears:
                aggregate.param_clears = [k for k in aggregate.param_clears if k != key]
            aggregate.param_updates[key] = value
    if result.param_clears:
        for key in result.param_clears:
            aggregate.param_updates.pop(key, None)
            if key not in aggregate.param_clears:
                aggregate.param_clears.append(key)
    if result.primary_target_change is not None:
        aggregate.primary_target_change = result.primary_target_change
    if result.linked_targets_change is not None:
        aggregate.linked_targets_change = list(result.linked_targets_change)
    if result.granted_actions_append:
        aggregate.granted_actions_append.extend(result.granted_actions_append)
    if result.status_change is not None:
        aggregate.status_change = result.status_change
    if result.sync_visual_tokens:
        aggregate.sync_visual_tokens.extend(result.sync_visual_tokens)
    if result.token_filter is not None:
        aggregate.token_filter = dict(result.token_filter)


def _apply_to_instance(instance: SpellRuntimeInstance, result: PhaseResult) -> None:
    """Apply aggregated changes back onto the instance.

    This is the *only* code in Stage 1 that mutates `SpellRuntimeInstance`
    columns. It runs in-memory; the caller is responsible for SQLAlchemy
    `flag_modified` on JSON columns and for committing the transaction.
    """
    if result.param_updates or result.param_clears or result.token_filter is not None:
        params = dict(instance.params or {})
        if result.param_clears:
            for key in result.param_clears:
                params.pop(key, None)
        if result.param_updates:
            params.update(result.param_updates)
        if result.token_filter is not None:
            params["token_filter"] = dict(result.token_filter)
        instance.params = params

    if result.primary_target_change is not None:
        instance.primary_target_token_id = result.primary_target_change

    if result.linked_targets_change is not None:
        instance.linked_target_token_ids = list(result.linked_targets_change)

    if result.granted_actions_append:
        existing = list(instance.granted_actions or [])
        existing.extend(dict(action) for action in result.granted_actions_append)
        instance.granted_actions = existing

    if result.status_change is not None:
        instance.status = result.status_change

    result.applied = True


async def execute_phase(
    db: AsyncSession,
    instance: SpellRuntimeInstance,
    trigger: str,
    ctx_overrides: Optional[Dict[str, Any]] = None,
    *,
    spell_data: Optional[Dict[str, Any]] = None,
    apply: bool = True,
) -> PhaseResult:
    """Execute every phase of `instance.spell_id` that matches `trigger`.

    `ctx_overrides` is a dict of `PhaseExecutionContext` field overrides
    (e.g. `{"primary_target": target, "attacker_token_id": 10}`).
    Unknown keys are ignored — the context is constructed by keyword.

    When `apply=False`, returned `PhaseResult` is purely an evaluation;
    `instance` is not mutated. Use this for projection / modifier flows.
    """
    ctx_overrides = dict(ctx_overrides or {})
    spell_data = spell_data or get_spell_by_id(instance.spell_id)
    if not spell_data:
        return PhaseResult()

    phases = get_spell_effect_phases(spell_data, instance.selected_option)
    matching = [p for p in phases if _phase_matches(p, trigger, ctx_overrides)]
    if not matching:
        return PhaseResult()

    ctx_kwargs = {
        k: v
        for k, v in ctx_overrides.items()
        if k in PhaseExecutionContext.__dataclass_fields__
    }
    ctx = PhaseExecutionContext(
        db=db,
        instance=instance,
        spell_data=spell_data,
        trigger=trigger,
        **ctx_kwargs,
    )

    result = PhaseResult()

    for phase in matching:
        for effect in phase.get("effects") or []:
            verb_type = str(effect.get("type") or "")
            handler = VERB_HANDLERS.get(verb_type)
            if handler is None:
                result.failed_verbs.append((verb_type, "no handler"))
                logger.warning(
                    "spell_runtime: unhandled verb %s in spell %s",
                    verb_type,
                    instance.spell_id,
                )
                continue

            missing = check_required_ctx(verb_type, ctx)
            if missing:
                reason = f"missing ctx: {','.join(sorted(missing))}"
                result.failed_verbs.append((verb_type, reason))
                logger.warning(
                    "spell_runtime: verb %s skipped (%s) on spell %s",
                    verb_type,
                    reason,
                    instance.spell_id,
                )
                continue

            try:
                verb_result = await handler(ctx, effect)
            except Exception as exc:  # noqa: BLE001 — engine-wide isolation
                result.failed_verbs.append((verb_type, repr(exc)))
                logger.exception(
                    "spell_runtime: verb %s raised in instance %s",
                    verb_type,
                    instance.id,
                )
                continue

            if verb_result is None:
                continue
            _merge_verb_result(result, verb_result)

    if apply:
        _apply_to_instance(instance, result)

    return result


async def evaluate_phase(
    db: AsyncSession,
    instance: SpellRuntimeInstance,
    trigger: str,
    ctx_overrides: Optional[Dict[str, Any]] = None,
    *,
    spell_data: Optional[Dict[str, Any]] = None,
) -> PhaseResult:
    """Read-only convenience: never mutates `instance`."""
    return await execute_phase(
        db,
        instance,
        trigger,
        ctx_overrides,
        spell_data=spell_data,
        apply=False,
    )
