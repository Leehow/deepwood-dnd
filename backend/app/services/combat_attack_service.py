from __future__ import annotations

import random
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Optional, Sequence

from app.schemas.combat import AttackResult, DiceRoll
from app.utils.class_effects import get_brutal_critical_dice
from app.utils.race_effects import check_savage_attacks


@dataclass(frozen=True)
class AttackRollState:
    roll_modifier: Optional[str]
    attack_d20: int
    d20_rolls: list[int]
    dice_notation: str


@dataclass(frozen=True)
class AttackOutcome:
    critical: bool
    fumble: bool
    hit: bool
    total_attack: int


@dataclass(frozen=True)
class DamageRollAdjustment:
    roll: DiceRoll
    applied: bool = False
    original_rolls: list[int] = field(default_factory=list)


@dataclass(frozen=True)
class BaseAttackDamageResult:
    num_dice: int
    die_size: int
    base_modifier: int
    damage_roll: DiceRoll
    damage_dealt: int
    gwf_rerolled: bool = False
    gwf_original_rolls: list[int] = field(default_factory=list)
    tavern_brawler_applied: bool = False
    savage_attacker_applied: bool = False
    elemental_adept_applied: bool = False


@dataclass(frozen=True)
class BonusDamageResult:
    roll: Optional[DiceRoll] = None
    damage: int = 0
    damage_type: Optional[str] = None
    mode: Optional[str] = None


def merge_roll_modifier(
    current_modifier: Optional[str],
    *,
    grants_advantage: bool = False,
    grants_disadvantage: bool = False,
) -> Optional[str]:
    next_modifier = current_modifier

    if grants_advantage:
        if next_modifier == "disadvantage":
            next_modifier = None
        elif next_modifier is None:
            next_modifier = "advantage"

    if grants_disadvantage:
        if next_modifier == "advantage":
            next_modifier = None
        elif next_modifier is None:
            next_modifier = "disadvantage"

    return next_modifier


def roll_attack_d20(
    *,
    roll_modifier: Optional[str],
    forced_d20: Optional[int] = None,
    randint: Callable[[int, int], int] = random.randint,
) -> AttackRollState:
    if forced_d20 is not None:
        attack_d20 = max(1, min(20, forced_d20))
        return AttackRollState(
            roll_modifier=roll_modifier,
            attack_d20=attack_d20,
            d20_rolls=[attack_d20],
            dice_notation="1d20",
        )

    if roll_modifier == "advantage":
        roll_1 = randint(1, 20)
        roll_2 = randint(1, 20)
        return AttackRollState(
            roll_modifier=roll_modifier,
            attack_d20=max(roll_1, roll_2),
            d20_rolls=[roll_1, roll_2],
            dice_notation="2d20kh1",
        )

    if roll_modifier == "disadvantage":
        roll_1 = randint(1, 20)
        roll_2 = randint(1, 20)
        return AttackRollState(
            roll_modifier=roll_modifier,
            attack_d20=min(roll_1, roll_2),
            d20_rolls=[roll_1, roll_2],
            dice_notation="2d20kl1",
        )

    attack_d20 = randint(1, 20)
    return AttackRollState(
        roll_modifier=roll_modifier,
        attack_d20=attack_d20,
        d20_rolls=[attack_d20],
        dice_notation="1d20",
    )


def resolve_attack_outcome(
    *,
    attack_d20: int,
    attack_bonus: int,
    target_ac: int,
    crit_range: int = 20,
    inspiration_value: int = 0,
    attack_bonus_add: int = 0,
    target_auto_crit: bool = False,
) -> AttackOutcome:
    critical = attack_d20 >= crit_range
    fumble = attack_d20 == 1
    total_attack = attack_d20 + attack_bonus + inspiration_value + attack_bonus_add

    if fumble:
        hit = False
    elif critical:
        hit = True
    else:
        hit = total_attack >= target_ac

    if hit and target_auto_crit and not critical:
        critical = True

    return AttackOutcome(
        critical=critical,
        fumble=fumble,
        hit=hit,
        total_attack=total_attack,
    )


