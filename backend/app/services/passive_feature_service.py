"""
Passive Features Service
Calculates permanent class abilities based on character class/level
"""
from typing import Optional, List, Dict, Any, TypedDict


class SneakAttackResult(TypedDict):
    dice: str
    feature: Dict[str, Any]


class SavingThrowBonus(TypedDict):
    source: str
    value: Any
    condition: Optional[Dict[str, Any]]


class AdvantageOn(TypedDict):
    target: str
    condition: Optional[Dict[str, Any]]


class CharacterPassiveFeatures(TypedDict):
    acFormula: Optional[Dict[str, Any]]
    speedBonus: int
    attacksPerAction: int
    brutalCriticalDice: int
    sneakAttack: Optional[SneakAttackResult]
    hasUncannyDodge: bool
    hasEvasion: bool
    savingThrowBonuses: List[SavingThrowBonus]
    allSavingThrowProficiency: bool
    reliableTalent: bool
    advantageOn: List[AdvantageOn]
    denyEnemyAdvantage: bool
    immunities: List[str]
    resistances: List[str]
    critRange: int
    divineStrike: Optional[Dict[str, Any]]
    allFeatures: List[Dict[str, Any]]


# Load features data
_features_data: Optional[List[Dict[str, Any]]] = None


SAVE_ABILITY_ALIASES = {
    "str": "strength",
    "strength": "strength",
    "力量": "strength",
    "dex": "dexterity",
    "dexterity": "dexterity",
    "敏捷": "dexterity",
    "con": "constitution",
    "constitution": "constitution",
    "体质": "constitution",
    "int": "intelligence",
    "intelligence": "intelligence",
    "智力": "intelligence",
    "wis": "wisdom",
    "wisdom": "wisdom",
    "感知": "wisdom",
    "cha": "charisma",
    "charisma": "charisma",
    "魅力": "charisma",
}

CONDITION_ALIASES = {
    "blinded": "blinded",
    "目盲": "blinded",
    "deafened": "deafened",
    "耳聋": "deafened",
    "incapacitated": "incapacitated",
    "失能": "incapacitated",
}

PASSIVE_SAVE_VISION_BLOCKERS = {"blinded", "deafened", "incapacitated"}


def _load_features() -> List[Dict[str, Any]]:
    """Load passive features from JSON file"""
    global _features_data
    if _features_data is None:
        from app.utils.rules_cache import get_passive_features_data
        data = get_passive_features_data()
        _features_data = data.get("features", [])
    return _features_data


def _get_scaled_value(scaling: Optional[Dict[str, Any]], level: int) -> Optional[Any]:
    """Get the scaled value for a feature at a given level"""
    if not scaling:
        return None

    # Find the highest level that's <= character level
    levels = [int(l) for l in scaling.keys() if int(l) <= level]
    if not levels:
        return None

    highest_level = max(levels)
    return scaling[str(highest_level)]


def _feature_applies(
    feature: Dict[str, Any],
    class_id: str,
    subclass_id: Optional[str],
    level: int
) -> bool:
    """Check if a feature applies to given class/subclass/level"""
    class_lower = class_id.lower()
    subclass_lower = (subclass_id or "").lower()

    # Check class requirement
    feature_classes = [c.lower() for c in feature.get("class", [])]
    if class_lower not in feature_classes:
        return False

    # Check level requirement
    if level < feature.get("level", 1):
        return False

    # Check subclass requirement if specified
    feature_subclasses = feature.get("subclass")
    if feature_subclasses:
        if not any(s.lower() in subclass_lower for s in feature_subclasses):
            return False

    return True


def _normalize_save_ability(value: Optional[str]) -> str:
    raw = str(value or "").strip().lower()
    return SAVE_ABILITY_ALIASES.get(raw, raw)


def _normalize_condition_id(value: Optional[str]) -> str:
    raw = str(value or "").strip().lower()
    return CONDITION_ALIASES.get(raw, raw)


def _is_always_on_passive_feature(feature: Dict[str, Any]) -> bool:
    """Return True for features that are genuinely passive, not activation-gated."""
    cost = str(feature.get("cost", "none") or "none").strip().lower()
    trigger = str(feature.get("trigger", "always") or "always").strip().lower()
    return trigger == "always" and cost in {"", "none"}


