"""Single owner for settling time-bound rules after world time changes.

Consolidates the settlement sequence (due casts, token active-effect expiry,
concentration expiry, runtime-instance expiry) behind one function. Each step
is opt-in so the compatibility HTTP endpoint can run only the subset it owns
(token active-effect durations) without re-running the concentration / runtime
steps the WebSocket path already performed for the same advance.

Idempotency: each wall-clock step removes only entries whose expires_at is
at/under current_time and clears the marker it acted on, so re-running at the
same current_time is a no-op for those steps. The only non-idempotent operation
is the legacy per-round duration decrement in the token active-effect step,
gated on rounds > 0; the WS path passes rounds=0 and the HTTP path passes its
own rounds exactly once per advance.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession


@dataclass
class WorldTimeSettlementResult:
    """What a settlement pass touched, for callers/tests and observability."""

    source: str
    steps_run: List[str] = field(default_factory=list)
    due_casts: List[Dict[str, Any]] = field(default_factory=list)
    effect_cleanup: Optional[Dict[str, Any]] = None
    expired_concentration_token_ids: List[int] = field(default_factory=list)
    ended_runtime_token_ids: List[int] = field(default_factory=list)


async def settle_world_time(
    db: AsyncSession,
    campaign_id: int,
    current_time: Optional[Dict[str, Any]],
    *,
    map_url: Optional[str] = None,
    rounds: int = 0,
    source: str = "time_update",
    settle_due_casts: bool = True,
    settle_effect_durations: bool = True,
    settle_concentration: bool = True,
    settle_runtime_instances: bool = True,
) -> WorldTimeSettlementResult:
    """Settle time-bound rules after world time changed.

    Steps run in a fixed order so downstream state stays consistent:
    resolve due casts (a finished cast can create timed effects), then token
    active-effect expiry / per-round decrement, then concentration expiry, then
    runtime-instance expiry.

    Args:
        current_time: campaign world-time dict (day/hour/minute/second).
        map_url: restrict the active-effect step to one map, or None for all.
        rounds: legacy per-round decrement count for the active-effect step;
            0 (default) means wall-clock-only settlement.
        source: free-form tag recorded on the result for observability.
        settle_*: opt-in flags so a caller can run a subset without re-running
            steps another path already performed.
    """
    # Lazy imports: these primitives live in route modules that import services
    # heavily; importing them at module load would risk a circular import.
    from app.api.routes.spell_cast import resolve_due_casts_for_campaign
    from app.api.routes.tokens import (
        cleanup_campaign_effect_durations,
        cleanup_expired_concentration_for_campaign,
    )
    from app.services.spell_runtime_service import cleanup_expired_runtime_instances

    cid = int(campaign_id)
    result = WorldTimeSettlementResult(source=source)

    if settle_due_casts:
        result.due_casts = await resolve_due_casts_for_campaign(db, cid, current_time or {})
        result.steps_run.append("due_casts")

    if settle_effect_durations:
        result.effect_cleanup = await cleanup_campaign_effect_durations(
            db,
            campaign_id=cid,
            current_time=current_time,
            rounds=rounds,
            map_url=map_url,
        )
        result.steps_run.append("effect_durations")

    if settle_concentration:
        result.expired_concentration_token_ids = await cleanup_expired_concentration_for_campaign(
            db,
            campaign_id=cid,
            current_time=current_time,
        )
        result.steps_run.append("concentration")

    if settle_runtime_instances:
        result.ended_runtime_token_ids = await cleanup_expired_runtime_instances(
            db,
            campaign_id=cid,
            current_world_time=current_time,
        )
        result.steps_run.append("runtime_instances")

    return result
