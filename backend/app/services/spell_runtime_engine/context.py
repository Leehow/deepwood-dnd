"""Dataclasses for the spell runtime phase executor.

`PhaseExecutionContext` carries the runtime instance plus trigger-specific
fields a verb handler may consult. `VerbResult` captures every change a verb
wants to make; the executor aggregates results into a `PhaseResult` and
optionally applies them back onto the instance.

Verb handlers must never mutate the instance directly — they return a
`VerbResult`. See `verb_registry.register_verb`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.spell_runtime_instance import SpellRuntimeInstance
from app.models.token import Token
from app.schemas.spell_runtime import RuntimeBonusDamage


@dataclass
class PhaseExecutionContext:
    """Per-call context handed to verb handlers."""

    db: AsyncSession
    instance: SpellRuntimeInstance
    spell_data: Dict[str, Any]
    trigger: str

    # Targeting (filled depending on trigger).
    primary_target: Optional[Any] = None
    targets: List[Any] = field(default_factory=list)

    # Trigger-specific optional fields. Verb handlers declare which they
    # require via `@register_verb(required_ctx={...})`.
    attacker_token_id: Optional[int] = None
    target_token_id: Optional[int] = None
    attack_kind: Optional[str] = None
    critical: bool = False
    invoked_action_id: Optional[str] = None
    invoked_target_token_id: Optional[int] = None
    current_world_time: Optional[Dict[str, Any]] = None
    # Turn-trigger context (Stage 8): populated when dispatching
    # start_of_turn / end_of_turn / start_of_target_turn / end_of_target_turn
    # from the combat active-turn hook. `turn_token_id` is the token whose
    # turn is starting or ending; `current_round` is the combat round number
    # after the storage update that fired the hook.
    turn_token_id: Optional[int] = None
    current_round: Optional[int] = None
    # Zone-trigger context (Stage 10): populated when dispatching
    # on_enter_zone / on_leave_zone from /zone-spell-settle. `zone_token_id`
    # is the token entering or leaving the caster's persistent zone.
    zone_token_id: Optional[int] = None


@dataclass
class VerbResult:
    """Everything a single verb wants to change."""

    narrative_parts: List[str] = field(default_factory=list)
    bonus_damages: List[RuntimeBonusDamage] = field(default_factory=list)
    modifier_effects: List[Dict[str, Any]] = field(default_factory=list)
    touched_token_ids: Set[int] = field(default_factory=set)
    param_updates: Dict[str, Any] = field(default_factory=dict)
    param_clears: List[str] = field(default_factory=list)
    primary_target_change: Optional[int] = None
    linked_targets_change: Optional[List[int]] = None
    granted_actions_append: List[Dict[str, Any]] = field(default_factory=list)
    status_change: Optional[str] = None
    sync_visual_tokens: List[Token] = field(default_factory=list)
    token_filter: Optional[Dict[str, Any]] = None


@dataclass
class PhaseResult:
    """Aggregate of N VerbResults across all matching phases for one call."""

    narrative_parts: List[str] = field(default_factory=list)
    bonus_damages: List[RuntimeBonusDamage] = field(default_factory=list)
    modifier_effects: List[Dict[str, Any]] = field(default_factory=list)
    touched_token_ids: Set[int] = field(default_factory=set)
    param_updates: Dict[str, Any] = field(default_factory=dict)
    param_clears: List[str] = field(default_factory=list)
    primary_target_change: Optional[int] = None
    linked_targets_change: Optional[List[int]] = None
    granted_actions_append: List[Dict[str, Any]] = field(default_factory=list)
    status_change: Optional[str] = None
    sync_visual_tokens: List[Token] = field(default_factory=list)
    token_filter: Optional[Dict[str, Any]] = None
    failed_verbs: List[Tuple[str, str]] = field(default_factory=list)
    applied: bool = False
