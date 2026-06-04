"""
Unified Class Resource Service
统一职业资源服务

Handles all class-specific resources like Ki, Superiority Dice, Bardic Inspiration, etc.
"""
import json
import os
import math
from typing import Optional, List, Dict, Any, Tuple

# Load class resources data
_resources_data = None
_resources_by_id = None
_abilities_by_id = None
_abilities_by_resource = None


def _load_resources(force_reload: bool = False) -> Dict[str, Any]:
    """Load resources from JSON file (lazy loading with optional force reload)"""
    global _resources_data, _resources_by_id, _abilities_by_id, _abilities_by_resource

    if _resources_data is None or force_reload:
        from app.utils.rules_cache import get_class_resources_data
        _resources_data = get_class_resources_data()

        # Build indexes
        _resources_by_id = {r['id']: r for r in _resources_data['classResources']}
        _abilities_by_id = {a['id']: a for a in _resources_data['resourceAbilities']}

        _abilities_by_resource = {}
        for ability in _resources_data['resourceAbilities']:
            resource_id = ability['resourceId']
            if resource_id not in _abilities_by_resource:
                _abilities_by_resource[resource_id] = []
            _abilities_by_resource[resource_id].append(ability)

    return _resources_data


def reload_resources() -> None:
    """Force reload resources from JSON file (clears cache)"""
    _load_resources(force_reload=True)


def get_resource_definition(resource_id: str) -> Optional[Dict[str, Any]]:
    """Get resource definition by ID. Auto-reloads if not found (in case JSON was updated)."""
    _load_resources()
    result = _resources_by_id.get(resource_id)

    # If not found, try reloading the JSON file (in case it was updated after server start)
    if result is None:
        _load_resources(force_reload=True)
        result = _resources_by_id.get(resource_id)

    return result


def resolve_resource_state_id(resource_id: str) -> str:
    """Resolve which persisted state bucket a resource should consume from."""
    resource = get_resource_definition(resource_id)
    if resource and resource.get('shareResource'):
        return resource['shareResource']
    return resource_id


def get_ability_definition(ability_id: str) -> Optional[Dict[str, Any]]:
    """Get ability definition by ID"""
    _load_resources()
    return _abilities_by_id.get(ability_id)


def get_resource_abilities(resource_id: str) -> List[Dict[str, Any]]:
    """Get all abilities associated with a resource"""
    _load_resources()
    return _abilities_by_resource.get(resource_id, [])


def get_all_resources() -> List[Dict[str, Any]]:
    """Get all resource definitions"""
    data = _load_resources()
    return data['classResources']


def get_modifier(score: int) -> int:
    """Calculate ability modifier from score"""
    return (score - 10) // 2


def get_scaled_value(scaling: Optional[Dict[str, Any]], level: int) -> Any:
    """Get value from level scaling dict"""
    if not scaling:
        return None

    result = None
    for lvl_str, value in scaling.items():
        lvl = int(lvl_str)
        if level >= lvl:
            result = value

    return result


def calculate_resource_max(
    resource: Dict[str, Any],
    level: int,
    charisma: int = 10,
    wisdom: int = 10,
    intelligence: int = 10
) -> int:
    """
    Calculate the maximum value for a resource.

    Args:
        resource: Resource definition
        level: Character level
        charisma: Charisma score
        wisdom: Wisdom score
        intelligence: Intelligence score

    Returns:
        Maximum resource value
    """
    min_level = resource.get('minLevel', 1)
    if level < min_level:
        return 0

    formula = resource.get('maxFormula', 'fixed')
    min_max = resource.get('minMax', 1)

    if formula == 'level':
        return level

    elif formula == 'half_level_rounded_up':
        return math.ceil(level / 2)

    elif formula == 'cha_mod':
        return max(min_max, get_modifier(charisma))

    elif formula == 'cha_mod_plus_1':
        return max(min_max, 1 + get_modifier(charisma))

    elif formula == 'wis_mod':
        return max(min_max, get_modifier(wisdom))

    elif formula == 'int_mod':
        return max(min_max, get_modifier(intelligence))

    elif formula == 'level_times_5':
        return level * 5

    elif formula == 'wizard_level_times_2_plus_int':
        return level * 2 + get_modifier(intelligence)

    elif formula == 'fixed':
        scaling = resource.get('maxScaling', {})
        value = get_scaled_value(scaling, level)
        if value is None:
            return 0
        if value == -1:  # Unlimited
            return 999
        return value

    elif formula in ('passive', 'uses_ki', 'uses_wild_shape', 'spell_slots'):
        return 0

    return 0


