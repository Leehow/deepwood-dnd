"""
Saving throw utility functions.
Provides functions for calculating saving throw modifiers and proficiencies.
"""
from typing import Optional, List, Dict, Any

# Class saving throw proficiencies
CLASS_SAVING_THROWS: Dict[str, List[str]] = {
    "barbarian": ["strength", "constitution"],
    "bard": ["dexterity", "charisma"],
    "cleric": ["wisdom", "charisma"],
    "druid": ["intelligence", "wisdom"],
    "fighter": ["strength", "constitution"],
    "monk": ["strength", "dexterity"],
    "paladin": ["wisdom", "charisma"],
    "ranger": ["strength", "dexterity"],
    "rogue": ["dexterity", "intelligence"],
    "sorcerer": ["constitution", "charisma"],
    "warlock": ["wisdom", "charisma"],
    "wizard": ["intelligence", "wisdom"],
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


def is_proficient_in_save(class_id: Optional[str], save_type: str) -> bool:
    """
    Check if a class is proficient in a saving throw type.

    Args:
        class_id: The class ID (e.g., "fighter", "wizard")
        save_type: The saving throw type (e.g., "strength", "dexterity")

    Returns:
        True if proficient, False otherwise
    """
    if not class_id:
        return False

    class_id_lower = class_id.lower()
    save_type_lower = save_type.lower()

    # Normalize Chinese ability names to English
    if save_type_lower in ABILITY_NAMES_EN:
        save_type_lower = ABILITY_NAMES_EN[save_type_lower]

    proficient_saves = CLASS_SAVING_THROWS.get(class_id_lower, [])
    return save_type_lower in proficient_saves


def calc_saving_throw_modifier(
    ability_scores: Dict[str, int],
    save_type: str,
    class_id: Optional[str] = None,
    level: int = 1,
    proficiency_bonus: Optional[int] = None,
    extra_proficient_saves: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    Calculate the saving throw modifier for a given ability.

    Args:
        ability_scores: Dict of ability scores {strength: 16, dexterity: 14, ...}
        save_type: The saving throw type (e.g., "strength", "dexterity")
        class_id: The class ID for proficiency check
        level: Character level for proficiency bonus calculation
        proficiency_bonus: Override proficiency bonus (for monsters)

    Returns:
        Dict with modifier details:
        {
            "ability_mod": int,
            "proficiency_bonus": int,
            "is_proficient": bool,
            "total": int,
            "ability_name_cn": str
        }
    """
    save_type_lower = save_type.lower()

    # Normalize Chinese ability names to English
    if save_type_lower in ABILITY_NAMES_EN:
        save_type_lower = ABILITY_NAMES_EN[save_type_lower]

    # Get ability score
    ability_score = ability_scores.get(save_type_lower, 10)
    ability_mod = calc_ability_modifier(ability_score)

    # Check proficiency
    is_proficient = is_proficient_in_save(class_id, save_type_lower)

    # Extra proficiency from feats (e.g., Resilient)
    if not is_proficient and extra_proficient_saves:
        if save_type_lower in [s.lower() for s in extra_proficient_saves]:
            is_proficient = True

    # Calculate proficiency bonus
    if proficiency_bonus is None:
        proficiency_bonus = get_proficiency_bonus(level)

    prof_bonus_applied = proficiency_bonus if is_proficient else 0
    total = ability_mod + prof_bonus_applied

    return {
        "ability_mod": ability_mod,
        "proficiency_bonus": prof_bonus_applied,
        "is_proficient": is_proficient,
        "total": total,
        "ability_name_cn": ABILITY_NAMES_CN.get(save_type_lower, save_type)
    }


def check_advantage_on_save(
    save_type: str,
    active_effects: Optional[List[Dict[str, Any]]] = None,
    conditions: Optional[List[str]] = None,
    armor_non_proficient: bool = False
) -> Dict[str, bool]:
    """
    Check if a creature has advantage or disadvantage on a saving throw.
    Uses the unified effect modifier system from effect_service.

    Args:
        save_type: The saving throw type
        active_effects: Active effects on the creature
        conditions: Conditions affecting the creature
        armor_non_proficient: Whether wearing non-proficient armor/shield

    Returns:
        Dict with {"advantage": bool, "disadvantage": bool}
    """
    from app.services.effect_service import get_modifiers_for_target, conditions_to_effects

    save_type_lower = save_type.lower()
    if save_type_lower in ABILITY_NAMES_EN:
        save_type_lower = ABILITY_NAMES_EN[save_type_lower]

    # Merge active_effects + conditions (dedup by ID)
    existing_ids = set()
    combined_effects = []
    for eff in (active_effects or []):
        eid = eff.get("id", "")
        combined_effects.append(eff)
        if eid:
            existing_ids.add(eid)
    for eff in conditions_to_effects(conditions):
        if eff.get("id") not in existing_ids:
            combined_effects.append(eff)

    # Use unified modifier system
    result = get_modifiers_for_target(
        combined_effects,
        "saving_throw",
        {"ability": save_type_lower}
    )

    advantage = result["has_advantage"]
    disadvantage = result["has_disadvantage"]

    # Armor non-proficiency: disadvantage on STR/DEX saving throws
    if armor_non_proficient and save_type_lower in ("strength", "dexterity"):
        disadvantage = True

    return {"advantage": advantage, "disadvantage": disadvantage}


def calc_spell_save_dc(
    caster_ability_score: int,
    proficiency_bonus: int
) -> int:
    """
    Calculate spell save DC.

    DC = 8 + proficiency bonus + spellcasting ability modifier

    Args:
        caster_ability_score: The caster's spellcasting ability score
        proficiency_bonus: The caster's proficiency bonus

    Returns:
        The spell save DC
    """
    ability_mod = calc_ability_modifier(caster_ability_score)
    return 8 + proficiency_bonus + ability_mod


def calc_aura_saving_throw_bonus(
    target_token_id: int,
    all_tokens: List[Dict[str, Any]],
    grid_size: int = 5
) -> Dict[str, Any]:
    """
    Calculate saving throw bonus from nearby auras (e.g., Paladin's Aura of Protection).

    Args:
        target_token_id: The token making the saving throw
        all_tokens: All tokens on the map (each with id, position_x, position_y, token_size, active_auras)
        grid_size: Grid size in feet (default 5)

    Returns:
        Dict with:
        {
            "bonus": int (highest non-stacking aura bonus),
            "source_name": str (name of the aura source),
            "aura_name": str (name of the aura providing bonus)
        }
    """
    target_token = None
    aura_sources = []

    for token in all_tokens:
        if token.get("id") == target_token_id:
            target_token = token
        if token.get("active_auras"):
            for aura in token.get("active_auras", []):
                if aura.get("id") == "aura_of_protection":
                    aura_sources.append({
                        "token": token,
                        "aura": aura
                    })

    if not target_token or not aura_sources:
        return {"bonus": 0, "source_name": None, "aura_name": None}

    # Calculate distance helper
    def calc_distance(t1: Dict, t2: Dict) -> float:
        def parse_size(s: str) -> tuple:
            if not s:
                return (1, 1)
            parts = s.split('x')
            return (int(parts[0]), int(parts[1]) if len(parts) > 1 else int(parts[0]))

        size1 = parse_size(t1.get("token_size", "1x1"))
        size2 = parse_size(t2.get("token_size", "1x1"))

        c1x = t1.get("position_x", 0) + size1[0] / 2
        c1y = t1.get("position_y", 0) + size1[1] / 2
        c2x = t2.get("position_x", 0) + size2[0] / 2
        c2y = t2.get("position_y", 0) + size2[1] / 2

        return max(abs(c1x - c2x), abs(c1y - c2y)) * grid_size

    # Find the best aura bonus (same auras don't stack, take highest)
    best_bonus = 0
    best_source = None

    for source in aura_sources:
        source_token = source["token"]
        aura = source["aura"]
        radius = aura.get("radius", 10)
        source_cha_mod = aura.get("source_cha_mod", 0)

        # Check if source is conscious (HP > 0)
        source_hp = source_token.get("current_hp")
        if source_hp is not None and source_hp <= 0:
            continue

        # Check distance
        distance = calc_distance(source_token, target_token)
        if distance > radius:
            continue

        # Aura of Protection: bonus = max(1, source_cha_mod)
        bonus = max(1, source_cha_mod)
        if bonus > best_bonus:
            best_bonus = bonus
            best_source = source_token.get("character_name", "Unknown")

    return {
        "bonus": best_bonus,
        "source_name": best_source,
        "aura_name": "护卫灵光" if best_bonus > 0 else None
    }


def check_condition_immunity(
    target_token_id: int,
    condition_type: str,
    all_tokens: List[Dict[str, Any]],
    grid_size: int = 5
) -> Dict[str, Any]:
    """
    DEPRECATED: Use app.services.immunity_service.check_condition_immunity instead.
    This function is kept for backwards compatibility.

    Check if a token is immune to a condition due to aura effects.
    """
    # Redirect to the unified immunity service
    from app.services.immunity_service import check_condition_immunity as unified_check
    is_immune, source = unified_check(
        immunities=None,
        condition_type=condition_type,
        all_tokens=all_tokens,
        target_token_id=target_token_id
    )
    return {
        "immune": is_immune,
        "source_name": source,
        "aura_name": source
    }
