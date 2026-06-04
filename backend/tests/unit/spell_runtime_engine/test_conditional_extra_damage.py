import pytest

from app.services.spell_runtime_engine import execute_phase
from app.services.spell_runtime_engine.verbs.damage import roll_runtime_damage
from app.utils.dice_formula import DiceGroup, FormulaResult

from ._helpers import make_instance


def _fake_eval_factory(*results):
    iterator = iter(results)

    def _fake(_formula, _vars):
        return next(iterator)

    return _fake


@pytest.mark.asyncio
async def test_on_hit_extra_damage_emits_runtime_bonus(monkeypatch: pytest.MonkeyPatch):
    instance = make_instance(params={})
    monkeypatch.setattr(
        "app.services.spell_runtime_engine.verbs.damage.eval_formula",
        _fake_eval_factory(
            FormulaResult(
                total=4,
                dice_groups=[DiceGroup(count=1, sides=6, rolls=[4], total=4)],
                modifier=0,
                breakdown="1d6(4)",
            )
        ),
    )
    spell_data = {
        "effects": [
            {
                "trigger": "on_hit",
                "effects": [
                    {
                        "type": "conditional_extra_damage",
                        "formula": "1d6",
                        "damage_type": "necrotic",
                    }
                ],
            }
        ]
    }

    result = await execute_phase(
        db=None,
        instance=instance,
        trigger="on_hit",
        ctx_overrides={
            "attacker_token_id": instance.caster_token_id,
            "target_token_id": instance.primary_target_token_id,
            "attack_kind": "weapon",
            "critical": False,
        },
        spell_data=spell_data,
    )

    assert len(result.bonus_damages) == 1
    bonus = result.bonus_damages[0]
    assert bonus.damage == 4
    assert bonus.damage_type == "necrotic"
    assert bonus.spell_id == "hex"
    assert bonus.roll["rolls"] == [4]


@pytest.mark.asyncio
async def test_on_hit_extra_damage_skipped_when_target_does_not_match():
    instance = make_instance(params={})
    spell_data = {
        "effects": [
            {
                "trigger": "on_hit",
                "effects": [{"type": "conditional_extra_damage", "formula": "1d6"}],
            }
        ]
    }

    result = await execute_phase(
        db=None,
        instance=instance,
        trigger="on_hit",
        ctx_overrides={
            "attacker_token_id": instance.caster_token_id,
            "target_token_id": 999,  # not the marked target
            "attack_kind": "weapon",
            "critical": False,
        },
        spell_data=spell_data,
    )
    assert result.bonus_damages == []


@pytest.mark.asyncio
async def test_target_match_any_emits_for_non_primary_target(monkeypatch: pytest.MonkeyPatch):
    instance = make_instance(params={})
    monkeypatch.setattr(
        "app.services.spell_runtime_engine.verbs.damage.eval_formula",
        _fake_eval_factory(
            FormulaResult(
                total=3,
                dice_groups=[DiceGroup(count=1, sides=4, rolls=[3], total=3)],
                modifier=0,
                breakdown="1d4(3)",
            )
        ),
    )
    spell_data = {
        "effects": [
            {
                "trigger": "on_weapon_hit",
                "effects": [
                    {
                        "type": "conditional_extra_damage",
                        "formula": "1d4",
                        "damage_type": "radiant",
                        "target_match": "any",
                    }
                ],
            }
        ]
    }

    result = await execute_phase(
        db=None,
        instance=instance,
        trigger="on_weapon_hit",
        ctx_overrides={
            "attacker_token_id": instance.caster_token_id,
            "target_token_id": 999,  # not the primary target
            "attack_kind": "weapon",
            "critical": False,
        },
        spell_data=spell_data,
    )

    assert len(result.bonus_damages) == 1
    bonus = result.bonus_damages[0]
    assert bonus.damage == 3
    assert bonus.damage_type == "radiant"


