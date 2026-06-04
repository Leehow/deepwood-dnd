from app.services.character_equipment_selection_service import (
    expand_equipment_pack,
    get_equipment_category_items,
    get_equipment_packs,
    resolve_equipment_item,
)


def test_get_equipment_category_items_builds_weapon_and_armor_groups():
    equipment_data = {
        "weapons": {
            "simple": {"melee": [{"id": "club"}], "ranged": [{"id": "shortbow"}]},
            "martial": {"melee": [{"id": "longsword"}], "ranged": [{"id": "longbow"}]},
        },
        "armor": {
            "light": [{"id": "leather"}],
            "medium": [{"id": "scale_mail"}],
            "heavy": [{"id": "chain_mail"}],
        },
    }

    category_map = get_equipment_category_items(equipment_data)

    assert category_map["simple_weapon"] == ["club", "shortbow"]
    assert category_map["martial_weapon"] == ["longsword", "longbow"]
    assert category_map["light_armor"] == ["leather"]
    assert category_map["heavy_armor"] == ["chain_mail"]


def test_resolve_equipment_item_applies_id_corrections():
    resolved = resolve_equipment_item("leather_armor", category_map={})
    assert resolved == "leather"


def test_get_equipment_packs_and_expand_equipment_pack_sets_container_id():
    equipment_data = {
        "packs": [
            {
                "id": "explorers_pack",
                "contents": [
                    {"item": "backpack", "quantity": 1},
                    {"item": "torch", "quantity": 10},
                    {"item": "rations", "quantity": 10},
                ],
            }
        ]
    }

    packs = get_equipment_packs(equipment_data)
    expanded = expand_equipment_pack("explorers_pack", packs, source="background")

    assert len(expanded) == 3
    torch = next(item for item in expanded if item["id"] == "torch")
    assert torch["containerId"] == "backpack"
    assert torch["from_pack"] == "explorers_pack"
