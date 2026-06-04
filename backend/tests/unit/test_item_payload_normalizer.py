from app.utils.item_payload_normalizer import (
    items_can_stack,
    normalize_character_equipment_payloads,
    normalize_loot_bag_data,
    normalize_item_payload,
    normalize_token_item_fields,
)


def test_normalize_character_equipment_payloads_extracts_currency_and_fills_canonical_fields():
    normalized_items, currency_extracted, changed = normalize_character_equipment_payloads(
        [
            {
                "id": "dagger",
                "name": "匕首",
                "icon": "assets/items/dagger.png",
                "quantity": "2",
            },
            {
                "id": "coin_pouch_with_12gp",
                "quantity": 2,
            },
        ]
    )

    assert changed is True
    assert currency_extracted["gp"] == 24
    assert normalized_items[0]["id"] == "dagger"
    assert normalized_items[0]["category"] == "weapon"
    assert normalized_items[0]["equipmentType"] == "weapon"
    assert normalized_items[0]["quantity"] == 2
    assert normalized_items[0]["iconPath"] == "assets/items/dagger.png"
    assert normalized_items[0]["avatar_url"] == "/assets/items/dagger.png"
    assert normalized_items[0]["icon"] == "/assets/items/dagger.png"


def test_normalize_token_item_fields_moves_quantity_to_token_field():
    normalized_item_data, normalized_quantity, changed = normalize_token_item_fields(
        {
            "id": "dagger",
            "name": "匕首",
            "icon": "assets/items/dagger.png",
            "quantity": "3",
        },
        None,
    )

    assert changed is True
    assert normalized_quantity == 3
    assert normalized_item_data is not None
    assert "quantity" not in normalized_item_data
    assert normalized_item_data["equipmentType"] == "weapon"
    assert normalized_item_data["icon"] == "/assets/items/dagger.png"


def test_normalize_loot_bag_data_normalizes_nested_items():
    normalized_loot_bag, changed = normalize_loot_bag_data(
        {
            "source_name": "地精",
            "items": [
                {
                    "id": "shield",
                    "name": "盾牌",
                    "icon": "assets/items/shield.png",
                }
            ],
            "currency": {"gp": 5},
        }
    )

    assert changed is True
    assert normalized_loot_bag is not None
    assert normalized_loot_bag["items"][0]["equipmentType"] == "armor"
    assert normalized_loot_bag["items"][0]["category"] == "shield"
    assert normalized_loot_bag["items"][0]["icon"] == "/assets/items/shield.png"


def test_normalize_item_payload_drops_legacy_aliases_and_uses_library_item_identity():
    normalized = normalize_item_payload(
        {
            "id": "rusty_sword",
            "name": "锈剑",
            "db_item_id": 42,
            "item_id": 42,
            "library_item_id": 42,
            "image_url": "https://example.com/rusty-sword.png",
            "armorClass": {"base": 11},
        }
    )

    assert normalized["id"] == "library-item-42"
    assert normalized["libraryItemId"] == 42
    assert normalized["avatar_url"] == "https://example.com/rusty-sword.png"
    assert normalized["armor_class"] == {"base": 11}
    assert "db_item_id" not in normalized
    assert "item_id" not in normalized
    assert "library_item_id" not in normalized
    assert "image_url" not in normalized
    assert "armorClass" not in normalized


def test_normalize_item_payload_recovers_library_item_id_from_string_identifier():
    normalized = normalize_item_payload(
        {
            "id": "library-item-42",
            "name": "锈剑",
        }
    )

    assert normalized["id"] == "library-item-42"
    assert normalized["libraryItemId"] == 42


def test_normalize_item_payload_keeps_custom_item_identity_separate_from_library_items():
    normalized = normalize_item_payload(
        {
            "id": 367,
            "name": "爆弹枪",
            "category": "weapon",
            "is_custom": True,
            "damage": {"dice": "3d6", "type": "piercing"},
            "range": {"normal": 160, "long": 320},
        }
    )

    assert normalized["id"] == "custom-item-367"
    assert normalized["libraryItemId"] == 367
    assert normalized["damage"] == {"dice": "3d6", "type": "piercing"}
    assert normalized["damageType"] == "piercing"
    assert normalized["range"] == {"normal": 160, "long": 320}


def test_normalize_item_payload_does_not_backfill_preset_meta_by_name_for_custom_items():
    normalized = normalize_item_payload(
        {
            "id": 50,
            "name": "皮甲",
            "category": "gear",
            "is_custom": True,
        }
    )

    assert normalized["id"] == "custom-item-50"
    assert normalized["category"] == "gear"
    assert normalized["equipmentType"] == "gear"
    assert "ac" not in normalized
    assert "armor_class" not in normalized


def test_items_can_stack_requires_matching_library_identity_when_present():
    assert items_can_stack(
        {"id": "longsword", "libraryItemId": 101},
        {"id": "longsword", "libraryItemId": 101},
    )
    assert not items_can_stack(
        {"id": "longsword", "libraryItemId": 101},
        {"id": "longsword", "libraryItemId": 202},
    )
    assert not items_can_stack(
        {"id": "longsword", "libraryItemId": 101},
        {"id": "longsword"},
    )


def test_items_can_stack_keeps_custom_items_separate_from_library_items():
    assert not items_can_stack(
        {"id": "custom-item-101", "libraryItemId": 101, "is_custom": True},
        {"id": "library-item-101", "libraryItemId": 101},
    )
