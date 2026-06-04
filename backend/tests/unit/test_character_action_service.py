from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.models.character import Character
from app.services.character_action_service import (
    restore_character_resource,
    set_character_resource,
    update_character_feature_uses,
)


class DummyExecuteResult:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows


class DummySession:
    def __init__(self, mapping=None, execute_rows=None):
        self.mapping = mapping or {}
        self.execute_rows = execute_rows or []
        self.committed = False
        self.refreshed = False

    async def get(self, model, ident):
        return self.mapping.get((model, ident))

    async def commit(self):
        self.committed = True

    async def refresh(self, _obj):
        self.refreshed = True

    async def execute(self, _query):
        return DummyExecuteResult(self.execute_rows)


@pytest.mark.asyncio
async def test_restore_character_resource_updates_current_uses(monkeypatch):
    character = SimpleNamespace(
        id=18,
        level=7,
        ability_scores={"charisma": 14, "wisdom": 12, "intelligence": 10},
        class_feature_uses={"channel_divinity_cleric": {"current": 0, "max": 2}},
    )
    db = DummySession({(Character, 18): character})

    monkeypatch.setattr(
        "app.services.character_action_service.class_resource_service.get_resource_definition",
        lambda resource_id: {"id": resource_id},
    )
    monkeypatch.setattr(
        "app.services.character_action_service.class_resource_service.resolve_resource_state_id",
        lambda resource_id: resource_id,
    )
    monkeypatch.setattr(
        "app.services.character_action_service.class_resource_service.calculate_resource_max",
        lambda *_args, **_kwargs: 2,
    )

    result = await restore_character_resource(
        db,
        character_id=18,
        resource_id="channel_divinity_cleric",
        amount=1,
    )

    assert result.current == 1
    assert result.max == 2
    assert character.class_feature_uses["channel_divinity_cleric"] == {"current": 1, "max": 2}
    assert db.committed is True


@pytest.mark.asyncio
async def test_set_character_resource_clamps_and_uses_shared_state(monkeypatch):
    character = SimpleNamespace(
        id=18,
        level=10,
        ability_scores={"charisma": 18, "wisdom": 12, "intelligence": 10},
        class_feature_uses={},
    )
    db = DummySession({(Character, 18): character})

    monkeypatch.setattr(
        "app.services.character_action_service.class_resource_service.get_resource_definition",
        lambda resource_id: {"id": resource_id},
    )
    monkeypatch.setattr(
        "app.services.character_action_service.class_resource_service.resolve_resource_state_id",
        lambda _resource_id: "sorcery_points",
    )
    monkeypatch.setattr(
        "app.services.character_action_service.class_resource_service.calculate_resource_max",
        lambda *_args, **_kwargs: 10,
    )

    result = await set_character_resource(
        db,
        character_id=18,
        resource_id="flexible_casting",
        value=99,
    )

    assert result.current == 10
    assert character.class_feature_uses["sorcery_points"] == {"current": 10, "max": 10}
    assert db.committed is True


@pytest.mark.asyncio
async def test_update_character_feature_uses_returns_campaign_ids():
    character = SimpleNamespace(
        id=18,
        class_feature_uses={"second_wind": {"current": 1, "max": 1}},
    )
    db = DummySession(
        {(Character, 18): character},
        execute_rows=[(7,), (12,)],
    )

    result = await update_character_feature_uses(
        db,
        character_id=18,
        feature_id="second_wind",
        current_uses=0,
        max_uses=1,
    )

    assert character.class_feature_uses["second_wind"] == {"current": 0, "max": 1}
    assert result.campaign_ids == [7, 12]
    assert db.committed is True
    assert db.refreshed is True
