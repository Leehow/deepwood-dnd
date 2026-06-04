from __future__ import annotations

from typing import Any, Optional

from app.schemas.combat import AbilityCheckResult, ContestResult, DiceRoll

SKILL_CN_MAP = {
    "athletics": "运动",
    "acrobatics": "杂技",
    "sleight_of_hand": "巧手",
    "stealth": "隐匿",
    "arcana": "奥秘",
    "history": "历史",
    "investigation": "调查",
    "nature": "自然",
    "religion": "宗教",
    "animal_handling": "驯兽",
    "insight": "洞悉",
    "medicine": "医药",
    "perception": "察觉",
    "survival": "求生",
    "deception": "欺瞒",
    "intimidation": "威吓",
    "performance": "表演",
    "persuasion": "游说",
}

CONTEST_TYPE_CN_MAP = {
    "grapple": "擒抱",
    "shove": "推撞",
    "custom": "对抗",
}

CONTEST_CHECK_CN_MAP = {
    "athletics": "运动",
    "acrobatics": "杂技",
    "strength": "力量",
    "dexterity": "敏捷",
}


def resolve_check_display_name(check_type: str, is_skill_check: bool) -> str:
    if not is_skill_check:
        return check_type
    return SKILL_CN_MAP.get(check_type.lower(), check_type)


def build_ability_check_narrative(
    *,
    participant_name: str,
    check_name: str,
    check_total: int,
    dc: Optional[int],
    success: Optional[bool],
    description: Optional[str],
) -> str:
    narrative = f"{participant_name}进行了{check_name}检定"
    if description:
        narrative = f"{participant_name}{description}"

    if success is True:
        return narrative + f"，成功通过了DC {dc}的检定！"
    if success is False:
        return narrative + f"，未能通过DC {dc}的检定。"
    return narrative + f"，结果为{check_total}。"


def build_ability_check_result(
    *,
    participant_name: str,
    participant_token_id: int,
    check_type: str,
    ability_used: str,
    check_roll: DiceRoll,
    check_modifier: int,
    check_total: int,
    had_advantage: bool,
    had_disadvantage: bool,
    advantage_reasons: list[str],
    dc: Optional[int],
    success: Optional[bool],
    narrative: str,
) -> AbilityCheckResult:
    return AbilityCheckResult(
        participant_name=participant_name,
        participant_token_id=participant_token_id,
        check_type=check_type,
        ability_used=ability_used,
        check_roll=check_roll,
        check_modifier=check_modifier,
        check_total=check_total,
        had_advantage=had_advantage,
        had_disadvantage=had_disadvantage,
        advantage_reasons=advantage_reasons,
        dc=dc,
        success=success,
        narrative=narrative,
    )


def build_ability_check_combat_log(
    *,
    participant_name: str,
    check_name: str,
    ability_cn: str,
    rolls: list[int],
    check_modifier: int,
    check_total: int,
    dc: Optional[int],
    success: Optional[bool],
    had_advantage: bool,
    had_disadvantage: bool,
    advantage_reasons: list[str],
    narrative: str,
) -> str:
    result_emoji = ""
    if success is True:
        result_emoji = "✅"
    elif success is False:
        result_emoji = "❌"

    rolls_str = "+".join(str(roll) for roll in rolls)
    if len(rolls) > 1:
        rolls_str = f"({rolls_str})"

    mod_sign = "+" if check_modifier >= 0 else ""
    adv_tag = ""
    if had_advantage:
        adv_tag = " 🎯优势"
    elif had_disadvantage:
        adv_tag = " ⚠️劣势"

    combat_content = f"🎲 **{participant_name}** 进行 **{check_name}** ({ability_cn})检定{adv_tag}\n"
    combat_content += f"🎲 检定: {rolls_str} (d20) {mod_sign}{check_modifier} = {check_total}"

    if dc is not None:
        combat_content += f" vs DC {dc} {result_emoji}"

    if advantage_reasons:
        combat_content += f"\n> 💡 {', '.join(advantage_reasons)}"

    combat_content += f"\n_{narrative}_"
    return combat_content