def apply_great_weapon_fighting(
    *,
    damage_roll: DiceRoll,
    die_size: int,
    attack_properties: Optional[Sequence[str]],
    fighting_style: Optional[str],
    randint: Callable[[int, int], int] = random.randint,
) -> DamageRollAdjustment:
    atk_props = [prop.lower() for prop in (attack_properties or [])]
    is_two_handed = any("two-handed" in prop or "双手" in prop for prop in atk_props)
    is_versatile = any("versatile" in prop or "两用" in prop for prop in atk_props)
    is_gwf = fighting_style in ("great_weapon_fighting", "great_weapon")

    if not (is_gwf and (is_two_handed or is_versatile) and die_size > 0):
        return DamageRollAdjustment(roll=damage_roll)

    original_rolls = list(damage_roll.rolls)
    rerolled = False
    new_rolls = []
    for roll in damage_roll.rolls:
        if roll <= 2:
            new_rolls.append(randint(1, die_size))
            rerolled = True
        else:
            new_rolls.append(roll)

    if not rerolled:
        return DamageRollAdjustment(roll=damage_roll, original_rolls=original_rolls)

    return DamageRollAdjustment(
        roll=DiceRoll(
            dice=damage_roll.dice,
            rolls=new_rolls,
            modifier=damage_roll.modifier,
            total=sum(new_rolls) + damage_roll.modifier,
        ),
        applied=True,
        original_rolls=original_rolls,
    )


def apply_savage_attacker(
    *,
    damage_roll: DiceRoll,
    feat_ids: Sequence[str],
    num_dice: int,
    die_size: int,
    normal_range: Optional[int],
    roll_dice: Callable[[int, int, int], DiceRoll],
) -> DamageRollAdjustment:
    if "savage_attacker" not in feat_ids or die_size <= 0:
        return DamageRollAdjustment(roll=damage_roll)

    is_melee_attack = not (normal_range and normal_range > 10)
    if not is_melee_attack:
        return DamageRollAdjustment(roll=damage_roll)

    alt_roll = roll_dice(num_dice, die_size, damage_roll.modifier)
    if alt_roll.total <= damage_roll.total:
        return DamageRollAdjustment(roll=damage_roll)

    return DamageRollAdjustment(roll=alt_roll, applied=True)


def apply_elemental_adept(
    *,
    damage_roll: DiceRoll,
    feat_ids: Sequence[str],
    die_size: int,
    chosen_element: Optional[str],
    damage_type: Optional[str],
) -> DamageRollAdjustment:
    if "elemental_adept" not in feat_ids or die_size <= 0:
        return DamageRollAdjustment(roll=damage_roll)
    if not chosen_element or not damage_type:
        return DamageRollAdjustment(roll=damage_roll)

    element_damage_map = {
        "acid": ["强酸", "acid"],
        "cold": ["寒冷", "cold"],
        "fire": ["火焰", "fire"],
        "lightning": ["闪电", "lightning"],
        "thunder": ["雷鸣", "thunder"],
    }
    matching_types = element_damage_map.get(chosen_element, [])
    if damage_type.lower() not in matching_types:
        return DamageRollAdjustment(roll=damage_roll)

    new_rolls = [max(2, roll) for roll in damage_roll.rolls]
    if new_rolls == damage_roll.rolls:
        return DamageRollAdjustment(roll=damage_roll)

    return DamageRollAdjustment(
        roll=DiceRoll(
            dice=damage_roll.dice,
            rolls=new_rolls,
            modifier=damage_roll.modifier,
            total=sum(new_rolls) + damage_roll.modifier,
        ),
        applied=True,
    )


