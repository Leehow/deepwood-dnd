"""Helpers for resolving class/background equipment selection payloads."""

from __future__ import annotations

import random
from typing import Any, Dict, List

# ID correction map - fixes incorrect item IDs in class configs.
EQUIPMENT_ID_CORRECTIONS = {
    "leather_armor": "leather",
    "studded_leather_armor": "studded_leather",
    "chain_mail_armor": "chain_mail",
    "scale_mail_armor": "scale_mail",
    "hide_armor": "hide",
    "arcane_focus": "crystal",  # Default arcane focus
    "druidic_focus": "sprig_of_mistletoe",  # Default druidic focus
}


def get_equipment_category_items(equipment_data: dict) -> Dict[str, List[str]]:
    """Build a mapping of equipment categories to specific item IDs."""
    category_map: Dict[str, List[str]] = {}

    # Simple weapons
    simple_melee = [w["id"] for w in equipment_data.get("weapons", {}).get("simple", {}).get("melee", [])]
    simple_ranged = [w["id"] for w in equipment_data.get("weapons", {}).get("simple", {}).get("ranged", [])]
    category_map["simple_weapon"] = simple_melee + simple_ranged
    category_map["simple_melee_weapon"] = simple_melee
    category_map["simple_ranged_weapon"] = simple_ranged

    # Martial weapons
    martial_melee = [w["id"] for w in equipment_data.get("weapons", {}).get("martial", {}).get("melee", [])]
    martial_ranged = [w["id"] for w in equipment_data.get("weapons", {}).get("martial", {}).get("ranged", [])]
    category_map["martial_weapon"] = martial_melee + martial_ranged
    category_map["martial_melee_weapon"] = martial_melee
    category_map["martial_ranged_weapon"] = martial_ranged

    # Armor
    light_armor = [a["id"] for a in equipment_data.get("armor", {}).get("light", [])]
    medium_armor = [a["id"] for a in equipment_data.get("armor", {}).get("medium", [])]
    heavy_armor = [a["id"] for a in equipment_data.get("armor", {}).get("heavy", [])]
    category_map["light_armor"] = light_armor
    category_map["medium_armor"] = medium_armor
    category_map["heavy_armor"] = heavy_armor

    return category_map


def resolve_equipment_item(item_id: str, category_map: Dict[str, List[str]], character_context: Dict | None = None) -> str:
    """
    Resolve an equipment item ID, handling categories and corrections.

    `character_context` is kept for forward-compatible AI-based selection.
    """
    _ = character_context

    # First, apply ID corrections.
    if item_id in EQUIPMENT_ID_CORRECTIONS:
        return EQUIPMENT_ID_CORRECTIONS[item_id]

    # Check if it's a category.
    if item_id in category_map:
        items = category_map[item_id]
        if items:
            return random.choice(items)

    return item_id


def get_equipment_packs(equipment_data: dict) -> Dict[str, Dict[str, Any]]:
    """Get equipment packs data with their contents."""
    packs: Dict[str, Dict[str, Any]] = {}
    for pack in equipment_data.get("packs", []):
        pack_id = pack.get("id")
        if pack_id:
            packs[pack_id] = pack
    return packs


def expand_equipment_pack(item_id: str, packs_data: Dict[str, Dict[str, Any]], source: str) -> List[Dict[str, Any]]:
    """Expand a pack item to concrete equipment entries."""
    if item_id not in packs_data:
        return []

    pack = packs_data[item_id]
    contents = pack.get("contents", [])
    expanded_items: List[Dict[str, Any]] = []

    # Find container in pack contents (backpack, pouch, sack, etc.).
    container_types = {"backpack", "pouch", "sack", "bag", "chest", "basket", "case"}
    container_id = None
    for content_item in contents:
        content_id = content_item.get("item", "")
        if content_id in container_types or any(ct in content_id.lower() for ct in container_types):
            container_id = content_id
            break

    for content_item in contents:
        content_id = content_item.get("item")
        content_qty = content_item.get("quantity", 1)
        if content_id:
            item_data: Dict[str, Any] = {
                "id": content_id,
                "quantity": content_qty,
                "equipped": False,
                "source": source,
                "from_pack": item_id,
            }
            # Put non-container items inside the container.
            if container_id and content_id != container_id:
                item_data["containerId"] = container_id
            expanded_items.append(item_data)

    return expanded_items
