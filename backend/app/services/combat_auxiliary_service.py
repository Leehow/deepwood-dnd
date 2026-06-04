from __future__ import annotations

from typing import Any


def build_extra_effect_prompt(
    *,
    effect_type: str,
    attacker_name: str,
    target_name: str,
    attack_name: str,
    damage_dealt: int,
) -> str:
    if effect_type == "critical":
        return f"""你是D&D战斗叙述者。玩家投出了暴击（自然20）！请为这次暴击生成一个额外的奖励效果。

攻击者: {attacker_name}
目标: {target_name}
攻击方式: {attack_name}
造成伤害: {damage_dealt}

请生成一个戏剧性的额外效果，可以是以下类型之一：
- 目标士气受挫（下次攻击检定劣势）
- 目标武器/盾牌被击落
- 目标被击退5尺
- 目标获得一个轻微伤口（流血、眩晕等叙事效果）
- 攻击者获得灵感或士气提升

要求：
- 2-3句话描述效果
- 包含具体的游戏机制影响（如"下次攻击有劣势"）
- 生动有趣但不过于夸张
- 直接输出效果描述，不要前缀"""

    if effect_type == "fumble":
        return f"""你是D&D战斗叙述者。玩家投出了大失败（自然1）！请为这次失误生成一个额外的惩罚效果。

攻击者: {attacker_name}
目标: {target_name}
攻击方式: {attack_name}

请生成一个滑稽但有游戏影响的失误效果，可以是以下类型之一：
- 武器脱手（需要用物件互动捡回）
- 失去平衡（下次攻击检定劣势）
- 绊倒（获得俯卧状态）
- 误伤自己（受到1d4伤害）
- 给敌人制造机会（目标获得反击机会）

要求：
- 2-3句话描述效果
- 包含具体的游戏机制影响
- 滑稽有趣但不至于太严重
- 直接输出效果描述，不要前缀"""

    raise ValueError("Invalid effect_type, must be 'critical' or 'fumble'")


def build_extra_effect_chat_content(*, effect_type: str, effect: str) -> str:
    effect_icon = "🌟" if effect_type == "critical" else "💥"
    effect_label = "暴击奖励" if effect_type == "critical" else "大失败惩罚"
    return f"{effect_icon} **{effect_label}**\n{effect.strip()}"


def build_extra_effect_chat_meta(
    *,
    effect_type: str,
    attacker_name: str,
    target_name: str,
) -> dict[str, Any]:
    return {
        "combat_type": "extra_effect",
        "effect_type": effect_type,
        "attacker_name": attacker_name,
        "target_name": target_name,
    }


def build_death_save_chat_meta(*, token_id: int, roll: int) -> dict[str, Any]:
    return {
        "combat_type": "death_save",
        "token_id": token_id,
        "roll": roll,
    }
