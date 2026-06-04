import app.services.passive_feature_service as passive_feature_service
from app.schemas.combat import DiceRoll
from app.services import combat_attack_service as service


def _roll(dice: str, rolls: list[int], modifier: int = 0) -> DiceRoll:
    return DiceRoll(
        dice=dice,
        rolls=rolls,
        modifier=modifier,
        total=sum(rolls) + modifier,
    )


def test_merge_roll_modifier_cancels_opposed_states():
    assert service.merge_roll_modifier("disadvantage", grants_advantage=True) is None
    assert service.merge_roll_modifier("advantage", grants_disadvantage=True) is None
    assert service.merge_roll_modifier(None, grants_advantage=True) == "advantage"
    assert service.merge_roll_modifier(None, grants_disadvantage=True) == "disadvantage"


def test_roll_attack_d20_supports_advantage_and_forced_rolls():
    rolls = iter([4, 17])

    advantaged = service.roll_attack_d20(
        roll_modifier="advantage",
        randint=lambda _start, _end: next(rolls),
    )
    forced = service.roll_attack_d20(
        roll_modifier=None,
        forced_d20=25,
    )

    assert advantaged.attack_d20 == 17
    assert advantaged.d20_rolls == [4, 17]
    assert advantaged.dice_notation == "2d20kh1"
    assert forced.attack_d20 == 20
    assert forced.d20_rolls == [20]


def test_resolve_attack_outcome_handles_auto_crit_and_fumbles():
    normal_hit = service.resolve_attack_outcome(
        attack_d20=15,
        attack_bonus=7,
        target_ac=18,
        target_auto_crit=True,
    )
    fumble = service.resolve_attack_outcome(
        attack_d20=1,
        attack_bonus=99,
        target_ac=5,
    )

    assert normal_hit.hit is True
    assert normal_hit.critical is True
    assert normal_hit.total_attack == 22
    assert fumble.hit is False
    assert fumble.fumble is True


def test_apply_great_weapon_fighting_rerolls_low_rolls():
    result = service.apply_great_weapon_fighting(
        damage_roll=_roll("2d6", [2, 5], modifier=3),
        die_size=6,
        attack_properties=["Two-Handed"],
        fighting_style="great_weapon_fighting",
        randint=lambda _start, _end: 6,
    )

    assert result.applied is True
    assert result.original_rolls == [2, 5]
    assert result.roll.rolls == [6, 5]
    assert result.roll.total == 14


def test_roll_base_attack_damage_applies_tavern_brawler_and_savage_attacker():
    rolls = iter(
        [
            _roll("2d4", [1, 2], modifier=1),
            _roll("2d4", [4, 3], modifier=1),
        ]
    )

    result = service.roll_base_attack_damage(
        attack_damage="1+力量",
        feat_ids=["tavern_brawler", "savage_attacker"],
        attack_properties=None,
        normal_range=5,
        fighting_style=None,
        damage_bonus=0,
        rage_damage_bonus=0,
        critical=True,
        chosen_element=None,
        damage_type=None,
        parse_damage_dice=lambda _value: (0, 0, 1),
        roll_dice=lambda _num_dice, _die_size, _modifier: next(rolls),
    )

    assert result.tavern_brawler_applied is True
    assert result.savage_attacker_applied is True
    assert result.num_dice == 2
    assert result.die_size == 4
    assert result.damage_roll.rolls == [4, 3]
    assert result.damage_dealt == 8


def test_roll_base_attack_damage_applies_elemental_adept():
    result = service.roll_base_attack_damage(
        attack_damage="2d6",
        feat_ids=["elemental_adept"],
        attack_properties=None,
        normal_range=None,
        fighting_style=None,
        damage_bonus=0,
        rage_damage_bonus=0,
        critical=False,
        chosen_element="fire",
        damage_type="fire",
        parse_damage_dice=lambda _value: (2, 6, 0),
        roll_dice=lambda _num_dice, _die_size, _modifier: _roll("2d6", [1, 3]),
    )

    assert result.elemental_adept_applied is True
    assert result.damage_roll.rolls == [2, 3]
    assert result.damage_roll.total == 5
    assert result.damage_dealt == 5