def get_current_dice_type(resource: Dict[str, Any], level: int) -> Optional[str]:
    """Get current dice type for a resource based on level"""
    base_dice = resource.get('diceType')
    if not base_dice:
        return None

    dice_scaling = resource.get('diceScaling')
    if dice_scaling:
        scaled = get_scaled_value(dice_scaling, level)
        if scaled:
            return scaled

    return base_dice


def get_current_recharge_type(resource: Dict[str, Any], level: int) -> Optional[str]:
    """Get current recharge type for a resource based on level"""
    upgrade = resource.get('rechargeUpgrade')
    if upgrade and level >= upgrade.get('level', 999):
        return upgrade.get('recharge')
    return resource.get('recharge')


def get_character_resources(
    class_id: str,
    subclass_id: Optional[str],
    level: int,
    character_invocations: Optional[List[str]] = None,
    character_feats: Optional[List[str]] = None
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Get all resources and abilities available to a character.

    Args:
        class_id: Character's class ID
        subclass_id: Character's subclass ID (optional)
        level: Character level
        character_invocations: List of invocation IDs the character has selected (optional)
        character_feats: List of feat IDs the character has selected (optional)

    Returns:
        Dict with 'resources' and 'abilities' lists
    """
    _load_resources()
    resources = []
    abilities = []

    for resource in _resources_data['classResources']:
        # Feat-based resources: match by featId
        feat_id = resource.get('featId')
        if feat_id:
            if not character_feats or feat_id not in character_feats:
                continue
        else:
            # Class-based resources: match by classId
            if resource.get('classId') != class_id:
                continue

            # Check subclass match
            resource_subclass = resource.get('subclassId')
            if resource_subclass and resource_subclass != subclass_id:
                continue

        # Check level requirement
        if level < resource.get('minLevel', 1):
            continue

        # Skip passive resources
        if resource.get('maxFormula') == 'passive':
            continue

        # Check invocation requirement
        required_inv = resource.get('requiresInvocation')
        if required_inv:
            if not character_invocations or required_inv not in character_invocations:
                continue

        # Shared resources should still contribute abilities, but they should not
        # appear as standalone resource pools in the UI.
        if not resource.get('shareResource'):
            resources.append(resource)

        # Add associated abilities
        resource_abilities = get_resource_abilities(resource['id'])
        for ability in resource_abilities:
            min_level = ability.get('minLevel', 1)
            ability_subclass = ability.get('subclassId')
            if ability_subclass and ability_subclass != subclass_id:
                continue
            if level >= min_level:
                abilities.append(ability)

    return {'resources': resources, 'abilities': abilities}


def calculate_ability_cost(ability: Dict[str, Any], spell_level: int = 1) -> int:
    """Calculate the cost of using an ability"""
    cost = ability.get('cost')
    if cost == 'spell_level':
        min_cost = ability.get('minCost', 1)
        return max(min_cost, spell_level)
    return cost if isinstance(cost, int) else 1


def check_can_use_ability(
    ability_id: str,
    level: int,
    resource_states: Dict[str, int]
) -> Tuple[bool, Optional[str]]:
    """
    Check if an ability can be used.

    Args:
        ability_id: Ability ID
        level: Character level
        resource_states: Dict mapping resource_id to current value

    Returns:
        (can_use, reason) tuple
    """
    ability = get_ability_definition(ability_id)
    if not ability:
        return False, "能力不存在"

    # Check level requirement
    min_level = ability.get('minLevel')
    if min_level and level < min_level:
        return False, f"需要等级 {min_level}"

    # Get resource
    resource_id = ability.get('resourceId')
    resource = get_resource_definition(resource_id)

    # Find actual resource if shared
    actual_resource_id = resource_id
    if resource and resource.get('shareResource'):
        actual_resource_id = resource['shareResource']

    # Check current value
    current = resource_states.get(actual_resource_id, 0)
    cost = calculate_ability_cost(ability)

    if current < cost:
        resource_def = get_resource_definition(actual_resource_id)
        resource_name = resource_def.get('name', '资源') if resource_def else '资源'
        return False, f"{resource_name}不足 ({current}/{cost})"

    return True, None


def process_short_rest(
    class_id: str,
    subclass_id: Optional[str],
    level: int,
    current_states: Dict[str, int],
    charisma: int = 10,
    wisdom: int = 10,
    intelligence: int = 10,
    character_invocations: Optional[List[str]] = None,
    character_feats: Optional[List[str]] = None
) -> Dict[str, int]:
    """
    Process a short rest, restoring appropriate resources.

    Returns:
        Updated resource states
    """
    char_resources = get_character_resources(class_id, subclass_id, level, character_invocations, character_feats)
    new_states = current_states.copy()

    for resource in char_resources['resources']:
        resource_id = resource['id']
        recharge_type = get_current_recharge_type(resource, level)

        if recharge_type == 'short_rest':
            max_value = calculate_resource_max(
                resource, level, charisma, wisdom, intelligence
            )
            new_states[resource_id] = max_value

    return new_states


def process_long_rest(
    class_id: str,
    subclass_id: Optional[str],
    level: int,
    charisma: int = 10,
    wisdom: int = 10,
    intelligence: int = 10,
    character_invocations: Optional[List[str]] = None,
    character_feats: Optional[List[str]] = None
) -> Dict[str, int]:
    """
    Process a long rest, restoring all resources.

    Returns:
        Updated resource states (all at max)
    """
    char_resources = get_character_resources(class_id, subclass_id, level, character_invocations, character_feats)
    new_states = {}

    for resource in char_resources['resources']:
        resource_id = resource['id']
        max_value = calculate_resource_max(
            resource, level, charisma, wisdom, intelligence
        )
        new_states[resource_id] = max_value

    return new_states


# ============ Integration with Effect System ============

def get_resource_for_effect(effect_id: str) -> Optional[Dict[str, Any]]:
    """
    Get the resource associated with an effect.

    Maps effects like 'rage' to their resource definition.
    """
    _load_resources()

    # Direct mapping: effect ID often matches resource ID
    if effect_id in _resources_by_id:
        return _resources_by_id[effect_id]

    # Check abilities field
    for resource in _resources_data['classResources']:
        abilities = resource.get('abilities', [])
        if effect_id in abilities:
            return resource

    return None


def use_resource_for_effect(
    effect_id: str,
    resource_states: Dict[str, int]
) -> Tuple[bool, Dict[str, int], Optional[str]]:
    """
    Use a resource when activating an effect.

    Args:
        effect_id: Effect ID (e.g., 'rage')
        resource_states: Current resource states

    Returns:
        (success, new_states, error_message)
    """
    resource = get_resource_for_effect(effect_id)
    if not resource:
        # No resource required for this effect
        return True, resource_states, None

    resource_id = resource['id']
    current = resource_states.get(resource_id, 0)

    if current <= 0:
        return False, resource_states, f"{resource.get('name', '资源')}已用完"

    new_states = resource_states.copy()
    new_states[resource_id] = current - 1

    return True, new_states, None
