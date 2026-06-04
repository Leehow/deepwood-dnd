"""
Unified Effect Service
Centralizes all buff/effect checking for D&D 5E combat
"""
import json
import os
from typing import Optional, List, Dict, Any, Tuple

from app.utils.dice_formula import evaluate as eval_formula, is_formula

# Load effects data
_effects_data = None
_effects_by_id = None


def _load_effects() -> Dict[str, Any]:
    """Load effects from JSON file (lazy loading)"""
    global _effects_data, _effects_by_id
    if _effects_data is None:
        from app.utils.rules_cache import get_effects_data
        _effects_data = get_effects_data()
        _effects_by_id = {e['id']: e for e in _effects_data['effects'] if 'id' in e}
    return _effects_data


def _get_effects_by_id() -> Dict[str, Dict[str, Any]]:
    """Get effects indexed by ID"""
    global _effects_by_id
    if _effects_by_id is None:
        _load_effects()
    return _effects_by_id


def get_effect_definition(effect_id: str) -> Optional[Dict[str, Any]]:
    """Get effect definition by ID"""
    return _get_effects_by_id().get(effect_id)


def get_all_effects() -> List[Dict[str, Any]]:
    """Get all effect definitions"""
    data = _load_effects()
    return data['effects']


def get_effects_by_category(category: str) -> List[Dict[str, Any]]:
    """Get effects filtered by category"""
    data = _load_effects()
    return [e for e in data['effects'] if e.get('category') == category]


def get_effects_by_source(source: str) -> List[Dict[str, Any]]:
    """Get effects filtered by source (class, race, etc.)"""
    data = _load_effects()
    return [e for e in data['effects'] if e.get('source') == source]


# Physical damage types that rage provides resistance to
PHYSICAL_DAMAGE_TYPES = [
    "bludgeoning", "piercing", "slashing",
    "钝击", "穿刺", "挥砍"
]


def check_has_effect(
    active_effects: Optional[List[Dict[str, Any]]],
    effect_id: str
) -> bool:
    """
    Check if a token has a specific effect active.

    Args:
        active_effects: List of active effects on the token
        effect_id: The effect ID to check for

    Returns:
        True if effect is active, False otherwise
    """
    if not active_effects:
        return False

    effect_def = get_effect_definition(effect_id)
    if not effect_def:
        return False

    # Check by ID or by name (supports both English and Chinese)
    name_en = effect_def.get('name_en', '').lower()
    name_cn = effect_def.get('name', '')

    for effect in active_effects:
        eff_id = effect.get("id", "").lower()
        eff_name = effect.get("name", "").lower()

        # Match by ID
        if eff_id == effect_id:
            return True

        # Match by English name
        if name_en and name_en in eff_name:
            return True

        # Match by Chinese name
        if name_cn and name_cn in effect.get("name", ""):
            return True

    return False


def check_is_raging(active_effects: Optional[List[Dict[str, Any]]]) -> bool:
    """Check if a token has rage active"""
    return check_has_effect(active_effects, "rage")


def check_is_reckless(active_effects: Optional[List[Dict[str, Any]]]) -> bool:
    """Check if a token has Reckless Attack active"""
    return check_has_effect(active_effects, "reckless_attack")


def check_is_frenzied(active_effects: Optional[List[Dict[str, Any]]]) -> bool:
    """Check if a token has Frenzy active"""
    return check_has_effect(active_effects, "frenzy")


def check_is_dodging(active_effects: Optional[List[Dict[str, Any]]]) -> bool:
    """Check if a token has Dodge action active"""
    return check_has_effect(active_effects, "dodge")


def check_is_hidden(active_effects: Optional[List[Dict[str, Any]]]) -> bool:
    """Check if a token is hidden"""
    return check_has_effect(active_effects, "hide")


def is_physical_damage(damage_type: Optional[str]) -> bool:
    """Check if a damage type is physical (affected by rage resistance)"""
    if not damage_type:
        return False
    damage_type_lower = damage_type.lower()
    return any(phys_type in damage_type_lower for phys_type in PHYSICAL_DAMAGE_TYPES)


