"""
Unified Immunity Check Service
Aggregates immunities from race, class, effects, and equipment
"""

import logging
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Damage type translations (Chinese <-> English)
DAMAGE_TYPE_TRANSLATIONS = {
    "poison": "毒素", "毒素": "poison",
    "fire": "火焰", "火焰": "fire",
    "cold": "寒冷", "寒冷": "cold",
    "lightning": "闪电", "闪电": "lightning",
    "thunder": "雷鸣", "雷鸣": "thunder",
    "acid": "强酸", "强酸": "acid",
    "necrotic": "黯蚀", "黯蚀": "necrotic",
    "radiant": "光耀", "光耀": "radiant",
    "psychic": "心灵", "心灵": "psychic",
    "force": "力场", "力场": "force",
    "bludgeoning": "钝击", "钝击": "bludgeoning",
    "piercing": "穿刺", "穿刺": "piercing",
    "slashing": "挥砍", "挥砍": "slashing",
}

# Condition type translations
CONDITION_TRANSLATIONS = {
    "blinded": "目盲", "目盲": "blinded",
    "charmed": "魅惑", "魅惑": "charmed",
    "deafened": "耳聋", "耳聋": "deafened",
    "exhaustion": "力竭", "力竭": "exhaustion",
    "frightened": "恐惧", "恐惧": "frightened",
    "grappled": "擒抱", "擒抱": "grappled",
    "incapacitated": "失能", "失能": "incapacitated",
    "invisible": "隐形", "隐形": "invisible",
    "paralyzed": "麻痹", "麻痹": "paralyzed",
    "petrified": "石化", "石化": "petrified",
    "poisoned": "中毒", "中毒": "poisoned",
    "prone": "倒地", "倒地": "prone",
    "restrained": "束缚", "束缚": "restrained",
    "stunned": "震慑", "震慑": "stunned",
    "unconscious": "昏迷", "昏迷": "unconscious",
    "silenced": "沉默", "沉默": "silenced",
    "diseased": "疾病", "疾病": "diseased",
    "sleep": "睡眠", "睡眠": "sleep",
    "aging": "衰老", "衰老": "aging",
    "confused": "困惑", "困惑": "confused",
}

# Race immunities (inherent racial features)
RACE_IMMUNITIES: Dict[str, Dict[str, Any]] = {
    "elf": {
        "condition_immunities": ["sleep"],
        "saving_throw_advantage": ["charmed"],
        "source": "精类血统"
    },
    "精灵": {
        "condition_immunities": ["sleep"],
        "saving_throw_advantage": ["charmed"],
        "source": "精类血统"
    },
    "half_elf": {
        "condition_immunities": ["sleep"],
        "saving_throw_advantage": ["charmed"],
        "source": "精类血统"
    },
    "半精灵": {
        "condition_immunities": ["sleep"],
        "saving_throw_advantage": ["charmed"],
        "source": "精类血统"
    },
    "warforged": {
        "condition_immunities": ["poisoned", "diseased"],
        "damage_immunities": ["poison"],
        "source": "活化构装体"
    },
    "锻造者": {
        "condition_immunities": ["poisoned", "diseased"],
        "damage_immunities": ["poison"],
        "source": "活化构装体"
    },
}

# Class immunities (by level)
CLASS_IMMUNITIES: Dict[str, Dict[int, Dict[str, Any]]] = {
    "paladin": {
        3: {
            "condition_immunities": ["diseased"],
            "source": "圣洁体魄",
            "source_en": "Divine Health"
        }
    },
    "圣武士": {
        3: {
            "condition_immunities": ["diseased"],
            "source": "圣洁体魄",
            "source_en": "Divine Health"
        }
    },
    "monk": {
        10: {
            "condition_immunities": ["diseased", "poisoned"],
            "damage_immunities": ["poison"],
            "source": "身心纯净",
            "source_en": "Purity of Body"
        }
    },
    "武僧": {
        10: {
            "condition_immunities": ["diseased", "poisoned"],
            "damage_immunities": ["poison"],
            "source": "身心纯净",
            "source_en": "Purity of Body"
        }
    },
    "druid": {
        18: {
            "condition_immunities": ["aging"],
            "source": "永恒之躯",
            "source_en": "Timeless Body"
        }
    },
    "德鲁伊": {
        18: {
            "condition_immunities": ["aging"],
            "source": "永恒之躯",
            "source_en": "Timeless Body"
        }
    },
}

# Cache for passive features
_passive_features_cache: Optional[List[Dict]] = None


