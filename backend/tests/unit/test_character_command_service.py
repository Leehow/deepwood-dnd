from dataclasses import dataclass
from datetime import datetime

from app.services import character_command_service as service
from app.api.routes.characters import CharacterPartialUpdate


@dataclass
class DummyCharacter:
    currency: dict


@dataclass
class DummyToken:
    campaign_id: int


def test_prepare_partial_character_update_merges_extracted_currency(monkeypatch):
    monkeypatch.setattr(
        service,
        "normalize_character_equipment_payloads",
        lambda equipment: ([{"id": "normalized_item"}], {"gp": 3, "sp": 2, "cp": 0, "ep": 0, "pp": 0}, True),
    )

    character = DummyCharacter(currency={"cp": 0, "sp": 1, "ep": 0, "gp": 5, "pp": 0})
    payload = service.prepare_partial_character_update(character, {"equipment": [{"id": "raw"}]})

    assert payload["equipment"] == [{"id": "normalized_item"}]
    assert payload["currency"] == {"cp": 0, "sp": 3, "ep": 0, "gp": 8, "pp": 0}


def test_character_partial_update_accepts_spellbook_fields():
    payload = CharacterPartialUpdate(
        selected_cantrips=["light"],
        selected_spells=["shield", "magic_missile"],
    )

    assert payload.selected_cantrips == ["light"]
    assert payload.selected_spells == ["shield", "magic_missile"]


def test_prepare_character_create_payload_reuses_currency_merging(monkeypatch):
    monkeypatch.setattr(
        service,
        "normalize_character_equipment_payloads",
        lambda equipment: ([{"id": "normalized_item"}], {"gp": 1, "sp": 0, "cp": 4, "ep": 0, "pp": 0}, True),
    )

    payload = service.prepare_character_create_payload(
        {"equipment": [{"id": "raw"}], "currency": {"cp": 1, "sp": 0, "ep": 0, "gp": 2, "pp": 0}}
    )

    assert payload["equipment"] == [{"id": "normalized_item"}]
    assert payload["currency"] == {"cp": 5, "sp": 0, "ep": 0, "gp": 3, "pp": 0}


def test_collect_character_campaign_ids_deduplicates_and_preserves_order():
    campaign_ids = service.collect_character_campaign_ids(
        [DummyToken(campaign_id=3), DummyToken(campaign_id=5), DummyToken(campaign_id=3)],
        extra_campaign_id=1,
    )

    assert campaign_ids == ["1", "3", "5"]


def test_collect_changed_feature_uses_returns_only_changed_entries():
    changed = service.collect_changed_feature_uses(
        {
            "lay_on_hands": {"current": 10, "max": 25},
            "channel_divinity_cleric": {"current": 1, "max": 1},
        },
        {
            "lay_on_hands": {"current": 5, "max": 25},
            "channel_divinity_cleric": {"current": 1, "max": 1},
            "second_wind": {"current": 0, "max": 1},
        },
    )

    assert changed == [
        {"feature_id": "lay_on_hands", "current_uses": 5, "max_uses": 25},
        {"feature_id": "second_wind", "current_uses": 0, "max_uses": 1},
    ]


def test_build_dm_condition_effects_maps_labels_and_duration():
    effects = service.build_dm_condition_effects(
        [
            {"condition": "prone", "duration": {"type": "rounds", "remaining": 3}},
            {"condition": "poisoned", "duration": {"type": "permanent"}},
        ],
        condition_translations={"prone": "倒地", "poisoned": "中毒"},
    )

    assert effects == [
        {
            "id": "condition_prone",
            "name": "倒地",
            "condition": "prone",
            "icon": "⬇️",
            "color": "#92400e",
            "dm_added": True,
            "duration": 3,
        },
        {
            "id": "condition_poisoned",
            "name": "中毒",
            "condition": "poisoned",
            "icon": "🤢",
            "color": "#16a34a",
            "dm_added": True,
        },
    ]


def test_merge_dm_status_effects_preserves_non_dm_entries():
    merged = service.merge_dm_status_effects(
        [
            {"id": "hex", "name": "Hex"},
            {"id": "condition_prone", "name": "倒地", "dm_added": True},
        ],
        [{"id": "condition_poisoned", "name": "中毒", "dm_added": True}],
    )

    assert merged == [
        {"id": "hex", "name": "Hex"},
        {"id": "condition_poisoned", "name": "中毒", "dm_added": True},
    ]


def test_build_resource_use_broadcast_data_preserves_existing_contract():
    created_at = datetime(2026, 3, 21, 1, 0, 0)
    payload = service.build_resource_use_broadcast_data(
        chat_id=7,
        character_id=3,
        character_name="莱雅",
        user_id="user-1",
        resource_id="lay_on_hands",
        resource_name="圣疗术",
        content="治疗 10 点",
        created_at=created_at,
        extra={"current": 15, "max": 25},
    )

    assert payload == {
        "id": 7,
        "character_id": 3,
        "character_name": "莱雅",
        "user_id": "user-1",
        "resource_id": "lay_on_hands",
        "resource_name": "圣疗术",
        "content": "治疗 10 点",
        "created_at": "2026-03-21T01:00:00",
        "current": 15,
        "max": 25,
    }


def test_build_character_level_event_data_is_compact():
    payload = service.build_character_level_event_data(
        character_id=8,
        character_name="阿伦",
        new_level=5,
    )

    assert payload == {
        "character_id": 8,
        "character_name": "阿伦",
        "new_level": 5,
    }
