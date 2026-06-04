from __future__ import annotations

from typing import Any, Optional

from app.schemas.combat import DiceRoll, SavingThrowResult, SavingThrowTargetResult


def build_saving_throw_narrative(
    *,
    source_name: str,
    effect_name: str,
    save_type: str,
    save_dc: int,
    target_results: list[SavingThrowTargetResult],
    successful_saves: int,
    failed_saves: int,
    damage_type: Optional[str],
    half_on_success: bool,
    ability_names: dict[str, str],
) -> str:
    save_type_cn = ability_names.get(save_type.lower(), save_type)
    narrative = f"{source_name}施放了{effect_name}！"

    if len(target_results) == 1:
        target_result = target_results[0]
        if target_result.success:
            narrative += f"{target_result.target_name}成功通过了DC {save_dc}的{save_type_cn}豁免"
            if target_result.damage_dealt > 0:
                half_note = "（减半）" if half_on_success else ""
                narrative += f"，受到{target_result.damage_dealt}点{damage_type or ''}伤害{half_note}。"
            else:
                narrative += "，完全避开了效果。"
        else:
            narrative += f"{target_result.target_name}未能通过DC {save_dc}的{save_type_cn}豁免"
            if target_result.damage_dealt > 0:
                narrative += f"，受到{target_result.damage_dealt}点{damage_type or ''}伤害！"
            else:
                narrative += "！"
        return narrative

    return narrative + f"{successful_saves}人成功，{failed_saves}人失败。"


def build_saving_throw_combat_log(
    *,
    source_name: str,
    effect_name: str,
    save_type: str,
    save_dc: int,
    target_results: list[SavingThrowTargetResult],
    damage_type: Optional[str],
    half_on_success: bool,
    narrative: str,
    ability_names: dict[str, str],
) -> str:
    save_type_cn = ability_names.get(save_type.lower(), save_type)
    combat_content = f"🎯 **{source_name}** 使用 **{effect_name}**\n"
    combat_content += f"📋 DC {save_dc} {save_type_cn}豁免\n"

    for target_result in target_results:
        result_emoji = "✅" if target_result.success else "❌"
        rolls_str = "+".join(str(roll) for roll in target_result.save_roll.rolls)
        if len(target_result.save_roll.rolls) > 1:
            rolls_str = f"({rolls_str})"

        mod_sign = "+" if target_result.save_modifier >= 0 else ""
        combat_content += (
            f"- {target_result.target_name}: {rolls_str} (d20) "
            f"{mod_sign}{target_result.save_modifier} = {target_result.save_total} {result_emoji}"
        )

        if target_result.damage_dealt > 0:
            damage_note = "（减半）" if target_result.success and half_on_success else ""
            combat_content += f" | 💥 {target_result.damage_dealt} {damage_type or ''}{damage_note}"

        if target_result.target_defeated:
            combat_content += " 💀"
        combat_content += "\n"

    combat_content += f"\n_{narrative}_"
    return combat_content


def build_saving_throw_chat_meta(
    *,
    effect_name: str,
    source_name: str,
    save_type: str,
    save_dc: int,
    total_targets: int,
    successful_saves: int,
    failed_saves: int,
    damage_roll: Optional[DiceRoll],
) -> dict[str, Any]:
    return {
        "combat_type": "saving_throw",
        "effect_name": effect_name,
        "source_name": source_name,
        "save_type": save_type,
        "save_dc": save_dc,
        "total_targets": total_targets,
        "successful_saves": successful_saves,
        "failed_saves": failed_saves,
        "damage_roll": damage_roll.model_dump() if damage_roll else None,
    }


def build_saving_throw_result(
    *,
    effect_name: str,
    source_name: str,
    save_type: str,
    save_dc: int,
    target_results: list[SavingThrowTargetResult],
    successful_saves: int,
    failed_saves: int,
    narrative: str,
) -> SavingThrowResult:
    return SavingThrowResult(
        effect_name=effect_name,
        source_name=source_name,
        save_type=save_type,
        save_dc=save_dc,
        target_results=target_results,
        total_targets=len(target_results),
        successful_saves=successful_saves,
        failed_saves=failed_saves,
        narrative=narrative,
    )
