from app.schemas.combat import DiceRoll
from app.services import combat_check_service as service


def _roll(dice: str, rolls: list[int], modifier: int) -> DiceRoll:
    return DiceRoll(
        dice=dice,
        rolls=rolls,
        modifier=modifier,
        total=sum(rolls) + modifier,
    )


def test_build_ability_check_outputs_preserve_contract():
    check_roll = _roll("2d20", [7, 16], 5)
    narrative = service.build_ability_check_narrative(
        participant_name="Aria",
        check_name="隐匿",
        check_total=21,
        dc=15,
        success=True,
        description="尝试潜行穿过走廊",
    )
    result = service.build_ability_check_result(
        participant_name="Aria",
        participant_token_id=8,
        check_type="stealth",
        ability_used="dexterity",
        check_roll=check_roll,
        check_modifier=5,
        check_total=21,
        had_advantage=True,
        had_disadvantage=False,
        advantage_reasons=["隐形术"],
        dc=15,
        success=True,
        narrative=narrative,
    )
    combat_log = service.build_ability_check_combat_log(
        participant_name="Aria",
        check_name="隐匿",
        ability_cn="敏捷",
        rolls=[7, 16],
        check_modifier=5,
        check_total=21,
        dc=15,
        success=True,
        had_advantage=True,
        had_disadvantage=False,
        advantage_reasons=["隐形术"],
        narrative=narrative,
    )
    meta = service.build_ability_check_chat_meta(
        participant_name="Aria",
        participant_token_id=8,
        check_type="stealth",
        ability_used="dexterity",
        check_total=21,
        dc=15,
        success=True,
        had_advantage=True,
        had_disadvantage=False,
        check_roll=check_roll,
    )

    assert "成功通过了DC 15的检定" in narrative
    assert result.check_total == 21
    assert "🎯优势" in combat_log
    assert meta["combat_type"] == "ability_check"
    assert meta["check_roll"]["dice"] == "2d20"


def test_build_contest_outputs_cover_tie_and_effect_rules():
    attacker_roll = _roll("2d20", [8, 15], 6)
    defender_roll = _roll("1d20", [15], 6)
    narrative = service.build_contest_narrative(
        contest_type="grapple",
        attacker_name="Bran",
        defender_name="Ghoul",
        attacker_wins=False,
        tie=True,
        effect_applied=None,
        description="门口发生一轮缠斗。",
    )
    result = service.build_contest_result(
        contest_type="grapple",
        attacker_name="Bran",
        attacker_token_id=1,
        attacker_check_type="athletics",
        attacker_roll=attacker_roll,
        attacker_modifier=6,
        attacker_total=21,
        attacker_had_advantage=True,
        attacker_had_disadvantage=False,
        attacker_advantage_reasons=["脆弱诅咒: 劣势"],
        defender_name="Ghoul",
        defender_token_id=2,
        defender_check_type="athletics",
        defender_roll=defender_roll,
        defender_modifier=6,
        defender_total=21,
        defender_had_advantage=False,
        defender_had_disadvantage=False,
        defender_advantage_reasons=[],
        attacker_wins=False,
        tie=True,
        effect_applied=None,
        narrative=narrative,
    )
    combat_log = service.build_contest_combat_log(
        contest_type="grapple",
        attacker_name="Bran",
        attacker_check_type="athletics",
        attacker_roll=attacker_roll,
        attacker_modifier=6,
        attacker_total=21,
        attacker_had_advantage=True,
        attacker_had_disadvantage=False,
        attacker_advantage_reasons=["脆弱诅咒: 劣势"],
        defender_name="Ghoul",
        defender_check_type="athletics",
        defender_roll=defender_roll,
        defender_modifier=6,
        defender_total=21,
        defender_had_advantage=False,
        defender_had_disadvantage=False,
        defender_advantage_reasons=[],
        attacker_wins=False,
        tie=True,
        effect_applied=None,
        narrative=narrative,
    )
    meta = service.build_contest_chat_meta(
        contest_type="grapple",
        attacker_name="Bran",
        attacker_token_id=1,
        defender_name="Ghoul",
        defender_token_id=2,
        attacker_total=21,
        defender_total=21,
        attacker_wins=False,
        tie=True,
        effect_applied=None,
        attacker_roll=attacker_roll,
        defender_roll=defender_roll,
        attacker_advantage_reasons=["脆弱诅咒: 劣势"],
        defender_advantage_reasons=[],
    )

    assert "平手" in narrative
    assert result.tie is True
    assert result.attacker_advantage_reasons == ["脆弱诅咒: 劣势"]
    assert "Bran: 脆弱诅咒: 劣势" in combat_log
    assert "对抗规则" in combat_log
    assert meta["combat_type"] == "contest"
    assert meta["defender_roll"]["total"] == 21
    assert meta["attacker_advantage_reasons"] == ["脆弱诅咒: 劣势"]


def test_resolve_check_display_name_maps_skills_only():
    assert service.resolve_check_display_name("stealth", True) == "隐匿"
    assert service.resolve_check_display_name("strength", False) == "strength"