def roll_base_attack_damage(
    *,
    attack_damage: Optional[str],
    feat_ids: Sequence[str],
    attack_properties: Optional[Sequence[str]],
    normal_range: Optional[int],
    fighting_style: Optional[str],
    damage_bonus: int,
    rage_damage_bonus: int,
    critical: bool,
    chosen_element: Optional[str],
    damage_type: Optional[str],
    parse_damage_dice: Callable[[str], tuple[int, int, int]],
    roll_dice: Callable[[int, int, int], DiceRoll],
    randint: Callable[[int, int], int] = random.randint,
) -> BaseAttackDamageResult:
    num_dice, die_size, base_modifier = parse_damage_dice(attack_damage or "1d4")
    tavern_brawler_applied = False
    if num_dice == 0 and die_size == 0 and "tavern_brawler" in feat_ids:
        num_dice, die_size = 1, 4
        tavern_brawler_applied = True

    total_modifier = base_modifier + damage_bonus + rage_damage_bonus
    if critical:
        num_dice *= 2

    damage_roll = roll_dice(num_dice, die_size, total_modifier)

    gwf_adjustment = apply_great_weapon_fighting(
        damage_roll=damage_roll,
        die_size=die_size,
        attack_properties=attack_properties,
        fighting_style=fighting_style,
        randint=randint,
    )
    damage_roll = gwf_adjustment.roll

    savage_attacker_adjustment = apply_savage_attacker(
        damage_roll=damage_roll,
        feat_ids=feat_ids,
        num_dice=num_dice,
        die_size=die_size,
        normal_range=normal_range,
        roll_dice=roll_dice,
    )
    damage_roll = savage_attacker_adjustment.roll

    elemental_adept_adjustment = apply_elemental_adept(
        damage_roll=damage_roll,
        feat_ids=feat_ids,
        die_size=die_size,
        chosen_element=chosen_element,
        damage_type=damage_type,
    )
    damage_roll = elemental_adept_adjustment.roll

    return BaseAttackDamageResult(
        num_dice=num_dice,
        die_size=die_size,
        base_modifier=base_modifier,
        damage_roll=damage_roll,
        damage_dealt=max(0, damage_roll.total),
        gwf_rerolled=gwf_adjustment.applied,
        gwf_original_rolls=gwf_adjustment.original_rolls,
        tavern_brawler_applied=tavern_brawler_applied,
        savage_attacker_applied=savage_attacker_adjustment.applied,
        elemental_adept_applied=elemental_adept_adjustment.applied,
    )


def resolve_enlarge_reduce_damage(
    *,
    transformation_data: Optional[dict[str, Any]],
    critical: bool,
    parse_damage_dice: Callable[[str], tuple[int, int, int]],
    roll_dice: Callable[[int, int, int], DiceRoll],
) -> BonusDamageResult:
    if not transformation_data:
        return BonusDamageResult()
    if transformation_data.get("type") != "modifier" or not transformation_data.get("modifiers"):
        return BonusDamageResult()

    for modifier in transformation_data["modifiers"]:
        if modifier.get("stat") != "weapon_damage":
            continue

        dice_str = str(modifier.get("value", "1d4"))
        num_dice, die_size, base_modifier = parse_damage_dice(dice_str)
        if num_dice <= 0 or die_size <= 0:
            return BonusDamageResult()
        if critical:
            num_dice *= 2

        roll = roll_dice(num_dice, die_size, base_modifier)
        operation = modifier.get("operation")
        if operation == "add_dice":
            return BonusDamageResult(
                roll=roll,
                damage=roll.total,
                mode=transformation_data.get("activeMode", "enlarge"),
            )
        if operation == "subtract_dice":
            return BonusDamageResult(
                roll=roll,
                damage=-roll.total,
                mode=transformation_data.get("activeMode", "reduce"),
            )
        return BonusDamageResult()

    return BonusDamageResult()


def resolve_savage_attacks_damage(
    *,
    critical: bool,
    race_id: Optional[str],
    is_melee: bool,
    die_size: int,
    roll_dice: Callable[[int, int, int], DiceRoll],
) -> BonusDamageResult:
    if not (critical and die_size > 0 and check_savage_attacks(race_id, is_melee)):
        return BonusDamageResult()

    roll = roll_dice(1, die_size, 0)
    return BonusDamageResult(roll=roll, damage=roll.total)


def resolve_brutal_critical_damage(
    *,
    critical: bool,
    class_id: Optional[str],
    level: int,
    die_size: int,
    roll_dice: Callable[[int, int, int], DiceRoll],
) -> BonusDamageResult:
    brutal_critical_dice = get_brutal_critical_dice(class_id, level)
    if not (critical and brutal_critical_dice > 0 and die_size > 0):
        return BonusDamageResult()

    roll = roll_dice(brutal_critical_dice, die_size, 0)
    return BonusDamageResult(roll=roll, damage=roll.total)


