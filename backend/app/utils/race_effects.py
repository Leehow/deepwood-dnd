"""
Race combat effects utility module.
Loads race data and provides functions to get combat effects for a race.
"""
from typing import Dict, List, Optional, Any
from app.utils.rules_cache import get_races_data


def _load_races_data() -> Dict:
    """Load races.json data from cache."""
    return get_races_data()


def get_race_combat_effects(race_id: str) -> List[Dict[str, Any]]:
    """
    Get all combat effects for a race (including main race and subrace traits).

    Args:
        race_id: The race ID (e.g., "half_orc", "dwarf", "elf_high")

    Returns:
        List of combat effect dictionaries
    """
    if not race_id:
        return []

    races_data = _load_races_data()
    effects = []

    # Normalize race_id for matching
    race_id_lower = race_id.lower().replace("-", "_")

    for race in races_data.get("races", []):
        race_match_id = race.get("id", "").lower().replace("-", "_")

        # Check if this is the main race
        if race_match_id == race_id_lower:
            # Add main race trait effects
            for trait in race.get("traits", []):
                if "combatEffects" in trait:
                    ce = trait["combatEffects"]
                    if isinstance(ce, list):
                        effects.extend(ce)
                    else:
                        effects.append(ce)
            break

        # Check subraces
        for subrace in race.get("subraces", []):
            subrace_match_id = subrace.get("id", "").lower().replace("-", "_")
            if subrace_match_id == race_id_lower:
                # Add main race trait effects first
                for trait in race.get("traits", []):
                    if "combatEffects" in trait:
                        ce = trait["combatEffects"]
                        if isinstance(ce, list):
                            effects.extend(ce)
                        else:
                            effects.append(ce)

                # Then add subrace trait effects
                for trait in subrace.get("traits", []):
                    if "combatEffects" in trait:
                        ce = trait["combatEffects"]
                        if isinstance(ce, list):
                            effects.extend(ce)
                        else:
                            effects.append(ce)
                break

    return effects


def get_effects_by_trigger(
    race_id: str,
    trigger: str,
    conditions: Optional[Dict[str, Any]] = None
) -> List[Dict[str, Any]]:
    """
    Get combat effects for a race that match a specific trigger and conditions.

    Args:
        race_id: The race ID
        trigger: The trigger type (e.g., "on_critical", "on_natural_1", "passive")
        conditions: Optional conditions to match (e.g., {"is_melee": True})

    Returns:
        List of matching combat effects
    """
    all_effects = get_race_combat_effects(race_id)
    matching = []

    for effect in all_effects:
        # Check trigger matches
        if effect.get("trigger") != trigger:
            continue

        # Check conditions match if provided
        if conditions:
            effect_conditions = effect.get("conditions", {})
            match = True
            for key, value in effect_conditions.items():
                if key in conditions and conditions[key] != value:
                    match = False
                    break
            if not match:
                continue

        matching.append(effect)

    return matching


def check_savage_attacks(race_id: str, is_melee: bool = True) -> bool:
    """
    Check if a race has the Savage Attacks ability (extra damage die on melee critical).

    Args:
        race_id: The race ID
        is_melee: Whether the attack is melee

    Returns:
        True if race has Savage Attacks and conditions are met
    """
    if not is_melee:
        return False

    effects = get_effects_by_trigger(race_id, "on_critical")
    for effect in effects:
        if effect.get("effect") == "extra_damage_die":
            conditions = effect.get("conditions", {})
            # If conditions specify is_melee=True, it must be a melee attack
            if conditions.get("is_melee", False) and is_melee:
                return True
            # If no melee condition specified, apply to all attacks
            if "is_melee" not in conditions:
                return True

    return False


def check_lucky(race_id: str) -> bool:
    """
    Check if a race has the Lucky ability (reroll natural 1s).

    Args:
        race_id: The race ID

    Returns:
        True if race has Lucky ability
    """
    effects = get_effects_by_trigger(race_id, "on_natural_1")
    for effect in effects:
        if effect.get("effect") == "reroll":
            return True
    return False


def get_damage_resistances(race_id: str) -> List[str]:
    """
    Get all damage resistances for a race.

    Args:
        race_id: The race ID

    Returns:
        List of damage types the race has resistance to
    """
    resistances = []
    effects = get_effects_by_trigger(race_id, "passive")

    for effect in effects:
        if effect.get("effect") == "damage_resistance":
            params = effect.get("params", {})
            resistance_type = params.get("resistance_type")
            if resistance_type:
                resistances.append(resistance_type)

    return resistances


def get_saving_throw_advantages(race_id: str) -> List[str]:
    """
    Get all saving throw types the race has advantage on.

    Args:
        race_id: The race ID

    Returns:
        List of save types (e.g., ["poison", "charm"])
    """
    advantages = []
    effects = get_effects_by_trigger(race_id, "on_saving_throw")

    for effect in effects:
        if effect.get("effect") == "saving_throw_advantage":
            conditions = effect.get("conditions", {})
            save_type = conditions.get("save_type")
            if save_type:
                advantages.append(save_type)

    return advantages
