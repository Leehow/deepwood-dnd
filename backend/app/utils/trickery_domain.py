"""Helpers for Trickery Domain cleric features."""

from typing import List, Optional

INVOKE_DUPLICITY_SPELL_ID = "invoke_duplicity"


def is_invoke_duplicity_concentration(concentration_spell: Optional[dict]) -> bool:
    if not isinstance(concentration_spell, dict):
        return False
    spell_id = str(concentration_spell.get("spell_id") or "").strip().lower()
    return spell_id == INVOKE_DUPLICITY_SPELL_ID


def get_concentration_linked_token_ids(concentration_spell: Optional[dict]) -> List[int]:
    """Return token ids bound to a concentration effect for cleanup."""
    if not isinstance(concentration_spell, dict):
        return []

    linked_ids: List[int] = []

    for raw_value in concentration_spell.get("linked_token_ids") or []:
        try:
            token_id = int(raw_value)
        except (TypeError, ValueError):
            continue
        if token_id > 0 and token_id not in linked_ids:
            linked_ids.append(token_id)

    area_effect = concentration_spell.get("area_effect") or {}
    try:
        illusion_token_id = int(area_effect.get("illusion_token_id"))
    except (TypeError, ValueError):
        illusion_token_id = None

    if illusion_token_id and illusion_token_id not in linked_ids:
        linked_ids.append(illusion_token_id)

    return linked_ids
