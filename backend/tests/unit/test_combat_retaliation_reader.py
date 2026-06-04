"""Unit tests for the on_take_damage retaliation reader.

Covers the gating boundaries (melee-only, temp-HP requirement, upcast scaling)
and the fire_shield cross-check. Pure-function tests over the spell definitions —
no DB or HTTP. See tests/integration/test_combat_retaliation.py for the
end-to-end QA-harness regression.
"""
from app.services.combat_retaliation_service import read_retaliation_strikes


def _buff(spell_id: str, cast_level: int = 1, selected_option=None) -> dict:
    effect = {"spell_buff": True, "spell_id": spell_id, "cast_level": cast_level}
    if selected_option:
        effect["selected_option"] = selected_option
    return effect


def test_armor_of_agathys_melee_hit_with_temp_hp_retaliates():
    strikes = read_retaliation_strikes(
        [_buff("armor_of_agathys")], defender_temp_hp_before=5, is_melee=True)
    assert len(strikes) == 1
    assert strikes[0].spell_id == "armor_of_agathys"
    assert strikes[0].damage == 5
    assert strikes[0].damage_type == "cold"


def test_armor_of_agathys_no_retaliation_without_temp_hp():
    # requires_temp_hp gate: once the temp HP is gone, the shield is spent.
    strikes = read_retaliation_strikes(
        [_buff("armor_of_agathys")], defender_temp_hp_before=0, is_melee=True)
    assert strikes == []


def test_armor_of_agathys_no_retaliation_on_ranged_hit():
    # melee_only gate: a ranged attacker takes no cold damage.
    strikes = read_retaliation_strikes(
        [_buff("armor_of_agathys")], defender_temp_hp_before=5, is_melee=False)
    assert strikes == []


def test_armor_of_agathys_upcast_scales_retaliation():
    # 5 + 5 * (cast_level - base_level): a 2nd-level slot deals 10 cold.
    strikes = read_retaliation_strikes(
        [_buff("armor_of_agathys", cast_level=2)],
        defender_temp_hp_before=10, is_melee=True)
    assert len(strikes) == 1
    assert strikes[0].damage == 10


def test_fire_shield_retaliates_2d8_fire_on_melee():
    # Fire Shield has no temp HP; it retaliates while the shield is up.
    strikes = read_retaliation_strikes(
        [_buff("fire_shield")], defender_temp_hp_before=0, is_melee=True)
    assert len(strikes) == 1
    assert strikes[0].spell_id == "fire_shield"
    assert strikes[0].damage_type == "fire"
    assert 2 <= strikes[0].damage <= 16  # 2d8


def test_fire_shield_no_retaliation_on_ranged_hit():
    strikes = read_retaliation_strikes(
        [_buff("fire_shield")], defender_temp_hp_before=0, is_melee=False)
    assert strikes == []


def test_non_retaliation_buffs_and_plain_effects_are_ignored():
    # A spell_buff for a spell with no on_take_damage phase, an aura bonus_damage
    # entry, and a malformed effect must all be skipped without error.
    effects = [
        _buff("mage_armor"),
        {"id": "aura", "bonus_damage": [{"formula": "1d6", "damage_type": "fire"}]},
        {"spell_buff": True},  # no spell_id
        "not-a-dict",
    ]
    strikes = read_retaliation_strikes(
        effects, defender_temp_hp_before=5, is_melee=True)
    assert strikes == []
