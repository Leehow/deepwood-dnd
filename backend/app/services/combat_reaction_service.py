from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Optional

from app.schemas.combat import DiceRoll


REACTION_DISPLAY_NAMES = {
    "opportunity_attack": "借机攻击",
    "uncanny_dodge": "灵活闪避",
    "deflect_missiles": "偏转飞射物",
    "parry": "招架",
    "riposte": "反击",
    "sentinel": "哨兵攻击",
    "mage_slayer": "法师杀手",
    "defensive_duelist": "防御决斗者",
    "shield_master_evasion": "盾牌闪避",
    "war_caster_oa": "战争施法(借机)",
    "polearm_master_oa": "长柄借机攻击",
    "shield_spell": "护盾术",
    "counterspell": "反制法术",
    "hellish_rebuke": "炼狱叱喝",
    "feather_fall": "羽落术",
    "absorb_elements": "吸收元素",
}


@dataclass(frozen=True)
class DefenseReactionOutcome:
    new_damage: int
    ac_bonus: int
    attack_now_misses: bool
    description: str


def reaction_display_name(reaction_id: str) -> str:
    return REACTION_DISPLAY_NAMES.get(reaction_id, reaction_id)


def get_superiority_die(level: int) -> int:
    if level >= 18:
        return 12
    if level >= 10:
        return 10
    return 8


def resolve_defense_reaction(
    *,
    reaction_id: str,
    reactor_name: str,
    original_damage: int,
    attack_total: int,
    target_ac: int,
    dex_mod: int,
    level: int,
    proficiency_bonus: int,
    roll_dice: Callable[[int, int, int], DiceRoll],
) -> DefenseReactionOutcome:
    if reaction_id == "uncanny_dodge":
        new_damage = original_damage // 2
        reduction = original_damage - new_damage
        return DefenseReactionOutcome(
            new_damage=new_damage,
            ac_bonus=0,
            attack_now_misses=False,
            description=(
                f"💨 **{reactor_name}** 使用**灵活闪避**，将伤害从 {original_damage} 减半为 "
                f"{new_damage}（减少 {reduction}）"
            ),
        )

    if reaction_id == "deflect_missiles":
        reduction_roll = roll_dice(1, 10, dex_mod + level)
        reduction = min(original_damage, reduction_roll.total)
        new_damage = max(0, original_damage - reduction)
        return DefenseReactionOutcome(
            new_damage=new_damage,
            ac_bonus=0,
            attack_now_misses=False,
            description=(
                f"🤲 **{reactor_name}** 使用**偏转飞射物**，减少 {reduction} 伤害"
                f"（1d10+{dex_mod + level}={reduction_roll.total}），剩余 {new_damage}"
            ),
        )

    if reaction_id == "parry":
        superiority_die = get_superiority_die(level)
        reduction_roll = roll_dice(1, superiority_die, dex_mod)
        reduction = min(original_damage, reduction_roll.total)
        new_damage = max(0, original_damage - reduction)
        return DefenseReactionOutcome(
            new_damage=new_damage,
            ac_bonus=0,
            attack_now_misses=False,
            description=(
                f"🗡️ **{reactor_name}** 使用**招架**，减少 {reduction} 伤害"
                f"（1d{superiority_die}+{dex_mod}={reduction_roll.total}），剩余 {new_damage}"
            ),
        )

    if reaction_id == "shield_spell":
        ac_bonus = 5
        new_ac = target_ac + ac_bonus
        if attack_total < new_ac:
            return DefenseReactionOutcome(
                new_damage=0,
                ac_bonus=ac_bonus,
                attack_now_misses=True,
                description=f"🛡️ **{reactor_name}** 施放**护盾术**（AC+5→{new_ac}），攻击未命中！伤害全部回退",
            )
        return DefenseReactionOutcome(
            new_damage=original_damage,
            ac_bonus=ac_bonus,
            attack_now_misses=False,
            description=f"🛡️ **{reactor_name}** 施放**护盾术**（AC+5→{new_ac}），但攻击仍然命中",
        )

    if reaction_id == "defensive_duelist":
        ac_bonus = proficiency_bonus
        new_ac = target_ac + ac_bonus
        if attack_total < new_ac:
            return DefenseReactionOutcome(
                new_damage=0,
                ac_bonus=ac_bonus,
                attack_now_misses=True,
                description=f"🤺 **{reactor_name}** 使用**防御决斗者**（AC+{proficiency_bonus}→{new_ac}），攻击未命中！",
            )
        return DefenseReactionOutcome(
            new_damage=original_damage,
            ac_bonus=ac_bonus,
            attack_now_misses=False,
            description=f"🤺 **{reactor_name}** 使用**防御决斗者**（AC+{proficiency_bonus}→{new_ac}），但攻击仍然命中",
        )

    if reaction_id == "shield_master_evasion":
        return DefenseReactionOutcome(
            new_damage=0,
            ac_bonus=0,
            attack_now_misses=False,
            description=f"🛡️ **{reactor_name}** 使用**盾牌闪避**，将伤害降为0",
        )

    raise ValueError(f"未知的防御反应: {reaction_id}")


def build_attack_reaction_description(
    *,
    reaction_id: str,
    reactor_name: str,
    target_name: str,
    total_attack: int,
    target_ac: int,
    hit: bool,
    total_damage: int,
) -> str:
    reaction_name = reaction_display_name(reaction_id)
    if hit:
        description = (
            f"⚔️ **{reactor_name}** 使用**{reaction_name}**攻击 **{target_name}**"
            f"（{total_attack} vs AC {target_ac}）✅ 命中，造成 {total_damage} 伤害"
        )
    else:
        description = (
            f"⚔️ **{reactor_name}** 使用**{reaction_name}**攻击 **{target_name}**"
            f"（{total_attack} vs AC {target_ac}）❌ 未命中"
        )
    if reaction_id == "sentinel" and hit:
        description += "，目标速度降为0"
    return description


def build_spell_reaction_description(
    *,
    reaction_id: str,
    reactor_name: str,
    spell_slot_level: Optional[int],
    total_damage: int = 0,
) -> str:
    if reaction_id == "counterspell":
        return f"🚫 **{reactor_name}** 施放**反制法术**"
    if reaction_id == "hellish_rebuke":
        slot = spell_slot_level or 1
        return f"🔥 **{reactor_name}** 施放**炼狱叱喝**（{slot}环），造成 {total_damage} 火焰伤害"
    if reaction_id == "absorb_elements":
        return f"✨ **{reactor_name}** 施放**吸收元素**，获得伤害抗性"
    if reaction_id == "feather_fall":
        return f"🪶 **{reactor_name}** 施放**羽落术**"
    return f"⚡ **{reactor_name}** 使用反应法术 **{reaction_id}**"


def build_reaction_chat_meta(
    *,
    reaction_id: str,
    reactor_token_id: int,
    target_token_id: Optional[int],
    damage_reduced: int,
    attack_now_misses: bool,
) -> dict[str, Any]:
    return {
        "combat_type": "reaction",
        "reaction_id": reaction_id,
        "reactor_token_id": reactor_token_id,
        "target_token_id": target_token_id,
        "damage_reduced": damage_reduced,
        "attack_now_misses": attack_now_misses,
    }