def get_passive_features(
    class_id: str,
    level: int,
    subclass_id: Optional[str] = None
) -> CharacterPassiveFeatures:
    """Get all passive features for a character"""
    features = _load_features()

    result: CharacterPassiveFeatures = {
        "acFormula": None,
        "speedBonus": 0,
        "attacksPerAction": 1,
        "brutalCriticalDice": 0,
        "sneakAttack": None,
        "hasUncannyDodge": False,
        "hasEvasion": False,
        "savingThrowBonuses": [],
        "allSavingThrowProficiency": False,
        "reliableTalent": False,
        "advantageOn": [],
        "denyEnemyAdvantage": False,
        "immunities": [],
        "resistances": [],
        "critRange": 20,
        "divineStrike": None,
        "allFeatures": [],
    }

    # Find all applicable features
    applicable = [f for f in features if _feature_applies(f, class_id, subclass_id, level)]
    result["allFeatures"] = applicable

    for feature in applicable:
        feature_type = feature.get("type")
        effect = feature.get("effect", {})

        if feature_type == "ac_formula":
            if not result["acFormula"]:
                result["acFormula"] = feature

        elif feature_type == "speed_bonus":
            scaled = _get_scaled_value(effect.get("scaling"), level)
            bonus = scaled if isinstance(scaled, int) else effect.get("value", 0)
            result["speedBonus"] = max(result["speedBonus"], bonus or 0)

        elif feature_type == "extra_attack":
            scaled = _get_scaled_value(effect.get("scaling"), level)
            attacks = scaled if isinstance(scaled, int) else effect.get("value", 1)
            result["attacksPerAction"] = max(result["attacksPerAction"], attacks or 1)

        elif feature_type == "brutal_critical":
            feature_id = feature.get("id", "")
            # For crit range (improved/superior critical)
            if "critical" in feature_id and "brutal" not in feature_id:
                crit_value = effect.get("value")
                if crit_value and crit_value < result["critRange"]:
                    result["critRange"] = crit_value
            else:
                # For brutal critical (extra dice)
                scaled = _get_scaled_value(effect.get("scaling"), level)
                dice = scaled if isinstance(scaled, int) else 0
                result["brutalCriticalDice"] = max(result["brutalCriticalDice"], dice or 0)

        elif feature_type == "sneak_attack":
            scaled = _get_scaled_value(effect.get("scaling"), level)
            if scaled:
                result["sneakAttack"] = {
                    "dice": str(scaled),
                    "feature": feature,
                }

        elif feature_type == "damage_reduction":
            if feature.get("id") == "uncanny_dodge":
                result["hasUncannyDodge"] = True

        elif feature_type == "evasion":
            result["hasEvasion"] = True

        elif feature_type == "saving_throw_bonus":
            result["savingThrowBonuses"].append({
                "source": feature.get("name", ""),
                "value": effect.get("abilityModifier") or effect.get("value", 0),
                "condition": feature.get("condition"),
            })

        elif feature_type == "saving_throw_proficiency":
            result["allSavingThrowProficiency"] = True

        elif feature_type == "minimum_roll":
            if feature.get("id") == "reliable_talent":
                result["reliableTalent"] = True

        elif feature_type == "advantage_grant":
            result["advantageOn"].append({
                "target": feature.get("trigger", ""),
                "condition": feature.get("condition"),
            })

        elif feature_type == "advantage_deny":
            if feature.get("id") == "elusive":
                result["denyEnemyAdvantage"] = True

        elif feature_type == "immunity":
            if not _is_always_on_passive_feature(feature):
                continue
            immune_to = effect.get("immuneTo", [])
            result["immunities"].extend(immune_to)

        elif feature_type == "resistance":
            if not _is_always_on_passive_feature(feature):
                continue
            resist_to = effect.get("resistTo", [])
            result["resistances"].extend(resist_to)

        elif feature_type == "divine_strike":
            scaled = _get_scaled_value(effect.get("scaling"), level)
            dmg = str(scaled) if scaled else effect.get("damage", "1d8")
            dmg_type = (effect.get("damageType") or ["radiant"])[0]
            result["divineStrike"] = {
                "damage": str(dmg),
                "damageType": dmg_type,
                "feature": feature,
            }

    return result


