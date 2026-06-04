from unittest.mock import AsyncMock

import pytest

from app.services.realtime_publisher import realtime_publisher
from app.services.websocket_manager import manager


@pytest.mark.asyncio
async def test_publish_token_hp_updated_uses_canonical_message_shape(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_token_hp_updated(
        99,
        token_id=7,
        current_hp=12,
        max_hp=18,
        temp_hp=None,
        character_id=3,
    )

    args = broadcast.await_args.args
    assert args[1] == "99"
    assert args[0] == {
        "type": "token_hp_update",
        "data": {
            "token_id": 7,
            "current_hp": 12,
            "max_hp": 18,
            "temp_hp": None,
            "character_id": 3,
        },
        "token_id": 7,
        "current_hp": 12,
        "max_hp": 18,
        "temp_hp": None,
        "character_id": 3,
    }


@pytest.mark.asyncio
async def test_publish_token_effects_updated_includes_compatibility_data(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_token_effects_updated(
        21,
        token_id=5,
        active_effects=[{"id": "grappled"}],
        reason="contest:grapple",
        character_id=9,
        character_status_effects={"active_conditions": [{"condition": "grappled"}]},
    )

    args = broadcast.await_args.args
    assert args[1] == "21"
    assert args[0] == {
        "type": "token_effects_update",
        "data": {
            "token_id": 5,
            "active_effects": [{"id": "grappled"}],
            "reason": "contest:grapple",
            "character_id": 9,
            "character_status_effects": {"active_conditions": [{"condition": "grappled"}]},
        },
        "token_id": 5,
        "active_effects": [{"id": "grappled"}],
        "reason": "contest:grapple",
        "character_id": 9,
        "character_status_effects": {"active_conditions": [{"condition": "grappled"}]},
    }


@pytest.mark.asyncio
async def test_publish_token_active_effects_updated_includes_compatibility_data(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_token_active_effects_updated(
        22,
        token_id=8,
        active_effects=[{"id": "restrained"}],
        monster_instance_id=14,
        monster_status_effects={"conditions": [{"condition": "restrained"}]},
    )

    args = broadcast.await_args.args
    assert args[1] == "22"
    assert args[0] == {
        "type": "token_active_effects_update",
        "data": {
            "token_id": 8,
            "active_effects": [{"id": "restrained"}],
            "monster_instance_id": 14,
            "monster_status_effects": {"conditions": [{"condition": "restrained"}]},
        },
        "token_id": 8,
        "active_effects": [{"id": "restrained"}],
        "monster_instance_id": 14,
        "monster_status_effects": {"conditions": [{"condition": "restrained"}]},
    }


@pytest.mark.asyncio
async def test_publish_trade_updated_targets_specific_recipients(monkeypatch):
    send_to_users = AsyncMock()
    monkeypatch.setattr(manager, "send_to_users", send_to_users)

    await realtime_publisher.publish_trade_updated(
        "campaign-1",
        data={"trade_id": "t-1", "offer": {"items": []}},
        recipients=["user-a"],
    )

    args = send_to_users.await_args.args
    assert args[1] == "campaign-1"
    assert args[2] == ["user-a"]
    assert args[0]["type"] == "trade_update"


@pytest.mark.asyncio
async def test_publish_kicked_targets_specific_recipients(monkeypatch):
    send_to_users = AsyncMock()
    monkeypatch.setattr(manager, "send_to_users", send_to_users)

    await realtime_publisher.publish_kicked(
        55,
        recipients=["user-a"],
        message="kicked message",
    )

    args = send_to_users.await_args.args
    assert args[1] == "55"
    assert args[2] == ["user-a"]
    assert args[0] == {
        "type": "kicked",
        "data": {
            "campaign_id": "55",
            "message": "kicked message",
        },
    }


@pytest.mark.asyncio
async def test_publish_character_status_effects_updated_preserves_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_character_status_effects_updated(
        30,
        character_id=12,
        status_effects={"active_conditions": [{"condition": "poisoned"}]},
    )

    args = broadcast.await_args.args
    assert args[1] == "30"
    assert args[0] == {
        "type": "character_status_effects_update",
        "character_id": 12,
        "status_effects": {"active_conditions": [{"condition": "poisoned"}]},
    }


@pytest.mark.asyncio
async def test_publish_character_experience_updated_preserves_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_character_experience_updated(
        31,
        character_id=4,
        experience_points=9300,
    )

    args = broadcast.await_args.args
    assert args[1] == "31"
    assert args[0] == {
        "type": "character_xp_update",
        "character_id": 4,
        "experience_points": 9300,
    }


@pytest.mark.asyncio
async def test_publish_character_feature_uses_updated_preserves_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_character_feature_uses_updated(
        32,
        character_id=5,
        feature_id="rage",
        current_uses=1,
        max_uses=3,
    )

    args = broadcast.await_args.args
    assert args[1] == "32"
    assert args[0] == {
        "type": "character_feature_uses_updated",
        "character_id": 5,
        "feature_id": "rage",
        "current_uses": 1,
        "max_uses": 3,
    }


@pytest.mark.asyncio
async def test_publish_character_avatar_updated_preserves_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_character_avatar_updated(
        33,
        character_id=8,
        avatar="/small.webp",
        avatar_large="/large.webp",
    )

    args = broadcast.await_args.args
    assert args[1] == "33"
    assert args[0] == {
        "type": "character_avatar_updated",
        "character_id": 8,
        "avatar": "/small.webp",
        "avatar_large": "/large.webp",
    }


@pytest.mark.asyncio
async def test_publish_character_level_event_preserves_nested_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_character_level_event(
        34,
        event_type="character_level_up",
        data={"character_id": 7, "new_level": 4},
    )

    args = broadcast.await_args.args
    assert args[1] == "34"
    assert args[0] == {
        "type": "character_level_up",
        "campaign_id": "34",
        "data": {"character_id": 7, "new_level": 4},
    }


@pytest.mark.asyncio
async def test_publish_character_created_preserves_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_character_created(
        39,
        character_id=22,
        character_name="米拉",
        user_id="user-22",
        level=6,
        class_id="wizard",
    )

    args = broadcast.await_args.args
    assert args[1] == "39"
    assert args[0] == {
        "type": "character_created",
        "character_id": 22,
        "character_name": "米拉",
        "user_id": "user-22",
        "level": 6,
        "class_id": "wizard",
    }


@pytest.mark.asyncio
async def test_publish_character_selected_preserves_nested_and_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_character_selected(
        54,
        user_id="user-22",
        character_id=22,
        character_name="米拉",
    )

    args = broadcast.await_args.args
    assert args[1] == "54"
    assert args[0] == {
        "type": "character_selected",
        "data": {
            "user_id": "user-22",
            "character_id": 22,
            "character_name": "米拉",
        },
        "user_id": "user-22",
        "character_id": 22,
        "character_name": "米拉",
    }


@pytest.mark.asyncio
async def test_publish_generation_progress_preserves_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_generation_progress(
        40,
        event_type="ai_generate_progress",
        stage=2,
        total_stages=6,
        stage_name="技能选择",
        detail="正在处理",
    )

    args = broadcast.await_args.args
    assert args[1] == "40"
    assert args[0] == {
        "type": "ai_generate_progress",
        "stage": 2,
        "total_stages": 6,
        "stage_name": "技能选择",
        "detail": "正在处理",
    }


@pytest.mark.asyncio
async def test_publish_virtual_player_event_preserves_nested_and_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_virtual_player_event(
        56,
        event_type="virtual_player_added",
        data={"member_id": 7, "user_id": "vp_123", "display_name": "Ghost"},
    )

    args = broadcast.await_args.args
    assert args[1] == "56"
    assert args[0] == {
        "type": "virtual_player_added",
        "data": {"member_id": 7, "user_id": "vp_123", "display_name": "Ghost"},
        "member_id": 7,
        "user_id": "vp_123",
        "display_name": "Ghost",
    }


@pytest.mark.asyncio
async def test_publish_spell_slots_updated_supports_custom_event_type(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_spell_slots_updated(
        35,
        character_id=9,
        spell_slots_state={"slots": [0, 4, 2]},
        event_type="character_spell_slots_update",
    )

    args = broadcast.await_args.args
    assert args[1] == "35"
    assert args[0] == {
        "type": "character_spell_slots_update",
        "character_id": 9,
        "spell_slots_state": {"slots": [0, 4, 2]},
    }


@pytest.mark.asyncio
async def test_publish_resource_updated_preserves_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_resource_updated(
        36,
        character_id=11,
        resource_id="ki_points",
        current=2,
        max=5,
    )

    args = broadcast.await_args.args
    assert args[1] == "36"
    assert args[0] == {
        "type": "resource_update",
        "character_id": 11,
        "resource_id": "ki_points",
        "current": 2,
        "max": 5,
    }


@pytest.mark.asyncio
async def test_publish_resource_use_preserves_nested_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_resource_use(
        37,
        data={"id": 90, "resource_id": "lay_on_hands", "current": 15},
    )

    args = broadcast.await_args.args
    assert args[1] == "37"
    assert args[0] == {
        "type": "resource_use",
        "data": {"id": 90, "resource_id": "lay_on_hands", "current": 15},
    }


@pytest.mark.asyncio
async def test_publish_spell_preparation_updated_preserves_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_spell_preparation_updated(
        38,
        character_id=14,
        prepared_spells=["magic_missile", "shield"],
        prepared_count=2,
        max_prepared=5,
    )

    args = broadcast.await_args.args
    assert args[1] == "38"
    assert args[0] == {
        "type": "spell_preparation_update",
        "character_id": 14,
        "prepared_spells": ["magic_missile", "shield"],
        "prepared_count": 2,
        "max_prepared": 5,
    }


@pytest.mark.asyncio
async def test_publish_combat_storage_deleted_preserves_existing_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_combat_storage_updated(
        5,
        event_type="storage_deleted",
        object_type="combat",
        object_id="combat-5",
    )

    args = broadcast.await_args.args
    assert args[1] == "5"
    assert args[0] == {
        "type": "storage_deleted",
        "data": {
            "object_type": "combat",
            "object_id": "combat-5",
        },
        "object_type": "combat",
        "object_id": "combat-5",
    }


@pytest.mark.asyncio
async def test_publish_combat_storage_updated_preserves_top_level_object_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_combat_storage_updated(
        6,
        event_type="storage_updated",
        storage_object={"id": 1, "object_type": "combat", "data": {"round": 2}},
    )

    args = broadcast.await_args.args
    assert args[1] == "6"
    assert args[0] == {
        "type": "storage_updated",
        "data": {
            "object": {"id": 1, "object_type": "combat", "data": {"round": 2}},
        },
        "object": {"id": 1, "object_type": "combat", "data": {"round": 2}},
    }


@pytest.mark.asyncio
async def test_publish_transformation_updated_preserves_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_transformation_updated(
        8,
        token_id=42,
        transformation_data=None,
        token_size="2x2",
    )

    args = broadcast.await_args.args
    assert args[1] == "8"
    assert args[0] == {
        "type": "transformation_update",
        "token_id": 42,
        "transformation_data": None,
        "token_size": "2x2",
    }


@pytest.mark.asyncio
async def test_publish_transformation_updated_supports_optional_reason(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_transformation_updated(
        8,
        token_id=42,
        transformation_data=None,
        active_effects=[{"id": "enlarge_reduce_buff"}],
        reason="damage",
    )

    args = broadcast.await_args.args
    assert args[1] == "8"
    assert args[0] == {
        "type": "transformation_update",
        "token_id": 42,
        "transformation_data": None,
        "active_effects": [{"id": "enlarge_reduce_buff"}],
        "reason": "damage",
    }


@pytest.mark.asyncio
async def test_publish_token_concentration_updated_preserves_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_token_concentration_updated(
        9,
        token_id=18,
        concentration_spell={"spell_id": "hold-person"},
    )

    args = broadcast.await_args.args
    assert args[1] == "9"
    assert args[0] == {
        "type": "token_concentration_update",
        "token_id": 18,
        "concentration_spell": {"spell_id": "hold-person"},
    }


@pytest.mark.asyncio
async def test_publish_token_concentration_updated_supports_optional_break_metadata(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_token_concentration_updated(
        9,
        token_id=18,
        concentration_spell=None,
        reason="damage",
        broken_spell={"spell_id": "fly"},
        active_effects=[{"id": "rage"}],
        temp_hp=4,
        effects_removed_from=[3, 5],
    )

    args = broadcast.await_args.args
    assert args[1] == "9"
    assert args[0] == {
        "type": "token_concentration_update",
        "token_id": 18,
        "concentration_spell": None,
        "reason": "damage",
        "broken_spell": {"spell_id": "fly"},
        "active_effects": [{"id": "rage"}],
        "temp_hp": 4,
        "effects_removed_from": [3, 5],
    }


@pytest.mark.asyncio
async def test_publish_token_updated_preserves_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_token_updated(
        10,
        token={"id": 4, "faction": "ally"},
    )

    args = broadcast.await_args.args
    assert args[1] == "10"
    assert args[0] == {
        "type": "token_update",
        "token": {"id": 4, "faction": "ally"},
    }


@pytest.mark.asyncio
async def test_publish_token_moved_preserves_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_token_moved(
        11,
        token_id=6,
        position_x=120,
        position_y=340,
    )

    args = broadcast.await_args.args
    assert args[1] == "11"
    assert args[0] == {
        "type": "token_move",
        "token_id": 6,
        "position": {"x": 120, "y": 340},
    }


@pytest.mark.asyncio
async def test_publish_token_size_updated_preserves_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_token_size_updated(
        24,
        token_id=6,
        token_size="2x2",
    )

    args = broadcast.await_args.args
    assert args[1] == "24"
    assert args[0] == {
        "type": "token_size_update",
        "token_id": 6,
        "token_size": "2x2",
    }


@pytest.mark.asyncio
async def test_publish_token_placed_preserves_nested_and_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_token_placed(
        41,
        token={"id": 3, "campaign_id": 41, "instance_name": "狼"},
    )

    args = broadcast.await_args.args
    assert args[1] == "41"
    assert args[0] == {
        "type": "token_placed",
        "data": {"token": {"id": 3, "campaign_id": 41, "instance_name": "狼"}},
        "token": {"id": 3, "campaign_id": 41, "instance_name": "狼"},
    }


@pytest.mark.asyncio
async def test_publish_map_token_removed_preserves_nested_and_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_map_token_removed(
        44,
        token_id=99,
    )

    args = broadcast.await_args.args
    assert args[1] == "44"
    assert args[0] == {
        "type": "token_removed",
        "data": {"token_id": 99},
        "token_id": 99,
    }


@pytest.mark.asyncio
async def test_publish_concentration_check_result_preserves_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_concentration_check_result(
        25,
        data={"token_id": 9, "needed": True, "success": False, "dc": 10},
    )

    args = broadcast.await_args.args
    assert args[1] == "25"
    assert args[0] == {
        "type": "concentration_check_result",
        "token_id": 9,
        "needed": True,
        "success": False,
        "dc": 10,
    }


@pytest.mark.asyncio
async def test_publish_chat_message_preserves_existing_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_chat_message(
        13,
        chat_id=7,
        user_id="user-1",
        role="player",
        message="combat log",
        message_type="combat",
        recipients=[],
        is_private=False,
        meta={"combat_type": "attack"},
        timestamp=123456789,
    )

    args = broadcast.await_args.args
    assert args[1] == "13"
    assert args[0] == {
        "type": "chat",
        "id": 7,
        "user_id": "user-1",
        "role": "player",
        "message": "combat log",
        "message_type": "combat",
        "recipients": [],
        "is_private": False,
        "meta": {"combat_type": "attack"},
        "timestamp": 123456789,
    }


@pytest.mark.asyncio
async def test_publish_consumable_use_preserves_nested_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_consumable_use(
        51,
        data={
            "id": 18,
            "user_id": "user-9",
            "character_name": "Lia",
            "item_name": "Healing Potion",
            "result_text": "恢复 7 点生命",
        },
    )

    args = broadcast.await_args.args
    assert args[1] == "51"
    assert args[0] == {
        "type": "consumable_use",
        "data": {
            "id": 18,
            "user_id": "user-9",
            "character_name": "Lia",
            "item_name": "Healing Potion",
            "result_text": "恢复 7 点生命",
        },
    }


@pytest.mark.asyncio
async def test_publish_chat_edit_delete_clear_preserve_contracts(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_chat_edit(
        52,
        message_id=3,
        content="edited",
        timestamp=111,
    )
    await realtime_publisher.publish_chat_delete(
        52,
        message_id=3,
        timestamp=222,
    )
    await realtime_publisher.publish_chat_clear(
        52,
        preserve_ai=True,
        timestamp=333,
    )

    first = broadcast.await_args_list[0].args
    second = broadcast.await_args_list[1].args
    third = broadcast.await_args_list[2].args
    assert first[0] == {
        "type": "chat_edit",
        "data": {
            "id": 3,
            "content": "edited",
            "timestamp": 111,
        },
        "id": 3,
        "content": "edited",
        "timestamp": 111,
    }
    assert second[0] == {
        "type": "chat_delete",
        "data": {
            "id": 3,
            "timestamp": 222,
        },
        "id": 3,
        "timestamp": 222,
    }
    assert third[0] == {
        "type": "chat_clear",
        "data": {
            "preserve_ai": True,
            "timestamp": 333,
        },
        "preserve_ai": True,
        "timestamp": 333,
    }


@pytest.mark.asyncio
async def test_publish_tts_events_preserve_nested_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_tts_generating(
        57,
        message_id=88,
    )
    await realtime_publisher.publish_tts_ready(
        57,
        message_id=88,
        audio_url="https://example.com/audio.wav",
        format="wav",
    )

    first = broadcast.await_args_list[0].args
    second = broadcast.await_args_list[1].args
    assert first[0] == {
        "type": "tts_generating",
        "data": {
            "message_id": 88,
        },
    }
    assert second[0] == {
        "type": "tts_ready",
        "data": {
            "message_id": 88,
            "audio_url": "https://example.com/audio.wav",
            "format": "wav",
        },
    }


@pytest.mark.asyncio
async def test_publish_character_equipment_updated_preserves_nested_and_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_character_equipment_updated(
        45,
        character_id=12,
        equipment=[{"id": "wand", "quantity": 1}],
        currency={"gp": 5},
        reason="partial_update",
    )

    args = broadcast.await_args.args
    assert args[1] == "45"
    assert args[0] == {
        "type": "character_equipment_updated",
        "data": {
            "character_id": 12,
            "equipment": [{"id": "wand", "quantity": 1}],
            "currency": {"gp": 5},
            "reason": "partial_update",
        },
        "character_id": 12,
        "equipment": [{"id": "wand", "quantity": 1}],
        "currency": {"gp": 5},
        "reason": "partial_update",
    }


@pytest.mark.asyncio
async def test_publish_spell_cast_result_preserves_nested_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_spell_cast_result(
        46,
        data={"spell_name": "Bless", "affected_token_ids": [1, 2]},
    )

    args = broadcast.await_args.args
    assert args[1] == "46"
    assert args[0] == {
        "type": "spell_cast_result",
        "data": {"spell_name": "Bless", "affected_token_ids": [1, 2]},
    }


@pytest.mark.asyncio
async def test_publish_token_casting_updated_preserves_nested_and_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_token_casting_updated(
        47,
        token_id=5,
        casting_in_progress={"spell_id": "teleportation_circle"},
        reason="started",
    )

    args = broadcast.await_args.args
    assert args[1] == "47"
    assert args[0] == {
        "type": "token_casting_update",
        "data": {
            "token_id": 5,
            "casting_in_progress": {"spell_id": "teleportation_circle"},
            "reason": "started",
        },
        "token_id": 5,
        "casting_in_progress": {"spell_id": "teleportation_circle"},
        "reason": "started",
    }


@pytest.mark.asyncio
async def test_publish_token_casting_interrupted_preserves_nested_and_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_token_casting_interrupted(
        48,
        token_id=5,
        casting_in_progress=None,
        broken_cast={"spell_id": "teleportation_circle"},
        reason="cancelled",
    )

    args = broadcast.await_args.args
    assert args[1] == "48"
    assert args[0] == {
        "type": "token_casting_interrupted",
        "data": {
            "token_id": 5,
            "casting_in_progress": None,
            "broken_cast": {"spell_id": "teleportation_circle"},
            "reason": "cancelled",
        },
        "token_id": 5,
        "casting_in_progress": None,
        "broken_cast": {"spell_id": "teleportation_circle"},
        "reason": "cancelled",
    }


@pytest.mark.asyncio
async def test_publish_token_casting_completed_preserves_nested_and_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_token_casting_completed(
        49,
        token_id=5,
        spell_id="teleportation_circle",
        spell_name="Teleportation Circle",
        result={"success": True},
    )

    args = broadcast.await_args.args
    assert args[1] == "49"
    assert args[0] == {
        "type": "token_casting_completed",
        "data": {
            "token_id": 5,
            "spell_id": "teleportation_circle",
            "spell_name": "Teleportation Circle",
            "result": {"success": True},
        },
        "token_id": 5,
        "spell_id": "teleportation_circle",
        "spell_name": "Teleportation Circle",
        "result": {"success": True},
    }


@pytest.mark.asyncio
async def test_publish_combat_narrative_updated_preserves_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_combat_narrative_updated(
        12,
        chat_message_id=19,
        narrative="刀光一闪",
        content="原文\n_刀光一闪_",
    )

    args = broadcast.await_args.args
    assert args[1] == "12"
    assert args[0] == {
        "type": "combat_narrative_update",
        "chat_message_id": 19,
        "narrative": "刀光一闪",
        "content": "原文\n_刀光一闪_",
    }


@pytest.mark.asyncio
async def test_publish_combat_attack_result_preserves_existing_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_combat_attack_result(
        14,
        attacker_token_id=1,
        target_token_id=2,
        target_monster_instance_id=3,
        xp_value=200,
        result={"hit": True},
        auto_apply=True,
        message="attack message",
    )

    args = broadcast.await_args.args
    assert args[1] == "14"
    assert args[0] == {
        "type": "combat_attack_result",
        "data": {
            "attacker_token_id": 1,
            "target_token_id": 2,
            "target_monster_instance_id": 3,
            "xp_value": 200,
            "result": {"hit": True},
            "auto_apply": True,
            "message": "attack message",
        },
    }


@pytest.mark.asyncio
async def test_publish_combat_reaction_used_includes_compatibility_data(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_combat_reaction_used(
        15,
        reactor_token_id=9,
        reaction_id="shield_spell",
    )

    args = broadcast.await_args.args
    assert args[1] == "15"
    assert args[0] == {
        "type": "combat_reaction_used",
        "data": {
            "reactor_token_id": 9,
            "reaction_id": "shield_spell",
        },
        "reactor_token_id": 9,
        "reaction_id": "shield_spell",
    }


@pytest.mark.asyncio
async def test_publish_death_save_updated_includes_compatibility_data(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_death_save_updated(
        16,
        token_id=4,
        roll=18,
        death_saves={"successes": 2, "failures": 0, "stabilized": False},
        revived=False,
        dead=False,
        message="death save message",
    )

    args = broadcast.await_args.args
    assert args[1] == "16"
    assert args[0] == {
        "type": "death_save_update",
        "data": {
            "token_id": 4,
            "roll": 18,
            "death_saves": {"successes": 2, "failures": 0, "stabilized": False},
            "revived": False,
            "dead": False,
            "message": "death save message",
        },
        "token_id": 4,
        "roll": 18,
        "death_saves": {"successes": 2, "failures": 0, "stabilized": False},
        "revived": False,
        "dead": False,
        "message": "death save message",
    }


@pytest.mark.asyncio
async def test_publish_combat_spell_result_preserves_existing_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_combat_spell_result(
        17,
        caster_token_id=3,
        target_token_id=4,
        spell_id="guiding_bolt",
        result={"hit": True, "damage_dealt": 14},
        auto_apply=True,
    )

    args = broadcast.await_args.args
    assert args[1] == "17"
    assert args[0] == {
        "type": "combat_spell_result",
        "data": {
            "caster_token_id": 3,
            "target_token_id": 4,
            "spell_id": "guiding_bolt",
            "result": {"hit": True, "damage_dealt": 14},
            "auto_apply": True,
        },
    }


@pytest.mark.asyncio
async def test_publish_area_spell_result_preserves_existing_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_area_spell_result(
        18,
        event_type="combat_area_spell_result",
        data={"spell_id": "fireball", "auto_apply": True},
    )

    args = broadcast.await_args.args
    assert args[1] == "18"
    assert args[0] == {
        "type": "combat_area_spell_result",
        "data": {"spell_id": "fireball", "auto_apply": True},
    }


@pytest.mark.asyncio
async def test_publish_spell_result_preserves_existing_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_spell_result(
        20,
        data={"spell_name": "Magic Missile", "total_damage": 11},
    )

    args = broadcast.await_args.args
    assert args[1] == "20"
    assert args[0] == {
        "type": "spell_result",
        "data": {"spell_name": "Magic Missile", "total_damage": 11},
    }


@pytest.mark.asyncio
async def test_publish_token_effect_added_includes_compatibility_data(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_token_effect_added(
        19,
        token_id=6,
        effect={"id": "hold_person_paralyzed", "name": "麻痹"},
        target_name="Cultist",
        spell_name="Hold Person",
    )

    args = broadcast.await_args.args
    assert args[1] == "19"
    assert args[0] == {
        "type": "token_effect_added",
        "data": {
            "token_id": 6,
            "effect": {"id": "hold_person_paralyzed", "name": "麻痹"},
            "target_name": "Cultist",
            "spell_name": "Hold Person",
        },
        "token_id": 6,
        "effect": {"id": "hold_person_paralyzed", "name": "麻痹"},
        "target_name": "Cultist",
        "spell_name": "Hold Person",
    }


@pytest.mark.asyncio
async def test_publish_token_disguise_updated_preserves_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_token_disguise_updated(
        26,
        token_id=11,
        disguise_data={"spell_id": "disguise_self"},
        active_effects=[{"id": "spell_buff_disguise_self"}],
    )

    args = broadcast.await_args.args
    assert args[1] == "26"
    assert args[0] == {
        "type": "token_disguise_update",
        "token_id": 11,
        "disguise_data": {"spell_id": "disguise_self"},
        "active_effects": [{"id": "spell_buff_disguise_self"}],
    }


@pytest.mark.asyncio
async def test_publish_effect_expired_preserves_nested_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_effect_expired(
        27,
        token_id=15,
        effect_name="Bless",
    )

    args = broadcast.await_args.args
    assert args[1] == "27"
    assert args[0] == {
        "type": "effect_expired",
        "data": {
            "token_id": 15,
            "effect_name": "Bless",
        },
    }


@pytest.mark.asyncio
async def test_publish_loot_bag_events_preserve_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_loot_bag_created(
        28,
        token={"id": 5, "instance_name": "战利品袋"},
        source_name="Goblin",
    )
    await realtime_publisher.publish_loot_bag_looted(
        28,
        token_id=5,
        character_id=9,
        character_name="Aria",
        items_taken=[{"name": "Potion"}],
        currency_taken={"gp": 12},
        bag_empty=False,
    )
    await realtime_publisher.publish_loot_bag_removed(
        28,
        token_id=5,
    )

    first = broadcast.await_args_list[0].args
    second = broadcast.await_args_list[1].args
    third = broadcast.await_args_list[2].args
    assert first[0] == {
        "type": "loot_bag_created",
        "token": {"id": 5, "instance_name": "战利品袋"},
        "source_name": "Goblin",
    }
    assert second[0] == {
        "type": "loot_bag_looted",
        "token_id": 5,
        "character_id": 9,
        "character_name": "Aria",
        "items_taken": [{"name": "Potion"}],
        "currency_taken": {"gp": 12},
        "bag_empty": False,
    }
    assert third[0] == {
        "type": "loot_bag_removed",
        "token_id": 5,
    }


@pytest.mark.asyncio
async def test_publish_storage_acl_updated_preserves_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_storage_acl_updated(
        43,
        object_type="journal",
        object_id="entry-1",
        users=["u1", "u2"],
    )

    args = broadcast.await_args.args
    assert args[1] == "43"
    assert args[0] == {
        "type": "storage_acl_updated",
        "object_type": "journal",
        "object_id": "entry-1",
        "users": ["u1", "u2"],
    }


@pytest.mark.asyncio
async def test_publish_marker_events_preserve_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_marker_created(
        50,
        marker={"id": 1, "map_url": "forest", "label": "Trap"},
    )
    await realtime_publisher.publish_marker_updated(
        50,
        marker={"id": 1, "map_url": "forest", "label": "Trap!", "color": "#f00"},
    )
    await realtime_publisher.publish_marker_deleted(
        50,
        marker_id=1,
        map_url="forest",
    )
    await realtime_publisher.publish_markers_cleared(
        50,
        map_url="forest",
    )

    first = broadcast.await_args_list[0].args
    second = broadcast.await_args_list[1].args
    third = broadcast.await_args_list[2].args
    fourth = broadcast.await_args_list[3].args
    assert first[0] == {
        "type": "marker_created",
        "marker": {"id": 1, "map_url": "forest", "label": "Trap"},
    }
    assert second[0] == {
        "type": "marker_updated",
        "marker": {"id": 1, "map_url": "forest", "label": "Trap!", "color": "#f00"},
    }
    assert third[0] == {
        "type": "marker_deleted",
        "marker_id": 1,
        "map_url": "forest",
    }
    assert fourth[0] == {
        "type": "markers_cleared",
        "map_url": "forest",
    }


@pytest.mark.asyncio
async def test_publish_chest_events_preserve_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_chest_event(
        53,
        event_type="chest_updated",
        chest={"id": 2, "name": "Ancient Chest"},
    )
    await realtime_publisher.publish_chest_deleted(
        53,
        chest_id=2,
    )

    first = broadcast.await_args_list[0].args
    second = broadcast.await_args_list[1].args
    assert first[0] == {
        "type": "chest_updated",
        "chest": {"id": 2, "name": "Ancient Chest"},
        "campaign_id": 53,
    }
    assert second[0] == {
        "type": "chest_deleted",
        "chest_id": 2,
        "campaign_id": 53,
    }


@pytest.mark.asyncio
async def test_publish_token_auras_and_faction_updates_preserve_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_token_auras_updated(
        29,
        token_id=7,
        active_auras=[{"id": "paladin_aura"}],
        aura_id="paladin_aura",
        enabled=True,
    )
    await realtime_publisher.publish_token_faction_updated(
        29,
        token_id=7,
        faction="ally",
    )

    first = broadcast.await_args_list[0].args
    second = broadcast.await_args_list[1].args
    assert first[0] == {
        "type": "token_auras_update",
        "token_id": 7,
        "active_auras": [{"id": "paladin_aura"}],
        "aura_id": "paladin_aura",
        "enabled": True,
    }
    assert second[0] == {
        "type": "token_faction_update",
        "token_id": 7,
        "faction": "ally",
    }


@pytest.mark.asyncio
async def test_publish_spell_slot_consumed_preserves_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_spell_slot_consumed(
        23,
        character_id=7,
        slot_level=3,
        use_pact_slot=False,
        new_spell_slots_state={"slots": [0, 4, 3, 1]},
    )

    args = broadcast.await_args.args
    assert args[1] == "23"
    assert args[0] == {
        "type": "spell_slot_consumed",
        "character_id": 7,
        "slot_level": 3,
        "use_pact_slot": False,
        "new_spell_slots_state": {"slots": [0, 4, 3, 1]},
    }


@pytest.mark.asyncio
async def test_publish_transformation_narrative_preserves_top_level_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_transformation_narrative(
        42,
        token_id=5,
        character_id=2,
        character_name="Lia",
        beast_name="Dire Wolf",
        is_transforming=True,
        config_id="wild_shape",
        narrative="骨骼在月光中拉长，化作狼影。",
    )

    args = broadcast.await_args.args
    assert args[1] == "42"
    assert args[0] == {
        "type": "transformation_narrative",
        "token_id": 5,
        "character_id": 2,
        "character_name": "Lia",
        "beast_name": "Dire Wolf",
        "is_transforming": True,
        "config_id": "wild_shape",
        "narrative": "骨骼在月光中拉长，化作狼影。",
    }


@pytest.mark.asyncio
async def test_publish_resource_chat_avatar_updates_include_compatibility_data(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_shop_avatar_updated(
        70,
        shop_id=9,
        avatar_url="/shop-small.webp",
        avatar_url_large="/shop-large.webp",
    )
    await realtime_publisher.publish_item_avatar_updated(
        70,
        item_id=11,
        avatar_url="/item-small.webp",
        avatar_url_large="/item-large.webp",
    )
    await realtime_publisher.publish_npc_avatar_updated(
        70,
        monster_instance_id=13,
        avatar_url="/npc-small.webp",
        avatar_url_large="/npc-large.webp",
    )
    await realtime_publisher.publish_chest_avatar_updated(
        70,
        chest_id=15,
        avatar_url="/chest-small.webp",
    )

    first = broadcast.await_args_list[0].args
    second = broadcast.await_args_list[1].args
    third = broadcast.await_args_list[2].args
    fourth = broadcast.await_args_list[3].args
    assert first[0] == {
        "type": "shop_avatar_updated",
        "data": {
            "shop_id": 9,
            "avatar_url": "/shop-small.webp",
            "avatar_url_large": "/shop-large.webp",
        },
        "shop_id": 9,
        "avatar_url": "/shop-small.webp",
        "avatar_url_large": "/shop-large.webp",
    }
    assert second[0] == {
        "type": "item_avatar_updated",
        "data": {
            "item_id": 11,
            "avatar_url": "/item-small.webp",
            "avatar_url_large": "/item-large.webp",
        },
        "item_id": 11,
        "avatar_url": "/item-small.webp",
        "avatar_url_large": "/item-large.webp",
    }
    assert third[0] == {
        "type": "npc_avatar_updated",
        "data": {
            "monster_instance_id": 13,
            "avatar_url": "/npc-small.webp",
            "avatar_url_large": "/npc-large.webp",
        },
        "monster_instance_id": 13,
        "avatar_url": "/npc-small.webp",
        "avatar_url_large": "/npc-large.webp",
    }
    assert fourth[0] == {
        "type": "chest_avatar_updated",
        "data": {
            "chest_id": 15,
            "avatar_url": "/chest-small.webp",
        },
        "chest_id": 15,
        "avatar_url": "/chest-small.webp",
    }


@pytest.mark.asyncio
async def test_publish_resource_chat_creation_events_include_compatibility_data(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_shop_created(71, shop_id=4, name="暮色杂货铺")
    await realtime_publisher.publish_monster_added(71, monster_instance_id=8, name="灰鬃熊")
    await realtime_publisher.publish_item_created(71, item_id=12, name="霜纹匕首")
    await realtime_publisher.publish_chest_created(71, chest_id=16, name="古铜宝箱")

    first = broadcast.await_args_list[0].args
    second = broadcast.await_args_list[1].args
    third = broadcast.await_args_list[2].args
    fourth = broadcast.await_args_list[3].args
    assert first[0] == {
        "type": "shop_created",
        "data": {"shop_id": 4, "name": "暮色杂货铺"},
        "shop_id": 4,
        "name": "暮色杂货铺",
    }
    assert second[0] == {
        "type": "monster_added",
        "data": {"monster_instance_id": 8, "name": "灰鬃熊"},
        "monster_instance_id": 8,
        "name": "灰鬃熊",
    }
    assert third[0] == {
        "type": "item_created",
        "data": {"item_id": 12, "name": "霜纹匕首"},
        "item_id": 12,
        "name": "霜纹匕首",
    }
    assert fourth[0] == {
        "type": "chest_created",
        "data": {"chest_id": 16, "name": "古铜宝箱"},
        "chest_id": 16,
        "name": "古铜宝箱",
    }


@pytest.mark.asyncio
async def test_publish_scene_created_preserves_summary_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_scene_created(
        72,
        npc_count=2,
        shop_count=1,
        token_count=5,
        npc_ids=[101, 102],
        shop_ids=[201],
        token_ids=[301, 302, 303, 304, 305],
    )

    args = broadcast.await_args.args
    assert args[1] == "72"
    assert args[0] == {
        "type": "scene_created",
        "data": {
            "npc_count": 2,
            "shop_count": 1,
            "token_count": 5,
            "npc_ids": [101, 102],
            "shop_ids": [201],
            "token_ids": [301, 302, 303, 304, 305],
        },
        "npc_count": 2,
        "shop_count": 1,
        "token_count": 5,
        "npc_ids": [101, 102],
        "shop_ids": [201],
        "token_ids": [301, 302, 303, 304, 305],
    }


@pytest.mark.asyncio
async def test_publish_monster_converted_to_chest_includes_compatibility_data(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_monster_converted_to_chest(
        73,
        token_id=41,
        chest_id=12,
        chest={
            "id": 12,
            "name": "焦黑宝箱",
            "state": "closed",
            "avatar_url": "/loot.webp",
            "gp": 17,
        },
        position_x=18,
        position_y=9,
        map_url="maps/catacomb",
    )

    args = broadcast.await_args.args
    assert args[1] == "73"
    assert args[0] == {
        "type": "monster_converted_to_chest",
        "data": {
            "token_id": 41,
            "chest_id": 12,
            "chest": {
                "id": 12,
                "name": "焦黑宝箱",
                "state": "closed",
                "avatar_url": "/loot.webp",
                "gp": 17,
            },
            "position_x": 18,
            "position_y": 9,
            "map_url": "maps/catacomb",
        },
        "token_id": 41,
        "chest_id": 12,
        "chest": {
            "id": 12,
            "name": "焦黑宝箱",
            "state": "closed",
            "avatar_url": "/loot.webp",
            "gp": 17,
        },
        "position_x": 18,
        "position_y": 9,
        "map_url": "maps/catacomb",
    }


@pytest.mark.asyncio
async def test_publish_user_presence_includes_compatibility_data(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_user_presence(
        74,
        event_type="user_connected",
        user_id="user-7",
        role="dm",
    )

    args = broadcast.await_args.args
    assert args[1] == "74"
    assert args[0] == {
        "type": "user_connected",
        "data": {
            "user_id": "user-7",
            "role": "dm",
        },
        "user_id": "user-7",
        "role": "dm",
    }


@pytest.mark.asyncio
async def test_publish_tts_broadcast_preserves_message_contract(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    message = {
        "type": "tts_broadcast",
        "data": {
            "audio_url": "/tts/clip.mp3",
            "voice_id": "narrator",
        },
    }
    await realtime_publisher.publish_tts_broadcast(75, message=message)

    args = broadcast.await_args.args
    assert args[1] == "75"
    assert args[0] == message


@pytest.mark.asyncio
async def test_publish_module_chat_events_include_compatibility_data(monkeypatch):
    broadcast = AsyncMock()
    monkeypatch.setattr(manager, "broadcast_to_campaign", broadcast)

    await realtime_publisher.publish_avatar_generated(
        76,
        entity_type="npc",
        entity_id=22,
        avatar_url="/avatars/npc.webp",
        has_avatar=True,
        name="守夜人",
    )
    await realtime_publisher.publish_npc_created(
        76,
        monster_instance_id=31,
        name="守夜人",
    )
    await realtime_publisher.publish_shop_created(
        76,
        shop_id=12,
        name="铜灯杂货",
        item_count=7,
        token_id=88,
    )
    await realtime_publisher.publish_map_generated(
        76,
        map_id="map-7",
        map_url="/maps/crypt.webp",
        map_name="遗忘墓窟",
        module_id="module-1",
    )

    first = broadcast.await_args_list[0].args
    second = broadcast.await_args_list[1].args
    third = broadcast.await_args_list[2].args
    fourth = broadcast.await_args_list[3].args
    assert first[0] == {
        "type": "avatar_generated",
        "data": {
            "entity_type": "npc",
            "entity_id": 22,
            "avatar_url": "/avatars/npc.webp",
            "has_avatar": True,
            "name": "守夜人",
        },
        "entity_type": "npc",
        "entity_id": 22,
        "avatar_url": "/avatars/npc.webp",
        "has_avatar": True,
        "name": "守夜人",
    }
    assert second[0] == {
        "type": "npc_created",
        "data": {
            "monster_instance_id": 31,
            "name": "守夜人",
        },
        "monster_instance_id": 31,
        "name": "守夜人",
    }
    assert third[0] == {
        "type": "shop_created",
        "data": {
            "shop_id": 12,
            "name": "铜灯杂货",
            "item_count": 7,
            "token_id": 88,
        },
        "shop_id": 12,
        "name": "铜灯杂货",
        "item_count": 7,
        "token_id": 88,
    }
    assert fourth[0] == {
        "type": "map_generated",
        "data": {
            "map_id": "map-7",
            "map_url": "/maps/crypt.webp",
            "map_name": "遗忘墓窟",
            "module_id": "module-1",
        },
        "map_id": "map-7",
        "map_url": "/maps/crypt.webp",
        "map_name": "遗忘墓窟",
        "module_id": "module-1",
    }
