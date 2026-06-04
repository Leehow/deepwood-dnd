"""Class data utilities - using cached rules data"""
from typing import Optional, Dict, Any, List
from app.utils.rules_cache import get_classes_data


def load_classes_data() -> Dict[str, Any]:
    """Load classes data from cache (backward compatibility)"""
    return get_classes_data()


def get_class_by_name(name_or_id: str) -> Optional[Dict[str, Any]]:
    """Get class data by Chinese name, English name, or id"""
    try:
        data = get_classes_data()
        for c in data.get("classes", []):
            if (
                c.get("id") == name_or_id
                or c.get("name") == name_or_id
                or c.get("nameEn", "").lower() == name_or_id.lower()
            ):
                return c
        return None
    except Exception:
        return None


def get_primary_abilities(class_id: str) -> List[str]:
    """Return the primary ability list for a class id (e.g., ["strength"], ["intelligence"])"""
    try:
        data = get_classes_data()
        for c in data.get("classes", []):
            if c.get("id") == class_id:
                # Some files may use primaryAbility or primaryAbilities
                pa = c.get("primaryAbility") or c.get("primaryAbilities")
                if isinstance(pa, list):
                    return [str(x).lower() for x in pa]
                if isinstance(pa, str):
                    return [pa.lower()]
        return []
    except Exception:
        return []
