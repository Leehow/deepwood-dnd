from __future__ import annotations

from typing import Any, Iterable


def _result_value(result: Any, key: str, default: Any = None) -> Any:
    if isinstance(result, dict):
        return result.get(key, default)
    return getattr(result, key, default)


def _format_roll_modifier(modifier: int) -> str:
    return f"+{modifier}" if modifier >= 0 else str(modifier)


def _format_zone_target_detail(result: Any, damage_type_cn: str | None) -> str:
    detail = str(_result_value(result, "target_name", "目标"))
    save_roll = _result_value(result, "save_roll")
    save_total = _result_value(result, "save_total", 0)
    if save_roll is not None:
        rolls = getattr(save_roll, "rolls", []) or []
        modifier = int(getattr(save_roll, "modifier", 0) or 0)
        if rolls:
            rolls_text = ",".join(str(roll) for roll in rolls)
            detail += f": {getattr(save_roll, 'dice', '1d20')}({rolls_text}){_format_roll_modifier(modifier)} = {save_total}"

    damage_dealt = _result_value(result, "damage_dealt", 0) or 0
    if damage_dealt:
        detail += f" ({damage_dealt}{damage_type_cn or ''}伤害)"
    return detail


def build_zone_spell_settle_narrative(
    *,
    spell_name: str,
    spell_save_dc: int,
    save_type_cn: str,
    failed_results: Iterable[Any],
    passed_results: Iterable[Any],
    condition_cn: str | None,
    should_persist_effect: bool,
    damage_formula: str | None,
    save_effect: str,
    damage_type_cn: str | None,
) -> str:
    failed = list(failed_results)
    passed = list(passed_results)
    narrative_parts = [f"🌫️ **{spell_name}** 环境效果结算 (DC {spell_save_dc} {save_type_cn}豁免)"]

    if failed:
        fail_details = [_format_zone_target_detail(result, damage_type_cn) for result in failed]
        narrative_parts.append("❌ 豁免失败:")
        narrative_parts.extend(f"  • {detail}" for detail in fail_details)
        if condition_cn and should_persist_effect:
            narrative_parts.append(f"   → 施加 [{condition_cn}] 状态")

    if passed:
        pass_details = [_format_zone_target_detail(result, damage_type_cn) for result in passed]
        narrative_parts.append("✓ 豁免成功:")
        narrative_parts.extend(f"  • {detail}" for detail in pass_details)
        if damage_formula and save_effect == "half":
            narrative_parts.append("   → 伤害减半")

    return "\n".join(narrative_parts)


def build_zone_spell_settle_chat_meta(
    *,
    spell_id: str,
    spell_name: str,
    caster_token_id: int,
    target_results: Iterable[Any],
    failed_count: int,
    passed_count: int,
    should_persist_effect: bool,
    condition_cn: str | None,
    damage_type_label: str | None,
) -> dict[str, Any]:
    target_list = list(target_results)
    return {
        "combat_type": "zone_spell_settle",
        "spell_id": spell_id,
        "spell_name": spell_name,
        "caster_token_id": caster_token_id,
        "target_count": len(target_list),
        "failed_count": failed_count,
        "passed_count": passed_count,
        "effect_persisted": should_persist_effect and failed_count > 0,
        "condition": condition_cn if should_persist_effect else None,
        "total_damage": sum((_result_value(result, "damage_dealt", 0) or 0) for result in target_list),
        "damage_type": damage_type_label,
    }


def build_ongoing_save_chat_meta(*, token_id: int, timing: str | None = None) -> dict[str, Any]:
    meta = {
        "combat_type": "ongoing_save",
        "token_id": token_id,
    }
    if timing:
        meta["timing"] = timing
    return meta


def build_ongoing_save_chat_content(
    *,
    token_name: str,
    effect_name: str,
    save_dc: int,
    save_type_cn: str,
    nat_roll: int | str,
    modifier: int,
    save_total: int,
    success: bool,
    effect_removed: bool,
) -> str:
    emoji = "✅" if success else "❌"
    result_text = "成功" if success else "失败"
    removed_text = "效果解除！" if effect_removed else "效果持续。"
    mod_str = f"+{modifier}" if modifier >= 0 else str(modifier)
    return (
        f"🎲 **{token_name}** 豁免:\n"
        f"{emoji} {effect_name} — DC {save_dc} {save_type_cn}: "
        f"d20({nat_roll}){mod_str} = {save_total} → {result_text}，{removed_text}"
    )


