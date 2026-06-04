"""
Class combat effects utility module.
Provides functions to get combat effects based on class and level.

NOTE: This module now delegates to the unified effect_service for effect checking.
The functions here are kept for backward compatibility.
"""
from typing import Optional, List, Dict, Any

# Import from unified effect service
from app.services.effect_service import (
    check_is_raging as _check_is_raging,
    check_is_reckless as _check_is_reckless,
    check_is_frenzied as _check_is_frenzied,
    is_physical_damage as _is_physical_damage,
    get_rage_damage_bonus as _get_rage_damage_bonus,
    get_brutal_critical_dice as _get_brutal_critical_dice,
    PHYSICAL_DAMAGE_TYPES,
)


def get_brutal_critical_dice(class_id: Optional[str], level: int) -> int:
    """
    Get the number of extra damage dice from Barbarian's Brutal Critical.
    Delegates to unified effect_service.
    """
    return _get_brutal_critical_dice(class_id, level)


def get_rage_damage_bonus(level: int) -> int:
    """
    Get the rage damage bonus based on barbarian level.
    Delegates to unified effect_service.
    """
    return _get_rage_damage_bonus(level)


def check_is_raging(active_effects: Optional[List[Dict[str, Any]]]) -> bool:
    """
    Check if a token has rage active in their effects.
    Delegates to unified effect_service.
    """
    return _check_is_raging(active_effects)


def is_physical_damage(damage_type: Optional[str]) -> bool:
    """
    Check if a damage type is physical (affected by rage resistance).
    Delegates to unified effect_service.
    """
    return _is_physical_damage(damage_type)


def check_is_reckless(active_effects: Optional[List[Dict[str, Any]]]) -> bool:
    """
    Check if a token has Reckless Attack active in their effects.
    Delegates to unified effect_service.
    """
    return _check_is_reckless(active_effects)


def check_is_frenzied(active_effects: Optional[List[Dict[str, Any]]]) -> bool:
    """
    Check if a token has Frenzy active in their effects.
    Delegates to unified effect_service.
    """
    return _check_is_frenzied(active_effects)


def get_crit_range(class_id: Optional[str], subclass_id: Optional[str], level: int) -> int:
    """
    Get the critical hit range based on class features.

    Champion Fighter:
    - Level 3: Improved Critical (19-20)
    - Level 15: Superior Critical (18-20)

    Args:
        class_id: The class ID (e.g., "fighter")
        subclass_id: The subclass ID (e.g., "champion")
        level: Character level

    Returns:
        Minimum roll for critical hit (20 = only nat 20, 19 = 19-20, etc.)
    """
    # Champion Fighter
    if class_id and class_id.lower() == "fighter":
        if subclass_id and subclass_id.lower() == "champion":
            if level >= 15:
                return 18  # Superior Critical: 18-20
            elif level >= 3:
                return 19  # Improved Critical: 19-20

    return 20  # Default: only natural 20
