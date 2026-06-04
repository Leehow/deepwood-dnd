from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services.module_chat_usecase_service import create_direct_module_entity


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeDb:
    def __init__(self, results):
        self._results = iter(results)
        self.commit = AsyncMock()
        self.refresh = AsyncMock()
        self.flush = AsyncMock()

    async def execute(self, _stmt):
        return _ScalarResult(next(self._results))

    def add(self, _obj):
        return None


@pytest.mark.asyncio
async def test_create_direct_module_entity_returns_existing_npc_skip_response() -> None:
    db = _FakeDb([SimpleNamespace(id=11, name="老守卫")])

    result = await create_direct_module_entity(
        db=db,
        campaign=SimpleNamespace(current_map_url=None, dm_user_id="dm"),
        campaign_id=7,
        module_id="module-1",
        module=None,
        entity_type="npc",
        data={"name": "老守卫"},
        preset_monsters=[],
        preset_equipment={},
        parse_module_monster_description=AsyncMock(),
        generate_item_with_llm=AsyncMock(),
    )

    assert result == {
        "success": True,
        "id": 11,
        "name": "老守卫",
        "type": "npc",
        "skipped": True,
        "message": "怪物/NPC '老守卫' 已存在于资源库中",
    }
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_create_direct_module_entity_returns_existing_item_skip_response() -> None:
    db = _FakeDb([SimpleNamespace(id=21, name="治疗药水")])

    result = await create_direct_module_entity(
        db=db,
        campaign=SimpleNamespace(current_map_url=None, dm_user_id="dm"),
        campaign_id=9,
        module_id="module-2",
        module=None,
        entity_type="item",
        data={"name": "治疗药水"},
        preset_monsters=[],
        preset_equipment={},
        parse_module_monster_description=AsyncMock(),
        generate_item_with_llm=AsyncMock(),
    )

    assert result == {
        "success": True,
        "id": 21,
        "name": "治疗药水",
        "type": "item",
        "skipped": True,
        "message": "物品 '治疗药水' 已存在于资源库中",
    }
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_create_direct_module_entity_rejects_unsupported_type() -> None:
    with pytest.raises(ValueError, match="Unsupported direct module entity type"):
        await create_direct_module_entity(
            db=_FakeDb([]),
            campaign=SimpleNamespace(current_map_url=None, dm_user_id="dm"),
            campaign_id=1,
            module_id="module-3",
            module=None,
            entity_type="encounter",
            data={},
            preset_monsters=[],
            preset_equipment={},
            parse_module_monster_description=AsyncMock(),
            generate_item_with_llm=AsyncMock(),
        )
