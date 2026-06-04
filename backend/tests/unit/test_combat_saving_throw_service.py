from app.schemas.combat import DiceRoll, SavingThrowTargetResult
from app.services import combat_saving_throw_service as service


def _roll(dice: str, rolls: list[int], modifier: int) -> DiceRoll:
    return DiceRoll(
        dice=dice,
        rolls=rolls,
        modifier=modifier,
        total=sum(rolls) + modifier,
    )


def _target_result(
    *,
    name: str,
    success: bool,
    damage_dealt: int,
    target_defeated: bool = False,
) -> SavingThrowTargetResult:
    return SavingThrowTargetResult(
        target_name=name,
        target_token_id=1,
        save_roll=_roll("1d20", [12], 3),
        save_modifier=3,
        save_total=15,
        save_dc=14,
        success=success,
        damage_roll=_roll("8d6", [4, 5, 6, 3, 2, 1, 4, 5], 0),
        damage_dealt=damage_dealt,
        damage_type="火焰",
        hp_change=-damage_dealt if damage_dealt else None,
        new_hp=8 if damage_dealt else None,
        target_defeated=target_defeated,
    )


def test_build_saving_throw_narrative_handles_single_target_success():
    narrative = service.build_saving_throw_narrative(
        source_name="法师",
        effect_name="火球术",
        save_type="dexterity",
        save_dc=15,
        target_results=[_target_result(name="哥布林", success=True, damage_dealt=12)],
        successful_saves=1,
        failed_saves=0,
        damage_type="火焰",
        half_on_success=True,
        ability_names={"dexterity": "敏捷"},
    )

    assert "哥布林成功通过了DC 15的敏捷豁免" in narrative
    assert "12点火焰伤害（减半）" in narrative


def test_build_saving_throw_combat_log_includes_damage_and_defeat_marker():
    combat_log = service.build_saving_throw_combat_log(
        source_name="法师",
        effect_name="火球术",
        save_type="dexterity",
        save_dc=15,
        target_results=[
            _target_result(name="哥布林", success=False, damage_dealt=24, target_defeated=True),
            _target_result(name="战士", success=True, damage_dealt=12),
        ],
        damage_type="火焰",
        half_on_success=True,
        narrative="法师施放了火球术！1人成功，1人失败。",
        ability_names={"dexterity": "敏捷"},
    )

    assert "DC 15 敏捷豁免" in combat_log
    assert "哥布林" in combat_log and "💀" in combat_log
    assert "12 火焰（减半）" in combat_log


def test_build_saving_throw_chat_meta_and_result_preserve_contract():
    target_results = [_target_result(name="哥布林", success=False, damage_dealt=24)]
    damage_roll = _roll("8d6", [4, 5, 6, 3, 2, 1, 4, 5], 0)

    meta = service.build_saving_throw_chat_meta(
        effect_name="火球术",
        source_name="法师",
        save_type="dexterity",
        save_dc=15,
        total_targets=1,
        successful_saves=0,
        failed_saves=1,
        damage_roll=damage_roll,
    )
    result = service.build_saving_throw_result(
        effect_name="火球术",
        source_name="法师",
        save_type="dexterity",
        save_dc=15,
        target_results=target_results,
        successful_saves=0,
        failed_saves=1,
        narrative="法师施放了火球术！哥布林未能通过豁免。",
    )

    assert meta["combat_type"] == "saving_throw"
    assert meta["damage_roll"]["dice"] == "8d6"
    assert result.total_targets == 1
    assert result.failed_saves == 1
    assert result.target_results[0].target_name == "哥布林"