def get_rage_damage_bonus(level: int) -> int:
    """
    Get the rage damage bonus based on barbarian level.

    Rage Damage Bonus:
    - Level 1-8: +2
    - Level 9-15: +3
    - Level 16+: +4
    """
    if level >= 16:
        return 4
    elif level >= 9:
        return 3
    else:
        return 2


def get_brutal_critical_dice(class_id: Optional[str], level: int) -> int:
    """
    Get the number of extra damage dice from Barbarian's Brutal Critical.

    Brutal Critical (Barbarian):
    - Level 9: +1 extra damage die on critical
    - Level 13: +2 extra damage dice on critical
    - Level 17: +3 extra damage dice on critical
    """
    if not class_id or class_id.lower() != "barbarian":
        return 0

    if level >= 17:
        return 3
    elif level >= 13:
        return 2
    elif level >= 9:
        return 1

    return 0


def get_modifiers_for_target(
    active_effects: Optional[List[Dict[str, Any]]],
    target: str,
    condition: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Get all modifiers that apply to a specific target.

    Args:
        active_effects: List of active effects
        target: The target type (attack_roll, incoming_attack, saving_throw, etc.)
        condition: Optional conditions to match (ability, damage_type, attack_type)

    Returns:
        Dict with: has_advantage, has_disadvantage, bonuses, resistances, reasons
    """
    result = {
        "has_advantage": False,
        "has_disadvantage": False,
        "auto_fail": False,
        "auto_crit": False,
        "suppressed": False,
        "bonuses": [],
        "resistances": [],
        "immunities": [],
        "reasons": []
    }

    if not active_effects:
        return result

    for effect in active_effects:
        effect_id = effect.get("id", "")
        effect_def = get_effect_definition(effect_id)

        # If no direct match, try to match by condition field (for spell-applied effects)
        # e.g., effect_id = "hold_person_paralyzed", condition = "paralyzed"
        if not effect_def and effect.get("condition"):
            effect_def = get_effect_definition(effect["condition"])

        if not effect_def:
            # Fall back to inline modifiers for spell-created effects
            # (SpellResolver creates effects with inline modifiers array)
            inline_mods = effect.get("modifiers")
            if not inline_mods:
                continue
            modifiers = inline_mods
            effect_name = effect.get("name", effect_id)
        else:
            modifiers = effect_def.get("modifiers", [])
            effect_name = effect_def.get("name", effect.get("name", effect_id))

        for mod in modifiers:
            if mod.get("target") != target:
                continue

            # Check condition match
            mod_condition = mod.get("condition")
            if mod_condition and condition:
                # Check ability match
                if mod_condition.get("ability") and condition.get("ability"):
                    if mod_condition["ability"] != condition["ability"]:
                        continue

                # Check damage type match
                mod_dmg_types = mod_condition.get("damage_type", [])
                if mod_dmg_types and condition.get("damage_type"):
                    if isinstance(mod_dmg_types, str):
                        mod_dmg_types = [mod_dmg_types]
                    cond_dmg_type = condition["damage_type"]
                    if cond_dmg_type not in mod_dmg_types:
                        continue

                # Check damage source match
                if mod_condition.get("damage_source"):
                    if not condition or not condition.get("damage_source"):
                        continue
                    if mod_condition["damage_source"] != condition["damage_source"]:
                        continue

                # Check attack type match
                if mod_condition.get("attack_type") and condition.get("attack_type"):
                    if mod_condition["attack_type"] != condition["attack_type"]:
                        continue

                # Check strength-based match
                if mod_condition.get("is_strength_based") is not None:
                    if condition.get("is_strength_based") != mod_condition["is_strength_based"]:
                        continue

                # Check range match (e.g., prone: 5ft=advantage, ranged=disadvantage)
                if mod_condition.get("range") and condition.get("range"):
                    if mod_condition["range"] != condition["range"]:
                        continue

                # Check skill match (e.g., invisible: stealth check advantage)
                if mod_condition.get("skill"):
                    if not condition.get("skill") or mod_condition["skill"] != condition["skill"]:
                        continue

            # Apply modifier
            mod_type = mod.get("type")

            if mod_type == "advantage":
                result["has_advantage"] = True
                result["reasons"].append(f"{effect_name}: 优势")
            elif mod_type == "disadvantage":
                result["has_disadvantage"] = True
                result["reasons"].append(f"{effect_name}: 劣势")
            elif mod_type == "suppress":
                result["suppressed"] = True
                result["reasons"].append(f"{effect_name}: 抑制")
            elif mod_type == "auto_fail":
                result["auto_fail"] = True
                result["reasons"].append(f"{effect_name}: 自动失败")
            elif mod_type == "auto_crit":
                result["auto_crit"] = True
                result["reasons"].append(f"{effect_name}: 自动暴击")
            elif mod_type == "bonus":
                value = mod.get("value", 0)
                if isinstance(value, (int, float)):
                    result["bonuses"].append(int(value))
                    result["reasons"].append(f"{effect_name}: +{int(value)}")
                elif isinstance(value, str) and is_formula(value):
                    # Formula bonus (e.g., "1d4" from Bless)
                    roll_result = eval_formula(value)
                    result["bonuses"].append(roll_result.total)
                    result["reasons"].append(
                        f"{effect_name}: +{roll_result.breakdown}"
                    )
                elif isinstance(value, str):
                    # Try parsing as int
                    try:
                        v = int(value)
                        result["bonuses"].append(v)
                        result["reasons"].append(f"{effect_name}: +{v}")
                    except ValueError:
                        pass
            elif mod_type == "resistance":
                dmg_types = mod_condition.get("damage_type", []) if mod_condition else []
                if isinstance(dmg_types, str):
                    dmg_types = [dmg_types]
                result["resistances"].extend(dmg_types)
                result["reasons"].append(f"{effect_name}: 抗性")
            elif mod_type == "immunity":
                dmg_types = mod_condition.get("damage_type", []) if mod_condition else []
                if isinstance(dmg_types, str):
                    dmg_types = [dmg_types]
                result["immunities"].extend(dmg_types)
                result["reasons"].append(f"{effect_name}: 免疫")

    return result


def get_max_hp_bonus(active_effects: Optional[List[Dict[str, Any]]]) -> int:
    """汇总 active_effects 中 hp_max 的 bonus 修正（如 aid 抬高生命上限）。无 buff 则 0。"""
    result = get_modifiers_for_target(active_effects, "hp_max")
    return sum(result.get("bonuses", []))


def conditions_to_effects(conditions: Optional[List[str]]) -> List[Dict[str, Any]]:
    """
    Convert a list of condition IDs (e.g. ["petrified", "blinded"]) into
    pseudo active_effects entries so get_modifiers_for_target can process them.
    """
    if not conditions:
        return []
    result = []
    for cid in conditions:
        edef = get_effect_definition(cid)
        if edef:
            result.append({"id": cid, "name": edef.get("name", cid)})
    return result


def check_advantage_on_attack(
    active_effects: Optional[List[Dict[str, Any]]],
    is_strength_based: bool = True,
    attack_type: str = "melee",
    attacker_conditions: Optional[List[str]] = None
) -> Tuple[bool, bool, List[str]]:
    """
    Check if attacker has advantage or disadvantage on attack rolls,
    based on active effects AND status conditions (prone, blinded, etc.).

    Returns:
        (has_advantage, has_disadvantage, reasons)
    """
    # Merge active_effects with condition-derived pseudo-effects, dedup by ID
    existing_ids = set()
    merged = []
    for eff in (active_effects or []):
        eid = eff.get("id", "")
        merged.append(eff)
        if eid:
            existing_ids.add(eid)
    for eff in conditions_to_effects(attacker_conditions):
        if eff.get("id") not in existing_ids:
            merged.append(eff)
    result = get_modifiers_for_target(
        merged,
        "attack_roll",
        {"is_strength_based": is_strength_based, "attack_type": attack_type}
    )
    return result["has_advantage"], result["has_disadvantage"], result["reasons"]


def check_advantage_against_target(
    target_effects: Optional[List[Dict[str, Any]]],
    is_melee: bool = True,
    target_conditions: Optional[List[str]] = None
) -> Tuple[bool, bool, bool, List[str]]:
    """
    Check if attacks against a target have advantage, disadvantage, or auto-crit
    based on target's active effects AND status conditions.

    Args:
        target_effects: Active effects on the target (spell buffs, dodge, etc.)
        is_melee: Whether this is a melee attack (for auto-crit from paralyzed/unconscious)
        target_conditions: List of condition IDs on the target (e.g. ["petrified", "blinded"])

    Returns:
        (has_advantage, has_disadvantage, auto_crit, reasons)
    """
    # Merge active_effects with condition-derived pseudo-effects, dedup by ID
    existing_ids = set()
    merged = []
    for eff in (target_effects or []):
        eid = eff.get("id", "")
        merged.append(eff)
        if eid:
            existing_ids.add(eid)
    for eff in conditions_to_effects(target_conditions):
        if eff.get("id") not in existing_ids:
            merged.append(eff)
    if not merged:
        return False, False, False, []
    # Check with melee range condition for auto-crit
    condition = {"range": "5ft"} if is_melee else {"range": "ranged"}
    result = get_modifiers_for_target(merged, "incoming_attack", condition)
    return result["has_advantage"], result["has_disadvantage"], result.get("auto_crit", False), result["reasons"]


def check_resistances(
    active_effects: Optional[List[Dict[str, Any]]],
    damage_type: str,
    *,
    damage_source: Optional[str] = None,
) -> Tuple[bool, bool]:
    """
    Check if target has resistance or immunity to a damage type.

    Returns:
        (has_resistance, has_immunity)
    """
    result = get_modifiers_for_target(
        active_effects,
        "damage_taken",
        {
            "damage_type": damage_type,
            **({"damage_source": damage_source} if damage_source else {}),
        }
    )

    has_resistance = damage_type.lower() in [r.lower() for r in result["resistances"]]
    has_immunity = damage_type.lower() in [r.lower() for r in result["immunities"]]

    # Special case for rage - physical damage resistance
    if check_is_raging(active_effects) and is_physical_damage(damage_type):
        has_resistance = True

    return has_resistance, has_immunity


def apply_damage_with_modifiers(
    base_damage: int,
    damage_type: str,
    target_effects: Optional[List[Dict[str, Any]]],
    *,
    damage_source: Optional[str] = None,
) -> Tuple[int, Dict[str, Any]]:
    """
    Apply resistance/immunity to damage.

    Returns:
        (final_damage, details_dict)
    """
    has_resistance, has_immunity = check_resistances(
        target_effects,
        damage_type,
        damage_source=damage_source,
    )

    details = {
        "base_damage": base_damage,
        "damage_type": damage_type,
        "has_resistance": has_resistance,
        "has_immunity": has_immunity,
        "final_damage": base_damage
    }

    if has_immunity:
        details["final_damage"] = 0
    elif has_resistance:
        details["final_damage"] = base_damage // 2

    return details["final_damage"], details


def check_provokes_opportunity_attack(
    active_effects: Optional[List[Dict[str, Any]]]
) -> bool:
    """
    Check if a creature's movement provokes opportunity attacks.
    Returns False if movement does NOT provoke OA (e.g., Disengage active).

    Args:
        active_effects: Active effects on the moving creature

    Returns:
        True if movement provokes OA, False if suppressed
    """
    result = get_modifiers_for_target(
        active_effects, "opportunity_attack_provoked"
    )
    return not result.get("suppressed", False)


def get_bonus_damage_entries(
    active_effects: Optional[List[Dict[str, Any]]],
    *,
    attack_kind: Optional[str] = None,
) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    for effect in active_effects or []:
        for raw_entry in effect.get("bonus_damage") or []:
            if not isinstance(raw_entry, dict):
                continue
            if attack_kind and raw_entry.get("attack_kind") and raw_entry.get("attack_kind") != attack_kind:
                continue
            entry = dict(raw_entry)
            entry.setdefault("_effect_name", effect.get("name") or effect.get("aura_name") or effect.get("id"))
            entries.append(entry)
    return entries


def get_save_success_override(
    active_effects: Optional[List[Dict[str, Any]]],
    *,
    scope: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    for effect in active_effects or []:
        override = effect.get("save_success_override")
        if not isinstance(override, dict) or not override:
            continue
        override_scope = override.get("scope")
        if scope and override_scope and override_scope != scope:
            continue
        return dict(override)
    return None