@pytest.mark.asyncio
async def test_target_match_any_still_requires_weapon_attack_kind():
    instance = make_instance(params={})
    spell_data = {
        "effects": [
            {
                "trigger": "on_weapon_hit",
                "effects": [
                    {
                        "type": "conditional_extra_damage",
                        "formula": "1d4",
                        "damage_type": "radiant",
                        "target_match": "any",
                    }
                ],
            }
        ]
    }

    result = await execute_phase(
        db=None,
        instance=instance,
        trigger="on_weapon_hit",
        ctx_overrides={
            "attacker_token_id": instance.caster_token_id,
            "target_token_id": 999,
            "attack_kind": "spell",  # not a weapon attack
            "critical": False,
        },
        spell_data=spell_data,
    )

    assert result.bonus_damages == []


@pytest.mark.asyncio
async def test_unknown_target_match_value_falls_back_to_primary_matching():
    instance = make_instance(params={})
    spell_data = {
        "effects": [
            {
                "trigger": "on_weapon_hit",
                "effects": [
                    {
                        "type": "conditional_extra_damage",
                        "formula": "1d4",
                        "damage_type": "radiant",
                        # Typo / unknown value must NOT loosen target matching.
                        "target_match": "all",
                    }
                ],
            }
        ]
    }

    result = await execute_phase(
        db=None,
        instance=instance,
        trigger="on_weapon_hit",
        ctx_overrides={
            "attacker_token_id": instance.caster_token_id,
            "target_token_id": 999,  # not the primary target
            "attack_kind": "weapon",
            "critical": False,
        },
        spell_data=spell_data,
    )

    assert result.bonus_damages == []


@pytest.mark.asyncio
async def test_camelcase_target_match_any_is_honored(monkeypatch: pytest.MonkeyPatch):
    instance = make_instance(params={})
    monkeypatch.setattr(
        "app.services.spell_runtime_engine.verbs.damage.eval_formula",
        _fake_eval_factory(
            FormulaResult(
                total=2,
                dice_groups=[DiceGroup(count=1, sides=4, rolls=[2], total=2)],
                modifier=0,
                breakdown="1d4(2)",
            )
        ),
    )
    spell_data = {
        "effects": [
            {
                "trigger": "on_weapon_hit",
                "effects": [
                    {
                        "type": "conditional_extra_damage",
                        "formula": "1d4",
                        "damage_type": "radiant",
                        # camelCase variant should be accepted.
                        "targetMatch": "any",
                    }
                ],
            }
        ]
    }

    result = await execute_phase(
        db=None,
        instance=instance,
        trigger="on_weapon_hit",
        ctx_overrides={
            "attacker_token_id": instance.caster_token_id,
            "target_token_id": 999,
            "attack_kind": "weapon",
            "critical": False,
        },
        spell_data=spell_data,
    )

    assert len(result.bonus_damages) == 1
    assert result.bonus_damages[0].damage == 2


def test_roll_runtime_damage_critical_doubles_only_damage_dice(monkeypatch: pytest.MonkeyPatch):
    instance = make_instance(params={})
    monkeypatch.setattr(
        "app.services.spell_runtime_engine.verbs.damage.eval_formula",
        _fake_eval_factory(
            FormulaResult(
                total=7,
                dice_groups=[DiceGroup(count=1, sides=6, rolls=[4], total=4)],
                modifier=3,
                breakdown="1d6(4)+3",
            ),
            FormulaResult(
                total=5,
                dice_groups=[DiceGroup(count=1, sides=6, rolls=[2], total=2)],
                modifier=3,
                breakdown="1d6(2)+3",
            ),
        ),
    )

    total, roll_data = roll_runtime_damage(formula="1d6+3", instance=instance, critical=True)

    assert total == 9  # (4+2) damage dice + 3 modifier (single-counted)
    assert roll_data["roll"]["dice"] == "2d6"
    assert roll_data["roll"]["rolls"] == [4, 2]
    assert roll_data["roll"]["modifier"] == 3
