"""Race data utilities - using cached rules data"""
from typing import Optional, Tuple, Dict, Any
from app.utils.rules_cache import get_races_data


def load_races_data() -> Dict[str, Any]:
    """Load races data from cache (backward compatibility)"""
    return get_races_data()


def get_race_age_range(race_id: str) -> Tuple[int, int]:
    """
    Get age range (mature_age, max_age) for a race

    Args:
        race_id: Race identifier (e.g., 'dwarf', 'elf', 'human')

    Returns:
        Tuple of (mature_age, max_age)
        Default to (20, 100) if race not found
    """
    try:
        races_data = get_races_data()

        for race in races_data.get("races", []):
            if race.get("id") == race_id or race.get("nameEn", "").lower() == race_id.lower():
                age_data = race.get("age", {})
                mature = age_data.get("mature", 20)
                max_age = age_data.get("max", 100)
                return (mature, max_age)

        # Default age range if race not found
        return (20, 100)
    except Exception:
        # Fallback to default if any error
        return (20, 100)


def get_race_by_name(race_name: str) -> Optional[Dict[str, Any]]:
    """
    Get race data by name (supports both Chinese and English names)

    Args:
        race_name: Race name in Chinese or English

    Returns:
        Race data dict or None if not found
    """
    try:
        races_data = get_races_data()

        for race in races_data.get("races", []):
            if (race.get("name") == race_name or
                race.get("nameEn", "").lower() == race_name.lower() or
                race.get("id") == race_name):
                return race

        return None
    except Exception:
        return None
