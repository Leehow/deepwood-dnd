from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.services.aura_service import (
    _sync_aura_applied_conditions,
    build_status_aura_display_effects,
    build_status_auras_from_status_effects,
)


def test_build_status_auras_from_character_custom_effects():
    status_effects = {
        "custom_effects": [
            {
                "id": "custom_fear_aura",
                "name": "恐惧灵气",
                "duration": {"type": "permanent", "value": 0, "remaining": 0, "v": 2},
                "aura": {
                    "radius": 15,
                    "icon": "😨",
                    "color": "#ef4444",
                    "affects_allies": False,
                    "affects_enemies": True,
                    "applies_conditions": ["frightened"],
                },
            }
        ]
    }

    auras = build_status_auras_from_status_effects(status_effects)

    assert len(auras) == 1
    assert auras[0]["id"] == "custom_fear_aura"
    assert auras[0]["name"] == "恐惧灵气"
    assert auras[0]["radius"] == 15
    assert auras[0]["icon"] == "😨"
    assert auras[0]["applies_conditions"] == ["frightened"]
    assert auras[0]["affects_enemies"] is True
    assert auras[0]["affects_allies"] is False

    display_effects = build_status_aura_display_effects(status_effects)
    assert len(display_effects) == 1
    assert display_effects[0]["aura_emitter"] is True
    assert display_effects[0]["dm_added"] is True


def test_build_status_auras_ignores_expired_and_supports_monster_effects_key():
    status_effects = {
        "effects": [
            {
                "id": "expired_aura",
                "name": "过期灵气",
                "duration": {"type": "rounds", "value": 10, "remaining": 0, "v": 2},
                "aura": {"radius": 10, "applies_conditions": ["poisoned"]},
            },
            {
                "id": "monster_aura",
                "name": "毒雾灵气",
                "duration": {"type": "rounds", "value": 10, "remaining": 3, "v": 2},
                "aura": {"radius": 10, "applies_conditions": ["poisoned"]},
            },
        ]
    }

    auras = build_status_auras_from_status_effects(status_effects)

    assert [aura["id"] for aura in auras] == ["monster_aura"]


@pytest.mark.asyncio
async def test_sync_aura_applied_conditions_updates_token_and_character_status():
    source_token = SimpleNamespace(
        id=1,
        instance_name="恐惧源",
        active_effects=[],
        character_id=None,
        monster_instance_id=None,
    )
    target_token = SimpleNamespace(
        id=2,
        instance_name="目标",
        active_effects=[],
        character_id=42,
        monster_instance_id=None,
    )
    character = SimpleNamespace(status_effects={})
    db = AsyncMock()
    db.get = AsyncMock(return_value=character)
    db.commit = AsyncMock()

    aura_updates = [
        {
            "source_token_id": 1,
            "aura_id": "custom_fear_aura",
            "aura_name": "恐惧灵气",
            "source_effect_id": "custom_fear_aura",
            "affected_token_ids": [2],
            "applies_conditions": ["frightened"],
        }
    ]

    with patch("app.services.aura_service.flag_modified"):
        changed = await _sync_aura_applied_conditions([source_token, target_token], aura_updates, db)

    assert len(changed) == 1
    assert changed[0]["token_id"] == 2
    assert changed[0]["character_id"] == 42
    assert target_token.active_effects[0]["condition"] == "frightened"
    assert target_token.active_effects[0]["aura_applied"] is True
    assert character.status_effects["active_conditions"][0]["condition"] == "frightened"
    assert character.status_effects["active_conditions"][0]["source"]["type"] == "aura"
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_sync_aura_applied_conditions_adds_non_condition_aura_buff_effect():
    source_token = SimpleNamespace(
        id=1,
        instance_name="圣武士",
        active_effects=[],
        character_id=None,
        monster_instance_id=None,
    )
    target_token = SimpleNamespace(
        id=2,
        instance_name="盟友",
        active_effects=[],
        character_id=None,
        monster_instance_id=None,
    )
    db = AsyncMock()
    db.commit = AsyncMock()

    aura_updates = [
        {
            "source_token_id": 1,
            "aura_id": "aura_of_protection",
            "aura_name": "护卫灵光",
            "source_effect_id": "aura_of_protection",
            "affected_token_ids": [2],
            "condition_immunities": ["frightened"],
            "modifiers": [
                {
                    "target": "saving_throw",
                    "type": "bonus",
                    "value": 3,
                }
            ],
            "bonus_damage": [
                {
                    "attack_kind": "weapon",
                    "formula": "1d4",
                    "damage_type": "radiant",
                }
            ],
            "spell_id": "crusaders_mantle",
        }
    ]

    with patch("app.services.aura_service.flag_modified"):
        changed = await _sync_aura_applied_conditions([source_token, target_token], aura_updates, db)

    assert len(changed) == 1
    aura_buff = target_token.active_effects[0]
    assert aura_buff["aura_applied"] is True
    assert aura_buff["spell_id"] == "crusaders_mantle"
    assert aura_buff["modifiers"][0]["value"] == 3
    assert aura_buff["metadata"]["immunities"]["condition"] == ["frightened"]
    assert aura_buff["bonus_damage"][0]["formula"] == "1d4"
