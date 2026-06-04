from __future__ import annotations

from copy import deepcopy
from functools import lru_cache
import re
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlparse

from app.utils.rules_cache import get_equipment_data


CURRENCY_ITEM_RE = re.compile(r"^(?P<base>.+?)_with_(?P<amount>\d+)(?P<currency>cp|sp|ep|gp|pp)$", re.IGNORECASE)
LIBRARY_ITEM_ID_RE = re.compile(r"^library-item-(?P<id>\d+)$", re.IGNORECASE)
CUSTOM_ITEM_ID_RE = re.compile(r"^custom-item-(?P<id>\d+)$", re.IGNORECASE)

ID_CORRECTIONS = {
    "leather_armor": "leather",
    "studded_leather_armor": "studded_leather",
    "chain_shirt_armor": "chain_shirt",
    "chain_mail_armor": "chain_mail",
    "scale_mail_armor": "scale_mail",
    "hide_armor": "hide",
}

ASSET_HOSTS = {"", None, "localhost", "127.0.0.1"}
LEGACY_ITEM_KEYS = {
    "avatar",
    "armorClass",
    "db_item_id",
    "image_url",
    "item_id",
    "library_item_id",
    "name_en",
}

ITEM_MODEL_FIELD_MAP = {
    "name": "name",
    "name_cn": "name_cn",
    "category": "category",
    "subcategory": "subcategory",
    "cost": "cost",
    "weight": "weight",
    "rarity": "rarity",
    "damage": "damage",
    "properties": "properties",
    "range": "range",
    "armor_class": "armor_class",
    "strength_requirement": "strength_requirement",
    "stealth_disadvantage": "stealth_disadvantage",
    "description": "description",
    "description_cn": "description_cn",
    "notes": "notes",
    "is_custom": "is_custom",
    "avatar_url": "avatar_url",
    "avatar_url_large": "avatar_url_large",
    "requires_attunement": "requires_attunement",
    "attunement_by": "attunement_by",
    "magic_bonus": "magic_bonus",
    "extra_damage": "extra_damage",
    "abilities": "abilities",
    "charges": "charges",
    "item_spells": "item_spells",
    "sentient": "sentient",
    "source_module": "source_module",
}


