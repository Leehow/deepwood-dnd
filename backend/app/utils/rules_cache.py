"""
Rules data cache service.
Loads JSON rule files once and caches them in memory for fast access.

All JSON data files are unified under frontend/app/data/.
"""
import json
from functools import lru_cache
from typing import Dict, Any, Optional, List
from pathlib import Path

# 统一数据根目录
PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
DATA_BASE_PATH = PROJECT_ROOT / "frontend" / "app" / "data"
RULES_BASE_PATH = DATA_BASE_PATH / "rules"
NPC_DATA_PATH = DATA_BASE_PATH / "npc"
BACKEND_DATA_PATH = DATA_BASE_PATH / "backend"
CREATOR_KB_PATH = DATA_BASE_PATH / "creator"
MODULES_DATA_PATH = DATA_BASE_PATH / "modules"


@lru_cache(maxsize=None)
def _load_json_file(file_path: str) -> Dict[str, Any]:
    """Load and cache a JSON file. Internal function."""
    with open(file_path, "r", encoding="utf-8") as f:
        return json.load(f)


def get_rules_path(filename: str) -> Path:
    """Get the full path to a rules file."""
    return RULES_BASE_PATH / filename


# ============== Specific Data Loaders ==============

def get_classes_data() -> Dict[str, Any]:
    """Get cached classes data (with structured subclass features)."""
    return _load_json_file(str(get_rules_path("classes_with_structured_subclass_features.json")))


def get_races_data() -> Dict[str, Any]:
    """Get cached races data."""
    return _load_json_file(str(get_rules_path("races.json")))


def get_spells_data() -> Dict[str, Any]:
    """Get cached spells data."""
    return _load_json_file(str(get_rules_path("spells.json")))


def get_equipment_data() -> Dict[str, Any]:
    """Get cached equipment data."""
    return _load_json_file(str(get_rules_path("equipment.json")))


def get_backgrounds_data() -> Dict[str, Any]:
    """Get cached backgrounds data."""
    return _load_json_file(str(get_rules_path("backgrounds.json")))


def get_skills_data() -> Dict[str, Any]:
    """Get cached skills data."""
    return _load_json_file(str(get_rules_path("skills.json")))


def get_abilities_data() -> Dict[str, Any]:
    """Get cached abilities data."""
    return _load_json_file(str(get_rules_path("abilities.json")))


def get_gods_data() -> Dict[str, Any]:
    """Get cached gods/deities data."""
    return _load_json_file(str(get_rules_path("gods.json")))


def get_feats_data() -> Dict[str, Any]:
    """Get cached feats data."""
    return _load_json_file(str(get_rules_path("feats.json")))


def get_eldritch_invocations_data() -> Dict[str, Any]:
    """Get cached eldritch invocations data."""
    return _load_json_file(str(get_rules_path("eldritch_invocations.json")))


def get_xp_thresholds_data() -> Dict[str, Any]:
    """Get cached XP thresholds data."""
    return _load_json_file(str(get_rules_path("xp-thresholds.json")))


def get_multiclass_requirements_data() -> Dict[str, Any]:
    """Get cached multiclass requirements data."""
    return _load_json_file(str(get_rules_path("multiclass-requirements.json")))


def get_spellcasting_data() -> Dict[str, Any]:
    """Get cached spellcasting rules data."""
    return _load_json_file(str(get_rules_path("spellcasting.json")))


def get_classes_progression_data() -> Dict[str, Any]:
    """Get cached class level-progression data (choice/subclass/feature nodes by level)."""
    return _load_json_file(str(get_rules_path("classes-progression.json")))


def get_monsters_data() -> Dict[str, Any]:
    """Get cached preset monsters data."""
    return _load_json_file(str(NPC_DATA_PATH / "monsters.json"))


def get_avatar_descriptions_data() -> Dict[str, Any]:
    """Get cached avatar descriptions data."""
    return _load_json_file(str(RULES_BASE_PATH / "avatar-descriptions.json"))


def get_all_monsters() -> List[Dict[str, Any]]:
    """Get list of all preset monsters."""
    return get_monsters_data().get("monsters", [])


# ============== Backend Data Loaders ==============

def get_companions_data() -> Dict[str, Any]:
    """Get cached companions data."""
    return _load_json_file(str(BACKEND_DATA_PATH / "companions.json"))


def get_effects_data() -> Dict[str, Any]:
    """Get cached effects data."""
    return _load_json_file(str(BACKEND_DATA_PATH / "effects.json"))


def get_passive_features_data() -> Dict[str, Any]:
    """Get cached passive features data."""
    return _load_json_file(str(BACKEND_DATA_PATH / "passive_features.json"))


def get_class_resources_data() -> Dict[str, Any]:
    """Get cached class resources data."""
    return _load_json_file(str(BACKEND_DATA_PATH / "class_resources.json"))


def get_module_templates_data() -> List[Dict[str, Any]]:
    """Get cached module templates data."""
    return _load_json_file(str(BACKEND_DATA_PATH / "templates" / "module_templates.json"))


# ============== Helper Functions ==============

def get_class_by_id(class_id: str) -> Optional[Dict[str, Any]]:
    """Get a specific class by ID."""
    data = get_classes_data()
    for cls in data.get("classes", []):
        if cls.get("id") == class_id:
            return cls
    return None


def get_class_by_name(name: str) -> Optional[Dict[str, Any]]:
    """Get a specific class by Chinese name, English name, or ID."""
    data = get_classes_data()
    name_lower = name.lower()
    for cls in data.get("classes", []):
        if (cls.get("id", "").lower() == name_lower or
            cls.get("name", "").lower() == name_lower or
            cls.get("name_en", "").lower() == name_lower):
            return cls
    return None


