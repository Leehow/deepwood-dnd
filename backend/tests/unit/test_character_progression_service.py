from dataclasses import dataclass, field
from types import SimpleNamespace

from app.services import character_progression_service as service


@dataclass
class DummyCharacter:
    class_id: str = "fighter"
    level: int = 4
    subclass_id: str | None = None
    ability_scores: dict = field(default_factory=lambda: {"constitution": 16})
    selected_cantrips: list = field(default_factory=lambda: [{"id": "light"}])
    selected_spells: list = field(default_factory=lambda: [{"id": "shield"}])
    selected_skills: list = field(default_factory=lambda: [{"value": "athletics"}])
    expertise_skills: list = field(default_factory=list)
    fighting_style: dict | None = None
    favored_enemy: dict | None = None
    favored_humanoid_races: list | None = None
    favored_terrain: dict | None = None
    eldritch_invocations: list = field(default_factory=list)
    feats: list = field(default_factory=list)
    feat_choices: dict = field(default_factory=dict)
    multiclass_data: dict | None = None
    current_hp: int = 10
    can_prepare_spells: bool = False
    spell_slots_state: list | dict | None = None


def test_build_level_history_snapshot_copies_mutable_fields():
    character = DummyCharacter(
        feats=["durable"],
        multiclass_data={"classes": [{"class_id": "fighter", "level": 4}]},
    )

    snapshot = service.build_level_history_snapshot(character, {"subclass": "champion"})

    assert snapshot["level"] == 4
    assert snapshot["selected_spells"] == [{"id": "shield"}]
    assert snapshot["feature_choices"] == {"subclass": "champion"}
    assert snapshot["multiclass_data"] == {"classes": [{"class_id": "fighter", "level": 4}]}

    character.selected_spells.append({"id": "magic_missile"})
    assert snapshot["selected_spells"] == [{"id": "shield"}]


def test_apply_level_up_class_choice_adds_multiclass_entry():
    character = DummyCharacter(level=4)
    multiclass_data = service.ensure_multiclass_data(character)

    next_data, class_entry, new_level = service.apply_level_up_class_choice(
        character,
        multiclass_data,
        "wizard",
    )

    assert new_level == 5
    assert class_entry == {"class_id": "wizard", "level": 1, "subclass_id": None}
    assert next_data["classes"] == [
        {"class_id": "fighter", "level": 4, "subclass_id": None},
        {"class_id": "wizard", "level": 1, "subclass_id": None},
    ]


def test_calculate_short_rest_heal_respects_durable_feat():
    character = DummyCharacter(
        class_id="wizard",
        ability_scores={"constitution": 16},
        feats=["durable"],
    )

    healing = service.calculate_short_rest_heal(character)

    assert healing.hit_die == 6
    assert healing.con_mod == 3
    assert healing.heal_amount == 7


def test_restore_pact_slots_on_short_rest_updates_multiclass_state():
    character = DummyCharacter(
        class_id="sorcerer",
        level=8,
        multiclass_data={"classes": [{"class_id": "sorcerer", "level": 5}, {"class_id": "warlock", "level": 3}]},
        spell_slots_state={"slots": [0] * 10, "pact_slots": [0] * 10},
    )

    restored = service.restore_pact_slots_on_short_rest(character)

    assert restored is True
    assert character.spell_slots_state["pact_level"] == 2
    assert character.spell_slots_state["pact_count"] == 2
    assert character.spell_slots_state["pact_slots"][2] == 2


def test_apply_character_rest_sets_long_rest_preparation_flag():
    character = DummyCharacter(current_hp=7, can_prepare_spells=False)

    service.apply_character_rest(character, rest_type="long", max_hp=30, short_heal=6)

    assert character.current_hp == 30
    assert character.can_prepare_spells is True


def test_restore_class_resources_for_short_rest_only_returns_increased_resources():
    character = DummyCharacter(
        class_id="fighter",
        level=5,
        ability_scores={"charisma": 10, "wisdom": 10, "intelligence": 10},
    )
    character.class_feature_uses = {
        "second_wind": {"current": 0, "max": 1},
        "action_surge": {"current": 1, "max": 1},
    }

    stub_service = SimpleNamespace(
        process_short_rest=lambda **_kwargs: {"second_wind": 1, "action_surge": 1},
        process_long_rest=lambda **_kwargs: {},
    )

    result = service.restore_class_resources_for_rest(
        character,
        rest_type="short",
        class_resource_service_module=stub_service,
    )

    assert result.changed is True
    assert result.resources_restored == ["second_wind"]
    assert result.class_feature_uses["second_wind"] == {"current": 1, "max": 1}
    assert result.class_feature_uses["action_surge"] == {"current": 1, "max": 1}


def test_restore_class_resources_for_long_rest_restores_all_available_resources():
    character = DummyCharacter(
        class_id="wizard",
        level=5,
        ability_scores={"charisma": 10, "wisdom": 10, "intelligence": 16},
    )
    character.class_feature_uses = {"arcane_recovery": {"current": 0, "max": 3}}

    stub_service = SimpleNamespace(
        process_short_rest=lambda **_kwargs: {},
        process_long_rest=lambda **_kwargs: {"arcane_recovery": 3, "spell_mastery": 1},
    )

    result = service.restore_class_resources_for_rest(
        character,
        rest_type="long",
        class_resource_service_module=stub_service,
    )

    assert result.changed is True
    assert result.resources_restored == ["arcane_recovery", "spell_mastery"]
    assert result.class_feature_uses["arcane_recovery"] == {"current": 3, "max": 3}
    assert result.class_feature_uses["spell_mastery"] == {"current": 1, "max": 1}
