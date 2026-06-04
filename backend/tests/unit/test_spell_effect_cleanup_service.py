from types import SimpleNamespace

import pytest

import app.services.spell_effect_cleanup_service as cleanup_module
from app.models.character import Character
from app.models.monster_instance import MonsterInstance
from app.models.token import Token
from app.services.spell_effect_cleanup_service import apply_damage_break_cleanup


class _CleanupDb:
    def __init__(self, mapping):
        self.mapping = mapping

    async def get(self, model, object_id):
        return self.mapping.get(model, {}).get(object_id)

    async def flush(self):
        return None


@pytest.mark.asyncio
async def test_damage_break_cleanup_removes_sleep_group_and_status(monkeypatch):
    monkeypatch.setattr(cleanup_module, "flag_modified", lambda *_args, **_kwargs: None)

    target_token = SimpleNamespace(
        id=202,
        character_id=303,
        monster_instance_id=None,
        active_effects=[
            {
                "id": "sleep_unconscious",
                "name": "昏迷",
                "condition": "unconscious",
                "spell_id": "sleep",
                "source_token_id": 101,
                "break_conditions": ["damage", "shaken"],
            }
        ],
        concentration_spell=None,
    )
    target_character = SimpleNamespace(
        id=303,
        class_id="wizard",
        subclass_id=None,
        level=5,
        status_effects={
            "active_conditions": [
                {"condition": "unconscious", "source": {"spell_id": "sleep", "name": "睡眠术"}}
            ]
        },
        ability_scores={"wisdom": 10},
    )

    db = _CleanupDb(
        {
            Token: {202: target_token},
            Character: {303: target_character},
            MonsterInstance: {},
        }
    )

    result = await apply_damage_break_cleanup(
        token=target_token,
        damage_amount=7,
        db=db,
    )

    assert result.active_effects_changed is True
    assert target_token.active_effects == []
    assert target_character.status_effects["active_conditions"] == []


@pytest.mark.asyncio
async def test_damage_break_cleanup_resolves_tashas_damage_save_and_clears_concentration(monkeypatch):
    monkeypatch.setattr(cleanup_module, "flag_modified", lambda *_args, **_kwargs: None)

    rolls = iter([3, 18])
    monkeypatch.setattr("random.randint", lambda _a, _b: next(rolls))

    caster_token = SimpleNamespace(
        id=101,
        character_id=None,
        monster_instance_id=None,
        active_effects=[],
        concentration_spell={
            "spell_id": "tashas_hideous_laughter",
            "spell_name": "塔莎狂笑术",
            "affected_token_ids": [202],
        },
    )
    target_token = SimpleNamespace(
        id=202,
        character_id=303,
        monster_instance_id=None,
        active_effects=[
            {
                "id": "tashas_hideous_laughter_incapacitated",
                "name": "失能",
                "condition": "incapacitated",
                "spell_id": "tashas_hideous_laughter",
                "source_token_id": 101,
                "spell_save_dc": 15,
            },
            {
                "id": "tashas_hideous_laughter_prone",
                "name": "倒地",
                "condition": "prone",
                "spell_id": "tashas_hideous_laughter",
                "source_token_id": 101,
                "spell_save_dc": 15,
            },
        ],
        concentration_spell=None,
    )
    target_character = SimpleNamespace(
        id=303,
        class_id="fighter",
        subclass_id=None,
        level=5,
        ability_scores={"wisdom": 10},
        status_effects={
            "active_conditions": [
                {"condition": "incapacitated", "source": {"spell_id": "tashas_hideous_laughter"}},
                {"condition": "prone", "source": {"spell_id": "tashas_hideous_laughter"}},
            ]
        },
    )

    db = _CleanupDb(
        {
            Token: {101: caster_token, 202: target_token},
            Character: {303: target_character},
            MonsterInstance: {},
        }
    )

    result = await apply_damage_break_cleanup(
        token=target_token,
        damage_amount=4,
        db=db,
    )

    assert result.active_effects_changed is True
    assert sorted(result.removed_effect_ids) == [
        "tashas_hideous_laughter_incapacitated",
        "tashas_hideous_laughter_prone",
    ]
    assert target_token.active_effects == []
    assert target_character.status_effects["active_conditions"] == []
    assert caster_token.concentration_spell is None
    assert result.concentration_touched_token_ids == [101]
