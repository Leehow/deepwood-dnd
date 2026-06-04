"""Derive the conditions a spell's visual buff should display.

The single source of truth is the spell's ``apply_condition`` effect entries —
i.e. conditions the spell actually *applies* to the buffed creature. The
top-level ``conditions`` field on a spell is a loose "related conditions" tag
(it also lists conditions the spell REMOVES, PREVENTS, DETECTS/COUNTERS, or that
belong to an invisible object/sensor rather than the creature) and must NOT be
trusted — copying it onto a token buff mis-renders the token (BUG B). See
``tests/unit/test_spell_buff_conditions.py``.
"""
from __future__ import annotations

from typing import Any, Dict, List


def derive_buff_conditions(spell_data: Dict[str, Any]) -> List[str]:
    """Return the conditions applied by ``spell_data`` via ``apply_condition``
    effects, ordered by first appearance with duplicates removed.

    Ignores the top-level ``conditions`` field entirely.
    """
    derived: List[str] = []
    for phase in spell_data.get("effects", []) or []:
        for effect in phase.get("effects", []) or []:
            if effect.get("type") != "apply_condition":
                continue
            cond = effect.get("condition")
            if cond and cond not in derived:
                derived.append(cond)
    return derived