def resolve_sneak_attack_damage(
    *,
    sneak_attack_enabled: bool,
    attacker_class_id: Optional[str],
    attacker_level: int,
    critical: bool,
    parse_damage_dice: Callable[[str], tuple[int, int, int]],
    roll_dice: Callable[[int, int, int], DiceRoll],
) -> BonusDamageResult:
    if not sneak_attack_enabled or (attacker_class_id or "").lower() != "rogue":
        return BonusDamageResult()

    from app.services.passive_feature_service import get_sneak_attack_dice

    damage_dice = get_sneak_attack_dice(attacker_level)
    num_dice, die_size, base_modifier = parse_damage_dice(damage_dice)
    if num_dice <= 0 or die_size <= 0:
        return BonusDamageResult()
    if critical:
        num_dice *= 2

    roll = roll_dice(num_dice, die_size, base_modifier)
    return BonusDamageResult(roll=roll, damage=roll.total)


def resolve_divine_strike_damage(
    *,
    attacker_class_id: Optional[str],
    attacker_level: int,
    subclass_id: Optional[str],
    critical: bool,
    parse_damage_dice: Callable[[str], tuple[int, int, int]],
    roll_dice: Callable[[int, int, int], DiceRoll],
) -> BonusDamageResult:
    if (attacker_class_id or "").lower() != "cleric" or attacker_level < 8:
        return BonusDamageResult()

    from app.services.passive_feature_service import get_divine_strike

    divine_strike = get_divine_strike(attacker_class_id, attacker_level, subclass_id)
    if not divine_strike:
        return BonusDamageResult()

    num_dice, die_size, base_modifier = parse_damage_dice(divine_strike["damage"])
    if num_dice <= 0 or die_size <= 0:
        return BonusDamageResult()
    if critical:
        num_dice *= 2

    roll = roll_dice(num_dice, die_size, base_modifier)
    return BonusDamageResult(
        roll=roll,
        damage=roll.total,
        damage_type=divine_strike["damageType"],
    )


def resolve_extra_damage(
    *,
    extra_damage_dice: Optional[str],
    extra_damage_type: Optional[str],
    critical: bool,
    parse_damage_dice: Callable[[str], tuple[int, int, int]],
    roll_dice: Callable[[int, int, int], DiceRoll],
) -> BonusDamageResult:
    if not extra_damage_dice:
        return BonusDamageResult()

    num_dice, die_size, base_modifier = parse_damage_dice(extra_damage_dice)
    if critical:
        num_dice *= 2

    roll = roll_dice(num_dice, die_size, base_modifier)
    return BonusDamageResult(
        roll=roll,
        damage=max(0, roll.total),
        damage_type=extra_damage_type,
    )


def _translate_damage_type(
    value: Optional[str],
    damage_type_labels: dict[str, str],
) -> str:
    if not value:
        return ""
    return damage_type_labels.get(value.lower(), value)


def build_attack_result(
    *,
    hit: bool,
    critical: bool,
    fumble: bool,
    attack_roll: DiceRoll,
    damage_roll: Optional[DiceRoll],
    extra_damage_roll: Optional[DiceRoll],
    savage_attacks_roll: Optional[DiceRoll],
    brutal_critical_roll: Optional[DiceRoll],
    inspiration_roll: Optional[DiceRoll],
    total_attack: int,
    target_ac: int,
    damage_dealt: int,
    damage_type: Optional[str],
    extra_damage_dealt: int,
    extra_damage_type: Optional[str],
    savage_attacks_damage: int,
    brutal_critical_damage: int,
    sneak_attack_roll: Optional[DiceRoll],
    sneak_attack_damage: int,
    enlarge_reduce_roll: Optional[DiceRoll],
    enlarge_reduce_damage: int,
    enlarge_reduce_mode: Optional[str],
    narrative: str,
    hp_change: Optional[int],
    new_hp: Optional[int],
    target_defeated: bool,
    attacker_name: str,
    target_name: str,
    attack_name: str,
) -> AttackResult:
    return AttackResult(
        hit=hit,
        critical=critical,
        fumble=fumble,
        attack_roll=attack_roll,
        damage_roll=damage_roll,
        extra_damage_roll=extra_damage_roll,
        savage_attacks_roll=savage_attacks_roll,
        brutal_critical_roll=brutal_critical_roll,
        inspiration_roll=inspiration_roll,
        total_attack=total_attack,
        target_ac=target_ac,
        damage_dealt=damage_dealt,
        damage_type=damage_type,
        extra_damage_dealt=extra_damage_dealt,
        extra_damage_type=extra_damage_type,
        savage_attacks_damage=savage_attacks_damage,
        brutal_critical_damage=brutal_critical_damage,
        sneak_attack_roll=sneak_attack_roll,
        sneak_attack_damage=sneak_attack_damage,
        enlarge_reduce_roll=enlarge_reduce_roll,
        enlarge_reduce_damage=enlarge_reduce_damage,
        enlarge_reduce_mode=enlarge_reduce_mode,
        narrative=narrative,
        hp_change=hp_change,
        new_hp=new_hp,
        target_defeated=target_defeated,
        attacker_name=attacker_name,
        target_name=target_name,
        attack_name=attack_name,
    )


