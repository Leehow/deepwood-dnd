from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.core.dependencies import (
    resolve_campaign_member_context,
    resolve_campaign_member_context_from_token,
)
from app.models.campaign import Campaign, CampaignMember


class DummyScalarResult:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class DummyScalarsResult:
    def __init__(self, rows):
        self.rows = rows

    def first(self):
        return self.rows[0] if self.rows else None


class DummyExecuteResult:
    def __init__(self, scalar=None, scalars=None):
        self._scalar = scalar
        self._scalars = scalars or []

    def scalar_one_or_none(self):
        return self._scalar

    def scalars(self):
        return DummyScalarsResult(self._scalars)


class DummySession:
    def __init__(self, responses):
        self._responses = list(responses)

    async def execute(self, _query):
        if not self._responses:
            raise AssertionError("Unexpected execute call")
        return self._responses.pop(0)


@pytest.mark.asyncio
async def test_resolve_campaign_member_context_supports_dm_without_member_row():
    campaign = SimpleNamespace(id=7, dm_user_id="dm-1")
    db = DummySession(
        [
            DummyExecuteResult(scalar=campaign),
            DummyExecuteResult(scalars=[]),
        ]
    )

    context = await resolve_campaign_member_context(
        db,
        campaign_id=7,
        current_user={"user_id": "dm-1"},
    )

    assert context.campaign_id == 7
    assert context.user_id == "dm-1"
    assert context.role == "dm"
    assert context.is_dm is True
    assert context.membership is None


@pytest.mark.asyncio
async def test_resolve_campaign_member_context_uses_membership_role_and_selected_character():
    campaign = SimpleNamespace(id=7, dm_user_id="dm-1")
    membership = SimpleNamespace(role="player", selected_character_id=42)
    db = DummySession(
        [
            DummyExecuteResult(scalar=campaign),
            DummyExecuteResult(scalars=[membership]),
        ]
    )

    context = await resolve_campaign_member_context(
        db,
        campaign_id=7,
        current_user={"user_id": "player-1"},
    )

    assert context.user_id == "player-1"
    assert context.role == "player"
    assert context.selected_character_id == 42
    assert context.is_dm is False


@pytest.mark.asyncio
async def test_resolve_campaign_member_context_from_token_decodes_before_lookup(monkeypatch):
    campaign = SimpleNamespace(id=9, dm_user_id="dm-9")
    db = DummySession(
        [
            DummyExecuteResult(scalar=campaign),
            DummyExecuteResult(scalars=[]),
        ]
    )

    monkeypatch.setattr(
        "app.core.dependencies.decode_token",
        lambda token: {"user_id": "dm-9", "token": token},
    )

    context = await resolve_campaign_member_context_from_token(
        db,
        campaign_id=9,
        token="jwt-token",
    )

    assert context.user_id == "dm-9"
    assert context.role == "dm"