def _deepcopy_if_needed(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return deepcopy(value)
    return value


def _copy_payload_source(source: Dict[str, Any]) -> Dict[str, Any]:
    return {
        key: _deepcopy_if_needed(value)
        for key, value in source.items()
        if key not in LEGACY_ITEM_KEYS
    }


def _to_lookup_key(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    lowered = text.lower()
    return ID_CORRECTIONS.get(lowered, lowered)


def _to_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _to_number(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}
    return False


def _normalize_quantity(value: Any, default: int = 1) -> int:
    qty = _to_int(value)
    return qty if qty is not None and qty > 0 else default


def _normalize_asset_path(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    if text.startswith("/assets/") or text.startswith("assets/"):
        return text.lstrip("/")
    if text.startswith("http://") or text.startswith("https://"):
        parsed = urlparse(text)
        if parsed.hostname in ASSET_HOSTS and parsed.path.startswith("/assets/"):
            return parsed.path.lstrip("/")
    return None


def _normalize_display_image(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    asset_path = _normalize_asset_path(text)
    if asset_path:
        return f"/{asset_path}"
    return text


def _normalize_list_strings(value: Any) -> Optional[List[str]]:
    if not isinstance(value, list):
        return None
    return [str(entry) for entry in value if entry is not None and str(entry).strip()]


def _normalize_damage(raw_damage: Any, raw_damage_type: Any) -> Tuple[Any, Optional[str]]:
    damage_type = str(raw_damage_type).strip() if isinstance(raw_damage_type, str) and raw_damage_type.strip() else None
    if isinstance(raw_damage, dict):
        normalized = dict(raw_damage)
        dice = normalized.get("dice") or normalized.get("formula")
        if dice:
            normalized["dice"] = str(dice)
        if normalized.get("type") and not damage_type:
            damage_type = str(normalized.get("type"))
        elif damage_type and "type" not in normalized:
            normalized["type"] = damage_type
        return normalized, damage_type
    if isinstance(raw_damage, str) and raw_damage.strip():
        return raw_damage.strip(), damage_type
    return None, damage_type


def _normalize_range(raw_range: Any) -> Any:
    if isinstance(raw_range, str):
        return raw_range.strip() or None
    if not isinstance(raw_range, dict):
        return None

    normal = _to_int(raw_range.get("normal"))
    long_range = _to_int(raw_range.get("long"))
    if normal is None and long_range is None:
        return None

    result: Dict[str, int] = {"normal": normal if normal is not None else 0}
    if long_range is not None:
        result["long"] = long_range
    return result


def _normalize_armor_class(raw_value: Any, raw_formula: Any) -> Tuple[Any, Any]:
    armor_class = raw_value
    if armor_class is None:
        armor_class = raw_formula

    normalized_ac = None
    normalized_armor_class = None

    if isinstance(armor_class, dict):
        normalized_armor_class = dict(armor_class)
        base_value = (
            normalized_armor_class.get("base")
            if normalized_armor_class.get("base") is not None
            else normalized_armor_class.get("ac")
        )
        if base_value is not None:
            normalized_armor_class["base"] = _to_int(base_value) if _to_int(base_value) is not None else base_value
            normalized_ac = normalized_armor_class["base"]
        if "dexBonus" in normalized_armor_class and "dex_bonus" not in normalized_armor_class:
            normalized_armor_class["dex_bonus"] = bool(normalized_armor_class.get("dexBonus"))
        if "maxDexBonus" in normalized_armor_class and "max_dex_bonus" not in normalized_armor_class:
            normalized_armor_class["max_dex_bonus"] = _to_int(normalized_armor_class.get("maxDexBonus"))
    elif armor_class is not None:
        converted = _to_int(armor_class)
        normalized_ac = converted if converted is not None else armor_class
        normalized_armor_class = normalized_ac

    return normalized_ac, normalized_armor_class


@lru_cache(maxsize=1)
def _equipment_indexes() -> Dict[str, Dict[str, Any]]:
    equipment_data = get_equipment_data()
    by_id: Dict[str, Dict[str, Any]] = {}
    by_key: Dict[str, Dict[str, Any]] = {}

    def register(item: Dict[str, Any], *, category: Optional[str], equipment_type: str, armor_tier: Optional[str] = None):
        record = {
            **item,
            "_category": category,
            "_equipment_type": equipment_type,
            "_armor_tier": armor_tier,
        }
        item_id = _to_lookup_key(item.get("id"))
        if item_id:
            by_id[item_id] = record

        for key in (item.get("id"), item.get("name"), item.get("nameEn"), item.get("name_en")):
            normalized_key = _to_lookup_key(key)
            if normalized_key and normalized_key not in by_key:
                by_key[normalized_key] = record

    weapons = equipment_data.get("weapons", {})
    for proficiency_group in ("simple", "martial"):
        for weapon_kind in ("melee", "ranged"):
            for item in weapons.get(proficiency_group, {}).get(weapon_kind, []) or []:
                register(item, category="weapon", equipment_type="weapon")

    armor = equipment_data.get("armor", {})
    for tier in ("light", "medium", "heavy", "shield"):
        for item in armor.get(tier, []) or []:
            register(item, category="shield" if tier == "shield" else "armor", equipment_type="armor", armor_tier=tier)

    adventuring = equipment_data.get("adventuringGear", {})
    for section, items in (adventuring or {}).items():
        if not isinstance(items, list):
            continue
        if section == "ammunition":
            category = "ammunition"
            equipment_type = "weapon"
        elif section in {"tools", "kits", "instruments"}:
            category = "tool"
            equipment_type = "tool"
        else:
            category = "gear"
            equipment_type = "gear"
        for item in items:
            register(item, category=category, equipment_type=equipment_type)

    tools = equipment_data.get("tools", {})
    if isinstance(tools, dict):
        for _, items in tools.items():
            if not isinstance(items, list):
                continue
            for item in items:
                register(item, category="tool", equipment_type="tool")

    for item in equipment_data.get("packs", []) or []:
        register(item, category="pack", equipment_type="gear")

    for item in equipment_data.get("backgroundItems", []) or []:
        register(item, category="gear", equipment_type="gear")

    return {"by_id": by_id, "by_key": by_key}


def _find_meta(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    indexes = _equipment_indexes()

    keys = [
        item.get("id"),
        item.get("item_id"),
    ]
    if not _to_bool(item.get("is_custom")):
        keys.extend([
            item.get("name"),
            item.get("name_cn"),
            item.get("nameEn"),
            item.get("name_en"),
        ])

    for key in keys:
        normalized = _to_lookup_key(key)
        if not normalized:
            continue
        if normalized in indexes["by_id"]:
            return indexes["by_id"][normalized]
        if normalized in indexes["by_key"]:
            return indexes["by_key"][normalized]
    return None


def normalize_item_payload(item: Any, quantity: Optional[int] = None) -> Dict[str, Any]:
    source: Dict[str, Any]
    if isinstance(item, dict):
        source = deepcopy(item)
    else:
        source = {"id": str(item)}

    meta = _find_meta(source)
    raw_id = source.get("id")
    if raw_id is None and isinstance(source.get("item_id"), str) and source.get("item_id").strip():
        raw_id = source.get("item_id")
    is_custom = _to_bool(source.get("is_custom"))
    raw_library_item_id = None
    if isinstance(raw_id, str):
        library_item_match = LIBRARY_ITEM_ID_RE.match(raw_id.strip())
        if library_item_match:
            raw_library_item_id = int(library_item_match.group("id"))
        elif is_custom:
            custom_item_match = CUSTOM_ITEM_ID_RE.match(raw_id.strip())
            if custom_item_match:
                raw_library_item_id = int(custom_item_match.group("id"))
    library_item_id = (
        _to_int(source.get("libraryItemId"))
        or _to_int(source.get("library_item_id"))
        or _to_int(source.get("db_item_id"))
        or raw_library_item_id
        or (_to_int(source.get("item_id")) if not isinstance(source.get("item_id"), str) else None)
        or (_to_int(raw_id) if not isinstance(raw_id, str) else None)
    )

    normalized_id = None
    if is_custom:
        if isinstance(raw_id, str):
            raw_id_text = raw_id.strip()
            custom_item_match = CUSTOM_ITEM_ID_RE.match(raw_id_text)
            if custom_item_match:
                normalized_id = f"custom-item-{custom_item_match.group('id')}"
            elif raw_id_text and not LIBRARY_ITEM_ID_RE.match(raw_id_text) and not raw_id_text.isdigit():
                normalized_id = _to_lookup_key(raw_id_text)
        if normalized_id is None and library_item_id is not None:
            normalized_id = f"custom-item-{library_item_id}"

    if normalized_id is None:
        if meta and meta.get("id"):
            normalized_id = str(meta["id"])
        elif library_item_id is not None:
            normalized_id = f"library-item-{library_item_id}"
        elif isinstance(raw_id, str):
            normalized_id = _to_lookup_key(raw_id)
    if not normalized_id:
        normalized_id = _to_lookup_key(source.get("name")) or _to_lookup_key(source.get("name_cn")) or "unknown-item"

    existing_name = next(
        (
            value for value in (
                source.get("name"),
                source.get("name_cn"),
            )
            if isinstance(value, str) and value.strip()
        ),
        None,
    )
    display_name = existing_name or (meta.get("name") if meta else None) or normalized_id
    english_name = next(
        (
            value for value in (
                source.get("nameEn"),
                source.get("name_en"),
            )
            if isinstance(value, str) and value.strip()
        ),
        None,
    ) or (meta.get("nameEn") if meta else None)

    category = source.get("category")
    if not category and meta:
        category = meta.get("_category")
    if category in {"tools", "kits", "instruments"}:
        category = "tool"

    equipment_type = source.get("equipmentType")
    if not equipment_type and meta:
        equipment_type = meta.get("_equipment_type")
    if not equipment_type:
        if category in {"weapon", "ammunition"}:
            equipment_type = "weapon"
        elif category in {"armor", "shield"}:
            equipment_type = "armor"
        elif category == "tool":
            equipment_type = "tool"
        else:
            equipment_type = "gear"

    icon_path = (
        _normalize_asset_path(source.get("iconPath"))
        or _normalize_asset_path(source.get("avatar_url"))
        or _normalize_asset_path(source.get("icon"))
        or (_normalize_asset_path(meta.get("iconPath")) if meta else None)
    )
    avatar_url = (
        _normalize_display_image(source.get("avatar_url"))
        or _normalize_display_image(source.get("avatar"))
        or _normalize_display_image(source.get("image_url"))
    )
    avatar_url_large = _normalize_display_image(source.get("avatar_url_large")) or avatar_url
    if avatar_url is None and icon_path:
        avatar_url = f"/{icon_path}"
    if avatar_url_large is None and avatar_url:
        avatar_url_large = avatar_url

    icon = (
        _normalize_display_image(source.get("icon"))
        or avatar_url
        or (f"/{icon_path}" if icon_path else None)
    )

    damage, damage_type = _normalize_damage(
        source.get("damage") if source.get("damage") is not None else (meta.get("damage") if meta else None),
        source.get("damageType") if source.get("damageType") is not None else (meta.get("damageType") if meta else None),
    )
    range_data = _normalize_range(source.get("range") if source.get("range") is not None else (meta.get("range") if meta else None))
    ac, armor_class = _normalize_armor_class(
        source.get("armor_class") if source.get("armor_class") is not None else source.get("armorClass"),
        source.get("acFormula") if source.get("acFormula") is not None else (meta.get("acFormula") if meta else None),
    )
    if ac is None and source.get("ac") is not None:
        ac = _to_int(source.get("ac")) if _to_int(source.get("ac")) is not None else source.get("ac")
    if ac is None and meta and meta.get("ac") is not None:
        ac = meta.get("ac")
    if armor_class is None and ac is not None:
        armor_class = ac

    ac_bonus = _to_int(source.get("acBonus"))
    if ac_bonus is None and meta and meta.get("acBonus") is not None:
        ac_bonus = _to_int(meta.get("acBonus"))
    magic_bonus = _to_int(source.get("magic_bonus"))
    if ac_bonus is None and equipment_type == "armor" and magic_bonus is not None:
        ac_bonus = magic_bonus

    weight = _to_number(source.get("weight"))
    if weight is None and meta and meta.get("weight") is not None:
        weight = _to_number(meta.get("weight"))
    if weight is not None and float(weight).is_integer():
        weight = int(weight)

    properties = _normalize_list_strings(source.get("properties"))
    if properties is None and meta:
        properties = _normalize_list_strings(meta.get("properties"))

    description = next(
        (
            value for value in (
                source.get("description"),
                source.get("description_cn"),
                meta.get("description") if meta else None,
            )
            if isinstance(value, str) and value.strip()
        ),
        None,
    )

    normalized = _copy_payload_source(source)
    normalized["id"] = normalized_id
    normalized["name"] = display_name
    if english_name:
        normalized["nameEn"] = english_name
    if library_item_id is not None:
        normalized["libraryItemId"] = library_item_id
    if category:
        normalized["category"] = category
    normalized["equipmentType"] = equipment_type
    normalized["quantity"] = _normalize_quantity(quantity if quantity is not None else normalized.get("quantity"), 1)
    if icon_path:
        normalized["iconPath"] = icon_path
    if avatar_url:
        normalized["avatar_url"] = avatar_url
    if avatar_url_large:
        normalized["avatar_url_large"] = avatar_url_large
    if icon:
        normalized["icon"] = icon
    if weight is not None:
        normalized["weight"] = weight
    if description:
        normalized["description"] = description
    if properties is not None:
        normalized["properties"] = properties
    if damage is not None:
        normalized["damage"] = _deepcopy_if_needed(damage)
    if damage_type:
        normalized["damageType"] = damage_type
    if range_data is not None:
        normalized["range"] = _deepcopy_if_needed(range_data)
    if ac is not None:
        normalized["ac"] = ac
    if ac_bonus is not None:
        normalized["acBonus"] = ac_bonus
    if armor_class is not None:
        normalized["armor_class"] = _deepcopy_if_needed(armor_class)
    if magic_bonus is not None:
        normalized["magic_bonus"] = magic_bonus
    if meta and meta.get("cost") is not None and normalized.get("cost") is None:
        normalized["cost"] = deepcopy(meta.get("cost"))
    if normalized.get("rarity") is None and meta and meta.get("rarity") is not None:
        normalized["rarity"] = meta.get("rarity")

    return normalized


def build_item_payload_from_model(item_model: Any, quantity: Optional[int] = None) -> Dict[str, Any]:
    source: Dict[str, Any] = {}

    library_item_id = getattr(item_model, "id", None)
    if library_item_id is not None:
        source["libraryItemId"] = library_item_id

    for payload_key, attr_name in ITEM_MODEL_FIELD_MAP.items():
        value = getattr(item_model, attr_name, None)
        if value is not None:
            source[payload_key] = _deepcopy_if_needed(value)

    if quantity is not None:
        source["quantity"] = quantity

    return normalize_item_payload(source, quantity=quantity)


def normalize_character_equipment_payloads(equipment: Any) -> Tuple[List[Dict[str, Any]], Dict[str, int], bool]:
    if not isinstance(equipment, list):
        return [], {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}, not (equipment in (None, []))

    changed = False
    normalized_items: List[Dict[str, Any]] = []
    currency_extracted = {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}

    for entry in equipment:
        original = deepcopy(entry)
        source = deepcopy(entry) if isinstance(entry, dict) else {"id": str(entry)}

        entry_id = source.get("id")
        if isinstance(entry_id, str):
            match = CURRENCY_ITEM_RE.match(entry_id.strip())
            if match:
                currency_type = match.group("currency").lower()
                currency_amount = int(match.group("amount"))
                quantity = _normalize_quantity(source.get("quantity"), 1)
                currency_extracted[currency_type] += currency_amount * quantity
                source["id"] = match.group("base")
                changed = True

        normalized = normalize_item_payload(source)
        if normalized != original:
            changed = True
        normalized_items.append(normalized)

    return normalized_items, currency_extracted, changed


def normalize_token_item_payload(item_data: Any) -> Tuple[Optional[Dict[str, Any]], bool]:
    normalized, _, changed = normalize_token_item_fields(item_data)
    return normalized, changed


def normalize_token_item_fields(
    item_data: Any,
    item_quantity: Any = None,
) -> Tuple[Optional[Dict[str, Any]], Optional[int], bool]:
    if item_data is None:
        return None, item_quantity, False

    quantity_source = item_quantity
    if quantity_source is None and isinstance(item_data, dict):
        quantity_source = item_data.get("quantity")

    normalized_quantity = _normalize_quantity(quantity_source, 1)
    normalized = normalize_item_payload(item_data, quantity=normalized_quantity)
    normalized.pop("quantity", None)

    changed = normalized != item_data or normalized_quantity != item_quantity
    return normalized, normalized_quantity, changed


def normalize_loot_bag_data(loot_bag_data: Any) -> Tuple[Optional[Dict[str, Any]], bool]:
    if not isinstance(loot_bag_data, dict):
        return loot_bag_data, False

    normalized = deepcopy(loot_bag_data)
    items = normalized.get("items")
    if isinstance(items, list):
        normalized_items, _, changed = normalize_character_equipment_payloads(items)
        normalized["items"] = normalized_items
        return normalized, changed or normalized != loot_bag_data
    return normalized, normalized != loot_bag_data


def items_can_stack(existing: Dict[str, Any], incoming: Dict[str, Any]) -> bool:
    existing_library_id = _to_int(existing.get("libraryItemId"))
    incoming_library_id = _to_int(incoming.get("libraryItemId"))
    existing_is_custom = _to_bool(existing.get("is_custom"))
    incoming_is_custom = _to_bool(incoming.get("is_custom"))
    if existing_library_id is not None or incoming_library_id is not None:
        return (
            existing_library_id is not None
            and incoming_library_id is not None
            and existing_library_id == incoming_library_id
            and existing_is_custom == incoming_is_custom
        )

    existing_id = str(existing.get("id") or "").strip().lower()
    incoming_id = str(incoming.get("id") or "").strip().lower()
    if existing_id and incoming_id and existing_id == incoming_id and existing_is_custom == incoming_is_custom:
        return True

    return False


def merge_item_into_equipment(
    equipment: Any,
    item_payload: Any,
    quantity: Optional[int] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any], bool]:
    existing_items = deepcopy(equipment) if isinstance(equipment, list) else []
    normalized_item = normalize_item_payload(item_payload, quantity=quantity)
    stack_target = next(
        (
            item for item in existing_items
            if isinstance(item, dict)
            and not item.get("equippedSlot")
            and items_can_stack(item, normalized_item)
        ),
        None,
    )
    if stack_target is None:
        return existing_items + [normalized_item], normalized_item, False

    stack_target["quantity"] = _normalize_quantity(stack_target.get("quantity"), 1) + _normalize_quantity(normalized_item.get("quantity"), 1)
    return existing_items, normalized_item, True
