"""Unit tests for ``app.services.combat_turn_trigger_hooks``.

These cover the pure helpers that decide whether a combat storage mutation
should fire runtime turn triggers, plus the async dispatcher that wires them
to ``execute_runtime_turn_triggers``. Both the campaign_storage hook and the
``tokens.delete_token`` hook share this module, so the helpers pin down
Stage 8a/8c semantics in one place.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.services import combat_turn_trigger_hooks as hooks


# ── is_canonical_combat_object ───────────────────────────────────────────────


def test_is_canonical_combat_object_only_matches_combat_current():
    assert hooks.is_canonical_combat_object("combat", "current") is True
    # Archived snapshots or alternate ids must not match.
    assert hooks.is_canonical_combat_object("combat", "archive-1") is False
    assert hooks.is_canonical_combat_object("combat", "") is False
    assert hooks.is_canonical_combat_object("token", "current") is False
    assert hooks.is_canonical_combat_object(None, None) is False


# ── extract_combat_turn_state ────────────────────────────────────────────────


def test_extract_runtime_schema():
    assert hooks.extract_combat_turn_state(
        {"current_turn_token_id": 42, "round_number": 5}
    ) == (42, 5)


def test_extract_legacy_order_index():
    assert hooks.extract_combat_turn_state(
        {"order": [11, 22, 33], "current_index": 1, "round": 2}
    ) == (22, 2)


def test_extract_prefers_runtime_token_id():
    assert hooks.extract_combat_turn_state(
        {
            "order": [11, 22, 33],
            "current_index": 0,
            "current_turn_token_id": 33,
            "round_number": 7,
        }
    ) == (33, 7)


def test_extract_falls_back_to_current_turn_index():
    # Stage 8c: the frontend now writes both `current_index` and
    # `current_turn_index` (see frontend/app/utils/combatTurnIndex.ts), but
    # older or out-of-sync snapshots may carry only the new name. The
    # extractor must still resolve the active token from the order array.
    assert hooks.extract_combat_turn_state(
        {"order": [11, 22, 33], "current_turn_index": 2, "round": 4}
    ) == (33, 4)


def test_extract_prefers_current_turn_index_over_current_index():
    # Both fields are dual-written today (frontend/app/utils/combatTurnIndex.ts),
    # but a stale legacy `current_index` left over from an older write must
    # not override the newer `current_turn_index`. Matches the frontend
    # reader's precedence.
    assert hooks.extract_combat_turn_state(
        {
            "order": [11, 22, 33],
            "current_index": 0,
            "current_turn_index": 2,
            "round": 1,
        }
    ) == (33, 1)


def test_extract_falls_back_to_current_index_when_current_turn_index_missing():
    assert hooks.extract_combat_turn_state(
        {"order": [11, 22, 33], "current_index": 1, "round": 1}
    ) == (22, 1)


def test_extract_handles_missing_and_invalid():
    assert hooks.extract_combat_turn_state(None) == (None, None)
    assert hooks.extract_combat_turn_state({}) == (None, None)
    assert hooks.extract_combat_turn_state(
        {"order": [1, 2], "current_index": 5}
    ) == (None, None)
    assert hooks.extract_combat_turn_state(
        {"current_turn_token_id": "abc", "round_number": "x"}
    ) == (None, None)


# ── combat_session_active ────────────────────────────────────────────────────


def test_combat_session_active():
    assert hooks.combat_session_active(False, {"in_combat": True}) is False
    assert hooks.combat_session_active(True, None) is True
    assert hooks.combat_session_active(True, {}) is True
    assert hooks.combat_session_active(True, {"in_combat": True}) is True
    assert hooks.combat_session_active(True, {"in_combat": False}) is False


# ── compute_combat_turn_transition ───────────────────────────────────────────


def _transition(**kwargs: Any):
    """Tiny helper to keep the call sites tidy."""
    base = dict(
        prev_active_token=None,
        prev_round=None,
        prev_in_session=False,
        new_active_token=None,
        new_round=None,
        new_in_session=True,
    )
    base.update(kwargs)
    return hooks.compute_combat_turn_transition(**base)


def test_transition_combat_start_only_fires_start():
    # None -> 10 with no prior session -> start only.
    assert _transition(
        prev_in_session=False, new_active_token=10, new_round=1
    ) == (None, 10, 1)


def test_transition_token_change_fires_end_then_start():
    assert _transition(
        prev_active_token=10,
        prev_round=1,
        prev_in_session=True,
        new_active_token=20,
        new_round=1,
    ) == (10, 20, 1)


def test_transition_end_of_combat_returns_none():
    # X -> None when leaving combat must NOT fire turn triggers (Stage 8a).
    assert _transition(
        prev_active_token=10,
        prev_round=1,
        prev_in_session=True,
        new_active_token=None,
        new_in_session=False,
    ) is None


def test_transition_same_token_round_change_fires_end_and_start_for_self():
    assert _transition(
        prev_active_token=10,
        prev_round=1,
        prev_in_session=True,
        new_active_token=10,
        new_round=2,
    ) == (10, 10, 2)


def test_transition_same_token_same_round_is_noop():
    assert _transition(
        prev_active_token=10,
        prev_round=1,
        prev_in_session=True,
        new_active_token=10,
        new_round=1,
    ) is None


def test_transition_token_change_from_no_session_skips_ending():
    # Combat just kicked off: prev not in session, so no ending token even
    # though prev_active_token happens to be populated (e.g. stale snapshot).
    assert _transition(
        prev_active_token=10,
        prev_round=None,
        prev_in_session=False,
        new_active_token=20,
        new_round=1,
    ) == (None, 20, 1)


# ── dispatch_combat_turn_triggers_if_changed ─────────────────────────────────


class _RecorderDB:
    """No-op async session double; the dispatcher only forwards it."""


def _install_dispatch_spy(monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    calls: list[dict] = []

    async def fake_execute(
        db, *, campaign_id, ending_token_id, starting_token_id, current_round=None
    ):
        calls.append(
            {
                "db": db,
                "campaign_id": campaign_id,
                "ending_token_id": ending_token_id,
                "starting_token_id": starting_token_id,
                "current_round": current_round,
            }
        )
        return []

    # The dispatcher imports execute_runtime_turn_triggers lazily inside the
    # function; patch the real module so the lazy import resolves to our spy.
    import app.services.spell_runtime_service as srs

    monkeypatch.setattr(srs, "execute_runtime_turn_triggers", fake_execute)

    # The dispatcher also fans out to the legacy executor; stub it so these
    # tests stay focused on the runtime spy and don't need DB fixtures.
    import app.services.combat_legacy_ongoing_effect_service as legacy

    async def noop_legacy(*args, **kwargs):
        return {"ending_fired": False, "starting_fired": False}

    monkeypatch.setattr(legacy, "execute_legacy_turn_ongoing_effects", noop_legacy)
    return calls


def test_dispatch_fires_on_token_change(monkeypatch):
    calls = _install_dispatch_spy(monkeypatch)
    db = _RecorderDB()

    asyncio.run(
        hooks.dispatch_combat_turn_triggers_if_changed(
            db,
            campaign_id=42,
            prev_data={"current_turn_token_id": 10, "round_number": 1},
            prev_is_active=True,
            new_data={"current_turn_token_id": 20, "round_number": 1},
            new_is_active=True,
        )
    )

    assert calls == [
        {
            "db": db,
            "campaign_id": 42,
            "ending_token_id": 10,
            "starting_token_id": 20,
            "current_round": 1,
        }
    ]


def test_dispatch_noop_when_nothing_changes(monkeypatch):
    calls = _install_dispatch_spy(monkeypatch)

    asyncio.run(
        hooks.dispatch_combat_turn_triggers_if_changed(
            _RecorderDB(),
            campaign_id=1,
            prev_data={"current_turn_token_id": 10, "round_number": 1},
            prev_is_active=True,
            new_data={"current_turn_token_id": 10, "round_number": 1},
            new_is_active=True,
        )
    )

    assert calls == []


def test_dispatch_noop_when_combat_ends(monkeypatch):
    calls = _install_dispatch_spy(monkeypatch)

    asyncio.run(
        hooks.dispatch_combat_turn_triggers_if_changed(
            _RecorderDB(),
            campaign_id=1,
            prev_data={"current_turn_token_id": 10, "round_number": 1},
            prev_is_active=True,
            new_data={"current_turn_token_id": 10, "round_number": 1},
            new_is_active=False,
        )
    )

    assert calls == []


def test_dispatch_fans_out_to_legacy_ongoing_executor(monkeypatch):
    """The combat hook must drive both the runtime engine and the legacy
    active-effect ongoing executor with the same (ending, starting) tokens —
    otherwise legacy spells like Heroism never fire on turn start."""
    # Stub runtime executor to keep this test focused.
    import app.services.spell_runtime_service as srs
    import app.services.combat_legacy_ongoing_effect_service as legacy

    async def noop_runtime(*args, **kwargs):
        return []

    monkeypatch.setattr(srs, "execute_runtime_turn_triggers", noop_runtime)

    legacy_calls: list[dict] = []

    async def fake_legacy(
        db, *, campaign_id, ending_token_id, starting_token_id, current_round=None
    ):
        legacy_calls.append(
            {
                "campaign_id": campaign_id,
                "ending_token_id": ending_token_id,
                "starting_token_id": starting_token_id,
                "current_round": current_round,
            }
        )
        return {"ending_fired": False, "starting_fired": False}

    monkeypatch.setattr(legacy, "execute_legacy_turn_ongoing_effects", fake_legacy)

    asyncio.run(
        hooks.dispatch_combat_turn_triggers_if_changed(
            _RecorderDB(),
            campaign_id=7,
            prev_data={"current_turn_token_id": 100, "round_number": 1},
            prev_is_active=True,
            new_data={"current_turn_token_id": 200, "round_number": 1},
            new_is_active=True,
        )
    )

    assert legacy_calls == [
        {
            "campaign_id": 7,
            "ending_token_id": 100,
            "starting_token_id": 200,
            "current_round": 1,
        }
    ]


def test_dispatch_swallows_legacy_exceptions(monkeypatch):
    """A failure in the legacy ongoing executor must not propagate either:
    the storage commit already happened before the hook fires."""
    import app.services.spell_runtime_service as srs
    import app.services.combat_legacy_ongoing_effect_service as legacy

    async def noop_runtime(*args, **kwargs):
        return []

    async def boom(*args, **kwargs):
        raise RuntimeError("legacy blew up")

    monkeypatch.setattr(srs, "execute_runtime_turn_triggers", noop_runtime)
    monkeypatch.setattr(legacy, "execute_legacy_turn_ongoing_effects", boom)

    asyncio.run(
        hooks.dispatch_combat_turn_triggers_if_changed(
            _RecorderDB(),
            campaign_id=1,
            prev_data={"current_turn_token_id": 10, "round_number": 1},
            prev_is_active=True,
            new_data={"current_turn_token_id": 20, "round_number": 1},
            new_is_active=True,
        )
    )


def test_dispatch_swallows_runtime_exceptions(monkeypatch, caplog):
    """Turn-trigger failures must not propagate; the storage commit already
    happened by the time the dispatcher runs."""
    import app.services.spell_runtime_service as srs
    import app.services.combat_legacy_ongoing_effect_service as legacy

    async def boom(*args, **kwargs):
        raise RuntimeError("trigger blew up")

    async def noop_legacy(*args, **kwargs):
        return {"ending_fired": False, "starting_fired": False}

    monkeypatch.setattr(srs, "execute_runtime_turn_triggers", boom)
    monkeypatch.setattr(legacy, "execute_legacy_turn_ongoing_effects", noop_legacy)

    asyncio.run(
        hooks.dispatch_combat_turn_triggers_if_changed(
            _RecorderDB(),
            campaign_id=1,
            prev_data={"current_turn_token_id": 10, "round_number": 1},
            prev_is_active=True,
            new_data={"current_turn_token_id": 20, "round_number": 1},
            new_is_active=True,
        )
    )
    # Reaching here without raising is the assertion.
