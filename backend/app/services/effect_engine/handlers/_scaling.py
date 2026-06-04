"""
Shared scaling helper extracted from SpellResolver._scale_formula().
"""
from __future__ import annotations

import re
from typing import Dict, Optional


def scale_formula(
    base_formula: str,
    scaling: Optional[Dict],
    slot_level: int,
) -> str:
    """Apply upcast scaling to a dice formula."""
    if not scaling:
        return base_formula
    per_slot = scaling.get("per_slot_above", 0)
    extra_dice = scaling.get("extra_dice")
    extra_value = scaling.get("extra_value")
    if not per_slot or slot_level <= per_slot:
        return base_formula

    levels_above = slot_level - per_slot
    if levels_above <= 0:
        return base_formula
    result = base_formula
    # Apply extra_dice AND extra_value when both are present (e.g. Magic Missile
    # adds 1d4 AND +1 flat per slot). Previously this returned after extra_dice,
    # silently dropping extra_value.
    if extra_dice:
        m = re.match(r"(\d*)d(\d+)", extra_dice)
        if m:
            count = int(m.group(1) or 1) * levels_above
            result = f"{result}+{count}d{m.group(2)}"
        else:
            result = f"{result}+{extra_dice}"
    if extra_value:
        result = f"{result}+{extra_value * levels_above}"
    return result
