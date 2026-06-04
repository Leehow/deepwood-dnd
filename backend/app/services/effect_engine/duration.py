"""Round-duration / world-time expiry helpers shared by effect handlers.

Centralizes the rounds-to-expires_at wall-clock calculation so round-duration
effects get consistent expiry metadata whether created in or out of combat.
"""
from __future__ import annotations

from typing import Any, Dict, Optional


def resolve_round_duration(phase: Dict[str, Any], *, concentration: bool) -> Optional[int]:
    """Return the round-duration for a non-concentration effect, else None.

    Concentration effects get no wall-clock duration here; concentration loss
    can end them earlier than any wall-clock expiry and is settled separately.
    """
    if concentration:
        return None
    return (phase or {}).get("duration", {}).get("rounds")


def derive_round_expiry(
    duration_rounds: Optional[int],
    current_world_time: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Return the expires_at world-time dict for a round-duration effect.

    Returns None when there is no positive round-duration or no known world
    time. Delegates the 6-seconds-per-round arithmetic to the canonical
    implementation in SpellResolver.
    """
    if not duration_rounds or not current_world_time:
        return None
    from app.services.spell_resolver import SpellResolver

    return SpellResolver._calc_expires_at(current_world_time, duration_rounds)