def build_ability_check_chat_meta(
    *,
    participant_name: str,
    participant_token_id: int,
    check_type: str,
    ability_used: str,
    check_total: int,
    dc: Optional[int],
    success: Optional[bool],
    had_advantage: bool,
    had_disadvantage: bool,
    check_roll: DiceRoll,
) -> dict[str, Any]:
    return {
        "combat_type": "ability_check",
        "participant_name": participant_name,
        "participant_token_id": participant_token_id,
        "check_type": check_type,
        "ability_used": ability_used,
        "check_total": check_total,
        "dc": dc,
        "success": success,
        "had_advantage": had_advantage,
        "had_disadvantage": had_disadvantage,
        "check_roll": check_roll.model_dump(),
    }


def build_contest_narrative(
    *,
    contest_type: str,
    attacker_name: str,
    defender_name: str,
    attacker_wins: bool,
    tie: bool,
    effect_applied: Optional[str],
    description: Optional[str],
) -> str:
    contest_type_cn = CONTEST_TYPE_CN_MAP.get(contest_type, contest_type)
    if attacker_wins:
        if contest_type == "grapple":
            narrative = f"{attacker_name}成功擒抱了{defender_name}！{defender_name}的速度变为0。"
        elif contest_type == "shove":
            if effect_applied == "prone":
                narrative = f"{attacker_name}成功将{defender_name}推倒在地！{defender_name}获得俯卧状态。"
            else:
                narrative = f"{attacker_name}成功将{defender_name}推开了5尺！"
        else:
            narrative = f"{attacker_name}在{contest_type_cn}中获胜！"
    elif tie:
        narrative = f"{attacker_name}与{defender_name}的{contest_type_cn}打成平手，{defender_name}守住了位置。"
    else:
        narrative = f"{defender_name}成功抵御了{attacker_name}的{contest_type_cn}！"

    if description:
        return description + " " + narrative
    return narrative


def build_contest_result(
    *,
    contest_type: str,
    attacker_name: str,
    attacker_token_id: int,
    attacker_check_type: str,
    attacker_roll: DiceRoll,
    attacker_modifier: int,
    attacker_total: int,
    attacker_had_advantage: bool,
    attacker_had_disadvantage: bool,
    attacker_advantage_reasons: list[str],
    defender_name: str,
    defender_token_id: int,
    defender_check_type: str,
    defender_roll: DiceRoll,
    defender_modifier: int,
    defender_total: int,
    defender_had_advantage: bool,
    defender_had_disadvantage: bool,
    defender_advantage_reasons: list[str],
    attacker_wins: bool,
    tie: bool,
    effect_applied: Optional[str],
    narrative: str,
) -> ContestResult:
    return ContestResult(
        contest_type=contest_type,
        attacker_name=attacker_name,
        attacker_token_id=attacker_token_id,
        attacker_check_type=attacker_check_type,
        attacker_roll=attacker_roll,
        attacker_modifier=attacker_modifier,
        attacker_total=attacker_total,
        attacker_had_advantage=attacker_had_advantage,
        attacker_had_disadvantage=attacker_had_disadvantage,
        attacker_advantage_reasons=attacker_advantage_reasons,
        defender_name=defender_name,
        defender_token_id=defender_token_id,
        defender_check_type=defender_check_type,
        defender_roll=defender_roll,
        defender_modifier=defender_modifier,
        defender_total=defender_total,
        defender_had_advantage=defender_had_advantage,
        defender_had_disadvantage=defender_had_disadvantage,
        defender_advantage_reasons=defender_advantage_reasons,
        attacker_wins=attacker_wins,
        tie=tie,
        effect_applied=effect_applied,
        narrative=narrative,
    )


