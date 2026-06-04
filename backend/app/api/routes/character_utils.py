"""
Character utility functions for calculations and data normalization.
Split from characters.py as part of code modularization.
"""

from typing import List, Optional, Dict, Any


def get_class_hit_die(class_id: str) -> int:
    """Get hit die for a class"""
    hit_die_map = {
        "barbarian": 12,
        "fighter": 10,
        "paladin": 10,
        "ranger": 10,
        "bard": 8,
        "cleric": 8,
        "druid": 8,
        "monk": 8,
        "rogue": 8,
        "warlock": 8,
        "sorcerer": 6,
        "wizard": 6
    }
    return hit_die_map.get(class_id, 8)  # Default to d8


def calculate_max_hp(character) -> int:
    """
    Calculate character's max HP based on class, level, and CON modifier

    Formula:
    - Level 1: Full hit die + CON modifier
    - Subsequent levels: Average ((hit_die / 2) + 1) + CON modifier

    For multiclass characters, calculate HP for each class separately
    """
    con_modifier = (character.ability_scores.get("constitution", 10) - 10) // 2

    # Handle multiclass
    if character.multiclass_data and character.multiclass_data.get("classes"):
        total_hp = 0
        for class_entry in character.multiclass_data["classes"]:
            class_id = class_entry["class_id"]
            class_level = class_entry["level"]
            hit_die = get_class_hit_die(class_id)

            if class_level >= 1:
                # First level: full hit die + CON modifier
                total_hp += hit_die + con_modifier
                # Subsequent levels: average + CON modifier
                if class_level > 1:
                    avg_roll = (hit_die // 2) + 1
                    total_hp += (avg_roll + con_modifier) * (class_level - 1)

        return max(total_hp, character.level)  # At least equal to level

    # Single class
    hit_die = get_class_hit_die(character.class_id)
    level = character.level

    # First level: full hit die + CON modifier
    max_hp = hit_die + con_modifier

    # Subsequent levels: average + CON modifier
    if level > 1:
        avg_roll = (hit_die // 2) + 1
        max_hp += (avg_roll + con_modifier) * (level - 1)

    return max(max_hp, level)  # At least equal to level


def normalize_spell_list(spells, default_level=1, default_source="migration"):
    """
    Convert spell list to new format with level tracking.

    Input: ["spell_1", "spell_2"] or [{"id": "spell_1", "level_learned": 1, ...}]
    Output: [{"id": "spell_1", "level_learned": 1, "source": "wizard"}]
    """
    if not spells:
        return []

    normalized = []
    for spell in spells:
        if isinstance(spell, str):
            # Old format: convert to new format
            normalized.append({
                "id": spell,
                "level_learned": default_level,
                "source": default_source
            })
        elif isinstance(spell, dict):
            # New format: ensure all fields exist
            normalized.append({
                "id": spell.get("id"),
                "level_learned": spell.get("level_learned", default_level),
                "source": spell.get("source", default_source)
            })

    return normalized


def extract_spell_ids(spells):
    """
    Extract spell IDs from spell list (works with both formats).

    Input: ["spell_1"] or [{"id": "spell_1", ...}]
    Output: ["spell_1"]
    """
    if not spells:
        return []

    ids = []
    for spell in spells:
        if isinstance(spell, str):
            ids.append(spell)
        elif isinstance(spell, dict):
            ids.append(spell.get("id"))

    return ids


def filter_spells_by_level(spells, max_level):
    """
    Filter spells to only include those learned at or below max_level.

    Input: [{"id": "spell_1", "level_learned": 1}, {"id": "spell_2", "level_learned": 3}]
    Output (max_level=1): [{"id": "spell_1", "level_learned": 1}]
    """
    if not spells:
        return []

    # First normalize to ensure proper format
    normalized = normalize_spell_list(spells)

    return [
        spell for spell in normalized
        if spell.get("level_learned", 1) <= max_level
    ]


def get_initial_spell_slots(class_id: str, level: int = 1):
    """
    Get initial spell slots for a class at a given level.

    Returns array: [0, slots_1st, slots_2nd, ..., slots_9th]
    Returns None if class is not a spellcaster.
    """
    # Caster type mapping
    caster_types = {
        "wizard": "full",
        "cleric": "full",
        "druid": "full",
        "sorcerer": "full",
        "bard": "full",
        "artificer": "full",
        "paladin": "half",
        "ranger": "half",
        "warlock": "pact"
    }

    caster_type = caster_types.get(class_id)
    if not caster_type:
        return None  # Not a spellcaster

    # Full casters spell slots by level
    full_caster_slots = {
        1: [0, 2, 0, 0, 0, 0, 0, 0, 0, 0],
        2: [0, 3, 0, 0, 0, 0, 0, 0, 0, 0],
        3: [0, 4, 2, 0, 0, 0, 0, 0, 0, 0],
        4: [0, 4, 3, 0, 0, 0, 0, 0, 0, 0],
        5: [0, 4, 3, 2, 0, 0, 0, 0, 0, 0],
    }

    # Half casters spell slots by level
    half_caster_slots = {
        1: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        2: [0, 2, 0, 0, 0, 0, 0, 0, 0, 0],
        3: [0, 3, 0, 0, 0, 0, 0, 0, 0, 0],
        4: [0, 3, 0, 0, 0, 0, 0, 0, 0, 0],
        5: [0, 4, 2, 0, 0, 0, 0, 0, 0, 0],
    }

    if caster_type == "full":
        return full_caster_slots.get(level, [0, 2, 0, 0, 0, 0, 0, 0, 0, 0])
    elif caster_type == "half":
        return half_caster_slots.get(level, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    elif caster_type == "pact":
        # Warlock pact magic (simplified)
        return [0, 1, 0, 0, 0, 0, 0, 0, 0, 0]

    return None


def normalize_selection_list(
    selections: Optional[Any],
    default_level: int = 1,
    default_source: str = "migration"
) -> List[Dict[str, Any]]:
    """Convert old format (strings) to new format (objects with level tracking)"""
    if not selections:
        return []

    normalized = []
    for item in selections:
        if isinstance(item, str):
            normalized.append({
                "value": item,
                "level_learned": default_level,
                "source": default_source
            })
        elif isinstance(item, dict):
            normalized.append({
                "value": item.get("value") or item.get("id"),
                "level_learned": item.get("level_learned", default_level),
                "source": item.get("source", default_source)
            })
        else:
            # Skip invalid entries
            continue

    return normalized


def normalize_single_selection(
    selection: Optional[Any],
    default_level: int = 1,
    default_source: str = "migration"
) -> Optional[Dict[str, Any]]:
    """Convert old format (string) to new format (object with level tracking)"""
    if not selection:
        return None

    if isinstance(selection, str):
        return {
            "value": selection,
            "level_learned": default_level,
            "source": default_source
        }
    elif isinstance(selection, dict):
        return {
            "value": selection.get("value") or selection.get("id"),
            "level_learned": selection.get("level_learned", default_level),
            "source": selection.get("source", default_source)
        }

    return None


def extract_values(selections: Optional[Any]) -> List[str]:
    """Extract values from selection list (works with both formats)"""
    if not selections:
        return []

    values = []
    for item in selections:
        if isinstance(item, str):
            values.append(item)
        elif isinstance(item, dict):
            values.append(item.get("value") or item.get("id"))

    return values


def extract_single_value(selection: Optional[Any]) -> Optional[str]:
    """Extract value from single selection (works with both formats)"""
    if not selection:
        return None

    if isinstance(selection, str):
        return selection
    elif isinstance(selection, dict):
        return selection.get("value") or selection.get("id")

    return None


def filter_selections_by_level(
    selections: Optional[Any],
    max_level: int
) -> List[Dict[str, Any]]:
    """Filter selections to only include those learned at or below max_level"""
    normalized = normalize_selection_list(selections)
    return [s for s in normalized if s.get("level_learned", 1) <= max_level]


def filter_single_selection_by_level(
    selection: Optional[Any],
    max_level: int
) -> Optional[Dict[str, Any]]:
    """Filter single selection based on level learned"""
    normalized = normalize_single_selection(selection)
    if not normalized:
        return None

    if normalized.get("level_learned", 1) <= max_level:
        return normalized

    return None


def calculate_proficiency_bonus(level: int) -> int:
    """Calculate proficiency bonus based on character level"""
    return ((level - 1) // 4) + 2


def calculate_ability_modifier(score: int) -> int:
    """Calculate ability modifier from ability score"""
    return (score - 10) // 2


def get_spell_save_dc(character, spellcasting_ability: str) -> int:
    """Calculate spell save DC"""
    ability_score = character.ability_scores.get(spellcasting_ability, 10)
    modifier = calculate_ability_modifier(ability_score)
    proficiency = calculate_proficiency_bonus(character.level)
    return 8 + proficiency + modifier


def get_spell_attack_bonus(character, spellcasting_ability: str) -> int:
    """Calculate spell attack bonus"""
    ability_score = character.ability_scores.get(spellcasting_ability, 10)
    modifier = calculate_ability_modifier(ability_score)
    proficiency = calculate_proficiency_bonus(character.level)
    return proficiency + modifier