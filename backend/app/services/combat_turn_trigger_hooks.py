"""Shared helpers for the combat turn-trigger hook.

Stage 8a wired turn triggers from ``campaign_storage.update_storage_object``.
Stage 8c generalises that hook so any mutation of the canonical active combat
storage object (``object_type == "combat"`` AND ``object_id == "current"``)
can dispatch the same ``end_*`` / ``start_*`` triggers through one code path.

These helpers are pure (or thin async dispatchers) so they can be unit-tested
without spinning up FastAPI or SQLAlchemy.
"""

from __future__ import annotations

import logging
from typing import Optional, Tuple

from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


CANONICAL_COMBAT_OBJECT_TYPE = "combat"
CANONICAL_COMBAT_OBJECT_ID = "current"


def is_canonical_combat_object(object_type: Optional[str], object_id: Optional[str]) -> bool:
    """True only for the single active combat storage row.

    The runtime turn-trigger hook only fires for the canonical
    ``("combat", "current")`` row. Other combat-typed rows (e.g. archived
    snapshots) must not dispatch triggers, otherwise unrelated edits would
    end/start spell phases for tokens that are not actually on stage.
    """
    return (
        object_type == CANONICAL_COMBAT_OBJECT_TYPE
        and object_id == CANONICAL_COMBAT_OBJECT_ID
    )


def extract_combat_turn_state(
    data: Optional[dict],
) -> Tuple[Optional[int], Optional[int]]:
    """Best-effort active-turn extraction for a combat storage object.

    Returns ``(active_turn_token_id, round_number)``. Supports both the
    runtime schema (``current_turn_token_id`` / ``round_number``) and the
    legacy frontend shape (``order[current_index]`` / ``round``). Missing or
    invalid values surface as ``None``.
    """
    if not isinstance(data, dict):
        return None, None
    raw_tid = data.get("current_turn_token_id")
    if raw_tid is None:
        order = data.get("order")
        # Match frontend/app/utils/combatTurnIndex.ts: prefer the newer
        # `current_turn_index`, fall back to legacy `current_index`. The two
        # are dual-written today, but stale snapshots may carry only one and
        # an out-of-sync legacy `current_index` would otherwise misdispatch.
        idx = data.get("current_turn_index")
        if not isinstance(idx, int):
            idx = data.get("current_index")
        if isinstance(order, list) and isinstance(idx, int) and 0 <= idx < len(order):
            raw_tid = order[idx]
    try:
        active_tid = int(raw_tid) if raw_tid is not None else None
    except (TypeError, ValueError):
        active_tid = None
    raw_round = data.get("round_number")
    if raw_round is None:
        raw_round = data.get("round")
    try:
        round_num = int(raw_round) if raw_round is not None else None
    except (TypeError, ValueError):
        round_num = None
    return active_tid, round_num


def combat_session_active(obj_is_active: bool, data: Optional[dict]) -> bool:
    """The runtime treats a combat row as live iff the storage row is active
    AND ``data.in_combat`` is not explicitly False."""
    if not obj_is_active:
        return False
    if isinstance(data, dict) and data.get("in_combat") is False:
        return False
    return True


def compute_combat_turn_transition(
    *,
    prev_active_token: Optional[int],
    prev_round: Optional[int],
    prev_in_session: bool,
    new_active_token: Optional[int],
    new_round: Optional[int],
    new_in_session: bool,
) -> Optional[Tuple[Optional[int], Optional[int], Optional[int]]]:
    """Decide which turn triggers should dispatch.

    Returns ``(ending_token_id, starting_token_id, current_round)`` or
    ``None`` if no turn trigger should fire.

    Semantics (matches Stage 8a):
    - End-of-combat (``new_in_session`` is False): no triggers. The active
      runtime instances for this combat are typically being torn down by
      higher-level flows; we deliberately do not fire ``end_of_turn`` from
      this hook to avoid double-dispatch.
    - Token change X -> Y while in session: fire ``end_*`` for X iff the
      previous state was already in session and X was not None; fire
      ``start_*`` for Y if Y is not None. Combat start (``prev_in_session``
      False, X None or absent) only fires start triggers.
    - Same-token across a round boundary (single-combatant / wrap edge):
      fire end then start for that token.
    """
    if not new_in_session:
        return None

    ending: Optional[int] = None
    starting: Optional[int] = None

    token_changed = prev_active_token != new_active_token
    round_changed_same_token = (
        new_active_token is not None
        and prev_active_token == new_active_token
        and prev_round is not None
        and new_round is not None
        and prev_round != new_round
    )

    if token_changed:
        if prev_in_session and prev_active_token is not None:
            ending = int(prev_active_token)
        if new_active_token is not None:
            starting = int(new_active_token)
    elif round_changed_same_token and new_active_token is not None:
        ending = int(new_active_token)
        starting = int(new_active_token)

    if ending is None and starting is None:
        return None
    return ending, starting, new_round


async def dispatch_combat_turn_triggers_if_changed(
    db: AsyncSession,
    *,
    campaign_id: int,
    prev_data: Optional[dict],
    prev_is_active: bool,
    new_data: Optional[dict],
    new_is_active: bool,
) -> None:
    """Compute the transition and dispatch runtime turn triggers if any.

    Exceptions raised by the runtime dispatcher are logged but not
    re-raised: the calling route has already committed the storage
    mutation, and turn-trigger failures must not poison that commit.
    """
    prev_token, prev_round = extract_combat_turn_state(prev_data)
    new_token, new_round = extract_combat_turn_state(new_data)
    prev_in_session = combat_session_active(prev_is_active, prev_data)
    new_in_session = combat_session_active(new_is_active, new_data)

    transition = compute_combat_turn_transition(
        prev_active_token=prev_token,
        prev_round=prev_round,
        prev_in_session=prev_in_session,
        new_active_token=new_token,
        new_round=new_round,
        new_in_session=new_in_session,
    )
    if transition is None:
        return
    ending_token, starting_token, current_round = transition

    # Import here to avoid a circular import at module load time
    # (spell_runtime_service imports from many service modules).
    from app.services.spell_runtime_service import execute_runtime_turn_triggers

    try:
        await execute_runtime_turn_triggers(
            db,
            campaign_id=campaign_id,
            ending_token_id=ending_token,
            starting_token_id=starting_token,
            current_round=current_round,
        )
    except Exception:
        logger.exception(
            "Failed to dispatch runtime turn triggers for campaign %s",
            campaign_id,
        )

    # Legacy active-effect ongoing triggers (e.g. Heroism's grant_temp_hp on
    # start_of_target_turn). Spells not yet migrated to SpellRuntimeInstance
    # still live on Token.active_effects and are invisible to the runtime
    # dispatcher above. Run them here, with the same end/start tokens.
    from app.services.combat_legacy_ongoing_effect_service import (
        execute_legacy_turn_ongoing_effects,
    )

    try:
        await execute_legacy_turn_ongoing_effects(
            db,
            campaign_id=campaign_id,
            ending_token_id=ending_token,
            starting_token_id=starting_token,
            current_round=current_round,
        )
    except Exception:
        logger.exception(
            "Failed to dispatch legacy turn ongoing effects for campaign %s",
            campaign_id,
        )
