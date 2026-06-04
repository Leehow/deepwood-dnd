from app.services.class_resource_service import (
    calculate_resource_max,
    get_character_resources,
    get_resource_definition,
)


def test_archdruid_gets_unlimited_wild_shape_uses() -> None:
    resource = get_resource_definition("wild_shape")

    assert resource is not None
    assert calculate_resource_max(resource, level=20) == 999


def test_core_resource_abilities_are_exposed_for_barbarian_and_fighter() -> None:
    barbarian_resources = get_character_resources("barbarian", None, 5)
    fighter_resources = get_character_resources("fighter", None, 2)
    wizard_resources = get_character_resources("wizard", None, 2)

    barbarian_ability_ids = {ability["id"] for ability in barbarian_resources["abilities"]}
    fighter_ability_ids = {ability["id"] for ability in fighter_resources["abilities"]}
    wizard_ability_ids = {ability["id"] for ability in wizard_resources["abilities"]}

    assert "rage" in barbarian_ability_ids
    assert "second_wind" in fighter_ability_ids
    assert "action_surge" in fighter_ability_ids
    assert "arcane_recovery" in wizard_ability_ids


def test_shared_resource_abilities_are_exposed_without_duplicate_resource_pool() -> None:
    druid_resources = get_character_resources("druid", "moon", 2)

    resource_ids = {resource["id"] for resource in druid_resources["resources"]}
    ability_ids = {ability["id"] for ability in druid_resources["abilities"]}

    assert "wild_shape" in resource_ids
    assert "combat_wild_shape" not in resource_ids
    assert "wild_shape" in ability_ids
    assert "combat_wild_shape" in ability_ids


def test_resource_abilities_carry_json_execution_metadata() -> None:
    druid_resources = get_character_resources("druid", "moon", 2)
    fighter_resources = get_character_resources("fighter", None, 2)

    combat_wild_shape = next(ability for ability in druid_resources["abilities"] if ability["id"] == "combat_wild_shape")
    second_wind = next(ability for ability in fighter_resources["abilities"] if ability["id"] == "second_wind")

    assert combat_wild_shape["execution"]["type"] == "transform"
    assert combat_wild_shape["execution"]["configId"] == "wild_shape"
    assert second_wind["execution"]["type"] == "self_heal"
