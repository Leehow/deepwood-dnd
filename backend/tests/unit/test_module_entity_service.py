from types import SimpleNamespace

from app.services.module_entity_service import (
    build_encounter_creation_message,
    build_monster_token_payload,
    calculate_spiral_positions,
    create_item_from_data,
    derive_npc_avatar_appearance,
    extract_armor_class,
    extract_range,
    match_monster_from_module,
    search_monster_in_chapters,
    search_character_appearance_in_toc,
    split_combined_shop_items,
)


def test_search_character_appearance_in_toc_extracts_relevant_sentences() -> None:
    toc = [
        {
            "title": "酒馆",
            "content": "守夜人披着旧披风，灰色长发垂在肩头。这里还有许多杂谈。",
            "children": [],
        }
    ]

    result = search_character_appearance_in_toc("守夜人", toc)

    assert "披着旧披风" in result
    assert "灰色长发" in result


def test_derive_npc_avatar_appearance_prefers_toc_then_humanoid_fallback() -> None:
    toc = [
        {
            "title": "村口",
            "content": "艾琳身着蓝色斗篷，银白色眼睛在暮色里发亮。",
            "children": [],
        }
    ]

    toc_result = derive_npc_avatar_appearance(
        name="艾琳",
        creature_type="类人生物（精灵）",
        toc=toc,
    )
    fallback_result = derive_npc_avatar_appearance(
        name="托姆",
        creature_type="类人生物（矮人）",
    )

    assert "蓝色斗篷" in toc_result
    assert fallback_result == "托姆，一个矮人角色，D&D奇幻风格肖像"


def test_module_monster_matching_and_chapter_search_helpers() -> None:
    module_monsters = [
        {"name": "骷髅", "nameEn": "Skeleton"},
        {"name": "食尸鬼", "nameEn": "Ghoul"},
    ]
    chapters = [
        {
            "title": "墓穴入口",
            "content": "骷髅守卫在石门前徘徊，骨节摩擦发出细碎声响。" * 6,
            "children": [],
        }
    ]

    assert match_monster_from_module("Skeleton", module_monsters) == {"name": "骷髅", "nameEn": "Skeleton"}
    assert "墓穴入口" in search_monster_in_chapters("骷髅", chapters)


def test_split_combined_shop_items_splits_ammo_bundles() -> None:
    items = [{"name": "轻弩（含20箭）", "quantity": 2}, {"name": "火把", "quantity": 3}]

    result = split_combined_shop_items(items)

    assert result == [
        {"name": "轻弩", "quantity": 2},
        {"name": "箭矢", "quantity": 2, "price_gp": 1},
        {"name": "火把", "quantity": 3},
    ]


def test_build_monster_token_payload_preserves_canonical_fields() -> None:
    token = SimpleNamespace(
        id=9,
        campaign_id=3,
        character_id=None,
        monster_instance_id=14,
        item_data=None,
        item_quantity=None,
        shop_id=None,
        user_id="dm",
        map_url="maps/cave",
        position_x=11,
        position_y=7,
        token_size="2x2",
        instance_name="骸骨卫兵 #1",
        current_hp=18,
        faction="enemy",
    )
    monster = SimpleNamespace(
        name="骸骨卫兵",
        name_cn="骸骨卫兵",
        type="亡灵",
        size="中型",
        avatar_url="/avatars/skeleton.webp",
        avatar_url_large="/avatars/skeleton-large.webp",
        hit_points=18,
    )

    payload = build_monster_token_payload(token, monster)

    assert payload == {
        "id": 9,
        "campaign_id": 3,
        "character_id": None,
        "monster_instance_id": 14,
        "item_data": None,
        "item_quantity": None,
        "shop_id": None,
        "user_id": "dm",
        "map_url": "maps/cave",
        "position_x": 11,
        "position_y": 7,
        "token_size": "2x2",
        "instance_name": "骸骨卫兵 #1",
        "current_hp": 18,
        "monster_name": "骸骨卫兵",
        "monster_name_cn": "骸骨卫兵",
        "monster_type": "亡灵",
        "monster_size": "中型",
        "avatar": "/avatars/skeleton.webp",
        "avatar_large": "/avatars/skeleton-large.webp",
        "monster_avatar_url": "/avatars/skeleton.webp",
        "max_hp": 18,
        "faction": "enemy",
    }


def test_extract_equipment_helpers_and_create_item_from_data_merge_sources() -> None:
    preset = {
        "name": "Leather Armor",
        "nameEn": "Leather Armor",
        "category": "armor",
        "costCopper": 1000,
        "weight": 10,
        "description": "Simple leather armor",
        "acFormula": {"base": 11, "dexModifier": "max2"},
        "range": "80/320",
        "properties": ["light"],
        "strengthRequired": 0,
        "stealthDisadvantage": False,
    }

    assert extract_armor_class(preset) == {"base": 11, "dex_bonus": True, "max_dex_bonus": 2}
    assert extract_range(preset) == {"normal": 80, "long": 320}

    item_kwargs = create_item_from_data(
        9,
        {
            "name": "迅捷皮甲",
            "name_cn": "迅捷皮甲",
            "rarity": "uncommon",
            "magic_bonus": 1,
            "source_module": "module-9",
        },
        preset,
    )

    assert item_kwargs["campaign_id"] == 9
    assert item_kwargs["name"] == "Leather Armor"
    assert item_kwargs["name_cn"] == "迅捷皮甲"
    assert item_kwargs["cost"] == {"amount": 10.0, "unit": "gp"}
    assert item_kwargs["armor_class"] == {"base": 11, "dex_bonus": True, "max_dex_bonus": 2}
    assert item_kwargs["range"] == {"normal": 80, "long": 320}
    assert item_kwargs["magic_bonus"] == 1
    assert item_kwargs["is_custom"] is False


def test_build_encounter_creation_message_switches_by_map_presence() -> None:
    assert build_encounter_creation_message(3, True) == "已添加 3 个怪物到地图上"
    assert build_encounter_creation_message(2, False) == "已添加 2 个怪物到资源库"


def test_calculate_spiral_positions_spreads_from_center() -> None:
    positions = calculate_spiral_positions({"x": 10, "y": 10}, 5, spacing=2)

    assert positions == [
        {"x": 10, "y": 10},
        {"x": 12, "y": 10},
        {"x": 12, "y": 12},
        {"x": 10, "y": 12},
        {"x": 8, "y": 12},
    ]
