"""
Ability check and skill check utility functions.
Provides functions for calculating ability/skill check modifiers and handling advantage/disadvantage.
"""
from typing import Optional, List, Dict, Any

# Skill to ability mapping
SKILL_ABILITIES: Dict[str, str] = {
    # Strength
    "athletics": "strength",
    "运动": "strength",
    # Dexterity
    "acrobatics": "dexterity",
    "sleight_of_hand": "dexterity",
    "stealth": "dexterity",
    "杂技": "dexterity",
    "巧手": "dexterity",
    "隐匿": "dexterity",
    # Intelligence
    "arcana": "intelligence",
    "history": "intelligence",
    "investigation": "intelligence",
    "nature": "intelligence",
    "religion": "intelligence",
    "奥秘": "intelligence",
    "历史": "intelligence",
    "调查": "intelligence",
    "自然": "intelligence",
    "宗教": "intelligence",
    # Wisdom
    "animal_handling": "wisdom",
    "insight": "wisdom",
    "medicine": "wisdom",
    "perception": "wisdom",
    "survival": "wisdom",
    "驯兽": "wisdom",
    "洞悉": "wisdom",
    "医药": "wisdom",
    "察觉": "wisdom",
    "求生": "wisdom",
    # Charisma
    "deception": "charisma",
    "intimidation": "charisma",
    "performance": "charisma",
    "persuasion": "charisma",
    "欺瞒": "charisma",
    "威吓": "charisma",
    "表演": "charisma",
    "游说": "charisma",
}

# Ability name translations
ABILITY_NAMES_CN = {
    "strength": "力量",
    "dexterity": "敏捷",
    "constitution": "体质",
    "intelligence": "智力",
    "wisdom": "感知",
    "charisma": "魅力"
}

ABILITY_NAMES_EN = {
    "力量": "strength",
    "敏捷": "dexterity",
    "体质": "constitution",
    "智力": "intelligence",
    "感知": "wisdom",
    "魅力": "charisma"
}


def calc_ability_modifier(score: int) -> int:
    """Calculate ability modifier from ability score"""
    return (score - 10) // 2


def get_proficiency_bonus(level: int) -> int:
    """Calculate proficiency bonus based on level"""
    if level < 5:
        return 2
    elif level < 9:
        return 3
    elif level < 13:
        return 4
    elif level < 17:
        return 5
    else:
        return 6


def get_skill_ability(skill: str) -> str:
    """
    Get the ability associated with a skill.

    Args:
        skill: Skill name (English or Chinese)

    Returns:
        Ability name (lowercase English)
    """
    skill_lower = skill.lower().replace(" ", "_")
    return SKILL_ABILITIES.get(skill_lower, skill_lower)


def calc_ability_check_modifier(
    ability_scores: Dict[str, int],
    check_type: str,
    skill: Optional[str] = None,
    is_proficient: bool = False,
    has_expertise: bool = False,
    level: int = 1,
    proficiency_bonus: Optional[int] = None
) -> Dict[str, Any]:
    """
    Calculate the ability/skill check modifier.

    Args:
        ability_scores: Dict of ability scores
        check_type: The ability type (strength, dexterity, etc.) or skill name
        skill: Optional skill name if different from check_type
        is_proficient: Whether proficient in this skill
        has_expertise: Whether has expertise (double proficiency)
        level: Character level for proficiency bonus calculation
        proficiency_bonus: Override proficiency bonus

    Returns:
        Dict with modifier details
    """
    # Determine the ability to use
    if skill:
        ability = get_skill_ability(skill)
        check_name = skill
    else:
        # Normalize ability name
        ability = check_type.lower()
        if ability in ABILITY_NAMES_EN:
            ability = ABILITY_NAMES_EN[ability]
        check_name = check_type

    # Get ability score and modifier
    ability_score = ability_scores.get(ability, 10)
    ability_mod = calc_ability_modifier(ability_score)

    # Calculate proficiency bonus
    if proficiency_bonus is None:
        proficiency_bonus = get_proficiency_bonus(level)

    # Apply proficiency/expertise
    if has_expertise:
        prof_bonus_applied = proficiency_bonus * 2
    elif is_proficient:
        prof_bonus_applied = proficiency_bonus
    else:
        prof_bonus_applied = 0

    total = ability_mod + prof_bonus_applied

    return {
        "ability": ability,
        "ability_mod": ability_mod,
        "proficiency_bonus": prof_bonus_applied,
        "is_proficient": is_proficient,
        "has_expertise": has_expertise,
        "total": total,
        "ability_name_cn": ABILITY_NAMES_CN.get(ability, ability),
        "check_name": check_name
    }


