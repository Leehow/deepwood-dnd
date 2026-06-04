from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services.module_encounter_usecase_service import (
    build_marker_position_lookup,
    create_module_encounter,
    execute_structured_map_encounter,
    normalize_encounter_monsters,
    resolve_area_base_position,
)


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeDb:
    def __init__(self, execute_results):
        self._execute_results = iter(execute_results)
        self.commit = AsyncMock()
        self.flush = AsyncMock()
        self.added = []
        self._refresh_id = 100

    async def execute(self, _stmt):
        return _ScalarResult(next(self._execute_results))

    def add(self, obj):
        self.added.append(obj)

    async def refresh(self, obj):
        if getattr(obj, "id", None) is None:
            obj.id = self._refresh_id
            self._refresh_id += 1


def test_normalize_encounter_monsters_supports_boss_and_string_entries() -> None:
    result = normalize_encounter_monsters(
        [],
        boss={"name": "骷髅领主", "count": 99},
        minions=["骷髅", {"name": "食尸鬼", "count": 2}],
    )

    assert result == [
        {"name": "骷髅领主", "count": 1},
        {"name": "骷髅", "count": 1},
        {"name": "食尸鬼", "count": 2},
    ]


def test_build_marker_position_lookup_and_area_resolution_handle_fuzzy_match() -> None:
    markers = [
        {"label": "大厅", "x": "25%", "y": "50%"},
        {"label": "坏点", "x": "oops", "y": "30%"},
    ]

    lookup = build_marker_position_lookup(markers, grid_size=40)
    matched_position = resolve_area_base_position(
        area_name="中央大厅",
        area_index=0,
        viewport_center_x=20,
        viewport_center_y=20,
        area_positions=lookup,
    )
    fallback_position = resolve_area_base_position(
        area_name="未知区域",
        area_index=4,
        viewport_center_x=20,
        viewport_center_y=20,
        area_positions=lookup,
    )

    assert lookup == {"大厅": (10, 20)}
    assert matched_position == (10, 20)
    assert fallback_position == (20, 24)


@pytest.mark.asyncio
async def test_create_module_encounter_reuses_existing_campaign_monster(monkeypatch) -> None:
    db = _FakeDb(
        [
            SimpleNamespace(
                id=11,
                name="骷髅",
                name_cn="骷髅",
                size="中型",
                type="亡灵",
                alignment="守序邪恶",
                challenge_rating="1/4",
                hit_points=13,
                hit_dice="2d8+4",
                armor_class=13,
                ability_scores={"str": 10},
                speeds={"walk": 30},
                monster_data={},
                monster_id="skeleton",
                token_size="1x1",
                current_hp=13,
                inventory=[],
                currency={},
            )
        ]
    )

    def _discard_task(coro):
        coro.close()
        return None

    monkeypatch.setattr(
        "app.services.module_encounter_usecase_service.asyncio.create_task",
        _discard_task,
    )

    result = await create_module_encounter(
        db=db,
        campaign=SimpleNamespace(current_map_url=None, dm_user_id="dm"),
        campaign_id=7,
        module_id="module-encounter",
        module=None,
        data={"name": "墓穴入口", "monsters": [{"name": "骷髅", "count": 1}]},
        preset_monsters=[],
        parse_module_monster_description=AsyncMock(),
    )

    assert result["success"] is True
    assert result["type"] == "encounter"
    assert result["token_ids"] == []
    assert result["monsters"][0]["matched_source"] == "existing_campaign"
    assert result["monsters"][0]["name"] == "骷髅"
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_execute_structured_map_encounter_creates_tokens_and_reuses_created_monster(
    monkeypatch,
) -> None:
    created_monster = SimpleNamespace(
        id=44,
        name="地精",
        name_cn="地精",
        type="类人生物",
        size="小型",
        avatar_url=None,
        avatar_url_large=None,
        hit_points=10,
    )
    db = _FakeDb([None, created_monster, created_monster])

    create_from_raw_data = AsyncMock(return_value=created_monster)
    publish_token_placed = AsyncMock()
    monkeypatch.setattr(
        "app.services.module_encounter_usecase_service.EntityCreationService.create_from_raw_data",
        create_from_raw_data,
    )
    monkeypatch.setattr(
        "app.services.module_encounter_usecase_service.realtime_publisher.publish_token_placed",
        publish_token_placed,
    )

    result = await execute_structured_map_encounter(
        db=db,
        campaign_id=9,
        module_id="module-plan",
        module=SimpleNamespace(monsters=[]),
        map_url="maps/cave",
        areas=[
            {
                "name": "大厅",
                "monsters": [{"name": "地精", "count": 2}],
                "loot": {"currency": {"gp": 5}, "items": ["短剑"]},
            }
        ],
        viewport_center_x=20,
        viewport_center_y=20,
        preset_monsters=[],
        markers=[{"label": "大厅", "x": "50%", "y": "25%"}],
    )

    assert result["success"] is True
    assert result["created_count"] == 2
    assert [entity["x"] for entity in result["entities"]] == [19, 20]
    assert [entity["y"] for entity in result["entities"]] == [10, 10]
    create_from_raw_data.assert_awaited_once()
    assert publish_token_placed.await_count == 2
