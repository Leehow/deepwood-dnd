"""Helpers for Light Domain cleric features."""

from typing import Any, Optional

from app.models.token import Token

LIGHT_DOMAIN_CORONA_EFFECT_ID = "corona_of_light"
LIGHT_DOMAIN_CORONA_BRIGHT_RADIUS_FEET = 60


def _parse_token_size(size_str: Optional[str]) -> tuple[int, int]:
    raw = (size_str or "1x1").lower()
    parts = raw.split("x")
    try:
        width = max(1, int(parts[0]))
    except (TypeError, ValueError):
        width = 1
    try:
        height = max(1, int(parts[1] if len(parts) > 1 else parts[0]))
    except (TypeError, ValueError):
        height = width
    return width, height


def calculate_token_distance_feet(token1: Token, token2: Token, grid_size: int = 5) -> float:
    """Calculate center-to-center token distance in feet."""
    width1, height1 = _parse_token_size(token1.token_size)
    width2, height2 = _parse_token_size(token2.token_size)

    center1_x = token1.position_x + (width1 / 2)
    center1_y = token1.position_y + (height1 / 2)
    center2_x = token2.position_x + (width2 / 2)
    center2_y = token2.position_y + (height2 / 2)

    return max(abs(center1_x - center2_x), abs(center1_y - center2_y)) * grid_size


def is_corona_of_light_active(token: Optional[Token]) -> bool:
    """Return True when the token currently has an active Corona of Light effect."""
    if not token or not token.active_effects:
        return False

    for effect in token.active_effects:
        if effect.get("id") != LIGHT_DOMAIN_CORONA_EFFECT_ID:
            continue

        remaining = effect.get("duration")
        if remaining is None:
            remaining = effect.get("roundsRemaining")

        if remaining is None:
            return True

        try:
            return float(remaining) > 0
        except (TypeError, ValueError):
            return True

    return False


def is_corona_damage_type(damage_type: Any) -> bool:
    """Corona of Light only affects fire or radiant spells."""
    if damage_type is None:
        return False

    normalized = str(damage_type).strip().lower()
    return any(
        alias in normalized
        for alias in ("fire", "火焰", "radiant", "光耀")
    )


def get_token_faction(token: Optional[Token]) -> str:
    if not token:
        return "neutral"
    if token.faction:
        return token.faction
    if token.character_id:
        return "player"
    if token.monster_instance_id:
        return "enemy"
    return "neutral"


def target_has_corona_of_light_save_disadvantage(
    source_token: Optional[Token],
    target_token: Optional[Token],
    damage_type: Any,
) -> bool:
    """
    Light Domain: hostile creatures in the bright light of Corona of Light have
    disadvantage on saves against the source token's fire or radiant spells.
    """
    if not source_token or not target_token:
        return False
    if source_token.id == target_token.id:
        return False
    if not is_corona_of_light_active(source_token):
        return False
    if not is_corona_damage_type(damage_type):
        return False
    if source_token.campaign_id != target_token.campaign_id:
        return False
    if source_token.map_url != target_token.map_url:
        return False

    source_faction = get_token_faction(source_token)
    target_faction = get_token_faction(target_token)
    if target_faction == "neutral" or source_faction == target_faction:
        return False

    return (
        calculate_token_distance_feet(source_token, target_token)
        <= LIGHT_DOMAIN_CORONA_BRIGHT_RADIUS_FEET
    )