def test_resolve_enlarge_reduce_damage_handles_bonus_and_penalty():
    add_result = service.resolve_enlarge_reduce_damage(
        transformation_data={
            "type": "modifier",
            "modifiers": [{"stat": "weapon_damage", "value": "1d4", "operation": "add_dice"}],
            "activeMode": "enlarge",
        },
        critical=False,
        parse_damage_dice=lambda _value: (1, 4, 0),
        roll_dice=lambda _num_dice, _die_size, _modifier: _roll("1d4", [3]),
    )
    subtract_result = service.resolve_enlarge_reduce_damage(
        transformation_data={
            "type": "modifier",
            "modifiers": [{"stat": "weapon_damage", "value": "1d4", "operation": "subtract_dice"}],
            "activeMode": "reduce",
        },
        critical=True,
        parse_damage_dice=lambda _value: (1, 4, 0),
        roll_dice=lambda num_dice, die_size, _modifier: _roll(f"{num_dice}d{die_size}", [2, 4]),
    )

    assert add_result.damage == 3
    assert add_result.mode == "enlarge"
    assert subtract_result.damage == -6
    assert subtract_result.mode == "reduce"
    assert subtract_result.roll.dice == "2d4"


def test_resolve_critical_bonus_damage_helpers(monkeypatch):
    monkeypatch.setattr(service, "check_savage_attacks", lambda _race_id, _is_melee: True)
    monkeypatch.setattr(service, "get_brutal_critical_dice", lambda _class_id, _level: 2)

    savage_result = service.resolve_savage_attacks_damage(
        critical=True,
        race_id="half_orc",
        is_melee=True,
        die_size=12,
        roll_dice=lambda _num_dice, _die_size, _modifier: _roll("1d12", [9]),
    )
    brutal_result = service.resolve_brutal_critical_damage(
        critical=True,
        class_id="barbarian",
        level=13,
        die_size=12,
        roll_dice=lambda _num_dice, _die_size, _modifier: _roll("2d12", [7, 8]),
    )
    extra_result = service.resolve_extra_damage(
        extra_damage_dice="1d6",
        extra_damage_type="poison",
        critical=True,
        parse_damage_dice=lambda _value: (1, 6, 0),
        roll_dice=lambda num_dice, die_size, _modifier: _roll(f"{num_dice}d{die_size}", [3, 4]),
    )

    assert savage_result.damage == 9
    assert brutal_result.damage == 15
    assert extra_result.damage == 7
    assert extra_result.damage_type == "poison"
    assert extra_result.roll.dice == "2d6"


def test_resolve_sneak_attack_and_divine_strike_damage(monkeypatch):
    monkeypatch.setattr(passive_feature_service, "get_sneak_attack_dice", lambda _level: "2d6")
    monkeypatch.setattr(
        passive_feature_service,
        "get_divine_strike",
        lambda _class_id, _level, _subclass_id: {"damage": "1d8", "damageType": "radiant"},
    )

    sneak_attack_result = service.resolve_sneak_attack_damage(
        sneak_attack_enabled=True,
        attacker_class_id="rogue",
        attacker_level=5,
        critical=True,
        parse_damage_dice=lambda _value: (2, 6, 0),
        roll_dice=lambda num_dice, die_size, _modifier: _roll(f"{num_dice}d{die_size}", [2, 3, 4, 5]),
    )
    divine_strike_result = service.resolve_divine_strike_damage(
        attacker_class_id="cleric",
        attacker_level=8,
        subclass_id="tempest",
        critical=False,
        parse_damage_dice=lambda _value: (1, 8, 0),
        roll_dice=lambda _num_dice, _die_size, _modifier: _roll("1d8", [6]),
    )

    assert sneak_attack_result.roll.dice == "4d6"
    assert sneak_attack_result.damage == 14
    assert divine_strike_result.damage == 6
    assert divine_strike_result.damage_type == "radiant"


def test_build_attack_result_returns_attack_schema():
    attack_roll = _roll("1d20", [17], modifier=7)
    damage_roll = _roll("1d8", [6], modifier=4)

    result = service.build_attack_result(
        hit=True,
        critical=False,
        fumble=False,
        attack_roll=attack_roll,
        damage_roll=damage_roll,
        extra_damage_roll=None,
        savage_attacks_roll=None,
        brutal_critical_roll=None,
        inspiration_roll=None,
        total_attack=24,
        target_ac=16,
        damage_dealt=10,
        damage_type="slashing",
        extra_damage_dealt=0,
        extra_damage_type=None,
        savage_attacks_damage=0,
        brutal_critical_damage=0,
        sneak_attack_roll=None,
        sneak_attack_damage=0,
        enlarge_reduce_roll=None,
        enlarge_reduce_damage=0,
        enlarge_reduce_mode=None,
        narrative="",
        hp_change=-10,
        new_hp=2,
        target_defeated=False,
        attacker_name="Aria",
        target_name="Goblin",
        attack_name="长剑",
    )

    assert result.total_attack == 24
    assert result.damage_roll.total == 10
    assert result.hp_change == -10
    assert result.attack_name == "长剑"


