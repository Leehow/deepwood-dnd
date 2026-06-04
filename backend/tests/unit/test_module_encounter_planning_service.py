from unittest.mock import AsyncMock

import pytest

from app.services.module_encounter_planning_service import (
    build_modify_assistant_content,
    build_modify_system_prompt,
    build_plan_assistant_content,
    build_plan_system_prompt,
    build_player_info_text,
    build_source_instructions,
    collect_module_encounters,
    persist_encounter_plan_message,
)


class _FakeDb:
    def __init__(self):
        self.commit = AsyncMock()
        self.added = []

    def add(self, obj):
        self.added.append(obj)

    async def refresh(self, obj):
        obj.id = 501


def test_collect_module_encounters_and_source_instructions_cover_modes() -> None:
    encounters = collect_module_encounters(
        [
            {"title": "第一章", "encounters": ["地精伏击"]},
            {"title": "第二章", "encounters": [{"name": "墓穴守卫", "description": "亡灵巡逻"}]},
            "ignored",
        ]
    )

    module_only = build_source_instructions("module_only", encounters)
    module_extend = build_source_instructions("module_extend", encounters)
    ai_free = build_source_instructions("ai_free", encounters)

    assert encounters == ["地精伏击", {"name": "墓穴守卫", "description": "亡灵巡逻"}]
    assert "只能使用模组中已定义的遭遇配置" in module_only
    assert "墓穴守卫" in module_extend
    assert "AI自由创造" in ai_free


def test_plan_prompt_and_assistant_content_include_player_and_density_context() -> None:
    player_info = {
        "players": [{"name": "艾琳", "class": "wizard", "level": 4}],
        "count": 1,
        "average_level": 4,
    }

    prompt = build_plan_system_prompt(
        module_title="失落矿坑",
        current_chapter="废弃神殿",
        context="这里有一群地精守卫着祭坛。",
        player_info=player_info,
        density="dense",
        source_mode="module_extend",
        module_encounters=["祭坛守卫"],
        preset_names=["地精", "熊地精"],
        module_monster_names=["地精萨满"],
    )
    content = build_plan_assistant_content("### 大厅\n- **怪物**: 地精 ×3", player_info)

    assert "废弃神殿" in prompt
    assert "DM选择的密度: 密集" in prompt
    assert "艾琳(wizard Lv4)" in prompt
    assert "祭坛守卫" in prompt
    assert "平均等级 4" in content


def test_modify_prompt_and_content_preserve_requested_change() -> None:
    prompt = build_modify_system_prompt(
        current_plan="### 大厅\n- **怪物**: 地精 ×3",
        modification="把大厅改成熊地精首领加两名地精",
        preset_names=["地精", "熊地精首领"],
        module_monster_names=[],
    )
    content = build_modify_assistant_content(
        "### 大厅\n- **怪物**: 熊地精首领 ×1, 地精 ×2",
        "把大厅改成熊地精首领加两名地精",
    )

    assert "熊地精首领" in prompt
    assert "修改后的完整规划" in prompt
    assert "修改内容" in content
    assert "熊地精首领 ×1" in content


def test_build_player_info_text_falls_back_when_no_players() -> None:
    assert "未检测到已选角色" in build_player_info_text({"players": []})


@pytest.mark.asyncio
async def test_persist_encounter_plan_message_saves_canonical_metadata() -> None:
    db = _FakeDb()

    message = await persist_encounter_plan_message(
        db=db,
        module_id="module-1",
        user_id="user-1",
        content="## 🗺️ 地图遭遇规划\n\n### 大厅",
        plan_text="### 大厅",
        map_url="maps/cave",
    )

    assert message.id == 501
    assert len(db.added) == 1
    assert db.added[0].analyzed_entities == {
        "type": "encounter_plan",
        "plan_text": "### 大厅",
        "map_url": "maps/cave",
    }
    db.commit.assert_awaited_once()
