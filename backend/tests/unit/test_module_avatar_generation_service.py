from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services import module_avatar_generation_service as avatar_generation_service


class _FakeSession:
    def __init__(self, entity):
        self.entity = entity
        self.commit = AsyncMock()

    async def get(self, _model, _entity_id):
        return self.entity


class _FakeSessionMaker:
    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.mark.asyncio
async def test_generate_module_monster_avatar_background_updates_entity_and_publishes(monkeypatch):
    monster = SimpleNamespace(avatar_url=None, avatar_url_large=None, has_avatar=False)
    session = _FakeSession(monster)
    monkeypatch.setattr(
        avatar_generation_service,
        "async_session_maker",
        lambda: _FakeSessionMaker(session),
    )
    monkeypatch.setattr(
        avatar_generation_service.avatar_service,
        "generate_avatar",
        AsyncMock(return_value=("/small.webp", "/large.webp")),
    )
    publish = AsyncMock()
    monkeypatch.setattr(
        avatar_generation_service.realtime_publisher,
        "publish_avatar_generated",
        publish,
    )

    await avatar_generation_service.generate_module_monster_avatar_background(
        monster_instance_id=5,
        campaign_id=7,
        name="守夜人",
        appearance="披着深蓝斗篷",
    )

    assert monster.avatar_url == "/small.webp"
    assert monster.avatar_url_large == "/large.webp"
    assert monster.has_avatar is True
    session.commit.assert_awaited_once()
    publish.assert_awaited_once_with(
        7,
        entity_type="npc",
        entity_id=5,
        avatar_url="/large.webp",
        has_avatar=True,
        name="守夜人",
    )


@pytest.mark.asyncio
async def test_generate_module_shop_avatar_background_returns_quietly_for_missing_entity(monkeypatch):
    session = _FakeSession(None)
    monkeypatch.setattr(
        avatar_generation_service,
        "async_session_maker",
        lambda: _FakeSessionMaker(session),
    )
    generate_avatar = AsyncMock()
    publish = AsyncMock()
    monkeypatch.setattr(avatar_generation_service.avatar_service, "generate_avatar", generate_avatar)
    monkeypatch.setattr(
        avatar_generation_service.realtime_publisher,
        "publish_avatar_generated",
        publish,
    )

    await avatar_generation_service.generate_module_shop_avatar_background(
        shop_id=8,
        campaign_id=9,
        name="铜灯杂货",
        appearance="门外挂着旧铜灯",
    )

    generate_avatar.assert_not_awaited()
    publish.assert_not_awaited()
