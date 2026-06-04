import pytest

from app.api.routes import combat
from app.models.character import Character
from app.models.token import Token


class FakeDb:
    def __init__(self, *, characters: dict[int, Character] | None = None):
        self.characters = characters or {}

    async def get(self, model, object_id):
        if model is Character:
            return self.characters.get(object_id)
        return None


def _make_character(*, status_effects=None, ability_scores=None) -> Character:
    return Character(
        user_id="unit-user",
        name="测试角色",
        race_id="human",
        class_id="fighter",
        level=5,
        appearance={},
        personality={},
        ability_scores=ability_scores
        or {
            "strength": 16,
            "dexterity": 12,
            "constitution": 14,
            "intelligence": 10,
            "wisdom": 12,
            "charisma": 10,
        },
        selected_skills=[],
        expertise_skills=[],
        selected_cantrips=[],
        selected_spells=[],
        prepared_spells=[],
        equipment=[],
        currency={"gp": 0, "sp": 0, "cp": 0, "ep": 0, "pp": 0},
        subclass_choices={},
        race_choices={},
        status_effects=status_effects or {},
    )


@pytest.mark.asyncio
async def test_remove_matching_status_entries_only_removes_same_spell(monkeypatch):
    monkeypatch.setattr(combat, "flag_modified", lambda *_args, **_kwargs: None)

    character = _make_character(
        status_effects={
            "active_conditions": [
                {
                    "condition": "paralyzed",
                    "source": {"type": "spell", "spell_id": "hold-person", "name": "人类定身术"},
                },
                {
                    "condition": "paralyzed",
                    "source": {"type": "spell", "spell_id": "symbol", "name": "徽记术"},
                },
            ]
        }
    )
    token = Token(character_id=1, active_effects=[])
    db = FakeDb(characters={1: character})

    await combat._remove_matching_status_entries(
        db,
        token,
        {"condition": "paralyzed", "spell_id": "hold-person"},
    )

    assert character.status_effects["active_conditions"] == [
        {
            "condition": "paralyzed",
            "source": {"type": "spell", "spell_id": "symbol", "name": "徽记术"},
        }
    ]


@pytest.mark.asyncio
async def test_do_single_save_success_cleans_character_status_condition(monkeypatch):
    monkeypatch.setattr(combat, "flag_modified", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(combat, "_roll_save_d20", lambda **_kwargs: (18, [18]))

    character = _make_character(
        status_effects={
            "active_conditions": [
                {
                    "condition": "paralyzed",
                    "source": {"type": "spell", "spell_id": "hold-person", "name": "人类定身术"},
                }
            ]
        }
    )
    effect = {
        "id": "hold_person_paralyzed",
        "name": "人类定身术",
        "condition": "paralyzed",
        "spell_id": "hold-person",
        "spell_save_dc": 15,
        "ongoing_save": {
            "dc": 15,
            "save_type": "wisdom",
            "timing": "end_of_turn",
        },
    }
    token = Token(
        id=42,
        character_id=1,
        instance_name="被定身的战士",
        active_effects=[effect.copy()],
    )
    db = FakeDb(characters={1: character})

    result = await combat._do_single_save(token, effect, db)

    assert result.effect_removed is True
    assert token.active_effects == []
    assert character.status_effects["active_conditions"] == []