def get_passive_save_advantage_sources(
    class_id: Optional[str],
    level: int,
    subclass_id: Optional[str] = None,
    save_type: Optional[str] = None,
    condition_ids: Optional[List[str]] = None,
    can_see_effect: Optional[bool] = None,
) -> List[str]:
    """Return passive feature names that grant advantage on the requested saving throw."""
    if not class_id or level < 1:
        return []

    normalized_save = _normalize_save_ability(save_type)
    normalized_conditions = {
        _normalize_condition_id(condition)
        for condition in (condition_ids or [])
        if condition
    }

    if can_see_effect is None:
        can_see_effect = not bool(normalized_conditions & PASSIVE_SAVE_VISION_BLOCKERS)

    sources: List[str] = []
    passive_features = get_passive_features(class_id, level, subclass_id)
    for feature in passive_features["allFeatures"]:
        if feature.get("type") != "advantage_grant":
            continue
        if str(feature.get("trigger", "")).strip().lower() != "on_saving_throw":
            continue

        condition = feature.get("condition") or {}
        required_ability = _normalize_save_ability(condition.get("savingThrowAbility"))
        if required_ability and required_ability != normalized_save:
            continue

        if condition.get("notIncapacitated") and "incapacitated" in normalized_conditions:
            continue

        if condition.get("canSeeEffect") and not can_see_effect:
            continue

        source_name = feature.get("nameEn") or feature.get("name") or feature.get("id")
        if source_name and source_name not in sources:
            sources.append(source_name)

    return sources


def get_sneak_attack_dice(level: int) -> str:
    """Get sneak attack dice for a rogue level"""
    if level < 1:
        return "0"

    features = _load_features()
    sneak_feature = next((f for f in features if f.get("id") == "sneak_attack"), None)
    if not sneak_feature:
        return "1d6"

    scaling = sneak_feature.get("effect", {}).get("scaling")
    scaled = _get_scaled_value(scaling, level)
    return str(scaled) if scaled else "1d6"


def get_extra_attack_count(
    class_id: str,
    level: int,
    subclass_id: Optional[str] = None
) -> int:
    """Get extra attack count for class/subclass/level"""
    result = get_passive_features(class_id, level, subclass_id)
    return result["attacksPerAction"]


def get_brutal_critical_dice(class_id: str, level: int) -> int:
    """Get brutal critical dice for class/level"""
    if class_id.lower() != "barbarian":
        return 0
    result = get_passive_features(class_id, level)
    return result["brutalCriticalDice"]


def get_crit_range(
    class_id: str,
    level: int,
    subclass_id: Optional[str] = None
) -> int:
    """Get crit range for class/subclass/level"""
    result = get_passive_features(class_id, level, subclass_id)
    return result["critRange"]


def has_evasion(class_id: str, level: int) -> bool:
    """Check if character has evasion"""
    result = get_passive_features(class_id, level)
    return result["hasEvasion"]


def has_uncanny_dodge(class_id: str, level: int) -> bool:
    """Check if character has uncanny dodge"""
    result = get_passive_features(class_id, level)
    return result["hasUncannyDodge"]


def has_reliable_talent(class_id: str, level: int) -> bool:
    """Check if character has reliable talent"""
    result = get_passive_features(class_id, level)
    return result["reliableTalent"]


def is_elusive(class_id: str, level: int) -> bool:
    """Check if character denies enemy advantage (elusive)"""
    result = get_passive_features(class_id, level)
    return result["denyEnemyAdvantage"]


def get_speed_bonus(
    class_id: str,
    level: int,
    subclass_id: Optional[str] = None
) -> int:
    """Get speed bonus for class/level (unarmored movement, fast movement)"""
    result = get_passive_features(class_id, level, subclass_id)
    return result["speedBonus"]


def get_divine_strike(
    class_id: str,
    level: int,
    subclass_id: Optional[str] = None
) -> Optional[Dict[str, str]]:
    """Get divine strike dice/type for class/subclass/level.
    Returns {"damage": "1d8", "damageType": "radiant"} or None."""
    result = get_passive_features(class_id, level, subclass_id)
    ds = result.get("divineStrike")
    if ds:
        return {"damage": ds["damage"], "damageType": ds["damageType"]}
    return None
