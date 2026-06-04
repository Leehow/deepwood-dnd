from __future__ import annotations

from typing import Any, Optional

from app.schemas.combat import AreaSpellCastResult, AreaSpellTargetResult, SpellData


def build_area_spell_chat_meta(
    *,
    spell_id: str,
    spell_name: str,
    caster_token_id: int,
    target_count: int,
    total_damage: int,
    center_position: dict[str, float] | None,
    slot_consumed: int,
    is_concentration: bool,
    has_persistent_area: bool,
    narrative_prompt: str | None = None,
    resolved_by: str | None = None,
) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "combat_type": "area_spell",
        "spell_id": spell_id,
        "spell_name": spell_name,
        "caster_token_id": caster_token_id,
        "target_count": target_count,
        "total_damage": total_damage,
        "center_position": center_position,
        "slot_consumed": slot_consumed,
        "is_concentration": is_concentration,
        "has_persistent_area": has_persistent_area,
        "has_narrative": False,
    }
    if narrative_prompt is not None:
        meta["narrative_prompt"] = narrative_prompt
    if resolved_by is not None:
        meta["resolved_by"] = resolved_by
    return meta


def build_area_spell_narrative_prompt(
    *,
    spell: SpellData,
    caster_name: str,
    target_results: list[AreaSpellTargetResult],
    base_damage: int,
    total_damage: int,
    spell_save_dc: int,
    save_type_cn: Optional[str],
    damage_type_cn: Optional[str],
    is_control_spell: bool = False,
) -> str:
    failed = [result for result in target_results if not result.save_succeeded]
    passed = [result for result in target_results if result.save_succeeded]
    defeated = [result for result in target_results if result.target_defeated]
    immune = [result for result in target_results if result.immunity_applied]

    target_summary = ""
    if failed:
        target_summary += f"【豁免失败】{', '.join(result.target_name for result in failed)}\n"
    if passed:
        target_summary += f"【豁免成功】{', '.join(result.target_name for result in passed)}\n"
    if defeated:
        target_summary += f"【被击倒】{', '.join(result.target_name for result in defeated)}\n"
    if immune:
        target_summary += f"【免疫】{', '.join(result.target_name for result in immune)}\n"

    if is_control_spell:
        return f"""你是D&D战斗叙述者。用2-3句简短生动的中文描述这次控制法术的效果。

【法术】
{spell.name}（{spell.name_en or ''}）
这是一个控制法术，对豁免失败的目标施加状态效果
豁免: DC{spell_save_dc} {save_type_cn or ''}豁免

【施法者】
{caster_name}

【目标（{len(target_results)}个）】
{target_summary}

【写作要求】
- 2-3句话，生动描述法术释放和效果
- 描述豁免失败的目标被控制/束缚/影响的情况
- 豁免成功的目标成功抵抗了法术
- 直接输出叙事文本"""

    return f"""你是D&D战斗叙述者。用2-3句简短生动的中文描述这次范围法术的效果。

【法术】
{spell.name}（{spell.name_en or ''}）
伤害骰: {base_damage}点{damage_type_cn or ''}伤害
豁免: DC{spell_save_dc} {save_type_cn or ''}豁免

【施法者】
{caster_name}

【目标（{len(target_results)}个）】
{target_summary}

【伤害统计】
总计造成 {total_damage} 点伤害

【写作要求】
- 2-3句话，生动描述法术释放和效果
- 简洁描述目标的反应（豁免成功的减伤，失败的承受全额）
- 若有被击倒的目标，特别提及
- 直接输出叙事文本"""


def build_area_spell_combat_message(
    *,
    spell: SpellData,
    caster_name: str,
    result: AreaSpellCastResult,
    slot_level: int,
    is_concentration: bool = False,
    has_area_effect: bool = False,
) -> str:
    lines: list[str] = []
    slot_text = f"({slot_level}环)" if slot_level > 0 else "(戏法)"
    conc_tag = " 🎯专注" if is_concentration else ""
    lines.append(f"🔮 **{caster_name}** 施放了 **{spell.name}** {slot_text}{conc_tag}")
    lines.append("")

    is_control_spell = result.damage_roll is None
    if not is_control_spell and result.damage_roll:
        lines.append(
            f"**伤害骰**: {result.damage_roll.dice} = "
            f"[{', '.join(map(str, result.damage_roll.rolls))}] = "
            f"**{result.damage_roll.total}** {result.damage_type_cn or ''}"
        )

    lines.append(f"**豁免**: DC {result.spell_save_dc} {result.save_type_cn or ''}")
    lines.append("")
    lines.append(f"**目标** ({result.total_targets}个):")
    for target_result in result.target_results:
        save_icon = "✓" if target_result.save_succeeded else "✗"
        save_text = f"{target_result.save_roll.total}(1d20{'+' if target_result.save_modifier >= 0 else ''}{target_result.save_modifier})"

        if is_control_spell:
            effect_text = "无效" if target_result.save_succeeded else "受影响"
            lines.append(f"  • {target_result.target_name}: {save_icon}{save_text} → {effect_text}")
            continue

        damage_text = f"{target_result.damage_dealt}伤害"
        if target_result.immunity_applied:
            damage_text = "免疫"
        elif target_result.resistance_applied:
            damage_text = f"{target_result.damage_dealt}伤害(抗性)"

        status = " 💀" if target_result.target_defeated else ""
        lines.append(f"  • {target_result.target_name}: {save_icon}{save_text} → {damage_text}{status}")

    lines.append("")
    if not is_control_spell:
        lines.append(f"**总计伤害**: {result.total_damage}")
        lines.append("")
    if result.narrative:
        lines.append(f"> {result.narrative}")

    if is_concentration and has_area_effect:
        lines.append("")
        lines.append(f"⚡ **{caster_name}** 正在专注维持 **{spell.name}**，效果区域将持续存在直到专注中断")

    return "\n".join(lines)