def build_attack_chat_meta(
    *,
    attacker_token_id: int,
    attacker_character_id: Optional[int],
    attacker_monster_instance_id: Optional[int],
    target_token_id: int,
    target_character_id: Optional[int],
    target_monster_instance_id: Optional[int],
    attacker_name: str,
    target_name: str,
    target_ac: int,
    attack_name: str,
    is_ranged: bool,
    total_attack: int,
    hit: bool,
    critical: bool,
    fumble: bool,
    total_damage: int,
    attack_damage_type: Optional[str],
    base_damage: int,
    extra_damage: int,
    extra_damage_type: Optional[str],
    savage_attacks_damage: int,
    brutal_critical_damage: int,
    sneak_attack_damage: int,
    divine_strike_damage: int,
    divine_strike_type: Optional[str],
    rage_damage_bonus: int,
    rage_resistance_applied: bool,
    damage_before_resistance: int,
    target_defeated: bool,
    xp_value: Optional[int],
    attack_roll: DiceRoll,
    damage_roll: Optional[DiceRoll],
    extra_damage_roll: Optional[DiceRoll],
    savage_attacks_roll: Optional[DiceRoll],
    brutal_critical_roll: Optional[DiceRoll],
    sneak_attack_roll: Optional[DiceRoll],
    divine_strike_roll: Optional[DiceRoll],
    inspiration_roll: Optional[DiceRoll],
    inspiration_die: Optional[str],
    narrative_prompt: str,
    damage_type_labels: dict[str, str],
) -> dict[str, Any]:
    return {
        "combat_type": "attack",
        "attacker_token_id": attacker_token_id,
        "attacker_character_id": attacker_character_id,
        "attacker_monster_instance_id": attacker_monster_instance_id,
        "target_token_id": target_token_id,
        "target_character_id": target_character_id,
        "target_monster_instance_id": target_monster_instance_id,
        "attacker_name": attacker_name,
        "target_name": target_name,
        "target_ac": target_ac,
        "attack_name": attack_name,
        "attack_type": "ranged" if is_ranged else "melee",
        "attack_total": total_attack,
        "hit": hit,
        "critical": critical,
        "fumble": fumble,
        "damage_dealt": total_damage,
        "damage_type": _translate_damage_type(attack_damage_type, damage_type_labels),
        "base_damage": base_damage,
        "extra_damage": extra_damage,
        "extra_damage_type": extra_damage_type,
        "savage_attacks_damage": savage_attacks_damage,
        "brutal_critical_damage": brutal_critical_damage,
        "sneak_attack_damage": sneak_attack_damage,
        "divine_strike_damage": divine_strike_damage,
        "divine_strike_type": divine_strike_type,
        "rage_damage_bonus": rage_damage_bonus,
        "rage_resistance_applied": rage_resistance_applied,
        "damage_before_resistance": damage_before_resistance if rage_resistance_applied else None,
        "target_defeated": target_defeated,
        "xp_value": xp_value if target_defeated and target_monster_instance_id else None,
        "attack_roll": attack_roll.model_dump(),
        "damage_roll": damage_roll.model_dump() if damage_roll else None,
        "extra_damage_roll": extra_damage_roll.model_dump() if extra_damage_roll else None,
        "savage_attacks_roll": savage_attacks_roll.model_dump() if savage_attacks_roll else None,
        "brutal_critical_roll": brutal_critical_roll.model_dump() if brutal_critical_roll else None,
        "sneak_attack_roll": sneak_attack_roll.model_dump() if sneak_attack_roll else None,
        "divine_strike_roll": divine_strike_roll.model_dump() if divine_strike_roll else None,
        "inspiration_roll": inspiration_roll.model_dump() if inspiration_roll else None,
        "inspiration_die": inspiration_die,
        "has_narrative": False,
        "narrative_prompt": narrative_prompt,
    }


