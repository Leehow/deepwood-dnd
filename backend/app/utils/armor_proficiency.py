"""
Armor proficiency check utilities.
Determines if a character is proficient with their equipped armor/shield,
and returns penalty info per D&D 5E rules.
"""
from typing import Optional, Set, Dict, Any, List

from app.utils.rules_cache import (
    get_class_by_name,
    get_race_by_name,
    get_equipment_data,
)


def get_armor_proficiencies(character) -> Set[str]:
    """Get armor proficiency set from race/class/subclass traits.

    Returns set of strings like: 'light_armor', 'medium_armor', 'heavy_armor', 'shields', or specific armor ids.
    """
    profs: Set[str] = set()

    # Race & subrace traits
    race_data = get_race_by_name(character.race_id) if character.race_id else None
    if race_data:
        traits = list(race_data.get("traits", []))
        if character.subrace_id:
            for sr in race_data.get("subraces", []):
                if sr.get("id") == character.subrace_id:
                    traits.extend(sr.get("traits", []))
                    break
        for t in traits:
            for ap in t.get("armorProficiencies", []):
                profs.add(ap)
            sd = t.get("structuredData") or {}
            for ap in sd.get("armorProficiencies", []):
                profs.add(ap)

    # Class proficiencies
    class_data = get_class_by_name(character.class_id) if character.class_id else None
    if class_data:
        for ap in class_data.get("proficiencies", {}).get("armor", []):
            profs.add(ap)
        # Subclass level 1 features
        if character.subclass_id:
            for sc in class_data.get("subclasses", []):
                if sc.get("id") == character.subclass_id:
                    for feat in sc.get("level1Features", []):
                        sd = feat.get("structuredData") or {}
                        for ap in sd.get("armorProficiencies", []):
                            profs.add(ap)
                    break

    return profs


def find_armor_tier(item_id: str) -> Optional[str]:
    """Find the armor tier ('light', 'medium', 'heavy', 'shield') for an item id.

    Returns None if the item is not found in armor data.
    """
    eq = get_equipment_data()
    armor = eq.get("armor", {})
    for tier in ("light", "medium", "heavy", "shield"):
        for item in armor.get(tier, []):
            if item.get("id") == item_id:
                return tier
    return None


def _is_proficient_with_armor(item_id: str, profs: Set[str]) -> bool:
    """Check if a specific armor item is covered by the proficiency set."""
    tier = find_armor_tier(item_id)
    if tier is None:
        return item_id in profs
    tier_map = {
        "light": "light_armor",
        "medium": "medium_armor",
        "heavy": "heavy_armor",
        "shield": "shields",
    }
    return tier_map.get(tier, "") in profs or item_id in profs


TIER_LABEL = {
    "light": "轻甲",
    "medium": "中甲",
    "heavy": "重甲",
    "shield": "盾牌",
}


def check_armor_proficiency_penalty(character) -> Dict[str, Any]:
    """Check equipped armor/shield for non-proficiency.

    Returns:
        {
            "has_penalty": bool,
            "items": [{"name": str, "tier_label": str}, ...]
        }
    """
    equipment: List[Dict[str, Any]] = character.equipment or []
    profs = get_armor_proficiencies(character)
    non_prof_items: List[Dict[str, str]] = []

    # Check armor slot
    for item in equipment:
        if not isinstance(item, dict):
            continue
        if item.get("equippedSlot") == "armor" and item.get("id"):
            tier = find_armor_tier(item["id"])
            # Only real armor (light/medium/heavy), not clothing
            if tier in ("light", "medium", "heavy"):
                if not _is_proficient_with_armor(item["id"], profs):
                    non_prof_items.append({
                        "name": item.get("name", item["id"]),
                        "tier_label": TIER_LABEL.get(tier, tier),
                    })

    # Check off-hand slot for shield
    for item in equipment:
        if not isinstance(item, dict):
            continue
        if item.get("equippedSlot") == "off_hand" and item.get("id") == "shield":
            if not _is_proficient_with_armor("shield", profs):
                non_prof_items.append({
                    "name": item.get("name", "盾牌"),
                    "tier_label": TIER_LABEL["shield"],
                })

    return {
        "has_penalty": len(non_prof_items) > 0,
        "items": non_prof_items,
    }