def _load_passive_features() -> List[Dict]:
    """Load passive features from JSON file"""
    global _passive_features_cache
    if _passive_features_cache is not None:
        return _passive_features_cache

    try:
        from app.utils.rules_cache import get_passive_features_data
        data = get_passive_features_data()
        _passive_features_cache = data.get("features", [])
        return _passive_features_cache
    except Exception as e:
        logger.warning(f"Failed to load passive features: {e}")

    _passive_features_cache = []
    return _passive_features_cache


def _normalize_condition(condition: str) -> str:
    """Normalize condition name to English lowercase"""
    condition_lower = condition.lower().strip()

    # List of valid English condition names
    english_conditions = {
        "blinded", "charmed", "deafened", "exhaustion",
        "frightened", "grappled", "incapacitated", "invisible",
        "paralyzed", "petrified", "poisoned", "prone",
        "restrained", "stunned", "unconscious",
        "silenced", "diseased", "sleep", "aging"
    }

    # If already English, return as-is
    if condition_lower in english_conditions:
        return condition_lower

    # Check if it's Chinese and translate to English
    if condition_lower in CONDITION_TRANSLATIONS:
        translation = CONDITION_TRANSLATIONS[condition_lower]
        if translation in english_conditions:
            return translation

    return condition_lower


def _normalize_damage_type(damage_type: str) -> str:
    """Normalize damage type to English lowercase"""
    damage_lower = damage_type.lower().strip()

    # List of valid English damage types
    english_damage_types = {
        "poison", "fire", "cold", "lightning", "thunder", "acid",
        "necrotic", "radiant", "psychic", "force",
        "bludgeoning", "piercing", "slashing"
    }

    # If already English, return as-is
    if damage_lower in english_damage_types:
        return damage_lower

    # Check if it's Chinese and translate to English
    if damage_lower in DAMAGE_TYPE_TRANSLATIONS:
        translation = DAMAGE_TYPE_TRANSLATIONS[damage_lower]
        if translation in english_damage_types:
            return translation

    return damage_lower


def get_race_immunities(race_id: Optional[str]) -> Dict[str, Any]:
    """Get immunities from race"""
    result = {
        "damage_immunities": [],
        "condition_immunities": [],
        "saving_throw_advantage": [],
        "sources": []
    }

    if not race_id:
        return result

    race_key = race_id.lower().strip()

    # Check direct match first
    race_data = RACE_IMMUNITIES.get(race_key)
    if not race_data:
        # Check for partial match (e.g., "wood_elf" contains "elf")
        for key, data in RACE_IMMUNITIES.items():
            if key in race_key or race_key in key:
                race_data = data
                break

    if race_data:
        source = race_data.get("source", race_id)
        if race_data.get("damage_immunities"):
            for imm in race_data["damage_immunities"]:
                result["damage_immunities"].append(_normalize_damage_type(imm))
                result["sources"].append({
                    "type": "race",
                    "name": source,
                    "immunity": imm
                })
        if race_data.get("condition_immunities"):
            for imm in race_data["condition_immunities"]:
                result["condition_immunities"].append(_normalize_condition(imm))
                result["sources"].append({
                    "type": "race",
                    "name": source,
                    "immunity": imm
                })
        if race_data.get("saving_throw_advantage"):
            result["saving_throw_advantage"] = race_data["saving_throw_advantage"]

    return result


def get_class_immunities(class_id: Optional[str], level: int = 1) -> Dict[str, Any]:
    """Get immunities from class features based on level"""
    result = {
        "damage_immunities": [],
        "condition_immunities": [],
        "sources": []
    }

    if not class_id:
        return result

    class_key = class_id.lower().strip()
    class_data = CLASS_IMMUNITIES.get(class_key)

    if not class_data:
        # Check for partial match
        for key, data in CLASS_IMMUNITIES.items():
            if key in class_key or class_key in key:
                class_data = data
                break

    if class_data:
        # Check each level threshold
        for req_level, immunity_data in sorted(class_data.items()):
            if level >= req_level:
                source = immunity_data.get("source", f"{class_id} Lv.{req_level}")
                if immunity_data.get("damage_immunities"):
                    for imm in immunity_data["damage_immunities"]:
                        normalized = _normalize_damage_type(imm)
                        if normalized not in result["damage_immunities"]:
                            result["damage_immunities"].append(normalized)
                            result["sources"].append({
                                "type": "class",
                                "name": source,
                                "immunity": imm,
                                "level": req_level
                            })
                if immunity_data.get("condition_immunities"):
                    for imm in immunity_data["condition_immunities"]:
                        normalized = _normalize_condition(imm)
                        if normalized not in result["condition_immunities"]:
                            result["condition_immunities"].append(normalized)
                            result["sources"].append({
                                "type": "class",
                                "name": source,
                                "immunity": imm,
                                "level": req_level
                            })

    return result