def get_race_by_id(race_id: str) -> Optional[Dict[str, Any]]:
    """Get a specific race by ID."""
    data = get_races_data()
    for race in data.get("races", []):
        if race.get("id") == race_id:
            return race
    return None


def get_race_by_name(name: str) -> Optional[Dict[str, Any]]:
    """Get a specific race by Chinese name, English name, or ID."""
    data = get_races_data()
    name_lower = name.lower()
    for race in data.get("races", []):
        if (race.get("id", "").lower() == name_lower or
            race.get("name", "").lower() == name_lower or
            race.get("name_en", "").lower() == name_lower):
            return race
    return None


def get_spell_by_id(spell_id: str) -> Optional[Dict[str, Any]]:
    """Get a specific spell by ID."""
    data = get_spells_data()
    for spell in data.get("spells", []):
        if spell.get("id") == spell_id:
            return spell
    return None


def get_spell_by_name(name: str) -> Optional[Dict[str, Any]]:
    """Get a specific spell by Chinese name, English name, or ID."""
    data = get_spells_data()
    name_lower = name.lower()
    for spell in data.get("spells", []):
        if (spell.get("id", "").lower() == name_lower or
            spell.get("name", "").lower() == name_lower or
            spell.get("name_en", "").lower() == name_lower):
            return spell
    return None


def get_spell_cast_option(spell_data: Optional[Dict[str, Any]], selected_option: Optional[str]) -> Optional[Dict[str, Any]]:
    """Get a spell cast option by key."""
    if not spell_data or not selected_option:
        return None
    for option in spell_data.get("castOptions", []) or []:
        if option.get("key") == selected_option:
            return option
    return None


def get_spell_effect_phases(
    spell_data: Optional[Dict[str, Any]],
    selected_option: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Return merged base spell phases plus selected cast option phases."""
    if not spell_data:
        return []
    phases = list(spell_data.get("effects") or [])
    option = get_spell_cast_option(spell_data, selected_option)
    if option and option.get("effects"):
        phases.extend(list(option.get("effects") or []))
    return phases


def spell_has_effect_type(
    spell_data: Optional[Dict[str, Any]],
    effect_type: str,
    selected_option: Optional[str] = None,
) -> bool:
    """Check whether a spell includes a specific effect type."""
    for phase in get_spell_effect_phases(spell_data, selected_option):
        for effect in phase.get("effects", []) or []:
            if effect.get("type") == effect_type:
                return True
    return False


def spell_has_illusion_subtype(
    spell_data: Optional[Dict[str, Any]],
    subtype: str,
) -> bool:
    """Check whether a spell is an illusion with the given subtype."""
    return ((spell_data or {}).get("illusion") or {}).get("subtype") == subtype


def spell_has_illumination_type(
    spell_data: Optional[Dict[str, Any]],
    illumination_type: str,
) -> bool:
    """Check whether a spell's illumination metadata matches the given type."""
    return ((spell_data or {}).get("illumination") or {}).get("type") == illumination_type


def get_spell_size_delta(
    spell_data: Optional[Dict[str, Any]],
    selected_option: Optional[str] = None,
) -> Optional[int]:
    """Return the size delta defined by spell metadata, if any."""
    for phase in get_spell_effect_phases(spell_data, selected_option):
        for effect in phase.get("effects", []) or []:
            if effect.get("type") != "modify_stat" or effect.get("stat") != "size":
                continue
            if effect.get("operation") != "add":
                continue
            formula = effect.get("formula")
            try:
                return int(str(formula).strip())
            except (TypeError, ValueError):
                continue
    return None


def get_background_by_id(bg_id: str) -> Optional[Dict[str, Any]]:
    """Get a specific background by ID."""
    data = get_backgrounds_data()
    for bg in data.get("backgrounds", []):
        if bg.get("id") == bg_id:
            return bg
    return None


def get_background_by_name(name: str) -> Optional[Dict[str, Any]]:
    """Get a specific background by Chinese name, English name, or ID."""
    data = get_backgrounds_data()
    name_lower = name.lower()
    for bg in data.get("backgrounds", []):
        if (bg.get("id", "").lower() == name_lower or
            bg.get("name", "").lower() == name_lower or
            bg.get("name_en", "").lower() == name_lower):
            return bg
    return None


def get_equipment_by_id(item_id: str) -> Optional[Dict[str, Any]]:
    """Get a specific equipment item by ID."""
    data = get_equipment_data()
    for category in ["weapons", "armor", "gear", "tools", "packs"]:
        for item in data.get(category, []):
            if item.get("id") == item_id:
                return item
    return None


def get_all_classes() -> List[Dict[str, Any]]:
    """Get list of all classes."""
    return get_classes_data().get("classes", [])


def get_all_races() -> List[Dict[str, Any]]:
    """Get list of all races."""
    return get_races_data().get("races", [])


def get_all_spells() -> List[Dict[str, Any]]:
    """Get list of all spells."""
    return get_spells_data().get("spells", [])


def get_all_backgrounds() -> List[Dict[str, Any]]:
    """Get list of all backgrounds."""
    return get_backgrounds_data().get("backgrounds", [])


# ============== Cache Management ==============

def clear_cache():
    """Clear all cached data. Useful for testing or when files are updated."""
    _load_json_file.cache_clear()


def get_cache_info():
    """Get cache statistics."""
    return _load_json_file.cache_info()
