"""
Dice formula parser and evaluator.

Supports expressions like:
  "2d6+8"         → roll 2d6, add 8
  "2d6+1d4+3"     → roll 2d6, roll 1d4, add 3
  "(3d8)+MOD"     → roll 3d8, add MOD variable
  "1d4"           → roll 1d4
  "5"             → fixed value 5
  "MOD"           → variable substitution

Variables: MOD (spellcasting mod), PROF (proficiency), LEVEL (caster level)
"""
import random
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class DiceGroup:
    """A single dice roll group, e.g. 2d6"""
    count: int
    sides: int
    rolls: List[int] = field(default_factory=list)
    total: int = 0

    def roll(self) -> int:
        self.rolls = [random.randint(1, self.sides) for _ in range(self.count)]
        self.total = sum(self.rolls)
        return self.total

    def __str__(self) -> str:
        if not self.rolls:
            return f"{self.count}d{self.sides}"
        rolls_str = ",".join(str(r) for r in self.rolls)
        return f"{self.count}d{self.sides}({rolls_str})"


@dataclass
class FormulaResult:
    """Result of evaluating a dice formula."""
    total: int
    dice_groups: List[DiceGroup] = field(default_factory=list)
    modifier: int = 0
    breakdown: str = ""  # e.g. "2d6(3,5)+1d4(2)+5"


# Matches dice groups like "2d6", "d8", "1d20"
_DICE_RE = re.compile(r"(\d*)d(\d+)", re.IGNORECASE)
# Matches variable names
_VAR_RE = re.compile(r"[A-Z_]+")


def evaluate(
    formula: str,
    variables: Optional[Dict[str, int]] = None,
) -> FormulaResult:
    """
    Parse and evaluate a dice formula.

    Args:
        formula: Expression like "2d6+8", "1d4+MOD", "5"
        variables: Variable values, e.g. {"MOD": 4, "PROF": 3, "LEVEL": 5}

    Returns:
        FormulaResult with total, dice_groups, modifier, breakdown
    """
    if not formula or not formula.strip():
        return FormulaResult(total=0, breakdown="0")

    variables = variables or {}
    expr = formula.strip()

    # Strip outer parentheses
    while expr.startswith("(") and expr.endswith(")"):
        expr = expr[1:-1].strip()

    # Substitute variables
    def _replace_var(m: re.Match) -> str:
        name = m.group(0)
        if name in variables:
            return str(variables[name])
        # Check case-insensitive
        for k, v in variables.items():
            if k.upper() == name.upper():
                return str(v)
        return "0"

    # Replace variables but not dice expressions (avoid replacing D in "2d6")
    substituted = _VAR_RE.sub(_replace_var, expr)
    # Clean up any leftover parentheses from patterns like "(3d8)+5"
    substituted = substituted.replace("(", "").replace(")", "")

    dice_groups: List[DiceGroup] = []
    total = 0

    # Extract and roll all dice groups
    def _roll_dice(m: re.Match) -> str:
        count = int(m.group(1)) if m.group(1) else 1
        sides = int(m.group(2))
        group = DiceGroup(count=count, sides=sides)
        group.roll()
        dice_groups.append(group)
        return str(group.total)

    # Replace dice expressions with their rolled values
    evaluated = _DICE_RE.sub(_roll_dice, substituted)

    # Now evaluated should be a simple arithmetic expression like "8+2+5"
    # Safely evaluate it
    try:
        # Only allow digits, +, -, spaces
        cleaned = evaluated.replace(" ", "")
        if cleaned and re.match(r"^[0-9+\-]+$", cleaned):
            total = _safe_eval_arithmetic(cleaned)
        elif cleaned:
            total = int(cleaned) if cleaned.lstrip("-").isdigit() else 0
    except (ValueError, SyntaxError):
        total = 0

    # Calculate modifier (non-dice portion)
    dice_total = sum(g.total for g in dice_groups)
    modifier = total - dice_total

    # Build breakdown string
    parts = []
    for g in dice_groups:
        parts.append(str(g))
    if modifier > 0 and dice_groups:
        parts.append(f"+{modifier}")
    elif modifier < 0:
        parts.append(str(modifier))
    elif modifier > 0 and not dice_groups:
        parts.append(str(modifier))

    breakdown = "".join(parts) if parts else str(total)

    return FormulaResult(
        total=total,
        dice_groups=dice_groups,
        modifier=modifier,
        breakdown=breakdown,
    )


def _safe_eval_arithmetic(expr: str) -> int:
    """Safely evaluate a simple arithmetic expression (only +, -)."""
    result = 0
    current = ""
    sign = 1

    for ch in expr:
        if ch in "+-":
            if current:
                result += sign * int(current)
                current = ""
            sign = 1 if ch == "+" else -1
        else:
            current += ch

    if current:
        result += sign * int(current)

    return result


def is_formula(value) -> bool:
    """Check if a value is a formula string (vs plain int)."""
    if isinstance(value, int):
        return False
    if isinstance(value, str):
        return bool(_DICE_RE.search(value) or _VAR_RE.search(value))
    return False