def get_passive_feature_immunities(
    class_id: Optional[str],
    level: int = 1,
    subclass_id: Optional[str] = None,
    race_id: Optional[str] = None
) -> Dict[str, Any]:
    """Get immunities from passive features JSON"""
    result = {
        "damage_immunities": [],
        "condition_immunities": [],
        "sources": []
    }

    features = _load_passive_features()
    if not features:
        return result

    for feature in features:
        if feature.get("type") != "immunity":
            continue

        # Check race requirement (for race-based features like Fey Ancestry)
        feature_races = feature.get("race", [])
        if feature_races:
            if not race_id:
                continue  # Skip race features if no race_id provided
            race_match = any(
                r.lower() in race_id.lower() or race_id.lower() in r.lower()
                for r in feature_races
            )
            if not race_match:
                continue

        # Check class requirement
        feature_classes = feature.get("class", [])
        if feature_classes:
            if not class_id:
                continue  # Skip class features if no class_id provided
            class_match = any(
                c.lower() in class_id.lower() or class_id.lower() in c.lower()
                for c in feature_classes
            )
            if not class_match:
                continue

        # Check level requirement
        req_level = feature.get("level", 1)
        if level < req_level:
            continue

        # Check subclass requirement
        feature_subclasses = feature.get("subclass", [])
        if feature_subclasses:
            if not subclass_id:
                continue
            subclass_match = any(
                s.lower() in subclass_id.lower() or subclass_id.lower() in s.lower()
                for s in feature_subclasses
            )
            if not subclass_match:
                continue

        # Extract immunities from effect
        effect = feature.get("effect", {})
        immune_to = effect.get("immuneTo", [])
        source = feature.get("name", feature.get("id", "Unknown"))

        for imm in immune_to:
            # Determine if it's a condition or damage type
            norm_cond = _normalize_condition(imm)
            norm_dmg = _normalize_damage_type(imm)

            # Conditions are typically things like "diseased", "poisoned", "sleep"
            # Damage types are "poison", "fire", etc.
            if norm_cond in ["diseased", "poisoned", "sleep", "aging", "charmed",
                            "frightened", "paralyzed", "petrified", "stunned",
                            "blinded", "deafened", "exhaustion", "grappled",
                            "incapacitated", "invisible", "prone", "restrained",
                            "unconscious"]:
                if norm_cond not in result["condition_immunities"]:
                    result["condition_immunities"].append(norm_cond)
                    result["sources"].append({
                        "type": "feature",
                        "name": source,
                        "immunity": imm,
                        "level": req_level
                    })
            else:
                if norm_dmg not in result["damage_immunities"]:
                    result["damage_immunities"].append(norm_dmg)
                    result["sources"].append({
                        "type": "feature",
                        "name": source,
                        "immunity": imm,
                        "level": req_level
                    })

    return result


def get_effect_immunities(active_effects: Optional[List[Dict]]) -> Dict[str, Any]:
    """Get immunities from active effects on token"""
    result = {
        "damage_immunities": [],
        "condition_immunities": [],
        "sources": []
    }

    if not active_effects:
        return result

    for effect in active_effects:
        effect_id = effect.get("id", "").lower()
        metadata = effect.get("metadata", {})

        # Check for immunity metadata
        immunities = metadata.get("immunities", {})
        source = effect.get("name", effect_id)

        if immunities.get("damage"):
            for imm in immunities["damage"]:
                normalized = _normalize_damage_type(imm)
                if normalized not in result["damage_immunities"]:
                    result["damage_immunities"].append(normalized)
                    result["sources"].append({
                        "type": "effect",
                        "name": source,
                        "immunity": imm
                    })

        if immunities.get("condition"):
            for imm in immunities["condition"]:
                normalized = _normalize_condition(imm)
                if normalized not in result["condition_immunities"]:
                    result["condition_immunities"].append(normalized)
                    result["sources"].append({
                        "type": "effect",
                        "name": source,
                        "immunity": imm
                    })

        # Special handling for specific effects
        if effect_id == "protection_from_evil":
            # Protection from Evil grants immunity to charmed by certain creatures
            pass  # Complex logic handled elsewhere

    return result