def build_batch_ongoing_save_chat_content(
    *,
    token_name: str,
    timing: str,
    results: Iterable[Any],
    save_type_cn_lookup: dict[str, str],
) -> str:
    timing_label = "回合末" if timing == "end_of_turn" else "回合初"
    lines = [f"🎲 **{token_name}** {timing_label}豁免:"]
    for result in results:
        success = bool(_result_value(result, "success", False))
        emoji = "✅" if success else "❌"
        save_type = str(_result_value(result, "save_type", ""))
        save_type_cn = save_type_cn_lookup.get(save_type.lower(), save_type)
        effect_removed = bool(_result_value(result, "effect_removed", False))
        removed_text = "效果解除！" if effect_removed else "效果持续。"
        result_text = "成功" if success else "失败"
        save_roll = _result_value(result, "save_roll")
        rolls = getattr(save_roll, "rolls", []) if save_roll is not None else []
        nat_roll = rolls[0] if rolls else "?"
        modifier = getattr(save_roll, "modifier", 0) if save_roll is not None else 0
        mod_str = f"+{modifier}" if modifier >= 0 else str(modifier)
        lines.append(
            f"{emoji} {_result_value(result, 'effect_name', '未知效果')} — "
            f"DC {_result_value(result, 'save_dc', 0)} {save_type_cn}: "
            f"d20({nat_roll}){mod_str} = {_result_value(result, 'save_total', 0)} "
            f"→ {result_text}，{removed_text}"
        )
    return "\n".join(lines)


def build_condition_save_narrative(
    *,
    target_name: str,
    success: bool,
    save_dc: int,
    save_type_cn: str,
    save_total: int,
    effect_name: str,
) -> str:
    if success:
        return f"{target_name} 通过了 DC {save_dc} 的{save_type_cn}豁免，{effect_name}效果解除！"
    return f"{target_name} 未能通过 DC {save_dc} 的{save_type_cn}豁免（{save_total}），{effect_name}效果持续。"


def build_condition_save_chat_content(
    *,
    target_name: str,
    success: bool,
    effect_name: str,
    save_dc: int,
    save_type_cn: str,
    nat_roll: int,
    save_modifier: int,
    save_total: int,
    effect_removed: bool,
) -> str:
    emoji = "✅" if success else "❌"
    result_text = "成功" if success else "失败"
    removed_text = "效果解除！" if effect_removed else "效果持续。"
    mod_str = f"+{save_modifier}" if save_modifier >= 0 else str(save_modifier)
    return (
        f"🎲 **{target_name}** 状态豁免:\n"
        f"{emoji} {effect_name} — DC {save_dc} {save_type_cn}: "
        f"d20({nat_roll}){mod_str} = {save_total} → {result_text}，{removed_text}"
    )


def build_condition_save_chat_meta(*, token_id: int) -> dict[str, Any]:
    return {
        "combat_type": "condition_save",
        "token_id": token_id,
    }


def build_escape_attempt_narrative(
    *,
    target_name: str,
    success: bool,
    dc: int,
    skill_label: str,
    check_text: str,
    nat_roll: int,
    modifier: int,
    total: int,
    effect_name: str,
) -> str:
    if success:
        return (
            f"{target_name}成功通过了DC {dc}的{skill_label}{check_text}"
            f"（🎲{nat_roll}+{modifier}={total}），挣脱了{effect_name}！"
        )
    return (
        f"{target_name}尝试挣脱，但未能通过DC {dc}的{skill_label}{check_text}"
        f"（🎲{nat_roll}+{modifier}={total}），仍被{effect_name}束缚。"
    )


def build_escape_attempt_chat_content(
    *,
    target_name: str,
    success: bool,
    effect_name: str,
    dc: int,
    skill_label: str,
    check_text: str,
    nat_roll: int,
    modifier: int,
    total: int,
) -> str:
    emoji = "✅" if success else "❌"
    mod_str = f"+{modifier}" if modifier >= 0 else str(modifier)
    outcome = "挣脱成功！" if success else "挣脱失败。"
    return (
        f"🎲 **{target_name}** 挣脱尝试:\n"
        f"{emoji} {effect_name} — DC {dc} {skill_label}{check_text}: "
        f"d20({nat_roll}){mod_str} = {total} → {outcome}"
    )


def build_escape_attempt_chat_meta(*, token_id: int) -> dict[str, Any]:
    return {
        "combat_type": "escape_attempt",
        "token_id": token_id,
    }