def build_contest_combat_log(
    *,
    contest_type: str,
    attacker_name: str,
    attacker_check_type: str,
    attacker_roll: DiceRoll,
    attacker_modifier: int,
    attacker_total: int,
    attacker_had_advantage: bool,
    attacker_had_disadvantage: bool,
    attacker_advantage_reasons: list[str],
    defender_name: str,
    defender_check_type: str,
    defender_roll: DiceRoll,
    defender_modifier: int,
    defender_total: int,
    defender_had_advantage: bool,
    defender_had_disadvantage: bool,
    defender_advantage_reasons: list[str],
    attacker_wins: bool,
    tie: bool,
    effect_applied: Optional[str],
    narrative: str,
) -> str:
    contest_type_cn = CONTEST_TYPE_CN_MAP.get(contest_type, contest_type)
    attacker_check_cn = CONTEST_CHECK_CN_MAP.get(attacker_check_type.lower(), attacker_check_type)
    defender_check_cn = CONTEST_CHECK_CN_MAP.get(defender_check_type.lower(), defender_check_type)
    winner_emoji = "⚔️" if attacker_wins else "🛡️"

    atk_rolls_str = "+".join(str(roll) for roll in attacker_roll.rolls)
    if len(attacker_roll.rolls) > 1:
        atk_rolls_str = f"({atk_rolls_str})"
    atk_mod_sign = "+" if attacker_modifier >= 0 else ""

    def_rolls_str = "+".join(str(roll) for roll in defender_roll.rolls)
    if len(defender_roll.rolls) > 1:
        def_rolls_str = f"({def_rolls_str})"
    def_mod_sign = "+" if defender_modifier >= 0 else ""

    combat_content = f"{winner_emoji} **{contest_type_cn}对抗**\n"
    combat_content += (
        f"⚔️ {attacker_name} ({attacker_check_cn}): {atk_rolls_str} (d20) "
        f"{atk_mod_sign}{attacker_modifier} = **{attacker_total}**"
    )
    if attacker_had_advantage:
        combat_content += " 🎯优势"
    elif attacker_had_disadvantage:
        combat_content += " ⚠️劣势"
    combat_content += "\n"

    combat_content += (
        f"🛡️ {defender_name} ({defender_check_cn}): {def_rolls_str} (d20) "
        f"{def_mod_sign}{defender_modifier} = **{defender_total}**"
    )
    if defender_had_advantage:
        combat_content += " 🎯优势"
    elif defender_had_disadvantage:
        combat_content += " ⚠️劣势"
    combat_content += "\n"

    reason_lines: list[str] = []
    if attacker_advantage_reasons:
        reason_lines.append(f"{attacker_name}: {', '.join(attacker_advantage_reasons)}")
    if defender_advantage_reasons:
        reason_lines.append(f"{defender_name}: {', '.join(defender_advantage_reasons)}")
    if reason_lines:
        combat_content += "> 💡 " + "\n> 💡 ".join(reason_lines) + "\n"

    if tie:
        combat_content += f"⚖️ **平局** - {defender_name}守住位置\n"
    elif attacker_wins:
        combat_content += f"✅ **{attacker_name}成功！**\n"
        if effect_applied == "grappled":
            combat_content += f"🔗 {defender_name}被擒抱，速度变为0\n"
        elif effect_applied == "prone":
            combat_content += f"⬇️ {defender_name}倒地，获得俯卧状态\n"
        elif effect_applied == "pushed_5ft":
            combat_content += f"➡️ {defender_name}被推开5尺\n"
    else:
        combat_content += f"❌ **{defender_name}抵御成功！**\n"

    combat_content += f"\n_{narrative}_"

    if tie:
        combat_content += "\n> 💡 **对抗规则**: 平局时防守方获胜"
    elif attacker_wins and effect_applied:
        if effect_applied == "grappled":
            combat_content += "\n> 💡 **擒抱**: 被擒抱者速度为0，可用动作尝试挣脱"
        elif effect_applied == "prone":
            combat_content += "\n> 💡 **俯卧**: 5尺内攻击有优势，5尺外攻击有劣势，站起消耗半速"
        elif effect_applied == "pushed_5ft":
            combat_content += "\n> 💡 **推开**: 可配合地形造成额外效果"

    return combat_content


def build_contest_chat_meta(
    *,
    contest_type: str,
    attacker_name: str,
    attacker_token_id: int,
    defender_name: str,
    defender_token_id: int,
    attacker_total: int,
    defender_total: int,
    attacker_wins: bool,
    tie: bool,
    effect_applied: Optional[str],
    attacker_roll: DiceRoll,
    defender_roll: DiceRoll,
    attacker_advantage_reasons: list[str],
    defender_advantage_reasons: list[str],
) -> dict[str, Any]:
    return {
        "combat_type": "contest",
        "contest_type": contest_type,
        "attacker_name": attacker_name,
        "attacker_token_id": attacker_token_id,
        "defender_name": defender_name,
        "defender_token_id": defender_token_id,
        "attacker_total": attacker_total,
        "defender_total": defender_total,
        "attacker_wins": attacker_wins,
        "tie": tie,
        "effect_applied": effect_applied,
        "attacker_roll": attacker_roll.model_dump(),
        "defender_roll": defender_roll.model_dump(),
        "attacker_advantage_reasons": attacker_advantage_reasons,
        "defender_advantage_reasons": defender_advantage_reasons,
    }