def get_character_immunities(
    character_data: Dict[str, Any],
    active_effects: Optional[List[Dict]] = None
) -> Dict[str, Any]:
    """
    Get all immunities for a character, aggregated from all sources.

    Args:
        character_data: Character data dict with race_id, class_id, level, etc.
        active_effects: Active effects from the token

    Returns:
        {
            "damage_immunities": ["poison", "fire"],
            "condition_immunities": ["diseased", "poisoned", "sleep"],
            "saving_throw_advantage": ["charmed"],
            "sources": [
                {"type": "race", "name": "精类血统", "immunity": "sleep"},
                {"type": "class", "name": "圣洁体魄", "immunity": "diseased"},
            ]
        }
    """
    result = {
        "damage_immunities": [],
        "condition_immunities": [],
        "saving_throw_advantage": [],
        "sources": []
    }

    race_id = character_data.get("race_id") or character_data.get("raceId")
    class_id = character_data.get("class_id") or character_data.get("classId")
    level = character_data.get("level", 1)
    subclass_id = character_data.get("subclass_id") or character_data.get("subclassId")

    # 1. Race immunities
    race_imm = get_race_immunities(race_id)
    for imm in race_imm["damage_immunities"]:
        if imm not in result["damage_immunities"]:
            result["damage_immunities"].append(imm)
    for imm in race_imm["condition_immunities"]:
        if imm not in result["condition_immunities"]:
            result["condition_immunities"].append(imm)
    result["sources"].extend(race_imm["sources"])
    if race_imm.get("saving_throw_advantage"):
        result["saving_throw_advantage"].extend(race_imm["saving_throw_advantage"])

    # 2. Class immunities
    class_imm = get_class_immunities(class_id, level)
    for imm in class_imm["damage_immunities"]:
        if imm not in result["damage_immunities"]:
            result["damage_immunities"].append(imm)
    for imm in class_imm["condition_immunities"]:
        if imm not in result["condition_immunities"]:
            result["condition_immunities"].append(imm)
    result["sources"].extend(class_imm["sources"])

    # 3. Passive feature immunities
    feature_imm = get_passive_feature_immunities(class_id, level, subclass_id, race_id)
    for imm in feature_imm["damage_immunities"]:
        if imm not in result["damage_immunities"]:
            result["damage_immunities"].append(imm)
    for imm in feature_imm["condition_immunities"]:
        if imm not in result["condition_immunities"]:
            result["condition_immunities"].append(imm)
    result["sources"].extend(feature_imm["sources"])

    # 4. Active effect immunities
    effect_imm = get_effect_immunities(active_effects)
    for imm in effect_imm["damage_immunities"]:
        if imm not in result["damage_immunities"]:
            result["damage_immunities"].append(imm)
    for imm in effect_imm["condition_immunities"]:
        if imm not in result["condition_immunities"]:
            result["condition_immunities"].append(imm)
    result["sources"].extend(effect_imm["sources"])

    return result


