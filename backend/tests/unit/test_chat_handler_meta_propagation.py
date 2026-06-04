"""Focused test for ChatHandler propagating client-supplied meta.

This guards the Counterspell V1 cross-client contract: a DM cast publishes
`{ meta: { spell_cast: true, spellCastData: { casterTokenId, spellId, ... } } }`
through the websocket chat channel, and other clients must receive that
`spellCastData` in the broadcast payload — otherwise the receiving player's
`ReactionButtons` cannot show the Counterspell button against the source
caster.
"""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services.websocket_handlers.chat_handler import ChatHandler


class _FakeDB:
    """Minimal AsyncSession stand-in just for ChatHandler.handle."""

    def __init__(self):
        self.added = []
        self._next_id = 1001

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        pass

    async def refresh(self, obj):
        # Mirror what SQLAlchemy refresh would populate on a freshly inserted
        # ChatMessage: an autoincrement id and a created_at timestamp.
        if getattr(obj, "id", None) is None:
            obj.id = self._next_id
            self._next_id += 1
        if getattr(obj, "created_at", None) is None:
            obj.created_at = datetime.utcnow()

    async def execute(self, _stmt):  # pragma: no cover — not reached for dm role
        return SimpleNamespace(scalar_one_or_none=lambda: None)


@pytest.mark.asyncio
async def test_chat_handler_propagates_spell_cast_meta(monkeypatch):
    handler = ChatHandler()

    captured: dict = {}

    async def fake_broadcast(payload, campaign_id):
        captured["payload"] = payload
        captured["campaign_id"] = campaign_id

    monkeypatch.setattr(handler, "broadcast_to_campaign", fake_broadcast)
    # send_to_recipients is unused on this public-broadcast path but mock for safety.
    monkeypatch.setattr(handler, "send_to_recipients", AsyncMock())

    db = _FakeDB()

    message = {
        "type": "chat",
        "data": {
            "message": "🔮 使用3环法术位施放【火球术】",
            "recipients": [],
            "message_type": "chat",
            "meta": {
                "spell_cast": True,
                "spellCastData": {
                    "spellName": "火球术",
                    "spellId": "fireball",
                    "casterTokenId": 99,
                    "slotLevel": 3,
                    "results": [],
                    "totalDamage": 0,
                    "totalHealing": 0,
                    "concentrationSet": False,
                },
            },
        },
    }

    await handler.handle(
        message=message,
        websocket=SimpleNamespace(),
        campaign_id="7",
        user_id="user-dm",
        role="dm",
        db=db,
    )

    # Meta was persisted on the ChatMessage
    assert len(db.added) == 1
    persisted = db.added[0]
    assert persisted.meta.get("spell_cast") is True
    assert persisted.meta["spellCastData"]["casterTokenId"] == 99
    assert persisted.meta["spellCastData"]["spellId"] == "fireball"

    # Meta also reached the outgoing broadcast payload
    assert "payload" in captured, "broadcast_to_campaign was not called"
    payload_data = captured["payload"]["data"]
    assert "meta" in payload_data, "broadcast payload missing meta key"
    assert payload_data["meta"].get("spell_cast") is True
    assert payload_data["meta"]["spellCastData"]["casterTokenId"] == 99


@pytest.mark.asyncio
async def test_chat_handler_handles_missing_meta(monkeypatch):
    """Plain chat without meta still works and yields meta={} on the wire."""
    handler = ChatHandler()
    captured: dict = {}

    async def fake_broadcast(payload, campaign_id):
        captured["payload"] = payload

    monkeypatch.setattr(handler, "broadcast_to_campaign", fake_broadcast)
    monkeypatch.setattr(handler, "send_to_recipients", AsyncMock())

    db = _FakeDB()
    await handler.handle(
        message={"type": "chat", "data": {"message": "hello", "recipients": []}},
        websocket=SimpleNamespace(),
        campaign_id="7",
        user_id="user-dm",
        role="dm",
        db=db,
    )

    assert db.added[0].meta == {}
    assert captured["payload"]["data"]["meta"] == {}


@pytest.mark.asyncio
async def test_chat_handler_ignores_non_dict_meta(monkeypatch):
    """A malformed meta payload (string/list) must not crash or leak through."""
    handler = ChatHandler()
    captured: dict = {}

    async def fake_broadcast(payload, campaign_id):
        captured["payload"] = payload

    monkeypatch.setattr(handler, "broadcast_to_campaign", fake_broadcast)
    monkeypatch.setattr(handler, "send_to_recipients", AsyncMock())

    db = _FakeDB()
    await handler.handle(
        message={
            "type": "chat",
            "data": {"message": "hi", "recipients": [], "meta": "not-a-dict"},
        },
        websocket=SimpleNamespace(),
        campaign_id="7",
        user_id="user-dm",
        role="dm",
        db=db,
    )

    assert db.added[0].meta == {}
    assert captured["payload"]["data"]["meta"] == {}
