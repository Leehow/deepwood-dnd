"""Skills data utilities - using cached rules data"""
from typing import Dict, Any
from app.utils.rules_cache import get_skills_data


def load_skills_data() -> Dict[str, Any]:
    """Load skills data from cache (backward compatibility)"""
    return get_skills_data()

