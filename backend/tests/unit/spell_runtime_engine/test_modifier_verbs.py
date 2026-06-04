import pytest

from app.services.spell_runtime_engine import evaluate_phase

from ._helpers import make_instance


@pytest.mark.asyncio
async def test_modifier_verbs_emit_envelopes_matching_legacy_shape():
    instance = make_instance(params={})
    spell_data = {
        "effects": [
            {
                "trigger": "on_cast",
                "effects": [
                    {"type": "grant_advantage", "on": "saving_throw"},
                    {"type": "grant_disadvantage", "on": "ability_check"},
                    {
                        "type": "grant_resistance",
                        "damage_types": ["fire", "cold"],
                    },
                    {"type": "grant_immunity", "damage_types": ["necrotic"]},
                    {
                        "type": "modify_roll",
                        "roll_types": ["attack_roll"],
                        "formula": "1d4",
                    },
                ],
            }
        ]
    }

    # Modifier projection must be evaluate-only — must not mutate instance.
    result = await evaluate_phase(
        db=None,
        instance=instance,
        trigger="on_cast",
        ctx_overrides={},
        spell_data=spell_data,
    )

    types = [env["modifiers"][0]["type"] for env in result.modifier_effects]
    targets = [env["modifiers"][0]["target"] for env in result.modifier_effects]
    assert types == ["advantage", "disadvantage", "resistance", "immunity", "bonus"]
    assert targets == [
        "saving_throw",
        "ability_check",
        "damage_taken",
        "damage_taken",
        "attack_roll",
    ]
    for envelope in result.modifier_effects:
        assert envelope["spell_id"] == "hex"
        assert envelope["spell_runtime"] is True
        assert envelope["name"] == "脆弱诅咒"
        assert envelope["id"].startswith(f"spell_runtime_{instance.id}_")

    # Resistance / immunity carry damage types under condition.damage_type.
    resistance = next(env for env in result.modifier_effects if env["modifiers"][0]["type"] == "resistance")
    assert resistance["modifiers"][0]["condition"] == {"damage_type": ["fire", "cold"]}

    # modify_roll preserves formula.
    bonus = next(env for env in result.modifier_effects if env["modifiers"][0]["type"] == "bonus")
    assert bonus["modifiers"][0]["value"] == "1d4"

    assert instance.params == {}
    assert result.applied is False


@pytest.mark.asyncio
async def test_modify_roll_emits_envelope_per_normalized_roll_type_for_bless():
    """Bless declares roll_types=['attack', 'save'] which should normalize to
    canonical attack_roll / saving_throw envelopes the frontend resolver
    already understands."""
    instance = make_instance(params={})
    spell_data = {
        "effects": [
            {
                "trigger": "on_cast",
                "effects": [
                    {
                        "type": "modify_roll",
                        "roll_types": ["attack", "save"],
                        "formula": "1d4",
                        "operation": "add",
                    }
                ],
            }
        ]
    }

    result = await evaluate_phase(
        db=None,
        instance=instance,
        trigger="on_cast",
        ctx_overrides={},
        spell_data=spell_data,
    )

    targets = [env["modifiers"][0]["target"] for env in result.modifier_effects]
    assert targets == ["attack_roll", "saving_throw"]

    for env in result.modifier_effects:
        modifier = env["modifiers"][0]
        assert modifier["type"] == "bonus"
        assert modifier["value"] == "1d4"
        assert modifier["operation"] == "add"

    # Stable distinct envelope ids per target so downstream de-duplication
    # treats attack-roll and saving-throw bonuses independently.
    ids = [env["id"] for env in result.modifier_effects]
    assert ids == [
        f"spell_runtime_{instance.id}_modify_roll_attack_roll",
        f"spell_runtime_{instance.id}_modify_roll_saving_throw",
    ]


@pytest.mark.asyncio
async def test_modify_roll_with_no_roll_types_defaults_to_attack_roll():
    instance = make_instance(params={})
    spell_data = {
        "effects": [
            {
                "trigger": "on_cast",
                "effects": [
                    {"type": "modify_roll", "formula": "1"},
                ],
            }
        ]
    }

    result = await evaluate_phase(
        db=None,
        instance=instance,
        trigger="on_cast",
        ctx_overrides={},
        spell_data=spell_data,
    )

    assert len(result.modifier_effects) == 1
    modifier = result.modifier_effects[0]["modifiers"][0]
    assert modifier["target"] == "attack_roll"
    assert modifier["type"] == "bonus"
    assert modifier["value"] == "1"
    # No operation field declared → not propagated.
    assert "operation" not in modifier