def build_attack_combat_log(
    *,
    attacker_name: str,
    target_name: str,
    weapon_name: str,
    is_off_hand: bool,
    roll_modifier: Optional[str],
    attack_d20: int,
    d20_rolls: Sequence[int],
    advantage_reasons: Optional[Sequence[str]],
    effect_reasons: Optional[Sequence[str]],
    attack_bonus_override: Optional[int],
    attack_bonus: int,
    ability_mod: int,
    ability_name: str,
    prof_bonus: int,
    weapon_proficient: bool,
    fighting_style_atk_bonus: int,
    fighting_style_atk_label: str,
    power_attack_active: bool,
    magic_bonus: int,
    inspiration_roll: Optional[DiceRoll],
    inspiration_value: int,
    inspiration_die: Optional[str],
    attack_bonus_add: int,
    attack_bonus_add_source: Optional[str],
    total_attack: int,
    hit: bool,
    critical: bool,
    fumble: bool,
    crit_range: int,
    attacker_class_id: Optional[str],
    attacker_level: int,
    damage_roll: Optional[DiceRoll],
    attack_damage_type: Optional[str],
    damage_ability_mod: int,
    damage_ability_name: str,
    dueling_bonus: int,
    rage_damage_bonus: int,
    gwf_rerolled: bool,
    gwf_original_rolls: Sequence[int],
    extra_damage_roll: Optional[DiceRoll],
    extra_damage_dealt: int,
    extra_damage_type: Optional[str],
    savage_attacks_roll: Optional[DiceRoll],
    savage_attacks_damage: int,
    brutal_critical_roll: Optional[DiceRoll],
    brutal_critical_damage: int,
    sneak_attack_roll: Optional[DiceRoll],
    sneak_attack_damage: int,
    divine_strike_roll: Optional[DiceRoll],
    divine_strike_damage: int,
    divine_strike_type: Optional[str],
    enlarge_reduce_roll: Optional[DiceRoll],
    enlarge_reduce_damage: int,
    damage_before_resistance: int,
    total_damage: int,
    rage_resistance_applied: bool,
    attacker_is_reckless: bool,
    halfling_lucky_reroll: bool,
    relentless_triggered: bool,
    target_defeated: bool,
    thunderbolt_strike_note: Optional[str],
    damage_type_labels: dict[str, str],
) -> str:
    clean_weapon_name = re.sub(r"\s*\([A-Za-z\s/]+\)", "", weapon_name).strip() or weapon_name
    off_hand_label = "(副手·附赠)" if is_off_hand else ""
    combat_content = f"⚔️ **{attacker_name}** 用 **{clean_weapon_name}**{off_hand_label} 攻击 **{target_name}**\n"

    if roll_modifier == "advantage":
        d20_display = f"{attack_d20} (d20: {d20_rolls[0]}, {d20_rolls[1]} 🟢优势)"
    elif roll_modifier == "disadvantage":
        d20_display = f"{attack_d20} (d20: {d20_rolls[0]}, {d20_rolls[1]} 🔴劣势)"
    else:
        d20_display = f"{attack_d20} (d20)"

    if advantage_reasons:
        combat_content += f"> 💡 {', '.join(advantage_reasons)}\n"
    if effect_reasons:
        combat_content += f"> 💡 {', '.join(effect_reasons)}\n"

    inspiration_display = f" +{inspiration_value}(🎵激励)" if inspiration_roll and inspiration_value > 0 else ""
    post_bonus_display = ""
    if attack_bonus_add:
        bonus_source = attack_bonus_add_source or "额外加值"
        post_bonus_display = f" +{attack_bonus_add}({bonus_source})"

    if attack_bonus_override is not None:
        bonus_sign = "+" if attack_bonus >= 0 else ""
        combat_content += f"🎲 攻击: {d20_display} {bonus_sign}{attack_bonus}{inspiration_display}{post_bonus_display} = {total_attack}\n"
    else:
        ability_sign = "+" if ability_mod >= 0 else ""
        fs_atk_display = f" +{fighting_style_atk_bonus}({fighting_style_atk_label})" if fighting_style_atk_bonus > 0 else ""
        pa_atk_display = " -5(强力打击)" if power_attack_active else ""
        magic_atk_display = f" +{magic_bonus}(魔法)" if magic_bonus > 0 else ""
        if weapon_proficient:
            combat_content += (
                f"🎲 攻击: {d20_display} {ability_sign}{ability_mod}({ability_name}) +{prof_bonus}(熟练)"
                f"{magic_atk_display}{fs_atk_display}{pa_atk_display}{inspiration_display}{post_bonus_display} = {total_attack}\n"
            )
        else:
            combat_content += (
                f"🎲 攻击: {d20_display} {ability_sign}{ability_mod}({ability_name}) ⚠️(不熟练)"
                f"{magic_atk_display}{fs_atk_display}{pa_atk_display}{inspiration_display}{post_bonus_display} = {total_attack}\n"
            )
    result_emoji = "🎯" if critical else ("💀" if fumble else ("✅" if hit else "❌"))
    result_text = "大成功!" if critical else ("大失败!" if fumble else ("命中" if hit else "未命中"))
    combat_content += f"{result_emoji} {result_text}"

    if hit and damage_roll:
        rolls_str = "+".join(str(roll) for roll in damage_roll.rolls)
        dmg_type = _translate_damage_type(attack_damage_type, damage_type_labels)

        mod_parts = []
        if damage_ability_mod != 0:
            sign = "+" if damage_ability_mod > 0 else ""
            mod_parts.append(f"{sign}{damage_ability_mod}({damage_ability_name})")
        if dueling_bonus > 0:
            mod_parts.append(f"+{dueling_bonus}(⚔️决斗)")
        if magic_bonus > 0:
            mod_parts.append(f"+{magic_bonus}(魔法)")
        if rage_damage_bonus > 0:
            mod_parts.append(f"+{rage_damage_bonus}(狂暴)")
        if power_attack_active:
            mod_parts.append("+10(强力打击)")
        mod_str = "".join(mod_parts)

        gwf_label = ""
        if gwf_rerolled:
            gwf_parts = []
            for index, rerolled_value in enumerate(damage_roll.rolls):
                original_value = gwf_original_rolls[index]
                gwf_parts.append(f"{original_value}→{rerolled_value}" if original_value <= 2 else str(rerolled_value))
            rolls_str = "+".join(gwf_parts)
            gwf_label = " 🗡️巨武器重投(原值→重投)"

        combat_content += f" | 💥 {rolls_str} ({damage_roll.dice}){mod_str} = {damage_roll.total} {dmg_type}{gwf_label}"

        if savage_attacks_roll and savage_attacks_damage > 0:
            combat_content += f" + {savage_attacks_roll.rolls[0]} ({savage_attacks_roll.dice}) = {savage_attacks_damage} 野蛮攻击"
        if brutal_critical_roll and brutal_critical_damage > 0:
            brutal_rolls_str = "+".join(str(roll) for roll in brutal_critical_roll.rolls)
            combat_content += f" + {brutal_rolls_str} ({brutal_critical_roll.dice}) = {brutal_critical_damage} 野蛮重击"
        if sneak_attack_roll and sneak_attack_damage > 0:
            sneak_rolls_str = "+".join(str(roll) for roll in sneak_attack_roll.rolls)
            combat_content += f" + {sneak_rolls_str} ({sneak_attack_roll.dice}) = {sneak_attack_damage} 偷袭"
        if divine_strike_roll and divine_strike_damage > 0:
            divine_rolls_str = "+".join(str(roll) for roll in divine_strike_roll.rolls)
            divine_type = _translate_damage_type(divine_strike_type, damage_type_labels)
            combat_content += f" + {divine_rolls_str} ({divine_strike_roll.dice}) = {divine_strike_damage} {divine_type}神圣打击"
        if enlarge_reduce_roll and enlarge_reduce_damage != 0:
            enlarge_rolls_str = "+".join(str(roll) for roll in enlarge_reduce_roll.rolls)
            if enlarge_reduce_damage > 0:
                combat_content += f" + {enlarge_rolls_str} ({enlarge_reduce_roll.dice}) = +{enlarge_reduce_damage} 📏变巨"
            else:
                combat_content += f" - {enlarge_rolls_str} ({enlarge_reduce_roll.dice}) = {enlarge_reduce_damage} 📏缩小"
        if extra_damage_roll and extra_damage_dealt > 0:
            extra_rolls_str = "+".join(str(roll) for roll in extra_damage_roll.rolls)
            extra_mod_str = (
                f"+{extra_damage_roll.modifier}" if extra_damage_roll.modifier > 0
                else (f"{extra_damage_roll.modifier}" if extra_damage_roll.modifier < 0 else "")
            )
            extra_type = _translate_damage_type(extra_damage_type, damage_type_labels) or "额外"
            combat_content += f" + {extra_rolls_str} ({extra_damage_roll.dice}){extra_mod_str} = {extra_damage_dealt} {extra_type}"

        if (
            extra_damage_dealt > 0
            or savage_attacks_damage > 0
            or brutal_critical_damage > 0
            or sneak_attack_damage > 0
            or divine_strike_damage > 0
            or enlarge_reduce_damage != 0
            or rage_damage_bonus > 0
            or power_attack_active
        ):
            combat_content += f" (共 {damage_before_resistance} 点伤害)"

        if rage_resistance_applied:
            combat_content += f"\n🛡️ **狂暴抗性**: {damage_before_resistance} ÷ 2 = {total_damage} 点实际伤害"

    if critical:
        crit_rule = f"自然{attack_d20}命中" if crit_range < 20 else "自然20必然命中"
        crit_range_tip = f"（重击范围: {crit_range}-20）" if crit_range < 20 else ""
        combat_content += f"\n> 💡 **大成功规则**: {crit_rule}，伤害骰数量翻倍{crit_range_tip}"
        if savage_attacks_damage > 0:
            combat_content += "\n> 🔥 **野蛮攻击**: 半兽人种族特性，重击时额外投一个武器伤害骰"
        if brutal_critical_damage > 0:
            brutal_dice_count = get_brutal_critical_dice(attacker_class_id, attacker_level or 1)
            combat_content += f"\n> ⚔️ **野蛮重击**: 野蛮人职业特性，重击时额外投{brutal_dice_count}个武器伤害骰"
    elif fumble:
        combat_content += "\n> 💡 **大失败规则**: 自然1必然未命中，无论攻击加值多高"

    if rage_damage_bonus > 0:
        combat_content += f"\n> 🔥 **狂暴**: 野蛮人职业特性，近战武器攻击+{rage_damage_bonus}伤害"
    if attacker_is_reckless:
        combat_content += "\n> 💢 **鲁莽攻击**: 野蛮人职业特性，本轮力量近战攻击具有优势，敌人对你的攻击也具有优势"
    if inspiration_roll and inspiration_value > 0:
        combat_content += f"\n> 🎵 **激励**: 诗人赋予的激励骰({inspiration_die})，可以加到攻击检定、属性检定或豁免检定上"
    if halfling_lucky_reroll:
        combat_content += f"\n> 🍀 **半身人幸运**: 自然1重投 → {attack_d20}"
    if sneak_attack_damage > 0 and sneak_attack_roll:
        combat_content += f"\n> 🗡️ **偷袭**: 盗贼职业特性，额外 {sneak_attack_roll.dice} = {sneak_attack_damage} 伤害"
    if divine_strike_damage > 0 and divine_strike_roll:
        divine_type = _translate_damage_type(divine_strike_type, damage_type_labels)
        combat_content += f"\n> ⚔️ **神圣打击**: 牧师领域特性，额外 {divine_strike_roll.dice} = {divine_strike_damage} {divine_type}伤害"
    if relentless_triggered:
        combat_content += "\n> 🔥 **不屈**: 半兽人种族特性，生命值降至1而非0！"
    if target_defeated:
        combat_content += f"\n💀 **{target_name}** 被击倒!"
    if thunderbolt_strike_note:
        combat_content += f"\n{thunderbolt_strike_note}"

    return combat_content
