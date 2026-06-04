from app.models.character import Character
from app.services.character_sheet_service import character_sheet_service


def _make_character(**overrides):
    payload = {
        "user_id": "test-user",
        "name": "Test Hero",
        "race_id": "human",
        "class_id": "fighter",
        "subclass_id": None,
        "level": 1,
        "ability_scores": {
            "strength": 16,
            "dexterity": 14,
            "constitution": 14,
            "intelligence": 10,
            "wisdom": 12,
            "charisma": 10,
        },
        "equipment": [],
        "currency": {},
        "class_feature_uses": {},
    }
    payload.update(overrides)
    return Character(**payload)


def _get_action(actions, action_id: str):
    return next(action for action in actions if action["id"] == action_id)


def test_barbarian_rage_action_uses_unified_resource_id() -> None:
    character = _make_character(
        class_id="barbarian",
        level=5,
        class_feature_uses={"rage": {"current": 2, "max": 3}},
    )

    actions = character_sheet_service._compute_actions(character)
    rage = _get_action(actions, "rage")

    assert rage["action_type"] == "bonus_action"
    assert rage["resourceId"] == "rage"
    assert rage["uses"] == {"current": 2, "max": 3, "recharge": "long_rest"}
    assert rage["execution"]["type"] == "toggle_effect"
    assert rage["execution"]["effectId"] == "rage"


def test_barbarian_reckless_attack_uses_feature_json_execution() -> None:
    character = _make_character(
        class_id="barbarian",
        level=5,
    )

    actions = character_sheet_service._compute_actions(character)
    reckless_attack = _get_action(actions, "reckless_attack")

    assert reckless_attack["action_type"] == "free"
    assert reckless_attack["execution"]["type"] == "toggle_effect"
    assert reckless_attack["execution"]["effectId"] == "reckless_attack"
    assert reckless_attack["execution"]["allowDeactivate"] is False


def test_fighter_core_actions_use_unified_resource_ids() -> None:
    character = _make_character(
        class_id="fighter",
        level=17,
        class_feature_uses={
            "second_wind": {"current": 0, "max": 1},
            "action_surge": {"current": 1, "max": 2},
        },
    )

    actions = character_sheet_service._compute_actions(character)
    second_wind = _get_action(actions, "second_wind")
    action_surge = _get_action(actions, "action_surge")

    assert second_wind["action_type"] == "bonus_action"
    assert second_wind["resourceId"] == "second_wind"
    assert second_wind["uses"] == {"current": 0, "max": 1, "recharge": "short_rest"}
    assert second_wind["execution"]["type"] == "self_heal"
    assert action_surge["action_type"] == "free"
    assert action_surge["resourceId"] == "action_surge"
    assert action_surge["uses"] == {"current": 1, "max": 2, "recharge": "short_rest"}
    assert action_surge["execution"]["type"] == "toggle_effect"
    assert action_surge["execution"]["effectId"] == "action_surge"


def test_druid_wild_shape_action_reads_unified_resource_state() -> None:
    character = _make_character(
        class_id="druid",
        level=20,
        class_feature_uses={"wild_shape": {"current": 7, "max": 999}},
    )

    actions = character_sheet_service._compute_actions(character)
    wild_shape = _get_action(actions, "wild_shape")

    assert wild_shape["action_type"] == "action"
    assert wild_shape["resourceId"] == "wild_shape"
    assert wild_shape["uses"] == {"current": 7, "max": 999, "recharge": "short_rest"}
    assert wild_shape["execution"]["type"] == "transform"
    assert wild_shape["execution"]["configId"] == "wild_shape"


def test_moon_druid_combat_wild_shape_shares_wild_shape_resource() -> None:
    character = _make_character(
        class_id="druid",
        subclass_id="moon",
        level=4,
        class_feature_uses={"wild_shape": {"current": 1, "max": 2}},
    )

    actions = character_sheet_service._compute_actions(character)
    combat_wild_shape = _get_action(actions, "combat_wild_shape")

    assert combat_wild_shape["resourceId"] == "combat_wild_shape"
    assert combat_wild_shape["uses"] == {"current": 1, "max": 2, "recharge": "short_rest"}
    assert combat_wild_shape["execution"]["type"] == "transform"


def test_land_druid_natural_recovery_uses_json_execution_metadata() -> None:
    character = _make_character(
        class_id="druid",
        subclass_id="land",
        level=6,
        class_feature_uses={"natural_recovery": {"current": 0, "max": 3}},
    )

    actions = character_sheet_service._compute_actions(character)
    natural_recovery = _get_action(actions, "natural_recovery")

    assert natural_recovery["resourceId"] == "natural_recovery"
    assert natural_recovery["uses"] == {"current": 0, "max": 3, "recharge": "long_rest"}
    assert natural_recovery["execution"]["type"] == "spell_slot_recovery"
    assert natural_recovery["execution"]["openEvent"] == "naturalRecoveryTarget"


def test_berserker_frenzy_reads_feature_json_from_level_bucket() -> None:
    character = _make_character(
        class_id="barbarian",
        subclass_id="berserker",
        level=3,
    )

    actions = character_sheet_service._compute_actions(character)
    frenzy = _get_action(actions, "subclass_berserker_frenzy")

    assert frenzy["name"] == "狂乱"
    assert frenzy["action_type"] == "bonus_action"
    assert frenzy["execution"]["type"] == "toggle_effect"
    assert frenzy["execution"]["effectId"] == "frenzy"
    assert frenzy["execution"]["requirements"]["activeEffects"] == ["rage"]


def test_berserker_intimidating_presence_reads_target_save_execution() -> None:
    character = _make_character(
        class_id="barbarian",
        subclass_id="berserker",
        level=10,
    )

    actions = character_sheet_service._compute_actions(character)
    intimidating_presence = _get_action(actions, "subclass_berserker_intimidating_presence")

    assert intimidating_presence["name"] == "威吓存在"
    assert intimidating_presence["action_type"] == "action"
    assert intimidating_presence["execution"]["type"] == "target_save_effect"
    assert intimidating_presence["execution"]["save"]["ability"] == "wisdom"
    assert intimidating_presence["execution"]["onFail"]["applyEffect"]["id"] == "frightened"


def test_champion_survivor_feature_exposes_start_of_turn_execution() -> None:
    character = _make_character(
        class_id="fighter",
        subclass_id="champion",
        level=18,
    )

    features = character_sheet_service._compute_features(character)
    survivor = next(feature for feature in features if feature["id"] == "subclass_champion_survivor")

    assert survivor["name"] == "幸存者"
    assert survivor["nameEn"] == "Survivor"
    assert survivor["execution"]["trigger"] == "start_of_turn"
    assert survivor["execution"]["type"] == "start_of_turn_self_heal"
    assert survivor["execution"]["heal"]["base"] == 5
    assert survivor["execution"]["heal"]["bonus"]["ability"] == "constitution"
