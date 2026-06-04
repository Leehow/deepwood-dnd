"""Unit tests for the combat turn-trigger hook helpers in campaign_storage.

These exercise the pure helpers ``_extract_combat_turn_state`` and
``_combat_session_active`` so the routing-side hook decisions are pinned
down without spinning up FastAPI / SQLAlchemy machinery.
"""

from __future__ import annotations

from app.api.routes.campaign_storage import (
    _combat_session_active,
    _extract_combat_turn_state,
)


def test_extract_combat_turn_state_runtime_schema():
    data = {
        "in_combat": True,
        "current_turn_token_id": 42,
        "round_number": 5,
    }
    assert _extract_combat_turn_state(data) == (42, 5)


def test_extract_combat_turn_state_legacy_order_index():
    data = {
        "order": [11, 22, 33],
        "current_index": 1,
        "round": 2,
    }
    assert _extract_combat_turn_state(data) == (22, 2)


def test_extract_combat_turn_state_prefers_explicit_token_id_over_order():
    data = {
        "order": [11, 22, 33],
        "current_index": 0,
        "current_turn_token_id": 33,
        "round_number": 7,
    }
    assert _extract_combat_turn_state(data) == (33, 7)


def test_extract_combat_turn_state_handles_missing_and_invalid():
    assert _extract_combat_turn_state(None) == (None, None)
    assert _extract_combat_turn_state({}) == (None, None)
    # current_index out of range -> no active token.
    assert _extract_combat_turn_state(
        {"order": [1, 2], "current_index": 5}
    ) == (None, None)
    # Non-int values are tolerated and produce None.
    assert _extract_combat_turn_state(
        {"current_turn_token_id": "abc", "round_number": "x"}
    ) == (None, None)


def test_combat_session_active_requires_is_active_true():
    assert _combat_session_active(False, {"in_combat": True}) is False
    assert _combat_session_active(True, None) is True
    assert _combat_session_active(True, {}) is True
    assert _combat_session_active(True, {"in_combat": True}) is True


def test_combat_session_active_respects_explicit_in_combat_false():
    # Storage row marked active but combat explicitly paused.
    assert _combat_session_active(True, {"in_combat": False}) is False
