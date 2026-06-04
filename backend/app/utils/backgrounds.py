"""Background data utilities - using cached rules data"""
from typing import Optional, Dict, Any
from app.utils.rules_cache import get_backgrounds_data


def load_backgrounds_data() -> Dict[str, Any]:
    """Load backgrounds data from cache (backward compatibility)"""
    return get_backgrounds_data()


def get_background_by_name(name_or_id: str) -> Optional[Dict[str, Any]]:
    """Get background by id, Chinese name, or English name"""
    try:
        data = get_backgrounds_data()
        for bg in data.get("backgrounds", []):
            if (
                bg.get("id") == name_or_id
                or bg.get("name") == name_or_id
                or bg.get("nameEn", "").lower() == name_or_id.lower()
            ):
                return bg
        return None
    except Exception:
        return None
