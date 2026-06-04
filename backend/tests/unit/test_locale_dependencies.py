"""Unit tests for the locale-resolution helpers in ``app.core.dependencies``.

These tests use a lightweight in-memory fake ``AsyncSession`` so they can
run under ``pytest --noconftest`` without a real database. They exercise
the pure helper path (``resolve_locale_context_for_user``) which is what
both the HTTP dependency and the WebSocket connect path call into.
"""

from __future__ import annotations

import asyncio
from typing import Optional

import pytest

from app.core.dependencies import (
    _load_user_preference_locale,
    resolve_locale_context_for_user,
)
from app.core.locale import DEFAULT_LOCALE


class _FakeScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeSession:
    """Minimal stand-in for ``AsyncSession`` used by the locale helpers.

    Only ``execute()`` is required by the helpers under test, and only the
    ``scalar_one_or_none()`` projection is consumed. ``preferences`` is
    returned verbatim for whichever user_id was queried.
    """

    def __init__(self, preferences_by_user: Optional[dict] = None):
        self.preferences_by_user = preferences_by_user or {}
        self.queried_user_ids: list[str] = []

    async def execute(self, stmt):  # noqa: ARG002 — stmt is not introspected
        # Extract the bound ``id == user_id`` parameter from the SQLAlchemy
        # statement. The helpers always use a literal ``str(user_id)``.
        params = stmt.compile().params
        user_id = next(iter(params.values()))
        self.queried_user_ids.append(user_id)
        return _FakeScalarResult(self.preferences_by_user.get(user_id))


class TestLoadUserPreferenceLocale:
    def test_returns_none_for_missing_user_id(self):
        session = _FakeSession()
        result = asyncio.run(_load_user_preference_locale(session, None))
        assert result is None
        # Should not have hit the DB at all.
        assert session.queried_user_ids == []

    def test_returns_none_when_user_missing(self):
        session = _FakeSession(preferences_by_user={})
        result = asyncio.run(_load_user_preference_locale(session, "u-1"))
        assert result is None
        assert session.queried_user_ids == ["u-1"]

    def test_returns_none_when_preferences_has_no_locale(self):
        session = _FakeSession(preferences_by_user={"u-1": {"sound": "on"}})
        result = asyncio.run(_load_user_preference_locale(session, "u-1"))
        assert result is None

    def test_returns_raw_locale_string(self):
        session = _FakeSession(preferences_by_user={"u-1": {"locale": "zh-CN"}})
        result = asyncio.run(_load_user_preference_locale(session, "u-1"))
        assert result == "zh-CN"

    def test_non_string_locale_is_ignored(self):
        session = _FakeSession(preferences_by_user={"u-1": {"locale": 123}})
        result = asyncio.run(_load_user_preference_locale(session, "u-1"))
        assert result is None

    def test_non_dict_preferences_row_is_ignored(self):
        session = _FakeSession(preferences_by_user={"u-1": "not-a-dict"})
        result = asyncio.run(_load_user_preference_locale(session, "u-1"))
        assert result is None


class TestResolveLocaleContextForUser:
    def test_preference_wins_over_header(self):
        session = _FakeSession(preferences_by_user={"u-1": {"locale": "zh-CN"}})
        ctx = asyncio.run(
            resolve_locale_context_for_user(
                session,
                user_id="u-1",
                accept_language="en-US;q=0.9",
            )
        )
        assert ctx.locale == "zh-CN"
        assert ctx.source == "user_preference"
        assert ctx.accept_language == "en-US;q=0.9"

    def test_header_used_when_no_preference(self):
        session = _FakeSession(preferences_by_user={"u-1": {}})
        ctx = asyncio.run(
            resolve_locale_context_for_user(
                session,
                user_id="u-1",
                accept_language="zh-CN;q=0.9, en-US;q=0.5",
            )
        )
        assert ctx.locale == "zh-CN"
        assert ctx.source == "header"

    def test_anonymous_falls_back_to_header(self):
        # No user_id and no DB query should happen.
        session = _FakeSession()
        ctx = asyncio.run(
            resolve_locale_context_for_user(
                session,
                user_id=None,
                accept_language="zh-CN",
            )
        )
        assert ctx.locale == "zh-CN"
        assert ctx.source == "header"
        assert session.queried_user_ids == []

    def test_anonymous_with_no_header_falls_back_to_default(self):
        session = _FakeSession()
        ctx = asyncio.run(
            resolve_locale_context_for_user(
                session,
                user_id=None,
                accept_language=None,
            )
        )
        assert ctx.locale == DEFAULT_LOCALE
        assert ctx.source == "default"

    def test_invalid_persisted_preference_falls_through(self):
        session = _FakeSession(preferences_by_user={"u-1": {"locale": "klingon"}})
        ctx = asyncio.run(
            resolve_locale_context_for_user(
                session,
                user_id="u-1",
                accept_language="zh-CN",
            )
        )
        assert ctx.locale == "zh-CN"
        assert ctx.source == "header"
        # Provenance still records the rejected raw preference.
        assert ctx.user_preference_raw == "klingon"
        assert ctx.user_preference_normalized is None