def test_build_attack_chat_meta_uses_canonical_damage_labels():
    meta = service.build_attack_chat_meta(
        attacker_token_id=1,
        attacker_character_id=2,
        attacker_monster_instance_id=None,
        target_token_id=3,
        target_character_id=4,
        target_monster_instance_id=None,
        attacker_name="Aria",
        target_name="Goblin",
        target_ac=15,
        attack_name="长剑",
        is_ranged=False,
        total_attack=21,
        hit=True,
        critical=False,
        fumble=False,
        total_damage=9,
        attack_damage_type="slashing",
        base_damage=9,
        extra_damage=0,
        extra_damage_type=None,
        savage_attacks_damage=0,
        brutal_critical_damage=0,
        sneak_attack_damage=0,
        divine_strike_damage=0,
        divine_strike_type=None,
        rage_damage_bonus=2,
        rage_resistance_applied=False,
        damage_before_resistance=9,
        target_defeated=False,
        xp_value=None,
        attack_roll=_roll("1d20", [14], modifier=7),
        damage_roll=_roll("1d8", [5], modifier=4),
        extra_damage_roll=None,
        savage_attacks_roll=None,
        brutal_critical_roll=None,
        sneak_attack_roll=None,
        divine_strike_roll=None,
        inspiration_roll=None,
        inspiration_die=None,
        narrative_prompt="prompt",
        damage_type_labels={"slashing": "挥砍"},
    )

    assert meta["attack_type"] == "melee"
    assert meta["damage_type"] == "挥砍"
    assert meta["damage_before_resistance"] is None
    assert meta["attack_roll"]["total"] == 21


def test_build_attack_combat_log_includes_damage_breakdown_and_tips(monkeypatch):
    monkeypatch.setattr(service, "get_brutal_critical_dice", lambda _class_id, _level: 2)

    content = service.build_attack_combat_log(
        attacker_name="Aria",
        target_name="Goblin",
        weapon_name="爪击 (Claw)",
        is_off_hand=False,
        roll_modifier="advantage",
        attack_d20=19,
        d20_rolls=[8, 19],
        advantage_reasons=["高地优势"],
        effect_reasons=["目标被束缚"],
        attack_bonus_override=None,
        attack_bonus=7,
        ability_mod=4,
        ability_name="力量",
        prof_bonus=3,
        weapon_proficient=True,
        fighting_style_atk_bonus=0,
        fighting_style_atk_label="",
        power_attack_active=True,
        magic_bonus=1,
        inspiration_roll=_roll("1d6", [4]),
        inspiration_value=4,
        inspiration_die="d6",
        attack_bonus_add=2,
        attack_bonus_add_source="祝福",
        total_attack=26,
        hit=True,
        critical=True,
        fumble=False,
        crit_range=19,
        attacker_class_id="barbarian",
        attacker_level=13,
        damage_roll=_roll("2d6", [2, 6], modifier=15),
        attack_damage_type="slashing",
        damage_ability_mod=4,
        damage_ability_name="力量",
        dueling_bonus=0,
        rage_damage_bonus=2,
        gwf_rerolled=True,
        gwf_original_rolls=[1, 6],
        extra_damage_roll=_roll("2d6", [3, 4]),
        extra_damage_dealt=7,
        extra_damage_type="fire",
        savage_attacks_roll=_roll("1d6", [5]),
        savage_attacks_damage=5,
        brutal_critical_roll=_roll("2d6", [4, 6]),
        brutal_critical_damage=10,
        sneak_attack_roll=None,
        sneak_attack_damage=0,
        divine_strike_roll=None,
        divine_strike_damage=0,
        divine_strike_type=None,
        enlarge_reduce_roll=None,
        enlarge_reduce_damage=0,
        damage_before_resistance=34,
        total_damage=17,
        rage_resistance_applied=True,
        attacker_is_reckless=True,
        halfling_lucky_reroll=False,
        relentless_triggered=True,
        target_defeated=True,
        thunderbolt_strike_note="⚡ 被击退10尺",
        damage_type_labels={"slashing": "挥砍", "fire": "火焰"},
    )

    assert "**Aria** 用 **爪击**" in content
    assert "🟢优势" in content
    assert "1→2" in content
    assert "野蛮重击" in content
    assert "狂暴抗性" in content
    assert "不屈" in content
    assert "⚡ 被击退10尺" in content
