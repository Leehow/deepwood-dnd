"""Unit tests for locale storage in ``ConnectionManager``.

Verifies that ``connect()`` accepts the new ``locale`` / ``locale_source``
kwargs, stores them in ``connection_info``, and that ``get_locale()``
returns the stored value or ``None`` for unknown connections.

Uses a minimal fake ``WebSocket`` so the tests run under
``pytest --noconftest`` without booting FastAPI/Starlette plumbing.
"""

from __future__ import annotations

import asyncio

from app.services.websocket_manager import ConnectionManager


class _FakeWebSocket:
    def __init__(self):
        self.accepted = False

    async def accept(self):
        self.accepted = True


def _connect(manager: ConnectionManager, ws: _FakeWebSocket, **overrides):
    kwargs = {
        "campaign_id": 7,
        "user_id": "u-1",
        "role": "player",
    }
    kwargs.update(overrides)
    asyncio.run(manager.connect(ws, **kwargs))


class TestConnectionManagerLocaleStorage:
    def test_locale_persisted_in_connection_info(self):
        manager = ConnectionManager()
        ws = _FakeWebSocket()
        _connect(manager, ws, locale="zh-CN", locale_source="user_preference")
        assert ws.accepted is True
        info = manager.get_connection_info(ws)
        assert info["locale"] == "zh-CN"
        assert info["locale_source"] == "user_preference"

    def test_locale_optional_defaults_to_none(self):
        manager = ConnectionManager()
        ws = _FakeWebSocket()
        _connect(manager, ws)
        info = manager.get_connection_info(ws)
        assert info["locale"] is None
        assert info["locale_source"] is None

    def test_get_locale_returns_value(self):
        manager = ConnectionManager()
        ws = _FakeWebSocket()
        _connect(manager, ws, locale="en-US", locale_source="header")
        assert manager.get_locale(ws) == "en-US"

    def test_get_locale_returns_none_for_unknown_socket(self):
        manager = ConnectionManager()
        assert manager.get_locale(_FakeWebSocket()) is None

    def test_get_locale_returns_none_when_unset(self):
        manager = ConnectionManager()
        ws = _FakeWebSocket()
        _connect(manager, ws)
        assert manager.get_locale(ws) is None

    def test_existing_kwargs_still_stored(self):
        # Regression guard: adding locale must not displace pre-existing
        # connection_info fields used elsewhere in the codebase.
        manager = ConnectionManager()
        ws = _FakeWebSocket()
        _connect(
            manager,
            ws,
            campaign_id=42,
            user_id="u-9",
            role="dm",
            selected_character_id=123,
            locale="en-US",
        )
        info = manager.get_connection_info(ws)
        assert info["campaign_id"] == "42"
        assert info["user_id"] == "u-9"
        assert info["role"] == "dm"
        assert info["selected_character_id"] == 123
        assert info["locale"] == "en-US"
