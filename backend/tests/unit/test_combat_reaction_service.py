from app.schemas.combat import DiceRoll
from app.services import combat_reaction_service as service


def _roll(dice: str, total: int, rolls: list[int] | None = None, modifier: int = 0) -> DiceRoll:
    return DiceRoll(
        dice=dice,
        rolls=rolls or [total - modifier],
        modifier=modifier,
        total=total,
    )


def test_resolve_defense_reaction_handles_shield_spell_turning_hit_into_miss():
    result = service.resolve_defense_reaction(
        reaction_id="shield_spell",
        reactor_name="Lia",
        original_damage=11,
        attack_total=16,
        target_ac=12,
        dex_mod=3,
        level=5,
        proficiency_bonus=3,
        roll_dice=lambda *_args: _roll("1d20", 0),
    )

    assert result.new_damage == 0
    assert result.ac_bonus == 5
    assert result.attack_now_misses is True
    assert "护盾术" in result.description


def test_resolve_defense_reaction_handles_uncanny_dodge_and_parry():
    uncanny = service.resolve_defense_reaction(
        reaction_id="uncanny_dodge",
        reactor_name="Vale",
        original_damage=13,
        attack_total=18,
        target_ac=14,
        dex_mod=4,
        level=7,
        proficiency_bonus=3,
        roll_dice=lambda *_args: _roll("1d20", 0),
    )
    parry = service.resolve_defense_reaction(
        reaction_id="parry",
        reactor_name="Vale",
        original_damage=12,
        attack_total=18,
        target_ac=14,
        dex_mod=4,
        level=7,
        proficiency_bonus=3,
        roll_dice=lambda *_args: _roll("1d8", 7, [3], 4),
    )

    assert uncanny.new_damage == 6
    assert uncanny.attack_now_misses is False
    assert parry.new_damage == 5
    assert "招架" in parry.description


def test_build_attack_and_spell_reaction_descriptions_include_expected_details():
    attack_description = service.build_attack_reaction_description(
        reaction_id="sentinel",
        reactor_name="Bran",
        target_name="Ghoul",
        total_attack=19,
        target_ac=13,
        hit=True,
        total_damage=9,
    )
    spell_description = service.build_spell_reaction_description(
        reaction_id="hellish_rebuke",
        reactor_name="Mira",
        spell_slot_level=2,
        total_damage=14,
    )

    assert "哨兵攻击" in attack_description
    assert "速度降为0" in attack_description
    assert "炼狱叱喝" in spell_description
    assert "14" in spell_description


def test_build_reaction_chat_meta_preserves_contract():
    meta = service.build_reaction_chat_meta(
        reaction_id="shield_spell",
        reactor_token_id=8,
        target_token_id=9,
        damage_reduced=12,
        attack_now_misses=True,
    )

    assert meta == {
        "combat_type": "reaction",
        "reaction_id": "shield_spell",
        "reactor_token_id": 8,
        "target_token_id": 9,
        "damage_reduced": 12,
        "attack_now_misses": True,
    }