def check_advantage_on_ability_check(
    ability: str,
    skill: Optional[str] = None,
    active_effects: Optional[List[Dict[str, Any]]] = None,
    conditions: Optional[List[str]] = None,
    armor_non_proficient: bool = False
) -> Dict[str, Any]:
    """
    Check if a creature has advantage or disadvantage on an ability check.
    Uses the unified data-driven modifier system from effect_service.

    Args:
        ability: The ability type (strength, dexterity, etc.)
        skill: Optional specific skill
        active_effects: Active effects on the creature
        conditions: Conditions affecting the creature
        armor_non_proficient: Whether wearing non-proficient armor/shield

    Returns:
        Dict with {"advantage": bool, "disadvantage": bool, "reasons": list}
    """
    from app.services.effect_service import get_modifiers_for_target, conditions_to_effects

    ability_lower = ability.lower()
    if ability_lower in ABILITY_NAMES_EN:
        ability_lower = ABILITY_NAMES_EN[ability_lower]

    # Merge active_effects + conditions (dedup by ID)
    existing_ids = set()
    combined = []
    for eff in (active_effects or []):
        eid = eff.get("id", "")
        combined.append(eff)
        if eid:
            existing_ids.add(eid)
    for eff in conditions_to_effects(conditions):
        if eff.get("id") not in existing_ids:
            combined.append(eff)

    # Call unified modifier engine
    condition_ctx = {"ability": ability_lower}
    if skill:
        condition_ctx["skill"] = skill.lower()
    result = get_modifiers_for_target(combined, "ability_check", condition_ctx)

    advantage = result["has_advantage"]
    disadvantage = result["has_disadvantage"]
    reasons = result["reasons"]

    # Armor non-proficiency: disadvantage on STR/DEX ability checks
    # (kept hardcoded — this is equipment state, not an effect)
    if armor_non_proficient and ability_lower in ("strength", "dexterity"):
        disadvantage = True
        reasons.append("护甲不熟练（力量/敏捷检定劣势）")

    # Numeric ability-check bonus (e.g. Guidance's +1d4). Sourced from the SAME
    # get_modifiers_for_target call above so the rolled value matches its reason
    # string — the caller adds this to the check total.
    bonus = sum(int(v) for v in result.get("bonuses", []))

    return {
        "advantage": advantage,
        "disadvantage": disadvantage,
        "reasons": reasons,
        "bonus": bonus,
    }


# Grapple and Shove contest rules
def get_grapple_check_type(is_attacker: bool) -> Dict[str, str]:
    """
    Get the check type for grapple contest.

    Attacker: Athletics check
    Defender: Athletics or Acrobatics (defender's choice)

    Returns:
        Dict with skill and ability info
    """
    if is_attacker:
        return {
            "skill": "athletics",
            "ability": "strength",
            "skill_cn": "运动",
            "ability_cn": "力量"
        }
    else:
        # Defender can choose - we'll let the API handle this
        return {
            "skill": "athletics_or_acrobatics",
            "ability": "strength_or_dexterity",
            "skill_cn": "运动或杂技",
            "ability_cn": "力量或敏捷"
        }


def get_shove_check_type(is_attacker: bool) -> Dict[str, str]:
    """
    Get the check type for shove contest.
    Same as grapple - attacker uses Athletics, defender uses Athletics or Acrobatics.
    """
    return get_grapple_check_type(is_attacker)