def get_monster_immunities(monster_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Get immunities for a monster from monster data.

    Args:
        monster_data: Monster data dict with damage_immunities, condition_immunities

    Returns:
        Same structure as get_character_immunities
    """
    result = {
        "damage_immunities": [],
        "condition_immunities": [],
        "sources": []
    }

    name = monster_data.get("name", "Unknown")

    # Damage immunities
    damage_imm = monster_data.get("damage_immunities") or []
    if isinstance(damage_imm, str):
        damage_imm = [d.strip() for d in damage_imm.split(",")]

    for imm in damage_imm:
        normalized = _normalize_damage_type(imm)
        if normalized and normalized not in result["damage_immunities"]:
            result["damage_immunities"].append(normalized)
            result["sources"].append({
                "type": "monster",
                "name": name,
                "immunity": imm
            })

    # Condition immunities
    condition_imm = monster_data.get("condition_immunities") or []
    if isinstance(condition_imm, str):
        condition_imm = [c.strip() for c in condition_imm.split(",")]

    for imm in condition_imm:
        normalized = _normalize_condition(imm)
        if normalized and normalized not in result["condition_immunities"]:
            result["condition_immunities"].append(normalized)
            result["sources"].append({
                "type": "monster",
                "name": name,
                "immunity": imm
            })

    return result


def check_damage_immunity(
    immunities: Dict[str, Any],
    damage_type: str
) -> Tuple[bool, Optional[str]]:
    """
    Check if target is immune to a damage type.

    Args:
        immunities: Immunity info from get_character_immunities/get_monster_immunities
        damage_type: The damage type to check

    Returns:
        (is_immune, source_name) - e.g., (True, "身心纯净")
    """
    if not immunities or not damage_type:
        return (False, None)

    normalized = _normalize_damage_type(damage_type)
    damage_immunities = immunities.get("damage_immunities", [])

    if normalized in damage_immunities:
        # Find the source
        for src in immunities.get("sources", []):
            if _normalize_damage_type(src.get("immunity", "")) == normalized:
                return (True, src.get("name"))
        return (True, None)

    return (False, None)


# Aura-based condition immunity mappings
CONDITION_IMMUNITY_AURAS = {
    "frightened": "aura_of_courage",
    "恐惧": "aura_of_courage",
    "charmed": "aura_of_devotion",
    "魅惑": "aura_of_devotion",
}

AURA_NAMES = {
    "aura_of_courage": "勇气灵光",
    "aura_of_devotion": "虔诚灵光",
}


def _calc_token_distance(t1: Dict, t2: Dict, grid_size: int = 5) -> float:
    """Calculate distance between two tokens in feet"""
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


def _check_aura_condition_immunity(
    target_token_id: int,
    condition_type: str,
    all_tokens: List[Dict]
) -> Tuple[bool, Optional[str]]:
    """
    Check if target is immune to a condition due to nearby auras.

    Args:
        target_token_id: The token to check
        condition_type: The condition type (e.g., "frightened", "charmed")
        all_tokens: All tokens on the map with id, position, active_auras, current_hp

    Returns:
        (is_immune, source_description) - e.g., (True, "勇气灵光 (来自 Paladin)")
    """
    normalized = _normalize_condition(condition_type)
    protective_aura_id = CONDITION_IMMUNITY_AURAS.get(normalized)
    if not protective_aura_id:
        return (False, None)

    target_token = None
    aura_sources = []

    for token in all_tokens:
        if token.get("id") == target_token_id:
            target_token = token
        if token.get("active_auras"):
            for aura in token.get("active_auras", []):
                if aura.get("id") == protective_aura_id:
                    aura_sources.append({"token": token, "aura": aura})

    if not target_token or not aura_sources:
        return (False, None)

    # Check if any aura source is within range and conscious
    for source in aura_sources:
        source_token = source["token"]
        aura = source["aura"]
        radius = aura.get("radius", 10)

        # Check if source is conscious (HP > 0)
        source_hp = source_token.get("current_hp")
        if source_hp is not None and source_hp <= 0:
            continue

        # Check distance
        distance = _calc_token_distance(source_token, target_token)
        if distance <= radius:
            aura_name = AURA_NAMES.get(protective_aura_id, protective_aura_id)
            source_name = source_token.get("character_name", "Unknown")
            return (True, f"{aura_name} (来自 {source_name})")

    return (False, None)


def check_condition_immunity(
    immunities: Dict[str, Any],
    condition_type: str,
    all_tokens: Optional[List[Dict]] = None,
    target_token_id: Optional[int] = None
) -> Tuple[bool, Optional[str]]:
    """
    Check if target is immune to a condition.
    Checks both inherent immunities and aura-based immunities.

    Args:
        immunities: Immunity info from get_character_immunities/get_monster_immunities
        condition_type: The condition to check (e.g., "sleep", "diseased")
        all_tokens: Optional list of all tokens for aura checks
        target_token_id: Target token ID for aura checks

    Returns:
        (is_immune, source_name) - e.g., (True, "精类血统")
    """
    if not condition_type:
        return (False, None)

    normalized = _normalize_condition(condition_type)

    # 1. Check inherent immunities (race, class, effects)
    if immunities:
        condition_immunities = immunities.get("condition_immunities", [])
        if normalized in condition_immunities:
            # Find the source
            for src in immunities.get("sources", []):
                if _normalize_condition(src.get("immunity", "")) == normalized:
                    return (True, src.get("name"))
            return (True, None)

    # 2. Check aura-based immunities (Paladin auras)
    if all_tokens and target_token_id:
        is_immune, source = _check_aura_condition_immunity(
            target_token_id, condition_type, all_tokens
        )
        if is_immune:
            return (True, source)

    return (False, None)


def get_saving_throw_advantage(
    immunities: Dict[str, Any],
    condition_type: str
) -> Tuple[bool, Optional[str]]:
    """
    Check if target has advantage on saving throws against a condition.

    Args:
        immunities: Immunity info
        condition_type: The condition being saved against

    Returns:
        (has_advantage, source_name)
    """
    if not immunities or not condition_type:
        return (False, None)

    normalized = _normalize_condition(condition_type)
    advantages = immunities.get("saving_throw_advantage", [])

    for adv in advantages:
        if _normalize_condition(adv) == normalized:
            # Find source from race immunity
            for src in immunities.get("sources", []):
                if src.get("type") == "race":
                    return (True, src.get("name"))
            return (True, None)

    return (False, None)
