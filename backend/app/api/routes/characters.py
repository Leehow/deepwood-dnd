# DM AI Character Generator with progress broadcast
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from sqlalchemy.orm.attributes import flag_modified
from typing import List, Optional, Dict, Any
from pathlib import Path
import json
import re
import random
from datetime import datetime

from pydantic import BaseModel

logger = logging.getLogger(__name__)

from app.db.session import get_db
from app.models.token import Token
from app.services.websocket_manager import manager
from app.services.realtime_publisher import realtime_publisher
from app.services import class_resource_service
from app.services.character_command_service import (
    build_character_level_event_data,
    collect_changed_feature_uses,
    build_dm_condition_effects,
    build_resource_use_broadcast_data,
    collect_character_campaign_ids,
    merge_dm_status_effects,
    prepare_character_create_payload,
    prepare_partial_character_update,
)
from app.services.character_progression_service import (
    apply_character_rest,
    apply_level_up_class_choice,
    build_level_history_snapshot,
    calculate_max_hp as calculate_max_hp_service,
    calculate_short_rest_heal,
    ensure_multiclass_data,
    extract_progression_ids,
    get_class_hit_die as get_class_hit_die_service,
    restore_class_resources_for_rest,
    restore_pact_slots_on_short_rest as restore_pact_slots_on_short_rest_service,
)
from app.services.character_action_service import (
    restore_character_resource as restore_character_resource_service,
    set_character_resource as set_character_resource_service,
    update_character_feature_uses as update_character_feature_uses_service,
)
from app.services.character_equipment_selection_service import (
    expand_equipment_pack,
    get_equipment_category_items,
    get_equipment_packs,
    resolve_equipment_item,
)
from app.services.runtime_schema_service import normalize_character_class_feature_uses
from app.models.character import Character
from app.models.item import Item
from app.models.user_avatar import UserAvatar
from app.schemas.character_sheet import (
    CharacterCreate,
    CharacterResponse,
    CharacterListItem,
    CharacterLevelUpBroadcast,
    TokenLocationInfo
)
from app.schemas.character import GenerateCharacterFromDescriptionRequest, DMGenerateHighLevelCharacterRequest
from app.services.ai_service import AIService
from app.services.character_generator import CharacterGenerator
from app.services.character_sheet_service import character_sheet_service
from app.utils.races import load_races_data, get_race_age_range
from app.utils.classes import load_classes_data, get_class_by_name, get_primary_abilities
from app.utils.backgrounds import load_backgrounds_data
from app.utils.rules_cache import (
    get_spells_data,
    get_all_spells,
    get_equipment_data,
    get_spell_by_id,
    spell_has_illumination_type,
)
from app.utils.avatar_urls import is_temporary_avatar_url, materialize_avatar_url
from app.utils.item_payload_normalizer import normalize_character_equipment_payloads
from fastapi import UploadFile, File
from app.core.security import require_auth

router = APIRouter(prefix="/characters", tags=["Characters"])


# Helper function to get class hit die
def get_class_hit_die(class_id: str) -> int:
    return get_class_hit_die_service(class_id)


def calculate_max_hp(character: Character) -> int:
    return calculate_max_hp_service(character)


# Spellcaster configuration for AI character generation
SPELLCASTER_CONFIG = {
    # Full casters: get cantrips and spells at level 1
    "wizard": {"type": "full", "cantrips": 3, "spells_known": 6, "ability": "intelligence"},
    "cleric": {"type": "full", "cantrips": 3, "spells_known": 0, "prepared": True, "ability": "wisdom"},
    "druid": {"type": "full", "cantrips": 2, "spells_known": 0, "prepared": True, "ability": "wisdom"},
    "sorcerer": {"type": "full", "cantrips": 4, "spells_known": 2, "ability": "charisma"},
    "bard": {"type": "full", "cantrips": 2, "spells_known": 4, "ability": "charisma"},
    "warlock": {"type": "pact", "cantrips": 2, "spells_known": 2, "ability": "charisma"},
    # Half casters: don't get spells until level 2
    "paladin": {"type": "half", "cantrips": 0, "spells_known": 0, "prepared": True, "ability": "charisma", "start_level": 2},
    "ranger": {"type": "half", "cantrips": 0, "spells_known": 2, "ability": "wisdom", "start_level": 2},
}


def get_starting_spells(class_id: str, spells_data: dict) -> tuple:
    """
    Get starting cantrips and spells for a spellcaster class at level 1.
    Returns (cantrips_list, spells_list)
    """
    config = SPELLCASTER_CONFIG.get(class_id)
    if not config:
        return [], []

    # Half casters don't get spells at level 1
    if config.get("start_level", 1) > 1:
        return [], []

    all_spells = spells_data.get("spells", [])

    # Get cantrips (level 0) for this class
    class_cantrips = [
        s["id"] for s in all_spells
        if s.get("level") == 0 and class_id in s.get("classes", [])
    ]

    # Get 1st level spells for this class
    class_level1_spells = [
        s["id"] for s in all_spells
        if s.get("level") == 1 and class_id in s.get("classes", [])
    ]

    # Select cantrips (first N from available)
    selected_cantrips = class_cantrips[:config["cantrips"]]

    # Select spells (first N from available, for non-prepared casters)
    spells_needed = config.get("spells_known", 0)
    selected_spells = class_level1_spells[:spells_needed] if spells_needed > 0 else []

    return selected_cantrips, selected_spells


async def _normalize_character_equipment_payloads_in_db(
    character: Character,
    db: AsyncSession,
) -> bool:
    normalized_equipment, currency_extracted, changed = normalize_character_equipment_payloads(character.equipment or [])

    currency_changed = False
    if any(currency_extracted.values()):
        currency = dict(character.currency or {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0})
        for coin_type, amount in currency_extracted.items():
            if amount:
                currency[coin_type] = int(currency.get(coin_type) or 0) + int(amount)
                currency_changed = True
        if currency_changed:
            character.currency = currency
            flag_modified(character, "currency")

    if changed:
        character.equipment = normalized_equipment
        flag_modified(character, "equipment")

    if changed or currency_changed:
        await db.commit()
        await db.refresh(character)
        return True
    return False

# Helper functions for spell level tracking
def normalize_spell_list(spells, default_level=1, default_source="migration"):
    """
    Convert spell list to new format with level tracking.

    Input: ["spell_1", "spell_2"] or [{"id": "spell_1", "level_learned": 1, ...}]
    Output: [{"id": "spell_1", "level_learned": 1, "source": "wizard"}]
    """
    if not spells:
        return []

    normalized = []
    for spell in spells:
        if isinstance(spell, str):
            # Old format: convert to new format
            normalized.append({
                "id": spell,
                "level_learned": default_level,
                "source": default_source
            })
        elif isinstance(spell, dict):
            # New format: ensure all fields exist
            normalized.append({
                "id": spell.get("id"),
                "level_learned": spell.get("level_learned", default_level),
                "source": spell.get("source", default_source)
            })

    return normalized


def extract_spell_ids(spells):
    """
    Extract spell IDs from spell list (works with both formats).

    Input: ["spell_1"] or [{"id": "spell_1", ...}]
    Output: ["spell_1"]
    """
    if not spells:
        return []

    ids = []
    for spell in spells:
        if isinstance(spell, str):
            ids.append(spell)
        elif isinstance(spell, dict):
            ids.append(spell.get("id"))

    return ids


def filter_spells_by_level(spells, max_level):
    """
    Filter spells to only include those learned at or below max_level.

    Input: [{"id": "spell_1", "level_learned": 1}, {"id": "spell_2", "level_learned": 3}]
    Output (max_level=1): [{"id": "spell_1", "level_learned": 1}]
    """
    if not spells:
        return []

    # First normalize to ensure proper format
    normalized = normalize_spell_list(spells)

    return [
        spell for spell in normalized
        if spell.get("level_learned", 1) <= max_level
    ]


def get_initial_spell_slots(class_id: str, level: int = 1, multiclass_data: Optional[Dict] = None, subclass_id: Optional[str] = None):
    """
    Get initial spell slots for a class at a given level.
    Supports multiclass if multiclass_data is provided.

    Returns dict: {
        "slots": [0, slots_1st, slots_2nd, ..., slots_9th],  # Standard spell slots
        "pact_slots": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]  # Warlock pact slots (if any)
    }
    For backward compatibility, if single class non-warlock, returns just the array.
    Returns None if not a spellcaster.
    """
    # Caster type mapping
    CASTER_TYPES = {
        "wizard": "full",
        "cleric": "full",
        "druid": "full",
        "sorcerer": "full",
        "bard": "full",
        "artificer": "half",  # Artificer rounds UP for spell slots
        "paladin": "half",
        "ranger": "half",
        "warlock": "pact",
        # Third casters (subclass-based, not standalone classes)
        "eldritch_knight": "third",
        "arcane_trickster": "third",
    }

    # Full caster spell slots by level (PHB p.201)
    # Format: [0, 1st, 2nd, 3rd, 4th, 5th, 6th, 7th, 8th, 9th]
    FULL_CASTER_SLOTS = {
        1:  [0, 2, 0, 0, 0, 0, 0, 0, 0, 0],
        2:  [0, 3, 0, 0, 0, 0, 0, 0, 0, 0],
        3:  [0, 4, 2, 0, 0, 0, 0, 0, 0, 0],
        4:  [0, 4, 3, 0, 0, 0, 0, 0, 0, 0],
        5:  [0, 4, 3, 2, 0, 0, 0, 0, 0, 0],
        6:  [0, 4, 3, 3, 0, 0, 0, 0, 0, 0],
        7:  [0, 4, 3, 3, 1, 0, 0, 0, 0, 0],
        8:  [0, 4, 3, 3, 2, 0, 0, 0, 0, 0],
        9:  [0, 4, 3, 3, 3, 1, 0, 0, 0, 0],
        10: [0, 4, 3, 3, 3, 2, 0, 0, 0, 0],
        11: [0, 4, 3, 3, 3, 2, 1, 0, 0, 0],
        12: [0, 4, 3, 3, 3, 2, 1, 0, 0, 0],
        13: [0, 4, 3, 3, 3, 2, 1, 1, 0, 0],
        14: [0, 4, 3, 3, 3, 2, 1, 1, 0, 0],
        15: [0, 4, 3, 3, 3, 2, 1, 1, 1, 0],
        16: [0, 4, 3, 3, 3, 2, 1, 1, 1, 0],
        17: [0, 4, 3, 3, 3, 2, 1, 1, 1, 1],
        18: [0, 4, 3, 3, 3, 3, 1, 1, 1, 1],
        19: [0, 4, 3, 3, 3, 3, 2, 1, 1, 1],
        20: [0, 4, 3, 3, 3, 3, 2, 2, 1, 1],
    }

    # Half caster spell slots (Paladin/Ranger start at level 2)
    HALF_CASTER_SLOTS = {
        1:  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        2:  [0, 2, 0, 0, 0, 0, 0, 0, 0, 0],
        3:  [0, 3, 0, 0, 0, 0, 0, 0, 0, 0],
        4:  [0, 3, 0, 0, 0, 0, 0, 0, 0, 0],
        5:  [0, 4, 2, 0, 0, 0, 0, 0, 0, 0],
        6:  [0, 4, 2, 0, 0, 0, 0, 0, 0, 0],
        7:  [0, 4, 3, 0, 0, 0, 0, 0, 0, 0],
        8:  [0, 4, 3, 0, 0, 0, 0, 0, 0, 0],
        9:  [0, 4, 3, 2, 0, 0, 0, 0, 0, 0],
        10: [0, 4, 3, 2, 0, 0, 0, 0, 0, 0],
        11: [0, 4, 3, 3, 0, 0, 0, 0, 0, 0],
        12: [0, 4, 3, 3, 0, 0, 0, 0, 0, 0],
        13: [0, 4, 3, 3, 1, 0, 0, 0, 0, 0],
        14: [0, 4, 3, 3, 1, 0, 0, 0, 0, 0],
        15: [0, 4, 3, 3, 2, 0, 0, 0, 0, 0],
        16: [0, 4, 3, 3, 2, 0, 0, 0, 0, 0],
        17: [0, 4, 3, 3, 3, 1, 0, 0, 0, 0],
        18: [0, 4, 3, 3, 3, 1, 0, 0, 0, 0],
        19: [0, 4, 3, 3, 3, 2, 0, 0, 0, 0],
        20: [0, 4, 3, 3, 3, 2, 0, 0, 0, 0],
    }

    # Warlock pact magic slots (separate from normal slots)
    # Stored as: pact_level (which slot level), pact_slots (how many)
    WARLOCK_PACT = {
        1:  (1, 1), 2:  (1, 2), 3:  (2, 2), 4:  (2, 2),
        5:  (3, 2), 6:  (3, 2), 7:  (4, 2), 8:  (4, 2),
        9:  (5, 2), 10: (5, 2), 11: (5, 3), 12: (5, 3),
        13: (5, 3), 14: (5, 3), 15: (5, 3), 16: (5, 3),
        17: (5, 4), 18: (5, 4), 19: (5, 4), 20: (5, 4),
    }

    # Third caster spell slots (Eldritch Knight / Arcane Trickster)
    THIRD_CASTER_SLOTS = {
        1:  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        2:  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        3:  [0, 2, 0, 0, 0, 0, 0, 0, 0, 0],
        4:  [0, 3, 0, 0, 0, 0, 0, 0, 0, 0],
        5:  [0, 3, 0, 0, 0, 0, 0, 0, 0, 0],
        6:  [0, 3, 0, 0, 0, 0, 0, 0, 0, 0],
        7:  [0, 4, 2, 0, 0, 0, 0, 0, 0, 0],
        8:  [0, 4, 2, 0, 0, 0, 0, 0, 0, 0],
        9:  [0, 4, 2, 0, 0, 0, 0, 0, 0, 0],
        10: [0, 4, 3, 0, 0, 0, 0, 0, 0, 0],
        11: [0, 4, 3, 0, 0, 0, 0, 0, 0, 0],
        12: [0, 4, 3, 0, 0, 0, 0, 0, 0, 0],
        13: [0, 4, 3, 2, 0, 0, 0, 0, 0, 0],
        14: [0, 4, 3, 2, 0, 0, 0, 0, 0, 0],
        15: [0, 4, 3, 2, 0, 0, 0, 0, 0, 0],
        16: [0, 4, 3, 3, 0, 0, 0, 0, 0, 0],
        17: [0, 4, 3, 3, 0, 0, 0, 0, 0, 0],
        18: [0, 4, 3, 3, 0, 0, 0, 0, 0, 0],
        19: [0, 4, 3, 3, 1, 0, 0, 0, 0, 0],
        20: [0, 4, 3, 3, 1, 0, 0, 0, 0, 0],
    }

    # Check if truly multiclass (more than one class)
    classes = []
    if multiclass_data and multiclass_data.get("classes"):
        classes = multiclass_data["classes"]

    # Resolve effective caster type: check subclass for fighter/rogue
    effective_caster_type = CASTER_TYPES.get(class_id)
    if not effective_caster_type and subclass_id:
        effective_caster_type = CASTER_TYPES.get(subclass_id)

    # Single class path: use class-specific spell slot table
    # (includes characters with multiclass_data containing only one class)
    if len(classes) <= 1:
        if not effective_caster_type:
            return None
        level = max(1, min(20, level))
        if effective_caster_type == "full":
            return FULL_CASTER_SLOTS[level]
        elif effective_caster_type == "half":
            return HALF_CASTER_SLOTS[level]
        elif effective_caster_type == "third":
            return THIRD_CASTER_SLOTS[level]
        elif effective_caster_type == "pact":
            # Warlock returns pact slots in the same array format for simplicity
            pact_level, pact_count = WARLOCK_PACT[level]
            slots = [0] * 10
            slots[pact_level] = pact_count
            return slots
        return None

    # === Multiclass calculation ===
    caster_level = 0
    warlock_level = 0
    has_spellcasting = False

    for cls in classes:
        cls_id = cls.get("class_id")
        cls_level = cls.get("level", 0)
        caster_type = CASTER_TYPES.get(cls_id)

        if not caster_type:
            continue

        has_spellcasting = True

        if caster_type == "full":
            caster_level += cls_level
        elif caster_type == "half":
            # Half casters: level / 2, round down
            # But Artificer rounds UP
            if cls_id == "artificer":
                caster_level += (cls_level + 1) // 2
            else:
                caster_level += cls_level // 2
        elif caster_type == "third":
            caster_level += cls_level // 3
        elif caster_type == "pact":
            warlock_level = cls_level  # Warlock pact magic is separate

    if not has_spellcasting:
        return None

    # Calculate standard spell slots from caster level
    caster_level = max(0, min(20, caster_level))
    if caster_level > 0:
        slots = FULL_CASTER_SLOTS[caster_level].copy()
    else:
        slots = [0] * 10

    # Calculate warlock pact slots
    pact_slots = [0] * 10
    if warlock_level > 0:
        pact_level, pact_count = WARLOCK_PACT[warlock_level]
        pact_slots[pact_level] = pact_count

    # If no warlock, return simple format for backward compatibility
    if warlock_level == 0:
        return slots

    # With warlock, return dict format
    return {
        "slots": slots,
        "pact_slots": pact_slots,
        "pact_level": WARLOCK_PACT[warlock_level][0],
        "pact_count": WARLOCK_PACT[warlock_level][1]
    }


# ========== Helper: Auto-pick fighting style for AI-generated Fighters ==========
_FIGHTING_STYLES = ["archery", "defense", "dueling", "great_weapon_fighting", "two_weapon_fighting", "protection"]

def _pick_ai_fighting_style(class_id: str) -> Optional[Dict[str, Any]]:
    """Pick a random fighting style for AI-generated Fighter characters."""
    import random
    if class_id != "fighter":
        return None
    return {
        "value": random.choice(_FIGHTING_STYLES),
        "level_acquired": 1,
        "source": "fighter"
    }


# ========== Helper Functions for Generic Level Tracking ==========
def normalize_selection_list(
    selections: Optional[Any],
    default_level: int = 1,
    default_source: str = "migration"
) -> List[Dict[str, Any]]:
    """Convert old format (strings) to new format (objects with level tracking)"""
    if not selections:
        return []

    # Handle if it's already a list
    if not isinstance(selections, list):
        selections = [selections]

    normalized = []
    for item in selections:
        if isinstance(item, str):
            # Old format: convert to new format
            normalized.append({
                "value": item,
                "level_acquired": default_level,
                "source": default_source
            })
        elif isinstance(item, dict) and 'level_acquired' in item:
            # Already in new format
            normalized.append(item)
        elif isinstance(item, dict) and 'value' in item:
            # Partial new format, add missing fields
            normalized.append({
                "value": item.get("value"),
                "level_acquired": item.get("level_acquired", default_level),
                "source": item.get("source", default_source),
                "source_detail": item.get("source_detail")
            })
        else:
            # Fallback for any other format
            normalized.append({
                "value": str(item),
                "level_acquired": default_level,
                "source": default_source
            })

    return normalized

def normalize_single_selection(
    selection: Optional[Any],
    default_level: int = 1,
    default_source: str = "migration"
) -> Optional[Dict[str, Any]]:
    """Convert old format (string) to new format (object with level tracking)"""
    if not selection:
        return None

    if isinstance(selection, str):
        # Old format
        return {
            "value": selection,
            "level_acquired": default_level,
            "source": default_source
        }
    elif isinstance(selection, dict) and 'level_acquired' in selection:
        # Already in new format
        return selection
    elif isinstance(selection, dict) and 'value' in selection:
        # Partial new format
        return {
            "value": selection.get("value"),
            "level_acquired": selection.get("level_acquired", default_level),
            "source": selection.get("source", default_source),
            "source_detail": selection.get("source_detail")
        }
    else:
        # Fallback
        return {
            "value": str(selection),
            "level_acquired": default_level,
            "source": default_source
        }

def extract_values(selections: Optional[Any]) -> List[str]:
    """Extract values from either format"""
    if not selections:
        return []

    if not isinstance(selections, list):
        selections = [selections]

    values = []
    for item in selections:
        if isinstance(item, str):
            values.append(item)
        elif isinstance(item, dict):
            values.append(item.get('value', str(item)))
        else:
            values.append(str(item))

    return values

def extract_single_value(selection: Optional[Any]) -> Optional[str]:
    """Extract value from either format"""
    if not selection:
        return None

    if isinstance(selection, str):
        return selection
    elif isinstance(selection, dict):
        return selection.get('value')
    else:
        return str(selection)

def filter_selections_by_level(
    selections: Optional[Any],
    max_level: int
) -> List[Dict[str, Any]]:
    """Filter selections to only include those acquired at or before the specified level"""
    normalized = normalize_selection_list(selections)
    return [s for s in normalized if s.get('level_acquired', 1) <= max_level]

def filter_single_selection_by_level(
    selection: Optional[Any],
    max_level: int
) -> Optional[Dict[str, Any]]:
    """Filter single selection by level"""
    normalized = normalize_single_selection(selection)
    if normalized and normalized.get('level_acquired', 1) <= max_level:
        return normalized
    return None

    # Spell slots by level (simplified - should load from spellcasting.json)
    if caster_type == "full":
        slots_by_level = {
            1: [0, 2, 0, 0, 0, 0, 0, 0, 0, 0],
            2: [0, 3, 0, 0, 0, 0, 0, 0, 0, 0],
            3: [0, 4, 2, 0, 0, 0, 0, 0, 0, 0],
            4: [0, 4, 3, 0, 0, 0, 0, 0, 0, 0],
            5: [0, 4, 3, 2, 0, 0, 0, 0, 0, 0],
        }
    elif caster_type == "half":
        slots_by_level = {
            1: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            2: [0, 2, 0, 0, 0, 0, 0, 0, 0, 0],
            3: [0, 3, 0, 0, 0, 0, 0, 0, 0, 0],
            4: [0, 3, 0, 0, 0, 0, 0, 0, 0, 0],
            5: [0, 4, 2, 0, 0, 0, 0, 0, 0, 0],
        }
    else:  # warlock (pact magic)
        slots_by_level = {
            1: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
            2: [0, 2, 0, 0, 0, 0, 0, 0, 0, 0],
            3: [0, 0, 2, 0, 0, 0, 0, 0, 0, 0],  # Warlock spell slots upgrade
            4: [0, 0, 2, 0, 0, 0, 0, 0, 0, 0],
            5: [0, 0, 0, 2, 0, 0, 0, 0, 0, 0],
        }

    return slots_by_level.get(level, [0] * 10)


@router.post("/import-card")
async def import_character_card(
    file: UploadFile = File(...),
    current_user: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Upload a character card file and parse it into character data using LLM."""
    from app.services.character_import_service import CharacterImportService, ALLOWED_EXTENSIONS, MAX_FILE_SIZE

    ext = Path(file.filename).suffix.lower() if file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"不支持的文件格式: {ext}，支持: {', '.join(ALLOWED_EXTENSIONS)}")

    file_bytes = await file.read()
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(400, f"文件过大，最大支持 {MAX_FILE_SIZE // (1024*1024)}MB")

    try:
        markdown = await CharacterImportService.convert_to_markdown(file_bytes, file.filename)
    except Exception as e:
        logger.error(f"File conversion failed: {e}")
        raise HTTPException(400, f"文件转换失败: {str(e)}")

    try:
        parsed = await CharacterImportService.parse_character(markdown, db)
    except Exception as e:
        logger.error(f"Character parsing failed: {e}")
        raise HTTPException(500, f"角色解析失败: {str(e)}")

    return {"parsed_character": parsed, "markdown_preview": markdown[:2000]}


@router.post("", response_model=CharacterResponse, status_code=status.HTTP_201_CREATED)
async def create_character(
    character_data: CharacterCreate,
    db: AsyncSession = Depends(get_db)
):
    """Create a new character"""
    import asyncio
    from app.core.config import settings

    # Convert Pydantic model to dict
    char_dict = character_data.model_dump(by_alias=False)

    # Convert nested models to JSON
    char_dict['appearance'] = character_data.appearance.model_dump()
    char_dict['personality'] = character_data.personality.model_dump()
    char_dict['ability_scores'] = character_data.ability_scores.model_dump()

    if character_data.subclass_choices:
        char_dict['subclass_choices'] = character_data.subclass_choices.model_dump()
    if character_data.race_choices:
        char_dict['race_choices'] = character_data.race_choices.model_dump()

    # Initialize spell slots for spellcasting classes
    initial_slots = get_initial_spell_slots(char_dict.get('class_id'), char_dict.get('level', 1), subclass_id=char_dict.get('subclass_id'))
    if initial_slots:
        char_dict['spell_slots_state'] = initial_slots

    # Extract currency from pouch_with_Xgp equipment items (background starting gold)
    equipment = char_dict.get('equipment') or []
    if equipment:
        currency = {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}
        cleaned_equipment = []
        for item in equipment:
            item_id = item.get('id', '') if isinstance(item, dict) else str(item)
            match = re.search(r'_with_(\d+)(cp|sp|ep|gp|pp)$', item_id.lower())
            if match:
                amount = int(match.group(1))
                curr_type = match.group(2)
                qty = (item.get('quantity', 1) if isinstance(item, dict) else 1)
                currency[curr_type] += amount * qty
                # Replace with plain pouch
                cleaned_equipment.append({
                    **(item if isinstance(item, dict) else {"id": item_id}),
                    "id": "pouch",
                    "name": "钱袋",
                })
            else:
                cleaned_equipment.append(item)
        char_dict['equipment'] = cleaned_equipment
        if any(v > 0 for v in currency.values()):
            char_dict['currency'] = currency

    char_dict = prepare_character_create_payload(char_dict)

    # Create character
    character = Character(**char_dict)
    db.add(character)

    # If character was created with an avatar, save to avatar library
    avatar_val = char_dict.get('avatar')
    user_id_val = char_dict.get('user_id')
    if avatar_val and user_id_val:
        existing = await db.execute(
            select(UserAvatar).where(
                UserAvatar.user_id == user_id_val,
                UserAvatar.avatar_url == avatar_val
            )
        )
        if not existing.scalar_one_or_none():
            db.add(UserAvatar(
                user_id=user_id_val,
                avatar_url=avatar_val,
                avatar_url_large=char_dict.get('avatar_large'),
            ))

    await db.commit()
    await db.refresh(character)

    # Spawn async background task for post-creation processing
    # (equipment normalization + avatar generation)
    campaign_id = character_data.campaign_id if hasattr(character_data, 'campaign_id') else None
    try:
        from app.services.character_post_creation_service import process_character_post_creation
        asyncio.create_task(
            process_character_post_creation(
                character_id=character.id,
                campaign_id=campaign_id,
                db_url=str(settings.DATABASE_URL)
            )
        )
    except Exception as e:
        # Don't fail character creation if background task fails to start
        logger.warning(f"[CreateCharacter] Failed to start post-creation task: {e}")

    return character


@router.get("", response_model=List[CharacterListItem])
async def list_characters(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Get all characters for a user with token locations"""
    from app.models.campaign import Campaign
    user_id = str(current_user["user_id"])

    # Get characters
    result = await db.execute(
        select(Character)
        .where(Character.user_id == user_id)
        .order_by(Character.created_at.desc())
    )
    characters = result.scalars().all()

    if not characters:
        return []

    # Get token locations for all characters in one query
    character_ids = [c.id for c in characters]
    tokens_result = await db.execute(
        select(Token, Campaign)
        .join(Campaign, Token.campaign_id == Campaign.id)
        .where(Token.character_id.in_(character_ids))
    )
    token_rows = tokens_result.all()

    # Group token locations by character_id
    locations_by_char: Dict[int, List[TokenLocationInfo]] = {}
    for token, campaign in token_rows:
        if token.character_id not in locations_by_char:
            locations_by_char[token.character_id] = []
        locations_by_char[token.character_id].append(TokenLocationInfo(
            campaign_id=campaign.id,
            campaign_name=campaign.name,
            map_url=token.map_url or ""
        ))

    # Build response with token locations
    response = []
    for char in characters:
        response.append(CharacterListItem(
            id=char.id,
            name=char.name,
            race_id=char.race_id,
            subrace_id=char.subrace_id,
            class_id=char.class_id,
            subclass_id=char.subclass_id,
            level=char.level,
            avatar=char.avatar,
            ability_scores=char.ability_scores or {},
            token_locations=locations_by_char.get(char.id, []),
            created_at=char.created_at
        ))

    return response

@router.post("/generate-from-description", response_model=CharacterResponse, status_code=status.HTTP_201_CREATED)
async def generate_from_description(
    request: GenerateCharacterFromDescriptionRequest,
    db: AsyncSession = Depends(get_db)
):
    """One-click AI character creation from free-form description.

    1) Use Fast Language Model to classify the description into race/class/background IDs
    2) Generate full description (name/age/gender/appearance/personality)
    3) Fill sensible defaults for ability scores, skills, equipment
    4) Persist and return the created character
    """
    # Helper to broadcast progress
    async def broadcast_progress(stage: int, stage_name: str, detail: str = ""):
        if request.campaign_id:
            await realtime_publisher.publish_generation_progress(
                request.campaign_id,
                event_type="ai_generate_progress",
                stage=stage,
                total_stages=6,
                stage_name=stage_name,
                detail=detail,
            )

    # Stage 1: Loading config
    await broadcast_progress(1, "分析描述", "正在加载AI配置和规则数据...")

    # Get Fast model config via usage config
    from app.services.ai_model_service import ai_model_service
    usage_params = await ai_model_service.get_usage_params(db, "character_ai_generation")
    config = usage_params.config
    char_temperature = usage_params.temperature
    char_max_tokens = usage_params.max_tokens

    # Load rules data
    races_data = load_races_data()
    classes_data = load_classes_data()
    bgs_data = load_backgrounds_data()

    races_opts = [
        {
            "id": r.get("id"),
            "name": r.get("name"),
            "nameEn": r.get("nameEn"),
            "subraces": [sr.get("id") for sr in r.get("subraces", [])],
        }
        for r in races_data.get("races", [])
    ]
    classes_opts = [
        {"id": c.get("id"), "name": c.get("name"), "nameEn": c.get("nameEn")}
        for c in classes_data.get("classes", [])
    ]
    bgs_opts = [
        {"id": b.get("id"), "name": b.get("name"), "nameEn": b.get("nameEn")}
        for b in bgs_data.get("backgrounds", [])
    ]

    # Ask AI to select IDs from options
    await broadcast_progress(1, "分析描述", "AI正在分析描述，选择种族、职业和背景...")
    select_prompt = f"""你是一名D&D 5E 角色构建助手。根据用户的自由描述，从提供的选项中选择最合适的种族、亚种（可选）、职业和背景，并给出阵营。

用户描述：
{request.description}

可选项（只允许从这些ID中选择，若描述未提及请自行合理决定）：
races: {json.dumps(races_opts, ensure_ascii=False)}
classes: {json.dumps(classes_opts, ensure_ascii=False)}
backgrounds: {json.dumps(bgs_opts, ensure_ascii=False)}

请严格返回JSON（不要markdown、不要解释），结构如下：
{{
  "raceId": "races中的id",
  "subraceId": "可为空或省略",
  "classId": "classes中的id",
  "backgroundId": "可为空或省略",
  "alignment": "守序善良/中立善良/混乱善良/守序中立/绝对中立/混乱中立/守序邪恶/中立邪恶/混乱邪恶"
}}"""

    selection_raw = await AIService.generate_completion(
        api_url=config.api_url,
        api_key=config.api_key,
        model=config.model_name,
        messages=[{"role": "user", "content": select_prompt}],
        temperature=char_temperature,
        max_tokens=char_max_tokens,
    )

    def extract_json(content: str) -> Dict[str, Any]:
        m = re.search(r"```json\s*([\s\S]*?)\s*```", content) or re.search(r"```\s*([\s\S]*?)\s*```", content)
        js = m.group(1) if m else content
        js = js.strip()
        try:
            return json.loads(js)
        except Exception:
            # best-effort fallback: find braces
            start = js.find("{")
            end = js.rfind("}")
            if start != -1 and end != -1:
                return json.loads(js[start : end + 1])
            raise

    try:
        sel = extract_json(selection_raw)
    except Exception:
        sel = {}

    race_id: str = sel.get("raceId") or "human"
    class_id: str = sel.get("classId") or "fighter"
    subrace_id: Optional[str] = sel.get("subraceId")
    background_id: Optional[str] = sel.get("backgroundId")
    alignment_hint: Optional[str] = sel.get("alignment")

    # Validate IDs against datasets
    if not any(r.get("id") == race_id for r in races_data.get("races", [])):
        race_id = "human"
    if not any(c.get("id") == class_id for c in classes_data.get("classes", [])):
        class_id = "fighter"
    if background_id and not any(b.get("id") == background_id for b in bgs_data.get("backgrounds", [])):
        background_id = None
    if subrace_id and not any(
        sr.get("id") == subrace_id
        for r in races_data.get("races", [])
        if r.get("id") == race_id
        for sr in r.get("subraces", [])
    ):
        subrace_id = None

    # Map IDs to Chinese names for better generation quality
    race_obj = next((r for r in races_data.get("races", []) if r.get("id") == race_id), None)
    class_obj = next((c for c in classes_data.get("classes", []) if c.get("id") == class_id), None)
    bg_obj = next((b for b in bgs_data.get("backgrounds", []) if b.get("id") == background_id), None) if background_id else None

    race_name_cn = (race_obj or {}).get("name", race_id)
    subrace_name_cn = None
    if subrace_id:
        for sr in (race_obj or {}).get("subraces", []):
            if sr.get("id") == subrace_id:
                subrace_name_cn = sr.get("name", subrace_id)
                break
    class_name_cn = (class_obj or {}).get("name", class_id)
    bg_name_cn = (bg_obj or {}).get("name") if bg_obj else None

    # Generate full description (name/age/gender/appearance/personality)
    await broadcast_progress(2, "生成形象", f"正在生成{race_name_cn}{class_name_cn}的姓名、外貌和性格...")
    age_range = get_race_age_range(race_id)
    full_desc = await CharacterGenerator.generate_full_description(
        api_url=config.api_url,
        api_key=config.api_key,
        model=config.model_name,
        race=race_name_cn,
        subrace=subrace_name_cn,
        character_class=class_name_cn,
        background=bg_name_cn,
        age_range=age_range,
    )

    # Build ability scores with sensible defaults based on class primary ability
    await broadcast_progress(3, "分配属性", "正在分配属性值和选择技能...")
    def build_ability_scores(cid: str) -> Dict[str, int]:
        scores = {"strength": 10, "dexterity": 10, "constitution": 10, "intelligence": 10, "wisdom": 10, "charisma": 10}
        prim = get_primary_abilities(cid)
        if prim:
            scores[prim[0]] = 15
        # Constitution is important for everyone
        scores["constitution"] = 14
        # If there is a second primary, give it 13
        if len(prim) > 1 and prim[1] in scores:
            scores[prim[1]] = max(scores[prim[1]], 13)
        else:
            # Otherwise favor dexterity as secondary if not main
            if (not prim) or (prim and prim[0] != "dexterity"):
                scores["dexterity"] = max(scores["dexterity"], 13)
        return scores

    ability_scores = build_ability_scores(class_id)

    # Pick class skills: first N from skillsAvailable
    selected_skills: List[str] = []
    try:
        prof = (class_obj or {}).get("proficiencies", {})
        avail: List[str] = prof.get("skillsAvailable", [])
        need: int = int(prof.get("skillChoices", 0))
        selected_skills = avail[:need] if need > 0 else []
    except Exception:
        selected_skills = []

    # Build starting equipment from class and background
    await broadcast_progress(4, "准备装备", "正在准备起始装备...")
    starting_equipment: List[Dict[str, Any]] = []
    starting_currency: Dict[str, int] = {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}

    def parse_currency_item(item_id: str) -> Optional[Dict[str, int]]:
        """Parse currency items like pouch_with_15gp, return currency dict or None"""
        import re
        # Match patterns like: pouch_with_15gp, pouch_with_10gp, belt_pouch_with_5gp
        match = re.search(r'_with_(\d+)(cp|sp|ep|gp|pp)$', item_id.lower())
        if match:
            amount = int(match.group(1))
            currency_type = match.group(2)
            return {currency_type: amount}
        return None

    try:
        # Load equipment data for category resolution
        equipment_data = get_equipment_data()
        category_map = get_equipment_category_items(equipment_data)
        packs_data = get_equipment_packs(equipment_data)

        def add_equipment_item(item_id: str, quantity: int, source: str):
            """Helper to add equipment item, expanding packs if needed"""
            nonlocal starting_currency
            resolved_id = resolve_equipment_item(item_id, category_map)

            # Check if this is a currency item (like pouch_with_15gp)
            currency = parse_currency_item(resolved_id)
            if currency:
                for curr_type, amount in currency.items():
                    starting_currency[curr_type] = starting_currency.get(curr_type, 0) + (amount * quantity)
                logger.info(f"[Character Gen] Converted '{resolved_id}' to currency: {currency}")
                # Add an empty pouch to equipment instead
                starting_equipment.append({
                    "id": "pouch",
                    "quantity": quantity,
                    "equipped": False,
                    "source": source
                })
                return

            # Check if this is an equipment pack that should be expanded
            expanded = expand_equipment_pack(resolved_id, packs_data, source)
            if expanded:
                # Add all items from the expanded pack
                for pack_item in expanded:
                    starting_equipment.append(pack_item)
                logger.info(f"[Character Gen] Expanded pack '{resolved_id}' into {len(expanded)} items")
            else:
                # Add as regular item
                starting_equipment.append({
                    "id": resolved_id,
                    "quantity": quantity,
                    "equipped": False,
                    "source": source
                })

        # 1. Get background equipment
        if bg_obj:
            bg_equipment = bg_obj.get("equipment", [])
            for item in bg_equipment:
                # Parse item format: "item_id" or "item_id:quantity"
                if ":" in str(item):
                    item_id, qty = str(item).rsplit(":", 1)
                    quantity = int(qty) if qty.isdigit() else 1
                else:
                    item_id = str(item)
                    quantity = 1
                add_equipment_item(item_id, quantity, "background")

        # 2. Get class starting equipment
        if class_obj:
            class_equip = class_obj.get("startingEquipment", {})

            # Add fixed equipment
            for item in class_equip.get("fixed", []):
                if ":" in str(item):
                    item_id, qty = str(item).rsplit(":", 1)
                    quantity = int(qty) if qty.isdigit() else 1
                else:
                    item_id = str(item)
                    quantity = 1
                add_equipment_item(item_id, quantity, "class")

            # For choices, pick the first option from each choice group
            for choice in class_equip.get("choices", []):
                options = choice.get("from", [])
                if options and len(options) > 0:
                    # Pick first option (could be a list of items)
                    first_option = options[0]
                    if isinstance(first_option, list):
                        for item in first_option:
                            if ":" in str(item):
                                item_id, qty = str(item).rsplit(":", 1)
                                quantity = int(qty) if qty.isdigit() else 1
                            else:
                                item_id = str(item)
                                quantity = 1
                            add_equipment_item(item_id, quantity, "class")
                    elif isinstance(first_option, str):
                        add_equipment_item(first_option, 1, "class")
    except Exception as e:
        logger.warning(f"[Character Gen] Failed to build starting equipment: {e}")
        starting_equipment = []

    # Get starting spells for spellcaster classes using AI selection
    await broadcast_progress(5, "选择法术", "正在为施法者选择起始法术...")
    starting_cantrips: List[str] = []
    starting_spells: List[str] = []
    try:
        spell_config = SPELLCASTER_CONFIG.get(class_id)
        if spell_config and spell_config.get("start_level", 1) <= 1:
            spells_data = get_spells_data()
            all_spells = spells_data.get("spells", [])

            # Get available cantrips and spells for this class
            available_cantrips = [
                {"id": s["id"], "name_cn": s.get("name", ""),
                 "school": s.get("school", ""), "description_cn": s.get("description", "")}
                for s in all_spells
                if s.get("level") == 0 and class_id in s.get("classes", [])
            ]
            available_level1_spells = [
                {"id": s["id"], "name_cn": s.get("name", ""),
                 "school": s.get("school", ""), "description_cn": s.get("description", "")}
                for s in all_spells
                if s.get("level") == 1 and class_id in s.get("classes", [])
            ]

            num_cantrips = spell_config.get("cantrips", 0)
            num_spells = spell_config.get("spells_known", 0)

            # Build personality dict for AI
            personality_for_ai = {
                "traits": full_desc.get("traits", []),
                "ideals": full_desc.get("ideals", ""),
                "bonds": full_desc.get("bonds", ""),
                "flaws": full_desc.get("flaws", ""),
                "backstory": full_desc.get("backstory", "")
            }

            # Use AI to select spells based on character personality
            if (num_cantrips > 0 or num_spells > 0) and (available_cantrips or available_level1_spells):
                logger.info(f"[Character Gen] Using AI to select spells for {class_id}...")
                spell_selection = await CharacterGenerator.generate_spells_for_character(
                    api_url=config.api_url,
                    api_key=config.api_key,
                    model=config.model_name,
                    class_id=class_id,
                    race=race_name_cn,
                    background=bg_name_cn,
                    personality=personality_for_ai,
                    available_cantrips=available_cantrips,
                    available_spells=available_level1_spells,
                    num_cantrips=num_cantrips,
                    num_spells=num_spells
                )
                starting_cantrips = spell_selection.get("cantrips", [])
                starting_spells = spell_selection.get("spells", [])
                logger.info(f"[Character Gen] AI selected {len(starting_cantrips)} cantrips: {starting_cantrips}")
                logger.info(f"[Character Gen] AI selected {len(starting_spells)} spells: {starting_spells}")
    except Exception as e:
        logger.warning(f"[Character Gen] Failed to get starting spells: {e}")
        # Fallback to simple selection
        try:
            spells_data = get_spells_data()
            starting_cantrips, starting_spells = get_starting_spells(class_id, spells_data)
        except Exception:
            pass

    # Create and save Character
    await broadcast_progress(6, "保存角色", "正在保存角色数据...")
    character = Character(
        user_id=request.user_id,
        name=str(full_desc.get("name", "无名")),
        race_id=race_id,
        subrace_id=subrace_id,
        class_id=class_id,
        subclass_id=None,
        background_id=background_id,
        level=1,
        age=int(full_desc.get("age") or age_range[0]),
        gender=str(full_desc.get("gender", "")) or None,
        alignment=str(full_desc.get("alignment") or alignment_hint or "绝对中立"),
        deity_id=None,
        avatar=None,
        appearance={
            "height": str(full_desc.get("height", "")),
            "weight": str(full_desc.get("weight", "")),
            "eyes": full_desc.get("eyes", ""),
            "skin": full_desc.get("skin", ""),
            "hair": full_desc.get("hair", ""),
            "distinguishingMarks": full_desc.get("distinguishingMarks", ""),
        },
        personality={
            "traits": full_desc.get("traits", []),
            "ideals": full_desc.get("ideals", ""),
            "bonds": full_desc.get("bonds", ""),
            "flaws": full_desc.get("flaws", ""),
        },
        other_traits=full_desc.get("otherTraits"),
        backstory=full_desc.get("backstory"),
        ability_scores=ability_scores,
        selected_skills=selected_skills,
        expertise_skills=[],
        fighting_style=_pick_ai_fighting_style(class_id) if class_id == "fighter" else None,
        favored_enemy=None,
        favored_terrain=None,
        eldritch_invocations=[],
        selected_cantrips=starting_cantrips,
        selected_spells=starting_spells,
        prepared_spells=[],
        equipment=starting_equipment,
        currency=starting_currency,
        subclass_choices=None,
        race_choices=None,
    )

    db.add(character)
    await db.commit()
    await db.refresh(character)
    return character


@router.post("/dm-generate-high-level", response_model=CharacterResponse, status_code=status.HTTP_201_CREATED)
async def dm_generate_high_level_character(
    request: DMGenerateHighLevelCharacterRequest,
    db: AsyncSession = Depends(get_db)
):
    """DM-only: Generate a rule-compliant high-level character using multi-stage AI generation.

    Stages:
    1) Basic Selection: race/class/background/alignment
    2) Skill Selection: validated against class + background rules
    3) Subclass Selection: for level 3+ or level 1 (cleric/sorcerer/warlock)
    4) Class Features: fighting style, favored enemy, etc.
    5) Spell Selection: cantrips + spells for spellcasters
    6) Equipment: starting equipment from class + background
    """
    from app.services.dm_character_generator import DMCharacterGenerator
    from app.services.ai_model_service import ai_model_service
    from app.utils.skills import load_skills_data

    # Helper to broadcast progress
    async def broadcast_progress(stage: int, stage_name: str, detail: str = ""):
        if request.campaign_id:
            await realtime_publisher.publish_generation_progress(
                request.campaign_id,
                event_type="dm_generate_progress",
                stage=stage,
                total_stages=6,
                stage_name=stage_name,
                detail=detail,
            )

    # Validate target level
    target_level = max(1, min(20, request.target_level))
    logger.info(f"[DM Gen] Starting multi-stage generation for level {target_level} character")

    # Get AI model config
    usage_params = await ai_model_service.get_usage_params(db, "dm_character_generate")
    config = usage_params.config
    temperature = usage_params.temperature
    max_tokens = usage_params.max_tokens

    # Load rules data
    races_data = load_races_data()
    classes_data = load_classes_data()
    bgs_data = load_backgrounds_data()
    skills_data = load_skills_data()

    # Load spells data
    spells_data = get_spells_data()

    # ========== STAGE 1: Basic Selection ==========
    await broadcast_progress(1, "基础选择", "正在选择种族、职业、背景...")
    logger.info("[DM Gen] Stage 1: Basic selection (race/class/background)")
    try:
        basics = await DMCharacterGenerator.generate_stage1_basics(
            description=request.description,
            target_level=target_level,
            races_data=races_data,
            classes_data=classes_data,
            backgrounds_data=bgs_data,
            config=config,
            temperature=temperature,
            max_tokens=max_tokens
        )
    except Exception as e:
        logger.info(f"[DM Gen] Stage 1 failed: {e}")
        basics = {}

    race_id = basics.get("raceId") or "human"
    class_id = basics.get("classId") or "fighter"
    subrace_id = basics.get("subraceId")
    background_id = basics.get("backgroundId")
    alignment = basics.get("alignment") or "绝对中立"

    # Validate IDs
    if not any(r.get("id") == race_id for r in races_data.get("races", [])):
        race_id = "human"
    if not any(c.get("id") == class_id for c in classes_data.get("classes", [])):
        class_id = "fighter"
    if background_id and not any(b.get("id") == background_id for b in bgs_data.get("backgrounds", [])):
        background_id = None
    if subrace_id:
        race_obj = next((r for r in races_data.get("races", []) if r.get("id") == race_id), None)
        if not race_obj or not any(sr.get("id") == subrace_id for sr in race_obj.get("subraces", [])):
            subrace_id = None

    logger.info(f"[DM Gen] Stage 1 result: race={race_id}, class={class_id}, bg={background_id}")

    # Get objects for later use
    race_obj = next((r for r in races_data.get("races", []) if r.get("id") == race_id), None)
    class_obj = next((c for c in classes_data.get("classes", []) if c.get("id") == class_id), None)
    bg_obj = next((b for b in bgs_data.get("backgrounds", []) if b.get("id") == background_id), None) if background_id else None

    # ========== STAGE 2: Skill Selection ==========
    await broadcast_progress(2, "技能选择", f"正在为{class_id}选择技能...")
    logger.info("[DM Gen] Stage 2: Skill selection")
    try:
        selected_skills = await DMCharacterGenerator.generate_stage2_skills(
            description=request.description,
            class_id=class_id,
            background_id=background_id or "",
            class_obj=class_obj or {},
            bg_obj=bg_obj or {},
            skills_data=skills_data,
            config=config,
            temperature=temperature,
            max_tokens=max_tokens
        )
    except Exception as e:
        logger.info(f"[DM Gen] Stage 2 failed: {e}")
        # Fallback: use class defaults
        prof = (class_obj or {}).get("proficiencies", {})
        selected_skills = prof.get("skillsAvailable", [])[:prof.get("skillChoices", 2)]
    logger.info(f"[DM Gen] Stage 2 result: skills={selected_skills}")

    # ========== STAGE 3: Subclass Selection ==========
    await broadcast_progress(3, "子职业选择", "正在选择子职业...")
    logger.info("[DM Gen] Stage 3: Subclass selection")
    try:
        subclass_id = await DMCharacterGenerator.generate_stage3_subclass(
            description=request.description,
            class_id=class_id,
            target_level=target_level,
            class_obj=class_obj or {},
            config=config,
            temperature=temperature,
            max_tokens=max_tokens
        )
    except Exception as e:
        logger.info(f"[DM Gen] Stage 3 failed: {e}")
        subclass_id = None
    logger.info(f"[DM Gen] Stage 3 result: subclass={subclass_id}")

    # ========== STAGE 4: Class Features ==========
    await broadcast_progress(4, "职业特性", "正在选择职业特性...")
    logger.info("[DM Gen] Stage 4: Class features")
    try:
        features = await DMCharacterGenerator.generate_stage4_features(
            description=request.description,
            class_id=class_id,
            subclass_id=subclass_id,
            target_level=target_level,
            selected_skills=selected_skills,
            config=config,
            temperature=temperature,
            max_tokens=max_tokens
        )
    except Exception as e:
        logger.info(f"[DM Gen] Stage 4 failed: {e}")
        features = {}
    logger.info(f"[DM Gen] Stage 4 result: features={features}")

    # ========== STAGE 5: Spell Selection ==========
    await broadcast_progress(5, "法术选择", "正在选择法术...")
    logger.info("[DM Gen] Stage 5: Spell selection")
    try:
        spell_selection = await DMCharacterGenerator.generate_stage5_spells(
            description=request.description,
            class_id=class_id,
            subclass_id=subclass_id,
            target_level=target_level,
            class_obj=class_obj or {},
            spells_data=spells_data,
            config=config,
            temperature=temperature,
            max_tokens=max_tokens
        )
    except Exception as e:
        logger.info(f"[DM Gen] Stage 5 failed: {e}")
        spell_selection = {"cantrips": [], "spells": []}
    logger.info(f"[DM Gen] Stage 5 result: cantrips={len(spell_selection['cantrips'])}, spells={len(spell_selection['spells'])}")

    # ========== STAGE 6: Equipment ==========
    await broadcast_progress(6, "装备", "正在分配起始装备...")
    logger.info("[DM Gen] Stage 6: Equipment")
    try:
        equipment = DMCharacterGenerator.get_starting_equipment(class_id, class_obj or {}, bg_obj)
    except Exception as e:
        logger.info(f"[DM Gen] Stage 6 failed: {e}")
        equipment = []
    logger.info(f"[DM Gen] Stage 6 result: {len(equipment)} items")

    # ========== Generate Character Description ==========
    race_name_cn = (race_obj or {}).get("name", race_id)
    subrace_name_cn = None
    if subrace_id and race_obj:
        for sr in race_obj.get("subraces", []):
            if sr.get("id") == subrace_id:
                subrace_name_cn = sr.get("name", subrace_id)
                break
    class_name_cn = (class_obj or {}).get("name", class_id)
    bg_name_cn = (bg_obj or {}).get("name") if bg_obj else None

    age_range = get_race_age_range(race_id)
    full_desc = await CharacterGenerator.generate_full_description(
        api_url=config.api_url,
        api_key=config.api_key,
        model=config.model_name,
        race=race_name_cn,
        subrace=subrace_name_cn,
        character_class=class_name_cn,
        background=bg_name_cn,
        age_range=age_range,
    )

    # ========== Build Ability Scores with ASI ==========
    def build_high_level_ability_scores(cid: str, level: int) -> Dict[str, int]:
        scores = {"strength": 10, "dexterity": 10, "constitution": 14, "intelligence": 10, "wisdom": 10, "charisma": 10}
        prim = get_primary_abilities(cid)
        if prim:
            scores[prim[0]] = 16
        if len(prim) > 1 and prim[1] in scores:
            scores[prim[1]] = 14
        elif (not prim) or (prim and prim[0] != "dexterity"):
            scores["dexterity"] = 13

        asi_levels = [4, 8, 12, 16, 19]
        asi_count = sum(1 for l in asi_levels if l <= level)
        if prim and asi_count > 0:
            for _ in range(asi_count):
                if scores[prim[0]] < 20:
                    scores[prim[0]] = min(20, scores[prim[0]] + 2)
                elif len(prim) > 1 and scores[prim[1]] < 20:
                    scores[prim[1]] = min(20, scores[prim[1]] + 2)
                else:
                    scores["constitution"] = min(20, scores["constitution"] + 2)
        return scores

    ability_scores = build_high_level_ability_scores(class_id, target_level)

    # ========== Calculate HP ==========
    hit_die = get_class_hit_die(class_id)
    con_mod = (ability_scores.get("constitution", 10) - 10) // 2
    max_hp = hit_die + con_mod
    if target_level > 1:
        avg_roll = (hit_die // 2) + 1
        max_hp += (avg_roll + con_mod) * (target_level - 1)
    max_hp = max(max_hp, target_level)

    # ========== Build Multiclass Data ==========
    multiclass_data = {
        "classes": [{
            "class_id": class_id,
            "level": target_level,
            "subclass_id": subclass_id
        }],
        "level_history": []
    }

    # ========== Create Character ==========
    # Calculate max HP before creating character
    hit_die = get_class_hit_die(class_id)
    con_modifier = (ability_scores.get("constitution", 10) - 10) // 2
    # Level 1: full hit die + CON modifier
    # Subsequent levels: average + CON modifier
    max_hp = hit_die + con_modifier
    if target_level > 1:
        avg_roll = (hit_die // 2) + 1
        max_hp += (avg_roll + con_modifier) * (target_level - 1)
    max_hp = max(max_hp, target_level)  # At least equal to level

    character = Character(
        user_id=request.user_id,
        name=str(full_desc.get("name", "无名")),
        race_id=race_id,
        subrace_id=subrace_id,
        class_id=class_id,
        subclass_id=subclass_id,
        background_id=background_id,
        level=target_level,
        age=int(full_desc.get("age") or age_range[0]),
        gender=str(full_desc.get("gender", "")) or None,
        alignment=str(full_desc.get("alignment") or alignment),
        deity_id=None,
        avatar=None,
        appearance={
            "height": str(full_desc.get("height", "")),
            "weight": str(full_desc.get("weight", "")),
            "eyes": full_desc.get("eyes", ""),
            "skin": full_desc.get("skin", ""),
            "hair": full_desc.get("hair", ""),
            "distinguishingMarks": full_desc.get("distinguishingMarks", ""),
        },
        personality={
            "traits": full_desc.get("traits", []),
            "ideals": full_desc.get("ideals", ""),
            "bonds": full_desc.get("bonds", ""),
            "flaws": full_desc.get("flaws", ""),
        },
        other_traits=full_desc.get("otherTraits"),
        backstory=full_desc.get("backstory"),
        ability_scores=ability_scores,
        selected_skills=selected_skills,
        expertise_skills=features.get("expertise_skills", []),
        fighting_style=features.get("fighting_style"),
        favored_enemy=features.get("favored_enemy"),
        favored_terrain=features.get("favored_terrain"),
        eldritch_invocations=features.get("eldritch_invocations", []),
        maneuvers_known=features.get("maneuvers_known", []),
        selected_cantrips=spell_selection["cantrips"],
        selected_spells=spell_selection["spells"],
        prepared_spells=spell_selection["spells"][:5] if spell_selection["spells"] else [],
        equipment=equipment,
        currency={"cp": 0, "sp": 0, "ep": 0, "gp": target_level * 50, "pp": 0},
        current_hp=max_hp,  # Set initial HP to max HP
        subclass_choices={"elementalDisciplines": features["elemental_disciplines"]} if features.get("elemental_disciplines") else None,
        race_choices=None,
        multiclass_data=multiclass_data,
    )

    db.add(character)
    await db.commit()
    await db.refresh(character)

    # Spawn async background task for post-creation processing
    # (equipment normalization + avatar generation)
    try:
        from app.services.character_post_creation_service import process_character_post_creation
        asyncio.create_task(
            process_character_post_creation(
                character_id=character.id,
                campaign_id=request.campaign_id,
                db_url=str(settings.DATABASE_URL)
            )
        )
        logger.info(f"[DM Gen] Started post-creation task (avatar generation)")
    except Exception as e:
        logger.warning(f"[DM Gen] Failed to start post-creation task: {e}")

    logger.info(f"[DM Gen] ✅ Created character: {character.name}")
    logger.info(f"[DM Gen]    Level {target_level} {class_name_cn} ({class_id})")
    logger.info(f"[DM Gen]    Subclass: {subclass_id}")
    logger.info(f"[DM Gen]    Skills: {selected_skills}")
    logger.info(f"[DM Gen]    Cantrips: {spell_selection['cantrips']}")
    logger.info(f"[DM Gen]    Spells: {len(spell_selection['spells'])} spells")
    logger.info(f"[DM Gen]    Equipment: {len(equipment)} items")
    logger.info(f"[DM Gen]    Features: {features}")

    # Broadcast character creation notification to campaign
    if request.campaign_id:
        await realtime_publisher.publish_character_created(
            request.campaign_id,
            character_id=character.id,
            character_name=character.name,
            user_id=request.user_id,
            level=target_level,
            class_id=class_id,
        )
        logger.info(f"[DM Gen]    Broadcasted character_created to campaign {request.campaign_id}")

    return character


# ─── Avatar Library ────────────────────────────────────────────────

@router.get("/avatar-library")
async def get_avatar_library(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Get user's avatar library (all previously uploaded/generated avatars)"""
    user_id = str(current_user["user_id"])
    result = await db.execute(
        select(UserAvatar)
        .where(UserAvatar.user_id == user_id)
        .order_by(UserAvatar.created_at.desc())
    )
    avatars = result.scalars().all()
    return [
        {
            "id": a.id,
            "avatar_url": a.avatar_url,
            "avatar_url_large": a.avatar_url_large,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        }
        for a in avatars
    ]


@router.delete("/avatar-library/{avatar_id}")
async def delete_avatar_from_library(avatar_id: int, db: AsyncSession = Depends(get_db)):
    """Delete avatar from user's library and from OSS"""
    result = await db.execute(select(UserAvatar).where(UserAvatar.id == avatar_id))
    avatar = result.scalar_one_or_none()
    if not avatar:
        raise HTTPException(status_code=404, detail="Avatar not found")

    # Delete from OSS
    try:
        from app.domain.parsing.oss_storage import OSSStorage
        oss = OSSStorage()
        for url in [avatar.avatar_url, avatar.avatar_url_large]:
            if url:
                key = oss.url_to_key(url)
                if key:
                    await oss.delete_object_async(key)
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"OSS删除失败(继续删除DB记录): {e}")

    await db.delete(avatar)
    await db.commit()
    return {"ok": True}


async def _repair_character_equipment_avatars(character: Character, db: AsyncSession) -> bool:
    equipment = character.equipment or []
    if not isinstance(equipment, list):
        return False

    changed = False
    library_changed = False

    async def find_backing_custom_item(entry: Dict[str, Any], item_name: str) -> Optional[Item]:
        library_item_id = entry.get("libraryItemId")
        try:
            parsed_id = int(str(library_item_id)) if library_item_id is not None else None
        except (TypeError, ValueError):
            parsed_id = None

        if parsed_id is not None:
            item_result = await db.execute(select(Item).where(Item.id == parsed_id))
            item_record = item_result.scalar_one_or_none()
            if item_record and item_record.is_custom:
                return item_record

        if not item_name:
            return None

        item_result = await db.execute(
            select(Item)
            .where(Item.is_custom.is_(True))
            .where(or_(Item.name == item_name, Item.name_cn == item_name))
            .order_by(Item.id.desc())
            .limit(1)
        )
        return item_result.scalar_one_or_none()

    for entry in equipment:
        if not isinstance(entry, dict):
            continue
        avatar_url = entry.get("avatar_url")
        if not avatar_url or not is_temporary_avatar_url(avatar_url):
            continue

        repaired = None
        item_name = str(entry.get("name") or entry.get("name_cn") or "")
        item_record = await find_backing_custom_item(entry, item_name)
        if item_record:
            entry["libraryItemId"] = item_record.id
            if item_record.avatar_url and not is_temporary_avatar_url(item_record.avatar_url):
                repaired = (
                    item_record.avatar_url,
                    item_record.avatar_url_large or item_record.avatar_url,
                )
            else:
                repaired = await materialize_avatar_url(
                    item_record.avatar_url,
                    "item",
                    item_record.id,
                    item_record.name or item_name,
                )
                if repaired:
                    item_record.avatar_url, item_record.avatar_url_large = repaired
                    item_record.has_avatar = True
                    library_changed = True

        if not repaired and item_name:
            try:
                from app.services.avatar_service import avatar_service

                entity_id = item_record.id if item_record else 0
                small_url, large_url = await avatar_service.generate_avatar(
                    db=db,
                    entity_type="item",
                    entity_id=entity_id,
                    name=item_name,
                    description=str(entry.get("description") or ""),
                    category=str(entry.get("category") or ""),
                )
                if is_temporary_avatar_url(small_url):
                    repaired = await materialize_avatar_url(small_url, "item", entity_id, item_name)
                if not repaired:
                    repaired = (small_url, large_url)
            except Exception as exc:
                logger.warning("Failed to repair equipment avatar for character %s item %s: %s", character.id, item_name, exc)
                continue

        if repaired:
            entry["avatar_url"], entry["avatar_url_large"] = repaired
            if item_record:
                entry["libraryItemId"] = item_record.id
            changed = True

    if changed:
        character.equipment = equipment
        flag_modified(character, "equipment")
    if changed or library_changed:
        await db.commit()
        await db.refresh(character)
    return changed or library_changed


@router.get("/{character_id}", response_model=CharacterResponse)
async def get_character(
    character_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Get a specific character by ID"""
    result = await db.execute(
        select(Character).where(Character.id == character_id)
    )
    character = result.scalar_one_or_none()

    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Character not found"
        )

    await _normalize_character_equipment_payloads_in_db(character, db)
    await _repair_character_equipment_avatars(character, db)

    return character


@router.get("/{character_id}/sheet")
async def get_character_sheet(
    character_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    Get character sheet with computed features, actions, and spells

    Returns:
        {
            "character": { ... character data with computed AC, HP, etc ... },
            "features": [ ... race and class features ... ],
            "actions": [ ... weapon attacks and class actions ... ]
        }
    """
    result = await db.execute(
        select(Character).where(Character.id == character_id)
    )
    character = result.scalar_one_or_none()

    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Character not found"
        )

    await _normalize_character_equipment_payloads_in_db(character, db)
    await _repair_character_equipment_avatars(character, db)

    # Compute character sheet using service
    sheet = character_sheet_service.get_character_sheet(character)

    return sheet


class TokenLocationItem(BaseModel):
    """Single token location info"""
    campaign_id: int
    campaign_name: str
    map_url: str
    token_id: int


class TokenLocationsResponse(BaseModel):
    """Response for all character token locations"""
    locations: List[TokenLocationItem]


@router.get("/{character_id}/token-locations", response_model=TokenLocationsResponse)
async def get_character_token_locations(
    character_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    Get all token locations for a character across all campaigns and maps.
    Returns campaign name, map URL, and token ID for each location.
    """
    from app.models.campaign import Campaign

    # Query all tokens for this character with campaign info
    result = await db.execute(
        select(Token, Campaign)
        .join(Campaign, Token.campaign_id == Campaign.id)
        .where(Token.character_id == character_id)
    )
    rows = result.all()

    locations = []
    for token, campaign in rows:
        locations.append(TokenLocationItem(
            campaign_id=campaign.id,
            campaign_name=campaign.name,
            map_url=token.map_url,
            token_id=token.id
        ))

    return TokenLocationsResponse(locations=locations)


@router.put("/{character_id}", response_model=CharacterResponse)
async def update_character(
    character_id: int,
    character_data: CharacterCreate,
    db: AsyncSession = Depends(get_db)
):
    """Update an existing character"""
    result = await db.execute(
        select(Character).where(Character.id == character_id)
    )
    character = result.scalar_one_or_none()

    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Character not found"
        )

    # Update character fields
    char_dict = character_data.model_dump(by_alias=False)
    char_dict['appearance'] = character_data.appearance.model_dump()
    char_dict['personality'] = character_data.personality.model_dump()
    char_dict['ability_scores'] = character_data.ability_scores.model_dump()

    if character_data.subclass_choices:
        char_dict['subclass_choices'] = character_data.subclass_choices.model_dump()
    if character_data.race_choices:
        char_dict['race_choices'] = character_data.race_choices.model_dump()

    for key, value in char_dict.items():
        setattr(character, key, value)

    await db.commit()
    await db.refresh(character)

    # Broadcast updates to all campaigns where this character has tokens
    try:
        token_results = await db.execute(
            select(Token).where(Token.character_id == character.id)
        )
        tokens = token_results.scalars().all()

        if tokens:
            # Sync HP to tokens and broadcast
            if character.current_hp is not None:
                for token in tokens:
                    token.current_hp = character.current_hp
                await db.commit()

                for token in tokens:
                    await realtime_publisher.publish_token_hp_updated(
                        token.campaign_id,
                        token_id=token.id,
                        current_hp=character.current_hp,
                        max_hp=character.max_hp,
                        character_id=character.id,
                    )

            # Broadcast spell slots
            if getattr(character, "spell_slots_state", None) is not None:
                campaign_ids = collect_character_campaign_ids(tokens)
                for campaign_id in campaign_ids:
                    await realtime_publisher.publish_spell_slots_updated(
                        campaign_id,
                        character_id=int(character.id),
                        spell_slots_state=character.spell_slots_state,
                        event_type="spell_slots_update",
                    )
    except Exception:
        # WebSocket broadcast failures should not prevent character updates
        pass

    return character



class AvatarUpdateRequest(BaseModel):
    avatar: str


class CharacterPartialUpdate(BaseModel):
    """Schema for partial character updates (e.g., equipment only)"""
    equipment: Optional[List[Dict[str, Any]]] = None
    selected_cantrips: Optional[List[Any]] = None
    selected_spells: Optional[List[Any]] = None
    prepared_spells: Optional[List[str]] = None
    can_prepare_spells: Optional[bool] = None  # Whether prepared casters can change prepared list
    currency: Optional[Dict[str, int]] = None  # {cp, sp, ep, gp, pp}
    spell_slots_state: Optional[List[int]] = None
    quick_spells: Optional[List[Optional[str]]] = None  # [spellId|null, spellId|null, spellId|null, spellId|null]
    level: Optional[int] = None
    experience_points: Optional[int] = None
    current_hp: Optional[int] = None
    multiclass_data: Optional[Dict[str, Any]] = None  # {classes: [...], level_history: [...]}
    class_feature_uses: Optional[Dict[str, Any]] = None  # {feature_id: {current: N, max: M}, ...}
    status_effects: Optional[Dict[str, Any]] = None  # {custom_effects: [...], active_conditions: [...], exhaustion_level: N}
    hotbar: Optional[List[Optional[Dict[str, Any]]]] = None  # Hotbar slots for quick actions
    broadcast_campaign_id: Optional[str] = None  # Frontend passes campaign_id for WebSocket broadcast
    # Add other fields as needed for partial updates


class LevelUpRequest(BaseModel):
    """Schema for character level up request"""
    class_choice: str
    feature_choices: Optional[Dict[str, Any]] = None  # {subclass: "school_of_evocation", spells: [...], expertise: [...], etc.}
    campaign_id: Optional[int] = None  # If provided, create companion MonsterInstance + Token


def _fighting_style_offered_at(class_id: str, subclass_id: Optional[str], class_level: int) -> bool:
    """Whether the class (at this class level) actually grants a fighting-style choice.

    Reliable signals in classes-progression.json: a top-level type=="choice" node with
    id "fighting_style" (fighter L1, paladin/ranger L2), OR a selected-subclass feature at
    that level whose id contains "fighting_style" (e.g. Champion's L10 additional_fighting_style).
    Used to ignore a fighting_style choice submitted at a level that doesn't offer one.
    """
    from app.utils.rules_cache import get_classes_progression_data
    cls = (get_classes_progression_data().get("classes") or {}).get(class_id) or {}
    prog = cls.get("levelProgression") or {}
    for node in (prog.get(str(class_level)) or {}).get("features") or []:
        if node.get("type") == "choice" and node.get("id") == "fighting_style":
            return True
    if subclass_id:
        for lvl_block in prog.values():
            for node in (lvl_block.get("features") or []):
                if node.get("type") != "subclass":
                    continue
                for opt in (node.get("choices") or []):
                    if opt.get("id") == subclass_id:
                        for feat in (opt.get("features") or []):
                            if feat.get("level") == class_level and "fighting_style" in (feat.get("id") or ""):
                                return True
    return False


@router.post("/{character_id}", response_model=CharacterResponse)
async def partial_update_character(
    character_id: int,
    update_data: CharacterPartialUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Partially update a character (e.g., update equipment only)"""
    result = await db.execute(
        select(Character).where(Character.id == character_id)
    )
    character = result.scalar_one_or_none()

    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Character not found"
        )

    # Update only the fields that are provided
    update_dict = update_data.model_dump(exclude_unset=True)
    broadcast_campaign_id = update_dict.pop("broadcast_campaign_id", None)
    previous_class_feature_uses = dict(character.class_feature_uses or {})

    update_dict = prepare_partial_character_update(character, update_dict)

    for key, value in update_dict.items():
        setattr(character, key, value)

    await db.commit()
    await db.refresh(character)

    tokens_result = await db.execute(
        select(Token).where(Token.character_id == character.id)
    )
    tokens = tokens_result.scalars().all()
    campaign_ids = collect_character_campaign_ids(
        tokens,
        extra_campaign_id=broadcast_campaign_id,
    )

    # Broadcast HP update if current_hp was changed
    try:
        if "current_hp" in update_dict:
            for token in tokens:
                token.current_hp = character.current_hp
            if tokens:
                await db.commit()
            for token in tokens:
                await realtime_publisher.publish_token_hp_updated(
                    token.campaign_id,
                    token_id=token.id,
                    current_hp=character.current_hp,
                    max_hp=character.max_hp,
                    character_id=character.id,
                )
    except Exception:
        pass

    # Broadcast status_effects update via WebSocket + sync conditions to token active_effects
    try:
        if "status_effects" in update_dict:
            from app.services.immunity_service import CONDITION_TRANSLATIONS
            from app.services import aura_service
            active_conditions = (character.status_effects or {}).get("active_conditions", [])
            condition_effects = build_dm_condition_effects(
                active_conditions,
                condition_translations=CONDITION_TRANSLATIONS,
            )
            active_auras = aura_service.build_status_auras_from_status_effects(character.status_effects)
            aura_display_effects = aura_service.build_status_aura_display_effects(character.status_effects)

            # Sync to token active_effects / active_auras (merge: keep non-dm_added, replace DM-synced entries)
            for token in tokens:
                token.active_effects = merge_dm_status_effects(
                    token.active_effects or [],
                    condition_effects,
                    aura_display_effects,
                )
                token.active_auras = active_auras or None
                flag_modified(token, "active_effects")
                flag_modified(token, "active_auras")
            if tokens:
                await db.commit()

            # Broadcast both status_effects and token_effects_update
            for cid in campaign_ids:
                await realtime_publisher.publish_character_status_effects_updated(
                    cid,
                    character_id=int(character.id),
                    status_effects=character.status_effects,
                )
            for token in tokens:
                await realtime_publisher.publish_token_effects_updated(
                    token.campaign_id,
                    token_id=token.id,
                    active_effects=token.active_effects,
                    character_id=int(character.id),
                    character_status_effects=character.status_effects,
                    reason="dm_status_update",
                )
                await realtime_publisher.publish_token_auras_updated(
                    token.campaign_id,
                    token_id=token.id,
                    active_auras=token.active_auras or [],
                    aura_id="status_sync",
                    enabled=bool(token.active_auras),
                )
                await aura_service.on_token_move(
                    token.id,
                    int(token.campaign_id),
                    token.map_url,
                    db,
                )
    except Exception as e:
        logger.warning(f"[StatusEffects] Broadcast error: {e}")

    # Broadcast experience_points update via WebSocket
    try:
        if "experience_points" in update_dict:
            for cid in campaign_ids:
                await realtime_publisher.publish_character_experience_updated(
                    cid,
                    character_id=int(character.id),
                    experience_points=character.experience_points,
                )
    except Exception as e:
        logger.warning(f"[XP] Broadcast error: {e}")

    # Broadcast spell_slots_state update via WebSocket
    try:
        if "spell_slots_state" in update_dict:
            for cid in campaign_ids:
                await realtime_publisher.publish_spell_slots_updated(
                    cid,
                    character_id=int(character.id),
                    spell_slots_state=character.spell_slots_state,
                    event_type="character_spell_slots_update",
                )
    except Exception as e:
        logger.warning(f"[SpellSlots] Broadcast error: {e}")

    # Broadcast equipment/currency updates so character sheets refresh even if the
    # character is not currently placed on the map.
    try:
        if "equipment" in update_dict or "currency" in update_dict:
            for cid in campaign_ids:
                await realtime_publisher.publish_character_equipment_updated(
                    cid,
                    character_id=int(character.id),
                    equipment=character.equipment or [],
                    currency=character.currency or {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0},
                    reason="partial_update",
                )
    except Exception as e:
        logger.warning(f"[Equipment] Broadcast error: {e}")

    try:
        if "class_feature_uses" in update_dict:
            for feature_state in collect_changed_feature_uses(
                previous_class_feature_uses,
                character.class_feature_uses,
            ):
                for cid in campaign_ids:
                    await realtime_publisher.publish_character_feature_uses_updated(
                        cid,
                        character_id=int(character.id),
                        feature_id=feature_state["feature_id"],
                        current_uses=feature_state["current_uses"],
                        max_uses=feature_state["max_uses"],
                    )
    except Exception as e:
        logger.warning(f"[FeatureUses] Broadcast error: {e}")

    try:
        generic_character_update_fields = sorted(
            field_name
            for field_name in update_dict
            if field_name in {
                "current_hp",
                "selected_cantrips",
                "selected_spells",
                "prepared_spells",
                "can_prepare_spells",
                "quick_spells",
                "hotbar",
                "level",
                "multiclass_data",
            }
        )
        if generic_character_update_fields:
            payload = {
                "character_id": int(character.id),
                "changed_fields": generic_character_update_fields,
            }
            for cid in campaign_ids:
                await realtime_publisher.publish_character_updated(
                    cid,
                    data=payload,
                )
    except Exception as e:
        logger.warning(f"[CharacterUpdated] Broadcast error: {e}")

    return character


@router.post("/{character_id}/avatar", response_model=CharacterResponse)
async def update_character_avatar(
    character_id: int,
    req: AvatarUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update character avatar - converts to webp and uploads to OSS"""
    result = await db.execute(select(Character).where(Character.id == character_id))
    character = result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Character not found")

    avatar_url = req.avatar
    avatar_large_url = req.avatar

    # If it's base64 data, upload to OSS
    if req.avatar and (req.avatar.startswith("data:image/") or not req.avatar.startswith("http")):
        try:
            from app.domain.parsing.oss_storage import get_oss_storage
            oss = get_oss_storage()
            result_urls = await oss.upload_avatar_base64_async(req.avatar, "character", character_id)
            if result_urls:
                avatar_url, avatar_large_url = result_urls
            else:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to upload avatar to OSS"
                )
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"OSS not configured: {str(e)}"
            )

    character.avatar = avatar_url
    character.avatar_large = avatar_large_url

    # Save to user's avatar library (deduplicate by URL)
    if character.user_id:
        existing = await db.execute(
            select(UserAvatar).where(
                UserAvatar.user_id == character.user_id,
                UserAvatar.avatar_url == avatar_url
            )
        )
        if not existing.scalar_one_or_none():
            db.add(UserAvatar(
                user_id=character.user_id,
                avatar_url=avatar_url,
                avatar_url_large=avatar_large_url,
            ))

    await db.commit()
    await db.refresh(character)

    # Broadcast avatar update to all campaigns where this character has tokens
    tokens_result = await db.execute(
        select(Token.campaign_id).where(Token.character_id == character_id).distinct()
    )
    campaign_ids = [row[0] for row in tokens_result.fetchall()]

    for campaign_id in campaign_ids:
        await realtime_publisher.publish_character_avatar_updated(
            campaign_id,
            character_id=character_id,
            avatar=avatar_url,
            avatar_large=avatar_large_url,
        )

    return character


class EquipmentAvatarRequest(BaseModel):
    item_id: str
    item_name: str
    item_description: Optional[str] = None
    library_item_id: Optional[int] = None


@router.post("/{character_id}/equipment-avatar")
async def generate_equipment_avatar(
    character_id: int,
    req: EquipmentAvatarRequest,
    db: AsyncSession = Depends(get_db),
):
    """Generate an avatar for a character's equipment item using AI."""
    result = await db.execute(select(Character).where(Character.id == character_id))
    character = result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    equipment = character.equipment or []
    item_idx = next((i for i, eq in enumerate(equipment) if str(eq.get("id")) == str(req.item_id)), None)
    if item_idx is None:
        raise HTTPException(status_code=404, detail="Equipment item not found")

    try:
        from app.services.avatar_service import avatar_service

        backing_item = None
        if req.library_item_id is not None:
            item_result = await db.execute(select(Item).where(Item.id == req.library_item_id))
            candidate = item_result.scalar_one_or_none()
            if candidate and candidate.is_custom:
                backing_item = candidate

        if backing_item is None and req.item_name:
            item_result = await db.execute(
                select(Item)
                .where(Item.is_custom.is_(True))
                .where(or_(Item.name == req.item_name, Item.name_cn == req.item_name))
                .order_by(Item.id.desc())
                .limit(1)
            )
            backing_item = item_result.scalar_one_or_none()

        entity_id = backing_item.id if backing_item else 0
        small_url, large_url = await avatar_service.generate_avatar(
            db=db,
            entity_type="item",
            entity_id=entity_id,
            name=req.item_name,
            description=req.item_description or "",
            usage_key="avatar_item",
        )

        if is_temporary_avatar_url(small_url):
            repaired = await materialize_avatar_url(small_url, "item", entity_id, req.item_name)
            if repaired:
                small_url, large_url = repaired

        equipment[item_idx]["avatar_url"] = small_url
        equipment[item_idx]["avatar_url_large"] = large_url
        if backing_item:
            equipment[item_idx]["libraryItemId"] = backing_item.id
            backing_item.avatar_url = small_url
            backing_item.avatar_url_large = large_url
            backing_item.has_avatar = True
        normalized_equipment, _, _ = normalize_character_equipment_payloads(equipment)
        character.equipment = normalized_equipment
        flag_modified(character, "equipment")
        await db.commit()
        await db.refresh(character)

        return {"avatar_url": small_url, "avatar_url_large": large_url}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate equipment avatar: {e}")


class FeatureUsesUpdate(BaseModel):
    """Update a character's feature uses (e.g., Second Wind, Rage, etc.)"""
    feature_id: str
    current_uses: int
    max_uses: int


@router.post("/{character_id}/feature-uses", response_model=CharacterResponse)
async def update_character_feature_uses(
    character_id: int,
    req: FeatureUsesUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a specific class feature's uses count (DM only typically)"""
    update_result = await update_character_feature_uses_service(
        db,
        character_id=character_id,
        feature_id=req.feature_id,
        current_uses=req.current_uses,
        max_uses=req.max_uses,
    )

    for campaign_id in update_result.campaign_ids:
        await realtime_publisher.publish_character_feature_uses_updated(
            campaign_id,
            character_id=character_id,
            feature_id=req.feature_id,
            current_uses=req.current_uses,
            max_uses=req.max_uses,
        )

    return update_result.character


@router.post("/{character_id}/level-down", response_model=CharacterResponse)
async def level_down_character(
    character_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Rollback character to previous level"""
    result = await db.execute(select(Character).where(Character.id == character_id))
    character = result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Character not found")

    # Check if character is at level 1
    if character.level <= 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot level down below level 1")

    # Check if there's history to rollback to
    level_history = character.level_history or []

    # Find the appropriate snapshot for the target level (current level - 1)
    target_level = character.level - 1
    snapshot_to_restore = None
    new_history = []

    # Look for a snapshot matching the target level
    for snapshot in level_history:
        if snapshot.get("level") == target_level:
            snapshot_to_restore = snapshot
            # Keep all snapshots before this one
            for s in level_history:
                if s.get("level") < target_level:
                    new_history.append(s)
            break

    if not snapshot_to_restore:
        # If no exact match, just decrease the level by 1
        # This handles cases where level history is incomplete
        character.level = target_level
        # Keep history entries that are still valid (below the new level)
        new_history = [s for s in level_history if s.get("level") < target_level]

        # Update multiclass data to sync with the new level
        if character.multiclass_data:
            multiclass_data = character.multiclass_data.copy()
            # Find the last class that was leveled up and reduce it by 1
            if multiclass_data.get("classes"):
                # Sort classes by when they were added (could use order field if available)
                total_levels = sum(c["level"] for c in multiclass_data["classes"])
                if total_levels > target_level:
                    # Find which class to reduce
                    for cls in reversed(multiclass_data["classes"]):
                        if cls["level"] > 0:
                            cls["level"] -= 1
                            if cls["level"] == 0:
                                # Remove the class if it drops to 0
                                multiclass_data["classes"].remove(cls)
                            break
            character.multiclass_data = multiclass_data

        # Filter spells to only keep those that could have been learned at the target level
        # Use level tracking to remove spells learned after the target level
        character.selected_spells = filter_spells_by_level(
            character.selected_spells or [],
            max_level=target_level
        )
        character.selected_cantrips = filter_spells_by_level(
            character.selected_cantrips or [],
            max_level=target_level
        )

        # Filter skills and expertise to only keep those acquired at or before target level
        character.selected_skills = filter_selections_by_level(
            character.selected_skills or [],
            max_level=target_level
        )
        character.expertise_skills = filter_selections_by_level(
            character.expertise_skills or [],
            max_level=target_level
        )

        # Filter class features
        character.fighting_style = filter_single_selection_by_level(
            character.fighting_style,
            max_level=target_level
        )
        character.favored_enemy = filter_single_selection_by_level(
            character.favored_enemy,
            max_level=target_level
        )
        character.favored_terrain = filter_single_selection_by_level(
            character.favored_terrain,
            max_level=target_level
        )
        character.eldritch_invocations = filter_selections_by_level(
            character.eldritch_invocations or [],
            max_level=target_level
        )

        # Clear subclass if rolling back to before it was chosen
        # Most classes get subclass at level 2 or 3
        subclass_levels = {
            "cleric": 1, "sorcerer": 1, "warlock": 1,  # Level 1 subclasses
            "druid": 2, "wizard": 2,                     # Level 2 subclasses
            "barbarian": 3, "bard": 3, "fighter": 3,    # Level 3 subclasses
            "monk": 3, "paladin": 3, "ranger": 3,
            "rogue": 3, "artificer": 3
        }
        subclass_level = subclass_levels.get(character.class_id, 3)
        if target_level < subclass_level:
            character.subclass_id = None

        # Also reset spell slots if available
        initial_slots = get_initial_spell_slots(
            character.class_id,
            target_level,
            character.multiclass_data,
            subclass_id=character.subclass_id
        )
        if initial_slots:
            character.spell_slots_state = initial_slots
        if initial_slots:
            character.spell_slots_state = initial_slots
    else:
        # Restore character state from snapshot
        character.level = snapshot_to_restore["level"]
        character.class_id = snapshot_to_restore.get("class_id", character.class_id)
        character.subclass_id = snapshot_to_restore.get("subclass_id", character.subclass_id)
        character.ability_scores = snapshot_to_restore.get("ability_scores", character.ability_scores)
        character.selected_cantrips = snapshot_to_restore.get("selected_cantrips", character.selected_cantrips)
        character.selected_spells = snapshot_to_restore.get("selected_spells", character.selected_spells)
        character.selected_skills = snapshot_to_restore.get("selected_skills", character.selected_skills)
        character.expertise_skills = snapshot_to_restore.get("expertise_skills", character.expertise_skills)
        character.fighting_style = snapshot_to_restore.get("fighting_style", character.fighting_style)
        character.favored_enemy = snapshot_to_restore.get("favored_enemy", character.favored_enemy)
        character.favored_humanoid_races = snapshot_to_restore.get("favored_humanoid_races", character.favored_humanoid_races)
        character.favored_terrain = snapshot_to_restore.get("favored_terrain", character.favored_terrain)
        character.eldritch_invocations = snapshot_to_restore.get("eldritch_invocations", character.eldritch_invocations)
        character.multiclass_data = snapshot_to_restore.get("multiclass_data", character.multiclass_data)

    character.level_history = new_history

    # Mark JSON fields as modified
    flag_modified(character, "ability_scores")
    flag_modified(character, "selected_cantrips")
    flag_modified(character, "selected_spells")
    flag_modified(character, "selected_skills")
    flag_modified(character, "expertise_skills")
    flag_modified(character, "fighting_style")
    flag_modified(character, "favored_enemy")
    flag_modified(character, "favored_humanoid_races")
    flag_modified(character, "favored_terrain")
    flag_modified(character, "eldritch_invocations")
    flag_modified(character, "multiclass_data")
    flag_modified(character, "level_history")

    logger.debug(f"[DEBUG] Rolled back to level {character.level}, intelligence: {character.ability_scores.get('intelligence')}")

    await db.commit()
    await db.refresh(character)

    # Broadcast level down to all campaigns where this character has tokens
    tokens_result = await db.execute(
        select(Token.campaign_id).where(Token.character_id == character_id).distinct()
    )
    campaign_ids = [row[0] for row in tokens_result.fetchall()]

    for campaign_id in campaign_ids:
        await realtime_publisher.publish_character_level_event(
            campaign_id,
            event_type="character_level_down",
            data=build_character_level_event_data(
                character_id=character_id,
                character_name=character.name,
                new_level=character.level,
            ),
        )

    return character


@router.post("/{character_id}/reset-to-level-one", response_model=CharacterResponse)
async def reset_character_to_level_one(
    character_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Reset character to level 1 state"""
    result = await db.execute(select(Character).where(Character.id == character_id))
    character = result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Character not found")

    # Check if character is already at level 1
    if character.level == 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Character is already at level 1")

    # Look for level 1 snapshot in history
    level_history = character.level_history or []
    level_1_snapshot = None

    for snapshot in level_history:
        if snapshot.get("level") == 1:
            level_1_snapshot = snapshot
            break

    if level_1_snapshot:
        # Restore from level 1 snapshot
        character.level = 1
        character.class_id = level_1_snapshot.get("class_id", character.class_id)
        character.subclass_id = None  # Always clear subclass at level 1
        character.ability_scores = dict(level_1_snapshot.get("ability_scores", character.ability_scores))

        # Restore spells - normalize and ensure they're in new format
        snapshot_cantrips = level_1_snapshot.get("selected_cantrips", [])
        snapshot_spells = level_1_snapshot.get("selected_spells", [])

        character.selected_cantrips = normalize_spell_list(
            snapshot_cantrips,
            default_level=1,
            default_source=character.class_id or "snapshot"
        )
        character.selected_spells = normalize_spell_list(
            snapshot_spells,
            default_level=1,
            default_source=character.class_id or "snapshot"
        )

        # Restore skills and other features from snapshot
        character.selected_skills = normalize_selection_list(
            level_1_snapshot.get("selected_skills", []),
            default_level=1,
            default_source="level_1"
        )
        character.expertise_skills = []  # No expertise at level 1
        # Fighter gets fighting style at level 1, preserve it from snapshot
        if character.class_id == "fighter":
            character.fighting_style = normalize_single_selection(
                level_1_snapshot.get("fighting_style"),
                default_level=1,
                default_source="fighter"
            )
        else:
            character.fighting_style = None
        character.favored_enemy = normalize_single_selection(
            level_1_snapshot.get("favored_enemy") if character.class_id == "ranger" else None,
            default_level=1,
            default_source="ranger"
        )
        character.favored_humanoid_races = level_1_snapshot.get("favored_humanoid_races") if character.class_id == "ranger" else None
        character.favored_terrain = normalize_single_selection(
            level_1_snapshot.get("favored_terrain") if character.class_id == "ranger" else None,
            default_level=1,
            default_source="ranger"
        )
        character.eldritch_invocations = []  # No invocations at level 1

        # Clear feats (re-select at appropriate levels)
        character.feats = []
        character.feat_choices = {}

        # Always create fresh multiclass_data with level 1 (don't trust snapshot)
        character.multiclass_data = {
            "classes": [{"class_id": character.class_id, "level": 1}]
        }
    else:
        # No snapshot available, reset to basic level 1 state
        character.level = 1
        character.subclass_id = None  # Remove subclass
        # Keep original ability scores and class

        # Filter all features to only keep level 1
        character.selected_cantrips = filter_spells_by_level(
            character.selected_cantrips or [],
            max_level=1
        )
        character.selected_spells = filter_spells_by_level(
            character.selected_spells or [],
            max_level=1
        )
        character.selected_skills = filter_selections_by_level(
            character.selected_skills or [],
            max_level=1
        )

        # Clear features that are never available at level 1
        character.expertise_skills = []
        # Fighter gets fighting style at level 1, preserve it
        if character.class_id != "fighter":
            character.fighting_style = None
        character.eldritch_invocations = []
        character.feats = []
        character.feat_choices = {}

        # Keep ranger features if they're a ranger and had them at level 1
        if character.class_id == "ranger":
            character.favored_enemy = filter_single_selection_by_level(
                character.favored_enemy,
                max_level=1
            )
            character.favored_terrain = filter_single_selection_by_level(
                character.favored_terrain,
                max_level=1
            )
        else:
            character.favored_enemy = None
            character.favored_terrain = None

        # Create a fresh multiclass_data object
        character.multiclass_data = {
            "classes": [{"class_id": character.class_id, "level": 1}]
        }

    # Clear prepared spells (must be re-selected)
    character.prepared_spells = []

    # Clear Battle Master maneuvers (no maneuvers at level 1)
    character.maneuvers_known = []

    # Clear all subclass_choices (beastCompanion, familiarForm, elementalDisciplines, pactBoon, etc.)
    # and delete companion/familiar MonsterInstance + Token from the campaign
    if character.subclass_choices:
        from app.models.monster_instance import MonsterInstance
        from sqlalchemy import and_

        # Delete companion/familiar instances owned by this character
        old_companions = await db.execute(
            select(MonsterInstance).where(and_(
                MonsterInstance.controller_character_id == character.id,
                MonsterInstance.control_type.in_(["companion", "familiar"])
            ))
        )
        for old in old_companions.scalars().all():
            old_tokens = await db.execute(
                select(Token).where(Token.monster_instance_id == old.id)
            )
            for t in old_tokens.scalars().all():
                await db.delete(t)
            await db.delete(old)

        character.subclass_choices = None
        flag_modified(character, "subclass_choices")

    # Clear quick spell bar and hotbar
    character.quick_spells = None
    character.hotbar = None

    # Reset class feature uses
    character.class_feature_uses = None

    # Reset spell slots to level 1 (single class after reset)
    initial_slots = get_initial_spell_slots(
        character.class_id,
        1,
        character.multiclass_data,  # Already reset to single class
        subclass_id=character.subclass_id
    )
    if initial_slots:
        character.spell_slots_state = initial_slots
    else:
        character.spell_slots_state = None

    # Clear level history since we're starting fresh
    character.level_history = []

    # Mark JSON fields as modified
    flag_modified(character, "ability_scores")
    flag_modified(character, "selected_cantrips")
    flag_modified(character, "selected_spells")
    flag_modified(character, "selected_skills")
    flag_modified(character, "prepared_spells")
    flag_modified(character, "spell_slots_state")
    flag_modified(character, "expertise_skills")
    flag_modified(character, "fighting_style")
    flag_modified(character, "favored_enemy")
    flag_modified(character, "favored_humanoid_races")
    flag_modified(character, "favored_terrain")
    flag_modified(character, "eldritch_invocations")
    flag_modified(character, "maneuvers_known")
    flag_modified(character, "feats")
    flag_modified(character, "quick_spells")
    flag_modified(character, "hotbar")
    flag_modified(character, "class_feature_uses")
    flag_modified(character, "multiclass_data")
    flag_modified(character, "level_history")


    logger.debug(f"[DEBUG] Reset character to level 1")
    logger.debug(f"[DEBUG] Character level: {character.level}")
    logger.debug(f"[DEBUG] Character subclass_id: {character.subclass_id}")
    logger.debug(f"[DEBUG] Multiclass data: {character.multiclass_data}")

    await db.commit()
    await db.refresh(character)

    logger.debug(f"[DEBUG] After commit - Character level: {character.level}")
    logger.debug(f"[DEBUG] After commit - Subclass ID: {character.subclass_id}")
    logger.debug(f"[DEBUG] After commit - Multiclass data: {character.multiclass_data}")

    # Broadcast reset to all campaigns where this character has tokens
    tokens_result = await db.execute(
        select(Token.campaign_id).where(Token.character_id == character_id).distinct()
    )
    campaign_ids = [row[0] for row in tokens_result.fetchall()]

    for campaign_id in campaign_ids:
        await realtime_publisher.publish_character_level_event(
            campaign_id,
            event_type="character_reset_to_level_1",
            data=build_character_level_event_data(
                character_id=character_id,
                character_name=character.name,
                new_level=1,
            ),
        )

    return character


async def _create_companion_instance(
    db: AsyncSession, campaign_id: int, character: Character, companion_id: str,
    category: str = "beast_master", control_type: str = "companion"
):
    """Create a MonsterInstance + Token for a beast companion or familiar."""
    from app.models.monster_instance import MonsterInstance
    from app.models.campaign import Campaign
    from app.models.map_settings import MapSettings
    from sqlalchemy import and_

    # Load companions data
    from app.utils.rules_cache import get_companions_data
    companions_data = get_companions_data()

    beast = None
    cat_data = companions_data["categories"].get(category)
    if cat_data:
        for creature in cat_data["creatures"]:
            if creature["id"] == companion_id:
                beast = creature
                break
    if not beast:
        logger.info(f"[Companion] Unknown companion ID: {companion_id} in category {category}")
        return

    # Delete old companions for this character in this campaign
    old_companions = await db.execute(
        select(MonsterInstance).where(and_(
            MonsterInstance.campaign_id == campaign_id,
            MonsterInstance.controller_character_id == character.id,
            MonsterInstance.control_type == control_type
        ))
    )
    for old in old_companions.scalars().all():
        # Delete associated tokens
        old_tokens = await db.execute(
            select(Token).where(Token.monster_instance_id == old.id)
        )
        for t in old_tokens.scalars().all():
            await db.delete(t)
        await db.delete(old)

    # Build ability_scores dict for DB storage
    ability_scores = {}
    for key in ["str", "dex", "con", "int", "wis", "cha"]:
        ability_scores[key] = beast["abilityScores"].get(key, 10)

    # Build monster_data (full beast data for stat block display)
    monster_data = {
        "specialAbilities": beast.get("specialAbilities", []),
        "actions": beast.get("actions", []),
        "skills": beast.get("skills", ""),
        "senses": beast.get("senses", {}),
        "trait": beast.get("trait", ""),
        "hpFormula": beast.get("hpFormula", ""),
    }

    # Create new MonsterInstance
    instance = MonsterInstance(
        campaign_id=campaign_id,
        monster_id=f"{control_type}_{companion_id}",
        name=beast.get("nameEn", companion_id),
        name_cn=beast.get("name", ""),
        entity_type=control_type,
        size=beast.get("size", "中型"),
        type=beast.get("type", "野兽"),
        challenge_rating=beast.get("cr", "1/4"),
        armor_class=beast.get("ac", 10),
        hit_points=beast.get("hp", 10),
        hit_dice=beast.get("hpFormula", ""),
        ability_scores=ability_scores,
        speeds=beast.get("speed", {"walk": 30}),
        monster_data=monster_data,
        avatar_url=f"/assets/monster-avatars/{companion_id}_128.webp",
        avatar_url_large=f"/assets/monster-avatars/{companion_id}_512.webp",
        has_avatar=True,
        current_hp=beast.get("hp", 10),
        token_size="1x1",
        controller_character_id=character.id,
        control_type=control_type,
    )
    db.add(instance)
    await db.flush()

    # Find the current map and create a token near the owner
    campaign_result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id)
    )
    campaign = campaign_result.scalar_one_or_none()
    map_url = campaign.current_map_url if campaign else None

    if map_url:
        # Find owner's token position
        owner_token_result = await db.execute(
            select(Token).where(and_(
                Token.campaign_id == campaign_id,
                Token.character_id == character.id,
                Token.map_url == map_url
            ))
        )
        owner_token = owner_token_result.scalar_one_or_none()

        # Determine companion token position
        if owner_token:
            center_x, center_y = owner_token.position_x, owner_token.position_y
        else:
            # Fallback: try anchor point
            anchor_result = await db.execute(
                select(MapSettings).where(and_(
                    MapSettings.campaign_id == campaign_id,
                    MapSettings.map_url == map_url
                ))
            )
            anchor = anchor_result.scalar_one_or_none()
            if anchor and anchor.anchor_x is not None:
                center_x, center_y = anchor.anchor_x, anchor.anchor_y
            else:
                center_x, center_y = 15, 10

        # Get used positions
        used_result = await db.execute(
            select(Token.position_x, Token.position_y).where(and_(
                Token.campaign_id == campaign_id,
                Token.map_url == map_url
            ))
        )
        used_positions = {(r.position_x, r.position_y) for r in used_result.all()}

        # Spiral search for empty slot next to owner
        deltas = [
            (1, 0), (0, 1), (-1, 0), (0, -1),
            (1, 1), (-1, 1), (1, -1), (-1, -1),
            (2, 0), (0, 2), (-2, 0), (0, -2),
        ]
        pos_x, pos_y = center_x + 1, center_y  # default: right of owner
        for dx, dy in deltas:
            candidate = (center_x + dx, center_y + dy)
            if candidate not in used_positions:
                pos_x, pos_y = candidate
                break

        token = Token(
            campaign_id=campaign_id,
            monster_instance_id=instance.id,
            user_id=character.user_id,
            map_url=map_url,
            position_x=pos_x,
            position_y=pos_y,
            token_size="1x1",
            instance_name=beast.get("name", companion_id),
            faction="player",
        )
        db.add(token)
        await db.flush()

        # Broadcast token_placed
        token_data = {
            "id": token.id,
            "campaign_id": campaign_id,
            "monster_instance_id": instance.id,
            "user_id": character.user_id,
            "map_url": map_url,
            "position_x": pos_x,
            "position_y": pos_y,
            "token_size": "1x1",
            "instance_name": beast.get("name", companion_id),
            "monster_name": beast.get("nameEn", companion_id),
            "monster_name_cn": beast.get("name", ""),
            "avatar": instance.avatar_url,
            "avatar_large": instance.avatar_url_large,
            "faction": "player",
            "current_hp": instance.current_hp,
            "max_hp": instance.hit_points,
            "controller_character_id": character.id,
            "control_type": control_type,
        }
        await realtime_publisher.publish_token_placed(
            campaign_id,
            token=token_data,
        )

    logger.info(f"[Companion] Created {control_type} {companion_id} (instance {instance.id}) for character {character.id}")


@router.post("/{character_id}/level-up", response_model=CharacterResponse)
async def level_up_character(
    character_id: int,
    req: LevelUpRequest,
    db: AsyncSession = Depends(get_db),
):
    """Level up a character, updating level, class, subclass, and spells"""
    logger.debug(f"[DEBUG] Level up request: class_choice={req.class_choice}, feature_choices={req.feature_choices}")

    result = await db.execute(select(Character).where(Character.id == character_id))
    character = result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Character not found")

    # Save current state to level_history before making changes
    level_history = character.level_history or []
    snapshot = build_level_history_snapshot(character, req.feature_choices)
    level_history.append(snapshot)
    character.level_history = level_history
    flag_modified(character, "level_history")
    logger.debug(f"[DEBUG] Saved snapshot for level {character.level}, history length: {len(level_history)}")

    multiclass_data = ensure_multiclass_data(character)
    multiclass_data, class_entry, new_level = apply_level_up_class_choice(
        character,
        multiclass_data,
        req.class_choice,
    )

    # Handle feature choices
    if req.feature_choices:
        # Handle subclass selection
        if "subclass" in req.feature_choices and class_entry:
            class_entry["subclass_id"] = req.feature_choices["subclass"]
            # Also update main subclass_id if this is the primary class
            if character.class_id == req.class_choice:
                character.subclass_id = req.feature_choices["subclass"]

        # Handle spell selection
        if "spells" in req.feature_choices:
            spells_data = req.feature_choices["spells"]
            logger.debug(f"[DEBUG] Processing spells: {spells_data}")

            # Load spell data to distinguish cantrips (level 0) from leveled spells
            all_spells_db = get_spells_data().get("spells", [])
            spell_level_map = {s["id"]: s.get("level", 0) for s in all_spells_db}

            # Normalize existing spells to new format
            current_spells = normalize_spell_list(
                character.selected_spells or [],
                default_level=1,
                default_source=character.class_id or "unknown"
            )

            # Handle both formats: array or {learned: [...], replaced: [...]}
            if isinstance(spells_data, dict):
                new_spells = spells_data.get("learned", [])
                replaced_spell_ids = spells_data.get("replaced", [])
                logger.debug(f"[DEBUG] New spells: {new_spells}, Replaced: {replaced_spell_ids}")

                # Remove replaced spells by ID comparison
                if replaced_spell_ids:
                    current_ids = extract_spell_ids(current_spells)
                    current_spells = [
                        s for s in current_spells
                        if s["id"] not in replaced_spell_ids
                    ]
                    logger.debug(f"[DEBUG] After removing replaced spells: {current_spells}")

                # Separate cantrips from leveled spells
                new_cantrip_ids = [sid for sid in new_spells if spell_level_map.get(sid, 0) == 0]
                new_leveled_ids = [sid for sid in new_spells if spell_level_map.get(sid, 0) > 0]

                # Add leveled spells to selected_spells
                current_ids = extract_spell_ids(current_spells)
                for spell_id in new_leveled_ids:
                    if spell_id not in current_ids:
                        current_spells.append({
                            "id": spell_id,
                            "level_learned": new_level,  # Record the level being upgraded to
                            "source": req.class_choice
                        })

                character.selected_spells = current_spells
                flag_modified(character, "selected_spells")
                logger.debug(f"[DEBUG] Updated selected_spells: {character.selected_spells}")

                # Add cantrips to selected_cantrips (not selected_spells)
                if new_cantrip_ids:
                    current_cantrips = normalize_spell_list(
                        character.selected_cantrips or [],
                        default_level=1,
                        default_source=character.class_id or "unknown"
                    )
                    cantrip_ids = extract_spell_ids(current_cantrips)
                    for cantrip_id in new_cantrip_ids:
                        if cantrip_id not in cantrip_ids:
                            current_cantrips.append({
                                "id": cantrip_id,
                                "level_learned": new_level,
                                "source": req.class_choice
                            })
                    character.selected_cantrips = current_cantrips
                    flag_modified(character, "selected_cantrips")
                    logger.debug(f"[DEBUG] Cantrips from spells.learned added to selected_cantrips: {new_cantrip_ids}")
            else:
                # Legacy format: simple array - still convert to new format
                new_cantrip_ids = [sid for sid in spells_data if spell_level_map.get(sid, 0) == 0]
                new_leveled_ids = [sid for sid in spells_data if spell_level_map.get(sid, 0) > 0]

                current_ids = extract_spell_ids(current_spells)
                for spell_id in new_leveled_ids:
                    if spell_id not in current_ids:
                        current_spells.append({
                            "id": spell_id,
                            "level_learned": new_level,
                            "source": req.class_choice
                        })
                character.selected_spells = current_spells
                flag_modified(character, "selected_spells")

                if new_cantrip_ids:
                    current_cantrips = normalize_spell_list(
                        character.selected_cantrips or [],
                        default_level=1,
                        default_source=character.class_id or "unknown"
                    )
                    cantrip_ids = extract_spell_ids(current_cantrips)
                    for cantrip_id in new_cantrip_ids:
                        if cantrip_id not in cantrip_ids:
                            current_cantrips.append({
                                "id": cantrip_id,
                                "level_learned": new_level,
                                "source": req.class_choice
                            })
                    character.selected_cantrips = current_cantrips
                    flag_modified(character, "selected_cantrips")
                logger.debug(f"[DEBUG] Updated selected_spells (legacy): {character.selected_spells}")

        # Handle cantrip selection
        if "cantrips" in req.feature_choices:
            cantrips_data = req.feature_choices["cantrips"]
            logger.debug(f"[DEBUG] Processing cantrips: {cantrips_data}")

            # Normalize existing cantrips to new format
            current_cantrips = normalize_spell_list(
                character.selected_cantrips or [],
                default_level=1,
                default_source=character.class_id or "unknown"
            )

            # Cantrips are typically just added (not replaced)
            current_ids = extract_spell_ids(current_cantrips)
            for cantrip_id in cantrips_data:
                if cantrip_id not in current_ids:
                    current_cantrips.append({
                        "id": cantrip_id,
                        "level_learned": new_level,
                        "source": req.class_choice
                    })

            character.selected_cantrips = current_cantrips
            flag_modified(character, "selected_cantrips")
            logger.debug(f"[DEBUG] Updated selected_cantrips: {character.selected_cantrips}")

        # Handle prepared spells selection (for prepared casters: Cleric, Druid, Paladin)
        if "preparedSpells" in req.feature_choices:
            prepared_data = req.feature_choices["preparedSpells"]
            logger.debug(f"[DEBUG] Processing preparedSpells: {prepared_data}")
            if isinstance(prepared_data, list):
                character.prepared_spells = prepared_data
                flag_modified(character, "prepared_spells")
                logger.debug(f"[DEBUG] Updated prepared_spells: {character.prepared_spells}")

        # Handle expertise selection (Rogue/Bard)
        if "expertise" in req.feature_choices:
            # Normalize existing expertise to new format
            current_expertise = normalize_selection_list(
                character.expertise_skills or [],
                default_level=1,
                default_source=character.class_id or "unknown"
            )

            new_expertise = req.feature_choices["expertise"]
            current_values = extract_values(current_expertise)

            for skill_id in new_expertise:
                if skill_id not in current_values:
                    current_expertise.append({
                        "value": skill_id,
                        "level_acquired": new_level,
                        "source": req.class_choice,
                        "source_detail": "expertise"
                    })

            character.expertise_skills = current_expertise
            flag_modified(character, "expertise_skills")
            logger.debug(f"[DEBUG] Updated expertise_skills: {character.expertise_skills}")

        # Handle fighting style selection — only apply if this class actually grants a
        # fighting-style choice at its current class level. Otherwise ignore it (the frontend
        # gates choices, so a not-offered submission is a no-op here, never a 422).
        if "fighting_style" in req.feature_choices:
            _fs_class_level = next(
                (c["level"] for c in (character.multiclass_data or {}).get("classes", [])
                 if c.get("class_id") == req.class_choice),
                new_level,
            )
            if _fighting_style_offered_at(req.class_choice, character.subclass_id, _fs_class_level):
                character.fighting_style = {
                    "value": req.feature_choices["fighting_style"],
                    "level_acquired": new_level,
                    "source": req.class_choice
                }
                flag_modified(character, "fighting_style")
                logger.debug(f"[DEBUG] Selected fighting style: {character.fighting_style}")
            else:
                logger.info(
                    f"[LevelUp] Ignoring fighting_style at {req.class_choice} "
                    f"L{_fs_class_level} (subclass {character.subclass_id}) — not offered")

        # Handle skills selection (from various features)
        if "skills" in req.feature_choices:
            # Normalize existing skills to new format
            current_skills = normalize_selection_list(
                character.selected_skills or [],
                default_level=1,
                default_source="background_or_class"
            )

            new_skills = req.feature_choices["skills"]
            current_values = extract_values(current_skills)

            for skill_id in new_skills:
                if skill_id not in current_values:
                    current_skills.append({
                        "value": skill_id,
                        "level_acquired": new_level,
                        "source": req.class_choice,
                        "source_detail": req.feature_choices.get("skill_source", "feature")
                    })

            character.selected_skills = current_skills
            flag_modified(character, "selected_skills")
            logger.debug(f"[DEBUG] Updated selected_skills: {character.selected_skills}")

        # Handle Ranger features
        if "favored_enemy" in req.feature_choices:
            character.favored_enemy = {
                "value": req.feature_choices["favored_enemy"],
                "level_acquired": new_level,
                "source": "ranger"
            }
            flag_modified(character, "favored_enemy")
            # Update humanoid races if selecting humanoids
            if req.feature_choices["favored_enemy"] == "humanoids" and "favored_humanoid_races" in req.feature_choices:
                character.favored_humanoid_races = req.feature_choices["favored_humanoid_races"]
                flag_modified(character, "favored_humanoid_races")

        if "favored_terrain" in req.feature_choices:
            character.favored_terrain = {
                "value": req.feature_choices["favored_terrain"],
                "level_acquired": new_level,
                "source": "ranger"
            }
            flag_modified(character, "favored_terrain")

        # Handle Warlock invocations
        if "eldritch_invocations" in req.feature_choices:
            # Normalize existing invocations to new format
            current_invocations = normalize_selection_list(
                character.eldritch_invocations or [],
                default_level=2,  # Warlocks get first invocations at level 2
                default_source="warlock"
            )

            new_invocations = req.feature_choices["eldritch_invocations"]
            current_values = extract_values(current_invocations)

            # Handle replacements if specified
            if "replaced_invocations" in req.feature_choices:
                replaced = req.feature_choices["replaced_invocations"]
                current_invocations = [
                    inv for inv in current_invocations
                    if inv["value"] not in replaced
                ]

            # Add new invocations
            for inv_id in new_invocations:
                if inv_id not in current_values:
                    current_invocations.append({
                        "value": inv_id,
                        "level_acquired": new_level,
                        "source": "warlock"
                    })

            character.eldritch_invocations = current_invocations
            flag_modified(character, "eldritch_invocations")
            logger.debug(f"[DEBUG] Updated eldritch_invocations: {character.eldritch_invocations}")

        # Handle Battle Master maneuvers
        if "maneuvers" in req.feature_choices:
            current_maneuvers = character.maneuvers_known or []
            new_maneuvers = req.feature_choices["maneuvers"]

            # Merge new maneuvers with existing ones (no duplicates)
            for maneuver_id in new_maneuvers:
                if maneuver_id not in current_maneuvers:
                    current_maneuvers.append(maneuver_id)

            character.maneuvers_known = current_maneuvers
            flag_modified(character, "maneuvers_known")
            logger.debug(f"[DEBUG] Updated maneuvers_known: {character.maneuvers_known}")

        # Handle Four Elements elemental disciplines
        if "elemental_disciplines" in req.feature_choices:
            subclass_choices = character.subclass_choices or {}
            current_disciplines = list(subclass_choices.get("elementalDisciplines", []))
            new_disciplines = req.feature_choices["elemental_disciplines"]
            replaced_disciplines = req.feature_choices.get("replaced_disciplines", [])

            # Remove replaced disciplines
            for rid in replaced_disciplines:
                if rid in current_disciplines:
                    current_disciplines.remove(rid)

            # Add new disciplines (no duplicates)
            for did in new_disciplines:
                if did not in current_disciplines:
                    current_disciplines.append(did)

            subclass_choices["elementalDisciplines"] = current_disciplines
            character.subclass_choices = subclass_choices
            flag_modified(character, "subclass_choices")
            logger.debug(f"[DEBUG] Updated elementalDisciplines: {current_disciplines}")

        # Handle Sorcerer metamagic (list in subclass_choices, supports replacement at later levels)
        if "metamagic" in req.feature_choices:
            subclass_choices = character.subclass_choices or {}
            current_metamagic = list(subclass_choices.get("metamagic", []))
            new_metamagic = req.feature_choices["metamagic"] or []
            replaced_metamagic = req.feature_choices.get("replaced_metamagic", [])
            for rid in replaced_metamagic:
                if rid in current_metamagic:
                    current_metamagic.remove(rid)
            for mid in new_metamagic:
                if mid not in current_metamagic:
                    current_metamagic.append(mid)
            subclass_choices["metamagic"] = current_metamagic
            character.subclass_choices = subclass_choices
            flag_modified(character, "subclass_choices")
            logger.debug(f"[DEBUG] Updated metamagic: {current_metamagic}")

        # Handle Beast Master companion
        if "companion" in req.feature_choices:
            subclass_choices = character.subclass_choices or {}
            subclass_choices["beastCompanion"] = req.feature_choices["companion"]
            character.subclass_choices = subclass_choices
            flag_modified(character, "subclass_choices")
            logger.debug(f"[DEBUG] Updated beastCompanion: {req.feature_choices['companion']}")

        # Handle Warlock Pact Boon
        if "pact_boon" in req.feature_choices:
            subclass_choices = character.subclass_choices or {}
            subclass_choices["pactBoon"] = req.feature_choices["pact_boon"]
            character.subclass_choices = subclass_choices
            flag_modified(character, "subclass_choices")
            logger.debug(f"[DEBUG] Selected pact boon: {req.feature_choices['pact_boon']}")

        # Handle Druid Circle of the Land terrain selection
        if "landType" in req.feature_choices:
            subclass_choices = character.subclass_choices or {}
            subclass_choices["landType"] = req.feature_choices["landType"]
            character.subclass_choices = subclass_choices
            flag_modified(character, "subclass_choices")
            logger.debug(f"[DEBUG] Selected land type: {req.feature_choices['landType']}")

        # Handle Warlock Chain Pact familiar selection
        if "familiar" in req.feature_choices:
            subclass_choices = character.subclass_choices or {}
            subclass_choices["familiarForm"] = req.feature_choices["familiar"]
            character.subclass_choices = subclass_choices
            flag_modified(character, "subclass_choices")
            logger.debug(f"[DEBUG] Selected familiar: {req.feature_choices['familiar']}")
            if req.campaign_id:
                await _create_companion_instance(
                    db, req.campaign_id, character, req.feature_choices["familiar"],
                    category="find_familiar", control_type="familiar"
                )

        # Handle ASI/Feat choices
        if "asiOrFeat" in req.feature_choices:
            if req.feature_choices["asiOrFeat"] == "asi" and "asiChoices" in req.feature_choices:
                # Apply ability score improvements
                ability_scores = character.ability_scores.copy() if character.ability_scores else {}
                logger.debug(f"[DEBUG] Before ASI: {ability_scores}")
                for ability, increase in req.feature_choices["asiChoices"].items():
                    if ability in ability_scores:
                        old_value = ability_scores[ability]
                        # 5e caps ability scores at 20 via ASI (matches the feat path below).
                        ability_scores[ability] = min(old_value + increase, 20)
                        logger.debug(f"[DEBUG] ASI: {ability} {old_value} -> {ability_scores[ability]}")
                character.ability_scores = ability_scores
                flag_modified(character, "ability_scores")
                logger.debug(f"[DEBUG] After ASI: {character.ability_scores}")
            elif req.feature_choices["asiOrFeat"] == "feat" and "featId" in req.feature_choices:
                # Apply feat choice - save to character.feats array
                feats = list(character.feats or [])
                feat_id = req.feature_choices["featId"]
                if feat_id not in feats:
                    feats.append(feat_id)
                    character.feats = feats
                    flag_modified(character, "feats")
                    logger.debug(f"[DEBUG] Added feat: {feat_id}, feats now: {character.feats}")
                # Save feat additional choices (e.g. resilient ability choice)
                additional = req.feature_choices.get("featAdditionalChoices")
                if additional:
                    fc = dict(character.feat_choices or {})
                    fc[feat_id] = additional
                    character.feat_choices = fc
                    flag_modified(character, "feat_choices")
                    logger.debug(f"[DEBUG] Saved feat_choices for {feat_id}: {additional}")

                    # Apply feat-granted cantrips/spells to selected_cantrips/spells
                    feat_cantrip = additional.get("cantrip")  # single cantrip (spell_sniper)
                    feat_cantrips = additional.get("cantrips")  # array (magic_initiate)
                    feat_spell = additional.get("spell")  # single spell (magic_initiate)
                    feat_ritual_spells = additional.get("ritualSpells")  # array (ritual_caster)
                    all_feat_cantrips = []
                    if feat_cantrip:
                        all_feat_cantrips.append(feat_cantrip)
                    if isinstance(feat_cantrips, list):
                        all_feat_cantrips.extend(feat_cantrips)
                    if all_feat_cantrips:
                        current_cantrips = list(character.selected_cantrips or [])
                        existing_ids = {(c["id"] if isinstance(c, dict) else c) for c in current_cantrips}
                        for cid in all_feat_cantrips:
                            if cid not in existing_ids:
                                current_cantrips.append({"id": cid, "level_learned": new_level, "source": feat_id})
                        character.selected_cantrips = current_cantrips
                        flag_modified(character, "selected_cantrips")
                        logger.debug(f"[DEBUG] Feat {feat_id} added cantrips: {all_feat_cantrips}")
                    all_feat_spells = []
                    if feat_spell:
                        all_feat_spells.append(feat_spell)
                    if isinstance(feat_ritual_spells, list):
                        all_feat_spells.extend(feat_ritual_spells)
                    if all_feat_spells:
                        current_spells = list(character.selected_spells or [])
                        existing_ids = {(s["id"] if isinstance(s, dict) else s) for s in current_spells}
                        for sid in all_feat_spells:
                            if sid not in existing_ids:
                                current_spells.append({"id": sid, "level_learned": new_level, "source": feat_id})
                        character.selected_spells = current_spells
                        flag_modified(character, "selected_spells")
                        logger.debug(f"[DEBUG] Feat {feat_id} added spells: {all_feat_spells}")

                    # Apply feat ability score increase if present
                    ability_choice = additional.get("abilityChoice")
                    if ability_choice:
                        from app.utils.rules_cache import get_feats_data
                        feats_data = get_feats_data()
                        feat_info = feats_data.get("feats", {}).get(feat_id, {})
                        amount = feat_info.get("abilityIncrease", {}).get("amount", 1)
                        ability_scores = character.ability_scores.copy() if character.ability_scores else {}
                        if ability_choice in ability_scores:
                            old_val = ability_scores[ability_choice]
                            ability_scores[ability_choice] = min(old_val + amount, 20)
                            character.ability_scores = ability_scores
                            flag_modified(character, "ability_scores")
                            logger.debug(f"[DEBUG] Feat {feat_id} ability boost: {ability_choice} {old_val} -> {ability_scores[ability_choice]}")

    # Record level history in multiclass_data (for backward compatibility)
    if "level_history" not in multiclass_data:
        multiclass_data["level_history"] = []
    multiclass_data["level_history"].append({
        "level": new_level,
        "class": req.class_choice,
        "timestamp": datetime.utcnow().isoformat()
    })

    # Update character
    character.multiclass_data = multiclass_data
    flag_modified(character, "multiclass_data")
    character.level = new_level
    # If first class, also update class_id for compatibility
    if len(multiclass_data["classes"]) == 1:
        character.class_id = req.class_choice

    # Update spell slots for the new level
    initial_slots = get_initial_spell_slots(
        character.class_id,
        new_level,
        character.multiclass_data,
        subclass_id=character.subclass_id
    )
    if initial_slots:
        character.spell_slots_state = initial_slots
        flag_modified(character, "spell_slots_state")

    # Allow spell preparation after level-up (treated like a long rest for prepared casters)
    character.can_prepare_spells = True

    # Calculate new XP threshold
    xp_thresholds = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000]
    if new_level <= len(xp_thresholds):
        # Don't change XP, just let it accumulate
        pass

    await db.commit()
    await db.refresh(character)

    # Calculate max HP for broadcast
    max_hp = calculate_max_hp(character)

    # Create broadcast data with complete character information
    broadcast_data = CharacterLevelUpBroadcast.from_character(character, max_hp)

    # Broadcast level up to all campaigns where this character has tokens
    tokens_result = await db.execute(
        select(Token.campaign_id).where(Token.character_id == character_id).distinct()
    )
    campaign_ids = [row[0] for row in tokens_result.fetchall()]

    logger.info(f"[LevelUp] Broadcasting complete character data to {len(campaign_ids)} campaigns")

    for campaign_id in campaign_ids:
        await realtime_publisher.publish_character_level_event(
            campaign_id,
            event_type="character_level_up",
            data=broadcast_data.model_dump(),
        )

    logger.info(f"[LevelUp] Broadcast complete: {character.name} level {character.level}")

    return character


@router.delete("/{character_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_character(
    character_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Delete a character"""
    result = await db.execute(
        select(Character).where(Character.id == character_id)
    )
    character = result.scalar_one_or_none()

    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Character not found"
        )

    await db.delete(character)
    await db.commit()
    return None

class RestRequest(BaseModel):
    rest_type: str  # 'short' | 'long'
    campaign_id: int


@router.post("/{character_id}/rest")
async def apply_rest(
    character_id: int,
    req: RestRequest,
    db: AsyncSession = Depends(get_db),
):
    """Apply short/long rest to a character and update all of their tokens in the campaign.

    - short: heal by average hit die + CON mod (min 1), capped at max HP
    - long: fully restore to max HP
    """
    result = await db.execute(select(Character).where(Character.id == character_id))
    character = result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    rest_type = (req.rest_type or "").strip().lower()
    if rest_type not in ("short", "long"):
        raise HTTPException(status_code=400, detail="Invalid rest_type; expected 'short' or 'long'")

    max_hp = character_sheet_service._compute_max_hp(character)  # type: ignore[attr-defined]
    short_rest_healing = calculate_short_rest_heal(character)
    hit_die = short_rest_healing.hit_die
    con_mod = short_rest_healing.con_mod
    short_heal = short_rest_healing.heal_amount
    apply_character_rest(
        character,
        rest_type=rest_type,
        max_hp=max_hp,
        short_heal=short_heal,
    )

    # Update all tokens for this character within the specified campaign
    tokens_q = await db.execute(
        select(Token).where(
            Token.campaign_id == int(req.campaign_id),
            Token.character_id == int(character_id),
        )
    )
    tokens = list(tokens_q.scalars().all())

    affected: list[int] = []
    for t in tokens:
        before = t.current_hp if isinstance(t.current_hp, int) else None
        if rest_type == "long":
            t.current_hp = int(max_hp)
            # Long rest: temporary HP expires (PHB p.198)
            t.temp_hp = None
        else:
            current = before if isinstance(before, int) else max_hp
            t.current_hp = int(min(max_hp, current + short_heal))
        affected.append(int(t.id))
    # --- Companion / summon healing ---
    companion_healed: list[dict] = []
    from app.models.monster_instance import MonsterInstance
    comp_q = await db.execute(
        select(MonsterInstance).where(
            MonsterInstance.controller_character_id == int(character_id),
            MonsterInstance.control_type.in_(["companion", "familiar", "summon", "mount"]),
        )
    )
    companions = list(comp_q.scalars().all())

    for comp in companions:
        comp_max_hp = comp.hit_points or 0
        if comp_max_hp <= 0:
            continue
        before_hp = comp.current_hp if isinstance(comp.current_hp, int) else 0
        if rest_type == "long":
            comp.current_hp = comp_max_hp
        else:
            # Short rest: heal avg(hit_dice) + CON mod, min 1
            comp_con = 10
            if isinstance(comp.ability_scores, dict):
                comp_con = comp.ability_scores.get("constitution", 10)
            comp_con_mod = (comp_con - 10) // 2
            try:
                hd_str = comp.hit_dice or "1d8"
                parts = hd_str.lower().split("d")
                die_size = int(parts[1].split("+")[0].split("-")[0]) if len(parts) > 1 else 8
            except Exception:
                die_size = 8
            comp_heal = max(1, (die_size // 2) + 1 + comp_con_mod)
            comp.current_hp = min(comp_max_hp, before_hp + comp_heal)
        if comp.current_hp != before_hp:
            companion_healed.append({
                "monster_instance_id": comp.id,
                "name": comp.name_cn or comp.name,
                "control_type": comp.control_type,
                "before_hp": before_hp,
                "current_hp": comp.current_hp,
                "max_hp": comp_max_hp,
            })

    # Update companion tokens on the map
    companion_token_updates: list[Token] = []
    if companions:
        comp_ids = [c.id for c in companions]
        comp_tok_q = await db.execute(
            select(Token).where(
                Token.campaign_id == int(req.campaign_id),
                Token.monster_instance_id.in_(comp_ids),
            )
        )
        companion_tokens_list = list(comp_tok_q.scalars().all())
        comp_hp_map = {c.id: c.current_hp for c in companions}
        for ct in companion_tokens_list:
            new_hp = comp_hp_map.get(ct.monster_instance_id)
            if new_hp is not None:
                ct.current_hp = new_hp
                companion_token_updates.append(ct)

    try:
        await db.commit()
        for t in tokens:
            await realtime_publisher.publish_token_hp_updated(
                t.campaign_id,
                token_id=int(t.id),
                current_hp=int(t.current_hp if isinstance(t.current_hp, int) else max_hp),
                temp_hp=int(t.temp_hp) if isinstance(t.temp_hp, int) else None,
                character_id=int(character_id),
            )
        for ct in companion_token_updates:
            await realtime_publisher.publish_token_hp_updated(
                ct.campaign_id,
                token_id=int(ct.id),
                current_hp=int(ct.current_hp) if isinstance(ct.current_hp, int) else 0,
                monster_instance_id=int(ct.monster_instance_id),
            )
    except Exception:
        # If broadcast fails, still return success for the API (clients may refetch state)
        pass

    # Restore short-rest resources (e.g., superiority dice for Battle Master)
    resource_restore = restore_class_resources_for_rest(
        character,
        rest_type=rest_type,
        class_resource_service_module=class_resource_service,
    )
    resources_restored = resource_restore.resources_restored

    if resource_restore.changed:
        character.class_feature_uses = resource_restore.class_feature_uses
        flag_modified(character, 'class_feature_uses')
        await db.commit()

    # Restore spell slots
    spell_slots_restored = False
    pact_slots_restored = False

    if rest_type == "long":
        # Long rest: restore ALL spell slots (regular + pact)
        initial_slots = get_initial_spell_slots(
            character.class_id,
            character.level,
            character.multiclass_data,
            subclass_id=character.subclass_id
        )
        if initial_slots:
            character.spell_slots_state = initial_slots
            flag_modified(character, 'spell_slots_state')
            spell_slots_restored = True
            await db.commit()
    else:
        # Short rest: only restore warlock pact slots
        pact_slots_restored = restore_pact_slots_on_short_rest_service(character)
        if pact_slots_restored:
            flag_modified(character, 'spell_slots_state')
            await db.commit()

    # Long rest: decrement day-based effects on character tokens
    if rest_type == "long":
        day_eff_q = await db.execute(
            select(Token).where(
                Token.campaign_id == int(req.campaign_id),
                Token.character_id == int(character_id),
                Token.active_effects.isnot(None),
            )
        )
        for token in day_eff_q.scalars().all():
            effs = token.active_effects or []
            new_effs = []
            expired = []
            changed = False
            for e in effs:
                if e.get("duration_unit") == "day" and e.get("duration") is not None:
                    d = e["duration"] - 1
                    if d > 0:
                        new_effs.append({**e, "duration": d})
                    else:
                        expired.append(e)
                    changed = True
                else:
                    new_effs.append(e)
            if changed:
                token.active_effects = new_effs if new_effs else None
                flag_modified(token, "active_effects")
                try:
                    await realtime_publisher.publish_token_active_effects_updated(
                        req.campaign_id,
                        token_id=token.id,
                        active_effects=new_effs,
                    )
                except Exception:
                    pass
                if expired:
                    from app.utils.spell_item_cleanup import cleanup_spell_generated_items
                    await cleanup_spell_generated_items(db, expired, token, int(req.campaign_id))
        await db.commit()

    return {
        "status": "ok",
        "rest_type": rest_type,
        "max_hp": max_hp,
        "healed": short_heal if rest_type == "short" else max_hp,
        "hit_die": hit_die,
        "con_mod": con_mod,
        "current_hp": int(character.current_hp),
        "affected_token_ids": affected,
        "resources_restored": resources_restored,
        "spell_slots_restored": spell_slots_restored,
        "pact_slots_restored": pact_slots_restored,
        "companion_healed": companion_healed,
    }


# ============ Class Resource System Endpoints ============

@router.get("/{character_id}/resources")
async def get_character_resources(
    character_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Get all class resources available to a character with their current states."""
    result = await db.execute(select(Character).where(Character.id == character_id))
    character = result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    # Get available resources and abilities
    # Extract invocation IDs for warlock invocation-gated resources
    invocations = None
    if character.class_id == 'warlock':
        raw_inv = character.eldritch_invocations or []
        invocations = [
            (v if isinstance(v, str) else v.get('id') or v.get('value', ''))
            for v in raw_inv
        ]
    # Extract feat IDs for feat-gated resources
    raw_feats = character.feats or []
    feat_ids = [
        (f if isinstance(f, str) else f.get('id') or f.get('value', ''))
        for f in raw_feats
    ] if raw_feats else None
    char_resources = class_resource_service.get_character_resources(
        class_id=character.class_id,
        subclass_id=character.subclass_id,
        level=character.level,
        character_invocations=invocations,
        character_feats=feat_ids
    )

    # Calculate max values
    ability_scores = character.ability_scores or {}
    charisma = ability_scores.get("charisma", 10)
    wisdom = ability_scores.get("wisdom", 10)
    intelligence = ability_scores.get("intelligence", 10)

    # Get current states from character
    current_states = normalize_character_class_feature_uses(character.class_feature_uses, strict=False) or {}

    # Build response with current and max values
    resources_with_state = []
    for resource in char_resources['resources']:
        resource_id = resource['id']
        max_value = class_resource_service.calculate_resource_max(
            resource, character.level, charisma, wisdom, intelligence
        )
        current_value = current_states.get(resource_id, {}).get('current', max_value)
        dice_type = class_resource_service.get_current_dice_type(resource, character.level)
        recharge_type = class_resource_service.get_current_recharge_type(resource, character.level)

        resources_with_state.append({
            **resource,
            'current': current_value,
            'max': max_value,
            'currentDiceType': dice_type,
            'currentRechargeType': recharge_type,
        })

    return {
        'resources': resources_with_state,
        'abilities': char_resources['abilities'],
    }


class UseResourceRequest(BaseModel):
    resource_id: str
    amount: int = 1
    campaign_id: Optional[int] = None
    spell_slot_level: Optional[int] = None  # For spell_slots type resources


@router.post("/{character_id}/resources/use")
async def use_character_resource(
    character_id: int,
    req: UseResourceRequest,
    db: AsyncSession = Depends(get_db),
):
    """Use a class resource (decrement its count)."""
    result = await db.execute(select(Character).where(Character.id == character_id))
    character = result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    # Get resource definition
    resource = class_resource_service.get_resource_definition(req.resource_id)
    if not resource:
        raise HTTPException(status_code=400, detail=f"Unknown resource: {req.resource_id}")
    state_resource_id = class_resource_service.resolve_resource_state_id(req.resource_id)
    state_resource = class_resource_service.get_resource_definition(state_resource_id) or resource

    # spell_slots type resources: skip counter logic, just broadcast chat message
    # (spell slot consumption is handled separately by the frontend)
    if resource.get('maxFormula') == 'spell_slots':
        if req.campaign_id:
            from app.models.chat_message import ChatMessage
            from datetime import datetime
            resource_name = resource.get('name', req.resource_id)
            resource_desc = resource.get('description', '')
            slot_level = req.spell_slot_level or 1
            content = f"**{character.name}** 使用了 **{resource_name}**（消耗{slot_level}环法术位）"
            if resource_desc:
                content += f"\n> {resource_desc}"
            chat_msg = ChatMessage(
                campaign_id=req.campaign_id,
                sender_user_id=character.user_id,
                sender_role="player",
                message_type="system",
                content=content,
                meta={"resource_use": {
                    "character_id": character_id,
                    "character_name": character.name,
                    "resource_id": req.resource_id,
                    "resource_name": resource_name,
                    "spell_slot_level": slot_level,
                }},
            )
            db.add(chat_msg)
            await db.commit()
            await db.refresh(chat_msg)
            await realtime_publisher.publish_resource_use(
                req.campaign_id,
                data=build_resource_use_broadcast_data(
                    chat_id=chat_msg.id,
                    character_id=character_id,
                    character_name=character.name,
                    user_id=character.user_id,
                    resource_id=req.resource_id,
                    resource_name=resource_name,
                    content=content,
                    created_at=chat_msg.created_at,
                    extra={"spell_slot_level": slot_level},
                ),
            )
        return {"status": "ok", "resource_id": req.resource_id}

    # Get current states
    ability_scores = character.ability_scores or {}
    charisma = ability_scores.get("charisma", 10)
    wisdom = ability_scores.get("wisdom", 10)
    intelligence = ability_scores.get("intelligence", 10)
    current_states = dict(character.class_feature_uses or {})
    resource_state = current_states.get(state_resource_id, {}) or current_states.get(req.resource_id, {})

    max_value = class_resource_service.calculate_resource_max(
        state_resource, character.level, charisma, wisdom, intelligence
    )
    current_value = resource_state.get('current', max_value)

    # Check if enough resources
    if current_value < req.amount:
        raise HTTPException(
            status_code=400,
            detail=f"Not enough {resource.get('name', req.resource_id)}: {current_value}/{req.amount}"
        )

    # Update
    new_value = current_value - req.amount
    current_states[state_resource_id] = {'current': new_value, 'max': max_value}
    character.class_feature_uses = current_states
    flag_modified(character, 'class_feature_uses')
    await db.commit()

    # Broadcast update and persist chat message if campaign_id provided
    if req.campaign_id:
        from app.models.chat_message import ChatMessage
        from datetime import datetime
        resource_name = resource.get('name', req.resource_id)
        resource_desc = resource.get('description', '')
        content = f"**{character.name}** 使用了 **{resource_name}**（剩余 {new_value}/{max_value}）"
        if resource_desc:
            content += f"\n> {resource_desc}"
        chat_msg = ChatMessage(
            campaign_id=req.campaign_id,
            sender_user_id=character.user_id,
            sender_role="player",
            message_type="system",
            content=content,
            meta={"resource_use": {
                "character_id": character_id,
                "character_name": character.name,
                "resource_id": req.resource_id,
                "resource_name": resource_name,
                "current": new_value,
                "max": max_value,
            }},
        )
        db.add(chat_msg)
        await db.commit()
        await db.refresh(chat_msg)

        await realtime_publisher.publish_resource_use(
            req.campaign_id,
            data=build_resource_use_broadcast_data(
                chat_id=chat_msg.id,
                character_id=character_id,
                character_name=character.name,
                user_id=character.user_id,
                resource_id=req.resource_id,
                resource_name=resource_name,
                content=content,
                created_at=chat_msg.created_at,
                extra={"current": new_value, "max": max_value},
            ),
        )

    return {
        "status": "ok",
        "resource_id": req.resource_id,
        "current": new_value,
        "max": max_value,
    }


# ── Lay on Hands (圣疗术) ────────────────────────────────────────
class LayOnHandsRequest(BaseModel):
    target_token_id: int
    heal_amount: int = 0
    cure_disease: bool = False
    cure_poison: bool = False
    campaign_id: int


@router.post("/{character_id}/lay-on-hands")
async def use_lay_on_hands(
    character_id: int,
    req: LayOnHandsRequest,
    db: AsyncSession = Depends(get_db),
):
    """Use Lay on Hands: heal target and/or cure disease/poison from the paladin's HP pool."""
    from app.models.chat_message import ChatMessage
    from app.models.monster_instance import MonsterInstance

    # 1. Load source character
    result = await db.execute(select(Character).where(Character.id == character_id))
    character = result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    # 2. Calculate pool
    resource = class_resource_service.get_resource_definition("lay_on_hands")
    if not resource:
        raise HTTPException(status_code=400, detail="lay_on_hands resource not found")

    ability_scores = character.ability_scores or {}
    max_pool = class_resource_service.calculate_resource_max(
        resource, character.level,
        ability_scores.get("charisma", 10),
        ability_scores.get("wisdom", 10),
        ability_scores.get("intelligence", 10),
    )
    current_states = character.class_feature_uses or {}
    pool_state = current_states.get("lay_on_hands", {})
    pool_current = pool_state.get("current", max_pool)

    # 3. Calculate total cost
    total_cost = req.heal_amount + (5 if req.cure_disease else 0) + (5 if req.cure_poison else 0)
    if total_cost <= 0:
        raise HTTPException(status_code=400, detail="Must heal or cure something")
    if total_cost > pool_current:
        raise HTTPException(status_code=400, detail=f"圣疗池不足: 需要{total_cost}, 剩余{pool_current}")

    # 4. Resolve target token
    token_result = await db.execute(select(Token).where(Token.id == req.target_token_id))
    target_token = token_result.scalar_one_or_none()
    if not target_token:
        raise HTTPException(status_code=404, detail="Target token not found")

    target_name = target_token.instance_name or "目标"
    target_new_hp = None
    target_max_hp = None

    # 5. Check if target is undead (Lay on Hands deals damage to undead instead of healing)
    is_undead = False
    if target_token.monster_instance_id and req.heal_amount > 0:
        mi_check = await db.execute(select(MonsterInstance).where(MonsterInstance.id == target_token.monster_instance_id))
        m = mi_check.scalar_one_or_none()
        if m:
            m_type = (m.type or "").replace("（", "(").split("(")[0].strip()
            is_undead = m_type in ("不死生物", "undead")

    # 5a. Undead: cure disease/poison is invalid
    if is_undead and (req.cure_disease or req.cure_poison):
        raise HTTPException(status_code=400, detail="不死生物无法被治愈疾病或中和毒素")

    # 5b. Apply healing or damage
    if req.heal_amount > 0:
        if is_undead:
            # D&D 5E: Lay on Hands deals radiant damage to undead (equal to heal_amount)
            mi_result = await db.execute(select(MonsterInstance).where(MonsterInstance.id == target_token.monster_instance_id))
            monster = mi_result.scalar_one_or_none()
            if monster:
                target_max_hp = monster.hit_points or 0
                current = target_token.current_hp if target_token.current_hp is not None else (monster.current_hp or target_max_hp)
                target_new_hp = max(0, current - req.heal_amount)
                target_token.current_hp = target_new_hp
                monster.current_hp = target_new_hp
        elif target_token.character_id:
            # Target is a character — use sheet service for max HP
            char_result = await db.execute(select(Character).where(Character.id == target_token.character_id))
            target_char = char_result.scalar_one_or_none()
            if target_char:
                target_max_hp = character_sheet_service._compute_max_hp(target_char)
                current = target_token.current_hp if target_token.current_hp is not None else (target_char.current_hp or target_max_hp)
                target_new_hp = min(current + req.heal_amount, target_max_hp)
                target_token.current_hp = target_new_hp
                target_char.current_hp = target_new_hp
        elif target_token.monster_instance_id:
            # Target is a monster instance
            mi_result = await db.execute(select(MonsterInstance).where(MonsterInstance.id == target_token.monster_instance_id))
            monster = mi_result.scalar_one_or_none()
            if monster:
                target_max_hp = monster.hit_points or 0
                current = target_token.current_hp if target_token.current_hp is not None else (monster.current_hp or target_max_hp)
                target_new_hp = min(current + req.heal_amount, target_max_hp)
                target_token.current_hp = target_new_hp
                monster.current_hp = target_new_hp

    # 6. Deduct from pool
    new_pool = pool_current - total_cost
    current_states["lay_on_hands"] = {"current": new_pool, "max": max_pool}
    character.class_feature_uses = current_states
    flag_modified(character, "class_feature_uses")
    await db.commit()

    # 7. Build chat message
    parts = []
    if req.heal_amount > 0:
        if is_undead:
            parts.append(f"对不死生物 **{target_name}** 造成 {req.heal_amount}点光耀伤害")
        else:
            parts.append(f"治疗 **{target_name}** {req.heal_amount}点生命值")
    if req.cure_disease:
        parts.append("移除一个疾病")
    if req.cure_poison:
        parts.append("中和一种毒素")
    content = f"**{character.name}** 使用了 **圣疗术**：{'，'.join(parts)}（圣疗池 {new_pool}/{max_pool}）"

    chat_msg = ChatMessage(
        campaign_id=req.campaign_id,
        sender_user_id=character.user_id,
        sender_role="player",
        message_type="system",
        content=content,
        meta={"resource_use": {
            "character_id": character_id,
            "character_name": character.name,
            "resource_id": "lay_on_hands",
            "resource_name": "圣疗术",
            "current": new_pool,
            "max": max_pool,
            "heal_amount": req.heal_amount,
            "cure_disease": req.cure_disease,
            "cure_poison": req.cure_poison,
        }},
    )
    db.add(chat_msg)
    await db.commit()
    await db.refresh(chat_msg)

    # 8. Broadcast resource_use to chat
    await realtime_publisher.publish_resource_use(
        req.campaign_id,
        data=build_resource_use_broadcast_data(
            chat_id=chat_msg.id,
            character_id=character_id,
            character_name=character.name,
            user_id=character.user_id,
            resource_id="lay_on_hands",
            resource_name="圣疗术",
            content=content,
            created_at=chat_msg.created_at,
            extra={"current": new_pool, "max": max_pool},
        ),
    )

    # 9. Broadcast token HP update if healed
    if req.heal_amount > 0 and target_new_hp is not None:
        await realtime_publisher.publish_token_hp_updated(
            req.campaign_id,
            token_id=req.target_token_id,
            current_hp=target_new_hp,
            max_hp=target_max_hp,
        )

    return {
        "status": "ok",
        "pool_current": new_pool,
        "pool_max": max_pool,
        "target_current_hp": target_new_hp,
        "target_max_hp": target_max_hp,
    }


class PreserveLifeTargetAllocation(BaseModel):
    target_token_id: int
    heal_amount: int


class PreserveLifeRequest(BaseModel):
    allocations: List[PreserveLifeTargetAllocation]
    campaign_id: int


def _normalize_ability_scores(ability_scores: Optional[Dict[str, Any]]) -> Dict[str, int]:
    mapping = {
        "str": "strength",
        "dex": "dexterity",
        "con": "constitution",
        "int": "intelligence",
        "wis": "wisdom",
        "cha": "charisma",
        "strength": "strength",
        "dexterity": "dexterity",
        "constitution": "constitution",
        "intelligence": "intelligence",
        "wisdom": "wisdom",
        "charisma": "charisma",
    }
    normalized = {
        "strength": 10,
        "dexterity": 10,
        "constitution": 10,
        "intelligence": 10,
        "wisdom": 10,
        "charisma": 10,
    }
    for raw_key, raw_value in (ability_scores or {}).items():
        key = mapping.get(str(raw_key).strip().lower())
        if not key:
            continue
        try:
            normalized[key] = int(raw_value)
        except (TypeError, ValueError):
            continue
    return normalized


def _extract_save_override(save_data: Any, ability: str) -> Optional[int]:
    if isinstance(save_data, (int, float)):
        return int(save_data)
    if not isinstance(save_data, dict):
        return None

    ability_cn = {
        "strength": "力量",
        "dexterity": "敏捷",
        "constitution": "体质",
        "intelligence": "智力",
        "wisdom": "感知",
        "charisma": "魅力",
    }.get(ability, ability)
    short_key = {
        "strength": "str",
        "dexterity": "dex",
        "constitution": "con",
        "intelligence": "int",
        "wisdom": "wis",
        "charisma": "cha",
    }.get(ability, ability[:3])

    normalized = {
        str(key).strip().lower().replace(" ", "_"): value
        for key, value in save_data.items()
    }
    for candidate in (ability, short_key, ability_cn.lower()):
        if candidate not in normalized:
            continue
        try:
            return int(normalized[candidate])
        except (TypeError, ValueError):
            return None
    return None


def _matches_damage_type(entries: Any, aliases: List[str]) -> bool:
    if not entries:
        return False
    values = entries if isinstance(entries, list) else [entries]
    alias_values = [alias.lower() for alias in aliases]
    for entry in values:
        normalized = str(entry).strip().lower()
        if any(
            normalized == alias
            or normalized in alias
                or alias in normalized
                for alias in alias_values
        ):
            return True
    return False


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


def _calculate_distance_to_point(token: Token, point_x: float, point_y: float, grid_size: int = 5) -> float:
    width, height = _parse_token_size(token.token_size)
    center_x = token.position_x + (width / 2)
    center_y = token.position_y + (height / 2)
    return max(abs(center_x - point_x), abs(center_y - point_y)) * grid_size


def _normalize_creature_type_key(value: Optional[str]) -> str:
    raw = str(value or "").replace("（", "(").replace("_", " ").strip().lower()
    if not raw:
        return ""
    return raw.split("(")[0].strip()


def _is_beast_or_plant_creature(value: Optional[str]) -> bool:
    normalized = _normalize_creature_type_key(value)
    if not normalized:
        return False
    return any(keyword in normalized for keyword in ("beast", "plant", "野兽", "植物"))


@router.post("/{character_id}/preserve-life")
async def use_preserve_life(
    character_id: int,
    req: PreserveLifeRequest,
    db: AsyncSession = Depends(get_db),
):
    """Use Preserve Life: heal multiple creatures within 30ft, capped at half HP each."""
    from app.models.chat_message import ChatMessage
    from app.models.monster_instance import MonsterInstance

    result = await db.execute(select(Character).where(Character.id == character_id))
    character = result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    subclass_ids = [
        subclass.strip().lower()
        for subclass in (character.subclass_id or "").split(",")
        if subclass.strip()
    ]
    if character.class_id != "cleric" or "life" not in subclass_ids or character.level < 2:
        raise HTTPException(status_code=400, detail="只有2级以上生命领域牧师可以使用保命通道")

    if not req.allocations:
        raise HTTPException(status_code=400, detail="至少需要选择一个治疗目标")

    resource = class_resource_service.get_resource_definition("channel_divinity_cleric")
    if not resource:
        raise HTTPException(status_code=400, detail="channel_divinity_cleric resource not found")

    ability_scores = character.ability_scores or {}
    max_uses = class_resource_service.calculate_resource_max(
        resource,
        character.level,
        ability_scores.get("charisma", 10),
        ability_scores.get("wisdom", 10),
        ability_scores.get("intelligence", 10),
    )
    current_states = character.class_feature_uses or {}
    channel_state = current_states.get("channel_divinity_cleric", {})
    current_uses = channel_state.get("current", max_uses)
    if current_uses <= 0:
        raise HTTPException(status_code=400, detail="引导神力已用完，需要短休后恢复")

    total_pool = 5 * character.level
    total_allocated = 0
    seen_target_ids = set()
    for allocation in req.allocations:
        if allocation.heal_amount <= 0:
            raise HTTPException(status_code=400, detail="治疗量必须大于0")
        if allocation.target_token_id in seen_target_ids:
            raise HTTPException(status_code=400, detail="同一目标不能重复分配治疗量")
        seen_target_ids.add(allocation.target_token_id)
        total_allocated += allocation.heal_amount

    if total_allocated <= 0:
        raise HTTPException(status_code=400, detail="治疗总量必须大于0")
    if total_allocated > total_pool:
        raise HTTPException(
            status_code=400,
            detail=f"保命通道治疗池不足：最多{total_pool}，当前分配{total_allocated}",
        )

    def _normalize_creature_type(value: Optional[str]) -> str:
        return (value or "").replace("（", "(").split("(")[0].strip().lower()

    target_results = []
    summary_parts = []

    for allocation in req.allocations:
        token_result = await db.execute(select(Token).where(Token.id == allocation.target_token_id))
        target_token = token_result.scalar_one_or_none()
        if not target_token:
            raise HTTPException(status_code=404, detail=f"目标 token 不存在: {allocation.target_token_id}")
        if target_token.campaign_id != req.campaign_id:
            raise HTTPException(status_code=400, detail="目标不在当前战役中")

        target_name = target_token.instance_name or "目标"
        target_current_hp = target_token.current_hp if target_token.current_hp is not None else 0
        target_max_hp = 0
        target_character_id = target_token.character_id
        normalized_type = ""

        if target_token.character_id:
            target_char_result = await db.execute(select(Character).where(Character.id == target_token.character_id))
            target_char = target_char_result.scalar_one_or_none()
            if not target_char:
                raise HTTPException(status_code=404, detail=f"角色目标不存在: {target_name}")
            target_max_hp = character_sheet_service._compute_max_hp(target_char)
            if target_token.current_hp is not None:
                target_current_hp = target_token.current_hp
            elif target_char.current_hp is not None:
                target_current_hp = target_char.current_hp
            else:
                target_current_hp = target_max_hp
        elif target_token.monster_instance_id:
            monster_result = await db.execute(
                select(MonsterInstance).where(MonsterInstance.id == target_token.monster_instance_id)
            )
            monster = monster_result.scalar_one_or_none()
            if not monster:
                raise HTTPException(status_code=404, detail=f"怪物目标不存在: {target_name}")
            normalized_type = _normalize_creature_type(monster.type)
            target_max_hp = monster.hit_points or 0
            if target_token.current_hp is not None:
                target_current_hp = target_token.current_hp
            elif monster.current_hp is not None:
                target_current_hp = monster.current_hp
            else:
                target_current_hp = target_max_hp
        else:
            raise HTTPException(status_code=400, detail=f"{target_name} 不是可治疗的生物目标")

        if any(keyword in normalized_type for keyword in ("undead", "construct", "不死", "构装")):
            raise HTTPException(status_code=400, detail=f"{target_name} 是不死生物或构装生物，不能成为保命通道目标")

        max_healable = max(0, (target_max_hp // 2) - target_current_hp)
        if max_healable <= 0:
            raise HTTPException(status_code=400, detail=f"{target_name} 当前无法被保命通道治疗")
        if allocation.heal_amount > max_healable:
            raise HTTPException(
                status_code=400,
                detail=f"{target_name} 最多只能恢复 {max_healable} 点生命值",
            )

        target_new_hp = target_current_hp + allocation.heal_amount
        target_token.current_hp = target_new_hp

        if target_token.character_id:
            target_char_result = await db.execute(select(Character).where(Character.id == target_token.character_id))
            target_char = target_char_result.scalar_one_or_none()
            if target_char:
                target_char.current_hp = target_new_hp
        elif target_token.monster_instance_id:
            monster_result = await db.execute(
                select(MonsterInstance).where(MonsterInstance.id == target_token.monster_instance_id)
            )
            monster = monster_result.scalar_one_or_none()
            if monster:
                monster.current_hp = target_new_hp

        target_results.append({
            "token_id": target_token.id,
            "name": target_name,
            "character_id": target_character_id,
            "current_hp": target_new_hp,
            "max_hp": target_max_hp,
            "healed_amount": allocation.heal_amount,
        })
        summary_parts.append(f"**{target_name}** +{allocation.heal_amount} ({target_new_hp}/{target_max_hp})")

    new_uses = current_uses - 1
    current_states["channel_divinity_cleric"] = {"current": new_uses, "max": max_uses}
    character.class_feature_uses = current_states
    flag_modified(character, "class_feature_uses")
    await db.commit()

    content = (
        f"**{character.name}** 使用了 **引导神力：保命通道**，总计恢复 {total_allocated} 点生命值"
        f"（引导神力 {new_uses}/{max_uses}）\n> {'，'.join(summary_parts)}"
    )

    chat_msg = ChatMessage(
        campaign_id=req.campaign_id,
        sender_user_id=character.user_id,
        sender_role="player",
        message_type="system",
        content=content,
        meta={"resource_use": {
            "character_id": character_id,
            "character_name": character.name,
            "resource_id": "channel_divinity_cleric",
            "resource_name": "引导神力：保命通道",
            "current": new_uses,
            "max": max_uses,
            "total_healed": total_allocated,
            "target_count": len(target_results),
        }},
    )
    db.add(chat_msg)
    await db.commit()
    await db.refresh(chat_msg)

    await realtime_publisher.publish_resource_use(
        req.campaign_id,
        data=build_resource_use_broadcast_data(
            chat_id=chat_msg.id,
            character_id=character_id,
            character_name=character.name,
            user_id=character.user_id,
            resource_id="channel_divinity_cleric",
            resource_name="引导神力：保命通道",
            content=content,
            created_at=chat_msg.created_at,
            extra={"current": new_uses, "max": max_uses},
        ),
    )

    for target in target_results:
        await realtime_publisher.publish_token_hp_updated(
            req.campaign_id,
            token_id=target["token_id"],
            current_hp=target["current_hp"],
            max_hp=target["max_hp"],
            hp_change=target["healed_amount"],
            character_id=target["character_id"],
        )

    return {
        "status": "ok",
        "total_pool": total_pool,
        "total_healed": total_allocated,
        "channel_divinity_current": new_uses,
        "channel_divinity_max": max_uses,
        "targets": target_results,
    }


class RadianceOfTheDawnRequest(BaseModel):
    campaign_id: int
    source_token_id: int


class CoronaOfLightRequest(BaseModel):
    campaign_id: int
    source_token_id: int


class CharmAnimalsAndPlantsRequest(BaseModel):
    campaign_id: int
    source_token_id: int


class MasterOfNatureRequest(BaseModel):
    campaign_id: int
    source_token_id: int


@router.post("/{character_id}/corona-of-light")
async def activate_corona_of_light(
    character_id: int,
    req: CoronaOfLightRequest,
    db: AsyncSession = Depends(get_db),
):
    """Activate Light Domain level 17 feature: Corona of Light."""
    from app.utils.light_domain import LIGHT_DOMAIN_CORONA_EFFECT_ID

    result = await db.execute(select(Character).where(Character.id == character_id))
    character = result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    subclass_ids = [
        subclass.strip().lower()
        for subclass in (character.subclass_id or "").split(",")
        if subclass.strip()
    ]
    if character.class_id != "cleric" or "light" not in subclass_ids or character.level < 17:
        raise HTTPException(status_code=400, detail="只有17级以上光明领域牧师可以使用日冕")

    source_token = await db.get(Token, req.source_token_id)
    if not source_token:
        raise HTTPException(status_code=404, detail="来源 token 不存在")
    if source_token.campaign_id != req.campaign_id:
        raise HTTPException(status_code=400, detail="来源 token 不在当前战役中")
    if source_token.character_id != character_id:
        raise HTTPException(status_code=400, detail="该 token 不是该角色的战斗实体")

    active_effects = list(source_token.active_effects or [])
    if any(effect.get("id") == LIGHT_DOMAIN_CORONA_EFFECT_ID for effect in active_effects):
        raise HTTPException(status_code=400, detail="日冕已激活")

    effect = {
        "id": LIGHT_DOMAIN_CORONA_EFFECT_ID,
        "name": "日冕",
        "icon": "☀️",
        "color": "#fbbf24",
        "duration": 10,
        "maxDuration": 10,
        "description": "60尺明亮光照、额外30尺微光；其中的敌人对你的火焰与光耀法术豁免具有劣势。",
        "illumination": {
            "type": "light",
            "bright_radius": 60,
            "dim_radius": 30,
            "attach_to": "caster",
            "is_sunlight": True,
            "color": "sunlight|gold",
        },
        "metadata": {
            "saveDisadvantageDamageTypes": ["fire", "radiant"],
            "brightRadiusFeet": 60,
            "dimRadiusFeet": 30,
        },
    }
    active_effects.append(effect)
    source_token.active_effects = active_effects
    flag_modified(source_token, "active_effects")
    await db.commit()

    source_name = source_token.instance_name or character.name or "牧师"
    await realtime_publisher.publish_token_active_effects_updated(
        req.campaign_id,
        token_id=source_token.id,
        active_effects=active_effects,
        character_id=character_id,
    )
    corona_message = (
        f"☀️ **{source_name}** 激活【日冕】！\n"
        "> 60尺内为明亮光照，额外30尺为微光。\n"
        "> 处于明亮光照中的敌人对其火焰与光耀法术豁免具有劣势。\n"
        "> 持续 10 轮。"
    )
    corona_timestamp = int(datetime.utcnow().timestamp() * 1000)
    await realtime_publisher.publish_chat_message(
        req.campaign_id,
        chat_id=corona_timestamp,
        user_id=character.user_id,
        role="player",
        message=corona_message,
        message_type="combat",
        recipients=[],
        is_private=False,
        meta={
            "combat_type": "light_domain_corona",
            "character_id": character_id,
            "source_token_id": source_token.id,
        },
        timestamp=corona_timestamp,
    )

    return {
        "status": "ok",
        "token_id": source_token.id,
        "effect": effect,
        "active_effects": active_effects,
    }


@router.post("/{character_id}/charm-animals-and-plants")
async def use_charm_animals_and_plants(
    character_id: int,
    req: CharmAnimalsAndPlantsRequest,
    db: AsyncSession = Depends(get_db),
):
    """Use Nature Domain Channel Divinity: Charm Animals and Plants."""
    from app.models.chat_message import ChatMessage
    from app.models.monster_instance import MonsterInstance
    from app.services.aura_service import calculate_distance
    from app.services.immunity_service import (
        check_condition_immunity,
        get_character_immunities,
        get_monster_immunities,
        get_saving_throw_advantage,
    )
    from app.utils.saving_throws import calc_saving_throw_modifier, check_advantage_on_save

    result = await db.execute(select(Character).where(Character.id == character_id))
    character = result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    subclass_ids = [
        subclass.strip().lower()
        for subclass in (character.subclass_id or "").split(",")
        if subclass.strip()
    ]
    if character.class_id != "cleric" or "nature" not in subclass_ids or character.level < 2:
        raise HTTPException(status_code=400, detail="只有2级以上自然领域牧师可以使用魅惑动植物通道")

    source_token = await db.get(Token, req.source_token_id)
    if not source_token:
        raise HTTPException(status_code=404, detail="来源 token 不存在")
    if source_token.campaign_id != req.campaign_id:
        raise HTTPException(status_code=400, detail="来源 token 不在当前战役中")
    if source_token.character_id != character_id:
        raise HTTPException(status_code=400, detail="该 token 不是该角色的战斗实体")

    resource = class_resource_service.get_resource_definition("channel_divinity_cleric")
    if not resource:
        raise HTTPException(status_code=400, detail="channel_divinity_cleric resource not found")

    ability_scores = character.ability_scores or {}
    max_uses = class_resource_service.calculate_resource_max(
        resource,
        character.level,
        ability_scores.get("charisma", 10),
        ability_scores.get("wisdom", 10),
        ability_scores.get("intelligence", 10),
    )
    current_states = character.class_feature_uses or {}
    channel_state = current_states.get("channel_divinity_cleric", {})
    current_uses = channel_state.get("current", max_uses)
    if current_uses <= 0:
        raise HTTPException(status_code=400, detail="引导神力已用完，需要短休后恢复")

    source_name = source_token.instance_name or character.name or "牧师"
    proficiency_bonus = 2 + max(0, (character.level - 1) // 4)
    wisdom_mod = (ability_scores.get("wisdom", 10) - 10) // 2
    spell_save_dc = 8 + proficiency_bonus + wisdom_mod

    token_rows = await db.execute(
        select(Token).where(
            Token.campaign_id == req.campaign_id,
            Token.map_url == source_token.map_url,
        )
    )
    map_tokens = token_rows.scalars().all()
    all_tokens_for_immunity = [
        {
            "id": token.id,
            "position_x": token.position_x,
            "position_y": token.position_y,
            "token_size": token.token_size,
            "active_auras": token.active_auras,
            "current_hp": token.current_hp,
            "character_name": token.instance_name or "Unknown",
        }
        for token in map_tokens
    ]

    target_results: List[Dict[str, Any]] = []
    effect_updates: List[Dict[str, Any]] = []
    successful_saves = 0
    failed_saves = 0
    immune_targets = 0
    eligible_target_count = 0
    effect_id = f"charm_animals_and_plants_{source_token.id}"

    for target_token in map_tokens:
        if target_token.id == source_token.id:
            continue
        if not target_token.character_id and not target_token.monster_instance_id:
            continue

        distance_feet = calculate_distance(source_token, target_token)
        if distance_feet > 30:
            continue

        target_name = target_token.instance_name or "目标"
        creature_type = ""
        target_character: Optional[Character] = None
        target_monster: Optional[MonsterInstance] = None
        target_immunities: Dict[str, Any] = {}

        if target_token.character_id:
            target_character = await db.get(Character, target_token.character_id)
            if not target_character:
                continue
            target_name = target_character.name or target_name
            transformation = target_token.transformation_data or {}
            form = transformation.get("form") if isinstance(transformation.get("form"), dict) else {}
            form_overrides = (
                transformation.get("formOverrides")
                if isinstance(transformation.get("formOverrides"), dict)
                else {}
            )
            creature_type = (
                form.get("type")
                or form.get("creature_type")
                or form_overrides.get("type")
                or transformation.get("creature_type")
                or ""
            )
            target_immunities = get_character_immunities(
                {
                    "race_id": target_character.race_id,
                    "class_id": target_character.class_id,
                    "level": target_character.level or 1,
                    "subclass_id": target_character.subclass_id,
                },
                target_token.active_effects,
            )
        else:
            target_monster = await db.get(MonsterInstance, target_token.monster_instance_id)
            if not target_monster:
                continue
            monster_data = target_monster.monster_data or {}
            target_name = target_monster.name_cn or target_monster.name or target_name
            creature_type = target_monster.type or monster_data.get("type") or ""
            target_immunities = get_monster_immunities(
                {
                    "name": target_monster.name_cn or target_monster.name,
                    "condition_immunities": monster_data.get("condition_immunities") or [],
                }
            )

        if not _is_beast_or_plant_creature(creature_type):
            continue

        eligible_target_count += 1

        is_immune, immunity_source = check_condition_immunity(
            target_immunities,
            "charmed",
            all_tokens=all_tokens_for_immunity,
            target_token_id=target_token.id,
        )
        if is_immune:
            immune_targets += 1
            target_results.append(
                {
                    "token_id": target_token.id,
                    "name": target_name,
                    "character_id": target_token.character_id,
                    "monster_instance_id": target_token.monster_instance_id,
                    "distance_feet": round(distance_feet, 1),
                    "creature_type": _normalize_creature_type_key(creature_type),
                    "save_rolls": [],
                    "save_modifier": 0,
                    "save_total": None,
                    "save_dc": spell_save_dc,
                    "success": None,
                    "immune": True,
                    "immunity_source": immunity_source,
                    "charmed_applied": False,
                }
            )
            continue

        save_modifier = 0
        if target_character:
            target_prof = 2 + max(0, (target_character.level - 1) // 4)
            save_modifier = calc_saving_throw_modifier(
                ability_scores=_normalize_ability_scores(target_character.ability_scores or {}),
                save_type="wisdom",
                class_id=target_character.class_id,
                level=target_character.level or 1,
                proficiency_bonus=target_prof,
            )["total"]
        elif target_monster:
            monster_data = target_monster.monster_data or {}
            save_override = _extract_save_override(monster_data.get("saving_throws"), "wisdom")
            if save_override is not None:
                save_modifier = save_override
            else:
                save_modifier = calc_saving_throw_modifier(
                    ability_scores=_normalize_ability_scores(
                        target_monster.ability_scores or monster_data.get("ability_scores") or {}
                    ),
                    save_type="wisdom",
                )["total"]

        adv_disadv = check_advantage_on_save("wisdom", target_token.active_effects)
        if target_character:
            has_advantage, _ = get_saving_throw_advantage(target_immunities, "charmed")
            if has_advantage:
                adv_disadv["advantage"] = True

        if adv_disadv.get("advantage") and not adv_disadv.get("disadvantage"):
            roll_a = random.randint(1, 20)
            roll_b = random.randint(1, 20)
            nat_roll = max(roll_a, roll_b)
            save_rolls = [roll_a, roll_b]
        elif adv_disadv.get("disadvantage") and not adv_disadv.get("advantage"):
            roll_a = random.randint(1, 20)
            roll_b = random.randint(1, 20)
            nat_roll = min(roll_a, roll_b)
            save_rolls = [roll_a, roll_b]
        else:
            nat_roll = random.randint(1, 20)
            save_rolls = [nat_roll]

        save_total = nat_roll + save_modifier
        success = save_total >= spell_save_dc
        if success:
            successful_saves += 1
            target_results.append(
                {
                    "token_id": target_token.id,
                    "name": target_name,
                    "character_id": target_token.character_id,
                    "monster_instance_id": target_token.monster_instance_id,
                    "distance_feet": round(distance_feet, 1),
                    "creature_type": _normalize_creature_type_key(creature_type),
                    "save_rolls": save_rolls,
                    "save_modifier": save_modifier,
                    "save_total": save_total,
                    "save_dc": spell_save_dc,
                    "success": True,
                    "immune": False,
                    "immunity_source": None,
                    "charmed_applied": False,
                }
            )
            continue

        failed_saves += 1
        active_effects = list(target_token.active_effects or [])
        target_effect = {
            "id": effect_id,
            "name": "魅惑",
            "condition": "charmed",
            "icon": "💕",
            "icon_path": "/assets/condition-icons/charmed.png",
            "color": "#ec4899",
            "maxDuration": 10,
            "source": f"魅惑动植物通道 ({source_name})",
            "sourceFeatureId": "charm_animals_and_plants",
            "sourceTokenId": source_token.id,
            "source_token_id": source_token.id,
            "appliedAt": datetime.utcnow().isoformat(),
            "saveDc": spell_save_dc,
            "saveType": "wisdom",
            "duration": 10,
            "durationRounds": 10,
            "roundsRemaining": 10,
            "break_conditions": ["damage_taken"],
            "metadata": {
                "sourceFeatureId": "charm_animals_and_plants",
                "sourceName": source_name,
                "sourceTokenId": source_token.id,
            },
        }

        existing_effect_idx = None
        for idx, existing in enumerate(active_effects):
            existing_feature_id = (
                existing.get("sourceFeatureId")
                or (existing.get("metadata") or {}).get("sourceFeatureId")
            )
            existing_source_token_id = (
                existing.get("sourceTokenId")
                or existing.get("source_token_id")
                or (existing.get("metadata") or {}).get("sourceTokenId")
            )
            if existing.get("id") == effect_id or (
                existing.get("condition") == "charmed"
                and existing_feature_id == "charm_animals_and_plants"
                and str(existing_source_token_id or "").strip() == str(source_token.id)
            ):
                existing_effect_idx = idx
                break

        if existing_effect_idx is not None:
            active_effects[existing_effect_idx] = target_effect
        else:
            active_effects.append(target_effect)
        target_token.active_effects = active_effects
        flag_modified(target_token, "active_effects")

        character_status_effects = None
        monster_status_effects = None
        cond_entry: Dict[str, Any] = {
            "condition": "charmed",
            "duration": {"type": "rounds", "value": 10, "remaining": 10, "v": 2},
            "source": {
                "type": "feature",
                "name": "魅惑动植物通道",
                "feature_id": "charm_animals_and_plants",
                "caster_name": source_name,
                "source_token_id": source_token.id,
            },
            "removal": {"type": "duration"},
        }

        if target_character:
            status = dict(target_character.status_effects or {})
            conditions = list(status.get("active_conditions", []))
            conditions = [
                condition
                for condition in conditions
                if not (
                    isinstance(condition, dict)
                    and condition.get("condition") == "charmed"
                    and (condition.get("source") or {}).get("feature_id") == "charm_animals_and_plants"
                    and str((condition.get("source") or {}).get("source_token_id") or "").strip() == str(source_token.id)
                )
            ]
            conditions.append(cond_entry)
            status["active_conditions"] = conditions
            target_character.status_effects = status
            flag_modified(target_character, "status_effects")
            character_status_effects = status
        elif target_monster:
            status = dict(target_monster.status_effects or {})
            conditions = list(status.get("conditions", []))
            conditions = [
                condition
                for condition in conditions
                if not (
                    isinstance(condition, dict)
                    and condition.get("condition") == "charmed"
                    and (condition.get("source") or {}).get("feature_id") == "charm_animals_and_plants"
                    and str((condition.get("source") or {}).get("source_token_id") or "").strip() == str(source_token.id)
                )
            ]
            conditions.append(cond_entry)
            status["conditions"] = conditions
            target_monster.status_effects = status
            flag_modified(target_monster, "status_effects")
            monster_status_effects = status

        effect_updates.append(
            {
                "token_id": target_token.id,
                "active_effects": active_effects,
                "character_id": target_token.character_id,
                "character_status_effects": character_status_effects,
                "monster_instance_id": target_token.monster_instance_id,
                "monster_status_effects": monster_status_effects,
            }
        )
        target_results.append(
            {
                "token_id": target_token.id,
                "name": target_name,
                "character_id": target_token.character_id,
                "monster_instance_id": target_token.monster_instance_id,
                "distance_feet": round(distance_feet, 1),
                "creature_type": _normalize_creature_type_key(creature_type),
                "save_rolls": save_rolls,
                "save_modifier": save_modifier,
                "save_total": save_total,
                "save_dc": spell_save_dc,
                "success": False,
                "immune": False,
                "immunity_source": None,
                "charmed_applied": True,
                "active_effects": active_effects,
            }
        )

    new_uses = current_uses - 1
    current_states["channel_divinity_cleric"] = {"current": new_uses, "max": max_uses}
    character.class_feature_uses = current_states
    flag_modified(character, "class_feature_uses")

    summary_lines = [
        f"🌿 **{source_name}** 使用【引导神力：魅惑动植物通道】！",
        f"> DC {spell_save_dc} 感知豁免",
    ]
    if target_results:
        for target in target_results:
            if target["immune"]:
                immunity_source = f"（{target['immunity_source']}）" if target.get("immunity_source") else ""
                summary_lines.append(f"- {target['name']}: 🛡️ 免疫魅惑{immunity_source}")
                continue
            rolls_str = "/".join(str(roll) for roll in target["save_rolls"])
            result_icon = "✅" if target["success"] else "❌"
            line = (
                f"- {target['name']}: {rolls_str} + {target['save_modifier']} = "
                f"{target['save_total']} {result_icon}"
            )
            if target["charmed_applied"]:
                line += " | 💕 魅惑 10 轮"
            summary_lines.append(line)
    else:
        summary_lines.append("_(30尺内没有野兽或植物生物)_")
    summary_lines.append(f"> 剩余引导神力: {new_uses}/{max_uses}")

    content = "\n".join(summary_lines)
    chat_msg = ChatMessage(
        campaign_id=req.campaign_id,
        sender_user_id=character.user_id,
        sender_role="player",
        message_type="combat",
        content=content,
        meta={
            "combat_type": "nature_domain_charm_animals_and_plants",
            "character_id": character_id,
            "character_name": character.name,
            "source_token_id": req.source_token_id,
            "save_dc": spell_save_dc,
            "eligible_target_count": eligible_target_count,
            "successful_saves": successful_saves,
            "failed_saves": failed_saves,
            "immune_targets": immune_targets,
        },
    )
    db.add(chat_msg)
    await db.commit()
    await db.refresh(chat_msg)

    await realtime_publisher.publish_chat_message(
        req.campaign_id,
        chat_id=chat_msg.id,
        user_id=character.user_id,
        role="player",
        message=content,
        message_type="combat",
        recipients=[],
        is_private=False,
        meta=chat_msg.meta,
        timestamp=int(chat_msg.created_at.timestamp() * 1000)
        if chat_msg.created_at
        else int(datetime.utcnow().timestamp() * 1000),
    )

    for update in effect_updates:
        await realtime_publisher.publish_token_active_effects_updated(
            req.campaign_id,
            token_id=update["token_id"],
            active_effects=update["active_effects"],
            character_id=update["character_id"],
            character_status_effects=update["character_status_effects"],
            monster_instance_id=update["monster_instance_id"],
            monster_status_effects=update["monster_status_effects"],
        )

    return {
        "status": "ok",
        "save_dc": spell_save_dc,
        "eligible_target_count": eligible_target_count,
        "successful_saves": successful_saves,
        "failed_saves": failed_saves,
        "immune_targets": immune_targets,
        "channel_divinity_current": new_uses,
        "channel_divinity_max": max_uses,
        "targets": target_results,
    }


@router.post("/{character_id}/master-of-nature")
async def use_master_of_nature(
    character_id: int,
    req: MasterOfNatureRequest,
    db: AsyncSession = Depends(get_db),
):
    """Use Nature Domain level 17 feature: gain direct control of charmed beasts/plants."""
    from app.models.chat_message import ChatMessage
    from app.models.monster_instance import MonsterInstance
    from app.utils.nature_domain import (
        MASTER_OF_NATURE_CONTROL_TYPE,
        get_effect_metadata,
        is_charm_animals_and_plants_effect,
    )

    result = await db.execute(select(Character).where(Character.id == character_id))
    character = result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    subclass_ids = [
        subclass.strip().lower()
        for subclass in (character.subclass_id or "").split(",")
        if subclass.strip()
    ]
    if character.class_id != "cleric" or "nature" not in subclass_ids or character.level < 17:
        raise HTTPException(status_code=400, detail="只有17级以上自然领域牧师可以使用自然大师")

    source_token = await db.get(Token, req.source_token_id)
    if not source_token:
        raise HTTPException(status_code=404, detail="来源 token 不存在")
    if source_token.campaign_id != req.campaign_id:
        raise HTTPException(status_code=400, detail="来源 token 不在当前战役中")
    if source_token.character_id != character_id:
        raise HTTPException(status_code=400, detail="该 token 不是该角色的战斗实体")

    token_rows = await db.execute(
        select(Token).where(
            Token.campaign_id == req.campaign_id,
            Token.map_url == source_token.map_url,
        )
    )
    map_tokens = token_rows.scalars().all()

    source_name = source_token.instance_name or character.name or "自然牧师"
    source_faction = source_token.faction or "player"
    controlled_targets: List[Dict[str, Any]] = []
    skipped_targets: List[Dict[str, Any]] = []

    for target_token in map_tokens:
        if target_token.id == source_token.id:
            continue

        active_effects = list(target_token.active_effects or [])
        effect_index = next(
            (
                idx
                for idx, effect in enumerate(active_effects)
                if is_charm_animals_and_plants_effect(effect, source_token.id)
            ),
            None,
        )
        if effect_index is None:
            continue

        target_name = target_token.instance_name or "目标"
        if not target_token.monster_instance_id:
            skipped_targets.append({
                "token_id": target_token.id,
                "name": target_name,
                "reason": "当前系统仅支持直接接管怪物/召唤物 token；角色目标仍保持魅惑状态",
            })
            continue

        monster = await db.get(MonsterInstance, target_token.monster_instance_id)
        if not monster:
            skipped_targets.append({
                "token_id": target_token.id,
                "name": target_name,
                "reason": "怪物实例不存在",
            })
            continue

        current_effect = active_effects[effect_index]
        metadata = dict(get_effect_metadata(current_effect))
        metadata.setdefault("originalUserId", target_token.user_id)
        metadata.setdefault("originalFaction", target_token.faction)
        metadata.setdefault("originalControllerCharacterId", monster.controller_character_id)
        metadata.setdefault("originalControlType", monster.control_type)
        metadata["masterOfNatureControlled"] = True
        metadata["controllerCharacterId"] = character_id
        metadata["controlType"] = MASTER_OF_NATURE_CONTROL_TYPE
        metadata["commandedBy"] = source_name

        updated_effect = {
            **current_effect,
            "description": (
                "该目标被魅惑动植物通道影响，并已由【自然大师】接管。"
                "在魅惑结束前，施法者玩家可以直接操作该生物。"
            ),
            "metadata": metadata,
        }
        active_effects[effect_index] = updated_effect
        target_token.active_effects = active_effects
        flag_modified(target_token, "active_effects")

        monster.controller_character_id = character_id
        monster.control_type = MASTER_OF_NATURE_CONTROL_TYPE
        target_token.user_id = character.user_id
        target_token.faction = source_faction

        controlled_targets.append({
            "token_id": target_token.id,
            "monster_instance_id": target_token.monster_instance_id,
            "name": target_name,
            "controller_character_id": character_id,
            "control_type": MASTER_OF_NATURE_CONTROL_TYPE,
            "user_id": character.user_id,
            "faction": source_faction,
            "active_effects": active_effects,
        })

    if not controlled_targets:
        detail = "当前地图上没有可由自然大师接管的魅惑目标"
        if skipped_targets:
            detail = skipped_targets[0]["reason"]
        raise HTTPException(status_code=400, detail=detail)

    content_lines = [
        f"🌳 **{source_name}** 使用【自然大师】！",
        "> 以下目标在魅惑结束前改为由你直接操控：",
    ]
    for entry in controlled_targets:
        content_lines.append(f"- {entry['name']}")
    if skipped_targets:
        for entry in skipped_targets:
            content_lines.append(f"- {entry['name']}: {entry['reason']}")
    content = "\n".join(content_lines)

    chat_msg = ChatMessage(
        campaign_id=req.campaign_id,
        sender_user_id=character.user_id,
        sender_role="player",
        message_type="combat",
        content=content,
        meta={
            "combat_type": "nature_domain_master_of_nature",
            "character_id": character_id,
            "character_name": character.name,
            "source_token_id": req.source_token_id,
            "controlled_target_count": len(controlled_targets),
        },
    )
    db.add(chat_msg)
    await db.commit()
    await db.refresh(chat_msg)

    await realtime_publisher.publish_chat_message(
        req.campaign_id,
        chat_id=chat_msg.id,
        user_id=character.user_id,
        role="player",
        message=content,
        message_type="combat",
        recipients=[],
        is_private=False,
        meta=chat_msg.meta,
        timestamp=int(chat_msg.created_at.timestamp() * 1000)
        if chat_msg.created_at
        else int(datetime.utcnow().timestamp() * 1000),
    )

    for entry in controlled_targets:
        await realtime_publisher.publish_token_updated(
            req.campaign_id,
            token={
                "id": entry["token_id"],
                "user_id": entry["user_id"],
                "faction": entry["faction"],
                "controller_character_id": entry["controller_character_id"],
                "control_type": entry["control_type"],
            },
        )
        await realtime_publisher.publish_token_active_effects_updated(
            req.campaign_id,
            token_id=entry["token_id"],
            active_effects=entry["active_effects"],
            monster_instance_id=entry["monster_instance_id"],
        )

    return {
        "status": "ok",
        "controlled_target_count": len(controlled_targets),
        "controlled_targets": controlled_targets,
        "skipped_targets": skipped_targets,
    }


@router.post("/{character_id}/radiance-of-the-dawn")
async def use_radiance_of_the_dawn(
    character_id: int,
    req: RadianceOfTheDawnRequest,
    db: AsyncSession = Depends(get_db),
):
    """Use Light Domain Channel Divinity: Radiance of the Dawn."""
    from app.api.routes.combat import _absorb_temp_hp
    from app.models.chat_message import ChatMessage
    from app.models.monster_instance import MonsterInstance
    from app.services.aura_service import calculate_distance
    from app.services.passive_feature_service import get_passive_features
    from app.utils.light_domain import target_has_corona_of_light_save_disadvantage
    from app.utils.saving_throws import calc_saving_throw_modifier, check_advantage_on_save

    result = await db.execute(select(Character).where(Character.id == character_id))
    character = result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    subclass_ids = [
        subclass.strip().lower()
        for subclass in (character.subclass_id or "").split(",")
        if subclass.strip()
    ]
    if character.class_id != "cleric" or "light" not in subclass_ids or character.level < 2:
        raise HTTPException(status_code=400, detail="只有2级以上光明领域牧师可以使用光辉通道")

    source_token = await db.get(Token, req.source_token_id)
    if not source_token:
        raise HTTPException(status_code=404, detail="来源 token 不存在")
    if source_token.campaign_id != req.campaign_id:
        raise HTTPException(status_code=400, detail="来源 token 不在当前战役中")
    if source_token.character_id != character_id:
        raise HTTPException(status_code=400, detail="该 token 不是该角色的战斗实体")

    resource = class_resource_service.get_resource_definition("channel_divinity_cleric")
    if not resource:
        raise HTTPException(status_code=400, detail="channel_divinity_cleric resource not found")

    ability_scores = character.ability_scores or {}
    max_uses = class_resource_service.calculate_resource_max(
        resource,
        character.level,
        ability_scores.get("charisma", 10),
        ability_scores.get("wisdom", 10),
        ability_scores.get("intelligence", 10),
    )
    current_states = character.class_feature_uses or {}
    channel_state = current_states.get("channel_divinity_cleric", {})
    current_uses = channel_state.get("current", max_uses)
    if current_uses <= 0:
        raise HTTPException(status_code=400, detail="引导神力已用完，需要短休后恢复")

    source_name = source_token.instance_name or character.name or "牧师"
    proficiency_bonus = 2 + max(0, (character.level - 1) // 4)
    wisdom_mod = (ability_scores.get("wisdom", 10) - 10) // 2
    spell_save_dc = 8 + proficiency_bonus + wisdom_mod
    damage_rolls = [random.randint(1, 10), random.randint(1, 10)]
    base_damage = sum(damage_rolls) + character.level

    source_faction = source_token.faction or ("player" if source_token.character_id else "enemy")
    token_rows = await db.execute(
        select(Token).where(
            Token.campaign_id == req.campaign_id,
            Token.map_url == source_token.map_url,
        )
    )
    map_tokens = token_rows.scalars().all()

    target_results = []
    successful_saves = 0
    failed_saves = 0
    dispelled_darkness_tokens: List[Dict[str, Any]] = []

    for candidate in map_tokens:
        conc = candidate.concentration_spell or {}
        conc_spell_id = str(
            conc.get("spell_id")
            or conc.get("sourceSpell")
            or conc.get("spellId")
            or ""
        ).strip().lower()
        if not spell_has_illumination_type(get_spell_by_id(conc_spell_id), "darkness"):
            continue

        area_effect = conc.get("area_effect") or {}
        center_x = area_effect.get("center_x")
        center_y = area_effect.get("center_y")
        if center_x is None or center_y is None:
            width, height = _parse_token_size(candidate.token_size)
            center_x = candidate.position_x + (width / 2)
            center_y = candidate.position_y + (height / 2)

        if _calculate_distance_to_point(source_token, float(center_x), float(center_y)) > 30:
            continue

        candidate.concentration_spell = None
        flag_modified(candidate, "concentration_spell")

        existing_effects = list(candidate.active_effects or [])
        filtered_effects = [
            effect for effect in existing_effects
            if not (
                effect.get("spell_buff")
                and spell_has_illumination_type(
                    get_spell_by_id(str(effect.get("spell_id") or "").strip().lower()),
                    "darkness",
                )
            )
        ]
        active_effects_changed = len(filtered_effects) != len(existing_effects)
        if active_effects_changed:
            candidate.active_effects = filtered_effects or None
            flag_modified(candidate, "active_effects")

        dispelled_darkness_tokens.append({
            "token_id": candidate.id,
            "name": candidate.instance_name or "黑暗来源",
            "active_effects_changed": active_effects_changed,
            "active_effects": filtered_effects,
        })

    for target_token in map_tokens:
        if target_token.id == source_token.id:
            continue
        if not target_token.character_id and not target_token.monster_instance_id:
            continue

        target_faction = target_token.faction or ("player" if target_token.character_id else "enemy")
        if target_faction == "neutral" or target_faction == source_faction:
            continue

        distance_feet = calculate_distance(source_token, target_token)
        if distance_feet > 30:
            continue

        target_name = target_token.instance_name or "目标"
        target_current_hp = target_token.current_hp if target_token.current_hp is not None else 0
        target_max_hp = target_token.current_hp if target_token.current_hp is not None else 0
        save_modifier = 0
        damage_resistances: List[str] = []
        damage_immunities: List[str] = []
        target_character_id = target_token.character_id
        target_monster_instance_id = target_token.monster_instance_id

        if target_token.character_id:
            target_character = await db.get(Character, target_token.character_id)
            if not target_character:
                continue
            target_name = target_character.name or target_name
            target_max_hp = calculate_max_hp(target_character)
            if target_token.current_hp is not None:
                target_current_hp = target_token.current_hp
            elif target_character.current_hp is not None:
                target_current_hp = target_character.current_hp
            else:
                target_current_hp = target_max_hp

            target_prof = 2 + max(0, (target_character.level - 1) // 4)
            save_modifier = calc_saving_throw_modifier(
                ability_scores=_normalize_ability_scores(target_character.ability_scores or {}),
                save_type="constitution",
                class_id=target_character.class_id,
                level=target_character.level or 1,
                proficiency_bonus=target_prof,
            )["total"]
            passive_features = get_passive_features(
                target_character.class_id,
                target_character.level or 1,
                target_character.subclass_id,
            )
            passive_resistances = passive_features.get("resistances", [])
            if isinstance(passive_resistances, list):
                damage_resistances.extend(passive_resistances)
            elif passive_resistances:
                damage_resistances.append(str(passive_resistances))
        else:
            monster = await db.get(MonsterInstance, target_token.monster_instance_id)
            if not monster:
                continue
            monster_data = monster.monster_data or {}
            target_name = monster.name_cn or monster.name or target_name
            target_max_hp = monster.hit_points or 0
            if target_token.current_hp is not None:
                target_current_hp = target_token.current_hp
            elif monster.current_hp is not None:
                target_current_hp = monster.current_hp
            else:
                target_current_hp = target_max_hp

            save_override = _extract_save_override(monster_data.get("saving_throws"), "constitution")
            if save_override is not None:
                save_modifier = save_override
            else:
                save_modifier = calc_saving_throw_modifier(
                    ability_scores=_normalize_ability_scores(monster.ability_scores or monster_data.get("ability_scores") or {}),
                    save_type="constitution",
                )["total"]
            monster_resistances = monster_data.get("damage_resistances") or []
            monster_immunities = monster_data.get("damage_immunities") or []
            if isinstance(monster_resistances, list):
                damage_resistances.extend(monster_resistances)
            elif monster_resistances:
                damage_resistances.append(str(monster_resistances))
            if isinstance(monster_immunities, list):
                damage_immunities.extend(monster_immunities)
            elif monster_immunities:
                damage_immunities.append(str(monster_immunities))

        adv_disadv = check_advantage_on_save("constitution", target_token.active_effects)
        if target_has_corona_of_light_save_disadvantage(source_token, target_token, "radiant"):
            adv_disadv["disadvantage"] = True
        if adv_disadv.get("advantage") and not adv_disadv.get("disadvantage"):
            roll_a = random.randint(1, 20)
            roll_b = random.randint(1, 20)
            nat_roll = max(roll_a, roll_b)
            save_rolls = [roll_a, roll_b]
        elif adv_disadv.get("disadvantage") and not adv_disadv.get("advantage"):
            roll_a = random.randint(1, 20)
            roll_b = random.randint(1, 20)
            nat_roll = min(roll_a, roll_b)
            save_rolls = [roll_a, roll_b]
        else:
            nat_roll = random.randint(1, 20)
            save_rolls = [nat_roll]

        save_total = nat_roll + save_modifier
        success = save_total >= spell_save_dc
        if success:
            successful_saves += 1
        else:
            failed_saves += 1

        damage_before_modifiers = base_damage // 2 if success else base_damage
        immunity_applied = _matches_damage_type(damage_immunities, ["radiant", "光耀"])
        resistance_applied = False
        damage_dealt = 0 if immunity_applied else damage_before_modifiers
        if damage_dealt > 0 and _matches_damage_type(damage_resistances, ["radiant", "光耀"]):
            damage_dealt = damage_dealt // 2
            resistance_applied = True

        hp_change = 0
        new_hp = target_current_hp
        target_defeated = False
        if damage_dealt > 0:
            actual_damage = await _absorb_temp_hp(target_token, damage_dealt, db)
            new_hp = max(0, target_current_hp - actual_damage)
            hp_change = -actual_damage
            target_defeated = new_hp <= 0
            target_token.current_hp = new_hp
            if target_token.character_id:
                target_character = await db.get(Character, target_token.character_id)
                if target_character:
                    target_character.current_hp = new_hp
            elif target_token.monster_instance_id:
                monster = await db.get(MonsterInstance, target_token.monster_instance_id)
                if monster:
                    monster.current_hp = new_hp

        target_results.append({
            "token_id": target_token.id,
            "name": target_name,
            "character_id": target_character_id,
            "monster_instance_id": target_monster_instance_id,
            "distance_feet": round(distance_feet, 1),
            "save_rolls": save_rolls,
            "save_modifier": save_modifier,
            "save_total": save_total,
            "save_dc": spell_save_dc,
            "success": success,
            "damage_before_modifiers": damage_before_modifiers,
            "damage_dealt": damage_dealt,
            "damage_type": "radiant",
            "hp_change": hp_change,
            "new_hp": new_hp,
            "target_defeated": target_defeated,
            "resistance_applied": resistance_applied,
            "immunity_applied": immunity_applied,
        })

    new_uses = current_uses - 1
    current_states["channel_divinity_cleric"] = {"current": new_uses, "max": max_uses}
    character.class_feature_uses = current_states
    flag_modified(character, "class_feature_uses")
    await db.commit()

    summary_lines = [
        f"🌅 **{source_name}** 使用【引导神力：光辉通道】！",
        f"> DC {spell_save_dc} 体质豁免",
        f"> 伤害: 2d10+{character.level} = {'+'.join(str(r) for r in damage_rolls)}+{character.level} = **{base_damage}** 光耀伤害",
    ]
    if dispelled_darkness_tokens:
        summary_lines.append(
            "> 驱散黑暗: " + "、".join(entry["name"] for entry in dispelled_darkness_tokens)
        )
    if target_results:
        for target in target_results:
            rolls_str = "/".join(str(v) for v in target["save_rolls"])
            result_icon = "✅" if target["success"] else "❌"
            line = (
                f"- {target['name']}: {rolls_str} + {target['save_modifier']} = {target['save_total']} "
                f"{result_icon} | 💥 {target['damage_dealt']} 光耀"
            )
            if target["immunity_applied"]:
                line += "（免疫）"
            elif target["resistance_applied"]:
                line += "（抗性）"
            if target["target_defeated"]:
                line += " 💀"
            summary_lines.append(line)
    else:
        summary_lines.append("_(30尺内没有敌对生物)_")
    summary_lines.append(f"> 剩余引导神力: {new_uses}/{max_uses}")

    content = "\n".join(summary_lines)
    chat_msg = ChatMessage(
        campaign_id=req.campaign_id,
        sender_user_id=character.user_id,
        sender_role="player",
        message_type="combat",
        content=content,
        meta={
            "combat_type": "light_domain_radiance",
            "character_id": character_id,
            "character_name": character.name,
            "source_token_id": req.source_token_id,
            "save_dc": spell_save_dc,
            "damage_total": base_damage,
            "successful_saves": successful_saves,
            "failed_saves": failed_saves,
            "target_count": len(target_results),
        },
    )
    db.add(chat_msg)
    await db.commit()
    await db.refresh(chat_msg)

    await realtime_publisher.publish_chat_message(
        req.campaign_id,
        chat_id=chat_msg.id,
        user_id=character.user_id,
        role="player",
        message=content,
        message_type="combat",
        recipients=[],
        is_private=False,
        meta=chat_msg.meta,
        timestamp=int(chat_msg.created_at.timestamp() * 1000)
        if chat_msg.created_at
        else int(datetime.utcnow().timestamp() * 1000),
    )

    for target in target_results:
        if not target["hp_change"]:
            continue
        token_after = await db.get(Token, target["token_id"])
        await realtime_publisher.publish_token_hp_updated(
            req.campaign_id,
            token_id=target["token_id"],
            current_hp=target["new_hp"],
            hp_change=target["hp_change"],
            target_defeated=target["target_defeated"],
            temp_hp=token_after.temp_hp if token_after else None,
            active_effects=token_after.active_effects if token_after else None,
            character_id=target["character_id"],
            monster_instance_id=target["monster_instance_id"],
        )

    for dispelled in dispelled_darkness_tokens:
        await realtime_publisher.publish_token_concentration_updated(
            req.campaign_id,
            token_id=dispelled["token_id"],
            concentration_spell=None,
        )
        if dispelled["active_effects_changed"]:
            await realtime_publisher.publish_token_active_effects_updated(
                req.campaign_id,
                token_id=dispelled["token_id"],
                active_effects=dispelled["active_effects"],
            )

    return {
        "status": "ok",
        "save_dc": spell_save_dc,
        "damage_roll": {
            "dice": "2d10",
            "rolls": damage_rolls,
            "modifier": character.level,
            "total": base_damage,
        },
        "successful_saves": successful_saves,
        "failed_saves": failed_saves,
        "dispelled_darkness_count": len(dispelled_darkness_tokens),
        "channel_divinity_current": new_uses,
        "channel_divinity_max": max_uses,
        "targets": target_results,
    }


# ── Divine Smite (神圣惩击) ─────────────────────────────────────
class DivineSmiteRequest(BaseModel):
    target_token_id: int
    spell_slot_level: int  # 1-5
    campaign_id: int


@router.post("/{character_id}/divine-smite")
async def use_divine_smite(
    character_id: int,
    req: DivineSmiteRequest,
    db: AsyncSession = Depends(get_db),
):
    """Use Divine Smite: consume a spell slot to deal radiant damage to a target."""
    from app.models.chat_message import ChatMessage
    from app.models.monster_instance import MonsterInstance

    if req.spell_slot_level < 1 or req.spell_slot_level > 5:
        raise HTTPException(status_code=400, detail="法术位环数必须在1-5之间")

    # 1. Load source character
    result = await db.execute(select(Character).where(Character.id == character_id))
    character = result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    # 2. Check spell slot availability
    spell_slots = character.spell_slots_state
    if not spell_slots:
        raise HTTPException(status_code=400, detail="没有可用的法术位")

    slot_available = False
    actual_slot_level = req.spell_slot_level
    if isinstance(spell_slots, dict) and 'slots' in spell_slots:
        slots = spell_slots['slots']
        if isinstance(slots, list) and len(slots) > req.spell_slot_level:
            if slots[req.spell_slot_level] and slots[req.spell_slot_level] > 0:
                slot_available = True
    elif isinstance(spell_slots, list):
        if len(spell_slots) > req.spell_slot_level:
            if spell_slots[req.spell_slot_level] and spell_slots[req.spell_slot_level] > 0:
                slot_available = True

    if not slot_available:
        raise HTTPException(status_code=400, detail=f"{req.spell_slot_level}环法术位已用尽")

    # 3. Resolve target token
    token_result = await db.execute(select(Token).where(Token.id == req.target_token_id))
    target_token = token_result.scalar_one_or_none()
    if not target_token:
        raise HTTPException(status_code=404, detail="Target token not found")

    target_name = target_token.instance_name or "目标"

    # 4. Check if target is undead or fiend
    is_undead_or_fiend = False
    if target_token.monster_instance_id:
        mi_result = await db.execute(
            select(MonsterInstance).where(MonsterInstance.id == target_token.monster_instance_id)
        )
        monster = mi_result.scalar_one_or_none()
        if monster:
            target_name = target_token.instance_name or monster.name or "目标"
            m_type = (monster.type or "").lower()
            is_undead_or_fiend = m_type in ("undead", "fiend")

    # 5. Roll damage: min(1+slot_level, 5)d8, +1d8 vs undead/fiend
    base_dice = min(1 + req.spell_slot_level, 5)
    bonus_dice = 1 if is_undead_or_fiend else 0
    total_dice = base_dice + bonus_dice
    damage = sum(random.randint(1, 8) for _ in range(total_dice))

    # 6. Apply damage to target
    target_new_hp = None
    target_max_hp = None
    if target_token.character_id:
        char_result = await db.execute(select(Character).where(Character.id == target_token.character_id))
        target_char = char_result.scalar_one_or_none()
        if target_char:
            target_max_hp = character_sheet_service._compute_max_hp(target_char)
            current = target_token.current_hp if target_token.current_hp is not None else (target_char.current_hp or target_max_hp)
            target_new_hp = max(0, current - damage)
            target_token.current_hp = target_new_hp
            target_char.current_hp = target_new_hp
    elif target_token.monster_instance_id:
        mi_result2 = await db.execute(
            select(MonsterInstance).where(MonsterInstance.id == target_token.monster_instance_id)
        )
        monster2 = mi_result2.scalar_one_or_none()
        if monster2:
            target_max_hp = monster2.hit_points or 0
            current = target_token.current_hp if target_token.current_hp is not None else (monster2.current_hp or target_max_hp)
            target_new_hp = max(0, current - damage)
            target_token.current_hp = target_new_hp
            monster2.current_hp = target_new_hp

    # 7. Consume spell slot (inline, same logic as combat._consume_spell_slot)
    if isinstance(spell_slots, dict) and 'slots' in spell_slots:
        slots = spell_slots['slots']
        if isinstance(slots, list) and len(slots) > req.spell_slot_level:
            slots[req.spell_slot_level] -= 1
            spell_slots['slots'] = slots
    elif isinstance(spell_slots, list):
        spell_slots[req.spell_slot_level] -= 1

    character.spell_slots_state = spell_slots
    flag_modified(character, 'spell_slots_state')
    await db.commit()

    # 8. Build chat message
    dice_str = f"{base_dice}d8"
    if is_undead_or_fiend:
        dice_str += "+1d8(亡灵/邪魔)"
    content = (
        f"**{character.name}** 使用了 **神圣惩击**（{req.spell_slot_level}环位）"
        f"对 **{target_name}** 造成 **{damage}** 点光耀伤害"
        f"（{dice_str} = {damage}）"
    )

    chat_msg = ChatMessage(
        campaign_id=req.campaign_id,
        sender_user_id=character.user_id,
        sender_role="player",
        message_type="system",
        content=content,
        meta={"resource_use": {
            "character_id": character_id,
            "character_name": character.name,
            "resource_id": "divine_smite",
            "resource_name": "神圣惩击",
            "spell_slot_level": req.spell_slot_level,
            "damage": damage,
            "damage_type": "radiant",
        }},
    )
    db.add(chat_msg)
    await db.commit()
    await db.refresh(chat_msg)

    # 9. Broadcast resource_use to chat
    await realtime_publisher.publish_resource_use(
        req.campaign_id,
        data=build_resource_use_broadcast_data(
            chat_id=chat_msg.id,
            character_id=character_id,
            character_name=character.name,
            user_id=character.user_id,
            resource_id="divine_smite",
            resource_name="神圣惩击",
            content=content,
            created_at=chat_msg.created_at,
        ),
    )

    # 10. Broadcast token HP update
    if target_new_hp is not None:
        await realtime_publisher.publish_token_hp_updated(
            req.campaign_id,
            token_id=req.target_token_id,
            current_hp=target_new_hp,
            max_hp=target_max_hp,
            character_id=target_token.character_id,
            monster_instance_id=target_token.monster_instance_id,
        )

    # 11. Broadcast spell slot consumed
    await realtime_publisher.publish_spell_slot_consumed(
        req.campaign_id,
        character_id=character_id,
        slot_level=req.spell_slot_level,
        use_pact_slot=False,
        new_spell_slots_state=spell_slots,
    )

    return {
        "status": "ok",
        "damage": damage,
        "damage_dice": total_dice,
        "is_undead_or_fiend": is_undead_or_fiend,
        "spell_slot_level": req.spell_slot_level,
        "target_current_hp": target_new_hp,
        "target_max_hp": target_max_hp,
    }


# ── Arcane Recovery (奥术恢复) ─────────────────────────────────
class ArcaneRecoveryRequest(BaseModel):
    slot_recoveries: Dict[str, int]  # {"1": 1, "3": 1} — level → count
    campaign_id: int


@router.post("/{character_id}/arcane-recovery")
async def use_arcane_recovery(
    character_id: int,
    req: ArcaneRecoveryRequest,
    db: AsyncSession = Depends(get_db),
):
    """Arcane Recovery: recover spell slots, total levels ≤ ceil(wizard_level/2), max 5th."""
    from app.models.chat_message import ChatMessage
    import math

    result = await db.execute(select(Character).where(Character.id == character_id))
    character = result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    wizard_level = character.level or 1
    budget = math.ceil(wizard_level / 2)

    # Validate recoveries
    total_levels = 0
    parsed: Dict[int, int] = {}
    for lvl_str, count in req.slot_recoveries.items():
        lvl = int(lvl_str)
        if lvl < 1 or lvl > 5:
            raise HTTPException(status_code=400, detail=f"不能恢复{lvl}级法术位（最高5级）")
        if count < 1:
            continue
        parsed[lvl] = count
        total_levels += lvl * count

    if total_levels == 0:
        raise HTTPException(status_code=400, detail="没有选择要恢复的法术位")
    if total_levels > budget:
        raise HTTPException(status_code=400, detail=f"总等级 {total_levels} 超过预算 {budget}")

    # Validate spell slots exist and have room
    spell_slots = character.spell_slots_state
    if not spell_slots or not isinstance(spell_slots, list):
        raise HTTPException(status_code=400, detail="没有法术位数据")

    # Get max slots to check room
    initial_slots = get_initial_spell_slots(character.class_id or "wizard", wizard_level, character.multiclass_data)
    if isinstance(initial_slots, dict) and 'slots' in initial_slots:
        max_slots = initial_slots['slots']
    elif isinstance(initial_slots, list):
        max_slots = initial_slots
    else:
        max_slots = [0] * 10

    for lvl, count in parsed.items():
        current = spell_slots[lvl] if len(spell_slots) > lvl else 0
        max_val = max_slots[lvl] if len(max_slots) > lvl else 0
        room = max_val - current
        if count > room:
            raise HTTPException(status_code=400, detail=f"{lvl}环法术位最多可恢复{room}个")

    # Check arcane_recovery uses (before modifying state)
    uses = character.class_feature_uses or {}
    ar_state = uses.get("arcane_recovery", {"current": 1, "max": 1})
    if ar_state.get("current", 0) <= 0:
        raise HTTPException(status_code=400, detail="奥术恢复今天已使用过（长休后重置）")

    # Apply recoveries
    for lvl, count in parsed.items():
        spell_slots[lvl] += count

    character.spell_slots_state = spell_slots
    flag_modified(character, 'spell_slots_state')

    # Consume arcane_recovery use
    ar_state["current"] = ar_state["current"] - 1
    uses["arcane_recovery"] = ar_state
    character.class_feature_uses = uses
    flag_modified(character, 'class_feature_uses')

    await db.commit()

    # Build summary
    parts = [f"{lvl}环×{count}" for lvl, count in sorted(parsed.items())]
    content = f"**{character.name}** 使用了 **奥术恢复**，恢复了 {', '.join(parts)} 法术位（共{total_levels}级）"

    chat_msg = ChatMessage(
        campaign_id=req.campaign_id,
        sender_user_id=character.user_id,
        sender_role="player",
        message_type="system",
        content=content,
        meta={"resource_use": {
            "character_id": character_id,
            "character_name": character.name,
            "resource_id": "arcane_recovery",
            "resource_name": "奥术恢复",
            "slot_recoveries": {str(k): v for k, v in parsed.items()},
        }},
    )
    db.add(chat_msg)
    await db.commit()
    await db.refresh(chat_msg)

    await realtime_publisher.publish_resource_use(
        req.campaign_id,
        data=build_resource_use_broadcast_data(
            chat_id=chat_msg.id,
            character_id=character_id,
            character_name=character.name,
            user_id=character.user_id,
            resource_id="arcane_recovery",
            resource_name="奥术恢复",
            content=content,
            created_at=chat_msg.created_at,
        ),
    )

    await realtime_publisher.publish_spell_slots_updated(
        req.campaign_id,
        character_id=character_id,
        spell_slots_state=spell_slots,
        event_type="spell_slots_update",
    )

    return {"status": "ok", "spell_slots_state": spell_slots}


# ── Natural Recovery (自然恢复 — Druid Land) ───────────────────
@router.post("/{character_id}/natural-recovery")
async def use_natural_recovery(
    character_id: int,
    req: ArcaneRecoveryRequest,
    db: AsyncSession = Depends(get_db),
):
    """Natural Recovery: identical to Arcane Recovery but for Land Druids."""
    from app.models.chat_message import ChatMessage
    import math

    result = await db.execute(select(Character).where(Character.id == character_id))
    character = result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    druid_level = character.level or 1
    budget = math.ceil(druid_level / 2)

    total_levels = 0
    parsed: Dict[int, int] = {}
    for lvl_str, count in req.slot_recoveries.items():
        lvl = int(lvl_str)
        if lvl < 1 or lvl > 5:
            raise HTTPException(status_code=400, detail=f"不能恢复{lvl}级法术位（最高5级）")
        if count < 1:
            continue
        parsed[lvl] = count
        total_levels += lvl * count

    if total_levels == 0:
        raise HTTPException(status_code=400, detail="没有选择要恢复的法术位")
    if total_levels > budget:
        raise HTTPException(status_code=400, detail=f"总等级 {total_levels} 超过预算 {budget}")

    spell_slots = character.spell_slots_state
    if not spell_slots or not isinstance(spell_slots, list):
        raise HTTPException(status_code=400, detail="没有法术位数据")

    initial_slots = get_initial_spell_slots(character.class_id or "druid", druid_level, character.multiclass_data)
    max_slots = initial_slots if isinstance(initial_slots, list) else (initial_slots.get('slots', [0] * 10) if isinstance(initial_slots, dict) else [0] * 10)

    for lvl, count in parsed.items():
        current = spell_slots[lvl] if len(spell_slots) > lvl else 0
        max_val = max_slots[lvl] if len(max_slots) > lvl else 0
        room = max_val - current
        if count > room:
            raise HTTPException(status_code=400, detail=f"{lvl}环法术位最多可恢复{room}个")

    uses = character.class_feature_uses or {}
    nr_state = uses.get("natural_recovery", {"current": 1, "max": 1})
    if nr_state.get("current", 0) <= 0:
        raise HTTPException(status_code=400, detail="自然恢复今天已使用过（长休后重置）")

    for lvl, count in parsed.items():
        spell_slots[lvl] += count
    character.spell_slots_state = spell_slots
    flag_modified(character, 'spell_slots_state')

    nr_state["current"] = nr_state["current"] - 1
    uses["natural_recovery"] = nr_state
    character.class_feature_uses = uses
    flag_modified(character, 'class_feature_uses')
    await db.commit()

    parts = [f"{lvl}环×{count}" for lvl, count in sorted(parsed.items())]
    content = f"**{character.name}** 使用了 **自然恢复**，恢复了 {', '.join(parts)} 法术位（共{total_levels}级）"

    chat_msg = ChatMessage(
        campaign_id=req.campaign_id,
        sender_user_id=character.user_id,
        sender_role="player",
        message_type="system",
        content=content,
        meta={"resource_use": {
            "character_id": character_id,
            "character_name": character.name,
            "resource_id": "natural_recovery",
            "resource_name": "自然恢复",
            "slot_recoveries": {str(k): v for k, v in parsed.items()},
        }},
    )
    db.add(chat_msg)
    await db.commit()
    await db.refresh(chat_msg)

    await realtime_publisher.publish_resource_use(
        req.campaign_id,
        data=build_resource_use_broadcast_data(
            chat_id=chat_msg.id,
            character_id=character_id,
            character_name=character.name,
            user_id=character.user_id,
            resource_id="natural_recovery",
            resource_name="自然恢复",
            content=content,
            created_at=chat_msg.created_at,
        ),
    )
    await realtime_publisher.publish_spell_slots_updated(
        req.campaign_id,
        character_id=character_id,
        spell_slots_state=spell_slots,
        event_type="spell_slots_update",
    )

    return {"status": "ok", "spell_slots_state": spell_slots}


# ── Flexible Casting (灵活施法) ────────────────────────────────
SLOT_TO_POINTS = {1: 2, 2: 3, 3: 5, 4: 6, 5: 7}


class FlexibleCastingRequest(BaseModel):
    action: str  # "create_slot" or "convert_slot"
    slot_level: int
    campaign_id: int


@router.post("/{character_id}/flexible-casting")
async def use_flexible_casting(
    character_id: int,
    req: FlexibleCastingRequest,
    db: AsyncSession = Depends(get_db),
):
    """Flexible Casting: convert sorcery points ↔ spell slots."""
    from app.models.chat_message import ChatMessage

    if req.action not in ("create_slot", "convert_slot"):
        raise HTTPException(status_code=400, detail="action 必须为 create_slot 或 convert_slot")

    result = await db.execute(select(Character).where(Character.id == character_id))
    character = result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    uses = character.class_feature_uses or {}
    sp_state = uses.get("sorcery_points", {})
    sp_current = sp_state.get("current", 0)
    sp_max = sp_state.get("max", character.level or 2)

    spell_slots = character.spell_slots_state
    if not spell_slots or not isinstance(spell_slots, list):
        raise HTTPException(status_code=400, detail="没有法术位数据")

    if req.action == "create_slot":
        if req.slot_level < 1 or req.slot_level > 5:
            raise HTTPException(status_code=400, detail="只能创造1-5级法术位")
        cost = SLOT_TO_POINTS.get(req.slot_level)
        if cost is None or sp_current < cost:
            raise HTTPException(status_code=400, detail=f"术法点不足（需要{cost}，当前{sp_current}）")
        # Deduct sorcery points
        sp_state["current"] = sp_current - cost
        # Add spell slot
        while len(spell_slots) <= req.slot_level:
            spell_slots.append(0)
        spell_slots[req.slot_level] += 1
        content = f"**{character.name}** 使用 **灵活施法** 消耗 {cost} 术法点，创造了 1 个 {req.slot_level} 环法术位"
    else:
        # convert_slot: consume slot → gain points
        if req.slot_level < 1 or req.slot_level > 9:
            raise HTTPException(status_code=400, detail="法术位等级必须在1-9之间")
        current_slot = spell_slots[req.slot_level] if len(spell_slots) > req.slot_level else 0
        if current_slot <= 0:
            raise HTTPException(status_code=400, detail=f"{req.slot_level}环法术位已用尽")
        gained = req.slot_level
        if sp_current + gained > sp_max:
            raise HTTPException(status_code=400, detail=f"术法点将超过上限（{sp_current}+{gained}>{sp_max}）")
        # Consume spell slot
        spell_slots[req.slot_level] -= 1
        # Add sorcery points
        sp_state["current"] = sp_current + gained
        content = f"**{character.name}** 使用 **灵活施法** 消耗 1 个 {req.slot_level} 环法术位，获得 {gained} 术法点"

    uses["sorcery_points"] = sp_state
    character.class_feature_uses = uses
    flag_modified(character, 'class_feature_uses')
    character.spell_slots_state = spell_slots
    flag_modified(character, 'spell_slots_state')
    await db.commit()

    chat_msg = ChatMessage(
        campaign_id=req.campaign_id,
        sender_user_id=character.user_id,
        sender_role="player",
        message_type="system",
        content=content,
        meta={"resource_use": {
            "character_id": character_id,
            "character_name": character.name,
            "resource_id": "flexible_casting",
            "resource_name": "灵活施法",
            "action": req.action,
            "slot_level": req.slot_level,
        }},
    )
    db.add(chat_msg)
    await db.commit()
    await db.refresh(chat_msg)

    await realtime_publisher.publish_resource_use(
        req.campaign_id,
        data=build_resource_use_broadcast_data(
            chat_id=chat_msg.id,
            character_id=character_id,
            character_name=character.name,
            user_id=character.user_id,
            resource_id="flexible_casting",
            resource_name="灵活施法",
            content=content,
            created_at=chat_msg.created_at,
        ),
    )

    await realtime_publisher.publish_spell_slots_updated(
        req.campaign_id,
        character_id=character_id,
        spell_slots_state=spell_slots,
        event_type="spell_slots_update",
    )

    return {
        "status": "ok",
        "spell_slots_state": spell_slots,
        "sorcery_points_current": sp_state["current"],
        "sorcery_points_max": sp_max,
    }


class RestoreResourceRequest(BaseModel):
    resource_id: str
    amount: Optional[int] = None  # None = restore to max
    campaign_id: Optional[int] = None


@router.post("/{character_id}/resources/restore")
async def restore_character_resource(
    character_id: int,
    req: RestoreResourceRequest,
    db: AsyncSession = Depends(get_db),
):
    """Restore a class resource."""
    update_result = await restore_character_resource_service(
        db,
        character_id=character_id,
        resource_id=req.resource_id,
        amount=req.amount,
    )

    if req.campaign_id:
        await realtime_publisher.publish_resource_updated(
            req.campaign_id,
            character_id=character_id,
            resource_id=req.resource_id,
            current=update_result.current,
            max=update_result.max,
        )

    return {
        "status": "ok",
        "resource_id": req.resource_id,
        "current": update_result.current,
        "max": update_result.max,
    }


class SetResourceRequest(BaseModel):
    resource_id: str
    value: int
    campaign_id: Optional[int] = None


@router.post("/{character_id}/resources/set")
async def set_character_resource(
    character_id: int,
    req: SetResourceRequest,
    db: AsyncSession = Depends(get_db),
):
    """Set a class resource to a specific value (DM only)."""
    update_result = await set_character_resource_service(
        db,
        character_id=character_id,
        resource_id=req.resource_id,
        value=req.value,
    )

    if req.campaign_id:
        await realtime_publisher.publish_resource_updated(
            req.campaign_id,
            character_id=character_id,
            resource_id=req.resource_id,
            current=update_result.current,
            max=update_result.max,
        )

    return {
        "status": "ok",
        "resource_id": req.resource_id,
        "current": update_result.current,
        "max": update_result.max,
    }


# ============ Spell Preparation System ============

# Prepared casters and their spellcasting ability
PREPARED_CASTERS = {
    "wizard": "intelligence",
    "cleric": "wisdom",
    "druid": "wisdom",
    "paladin": "charisma",
    "artificer": "intelligence",
}

# 法术书型准备施法者：虽然是准备型，但只能从法术书(selected_spells)中准备法术，
# 而非像牧师/德鲁伊那样从完整职业法术列表中准备。
# 未来新职业如有类似机制只需加入此集合。
SPELLBOOK_CASTERS = {"wizard"}


def get_max_prepared_spells(class_id: str, level: int, ability_scores: Dict) -> int:
    """
    Calculate maximum prepared spells for a prepared caster.
    - Wizard: level + INT modifier
    - Cleric/Druid: level + WIS modifier
    - Paladin: level/2 + CHA modifier (minimum 1)
    - Artificer: ceil(level/2) + INT modifier (minimum 1)
    """
    if class_id not in PREPARED_CASTERS:
        return 0

    ability = PREPARED_CASTERS[class_id]
    score = ability_scores.get(ability, 10)
    modifier = (score - 10) // 2

    if class_id == "paladin":
        # Paladin uses half level (rounded down)
        max_prepared = (level // 2) + modifier
    elif class_id == "artificer":
        # Artificer uses half level (rounded UP): (level + 1) // 2
        max_prepared = ((level + 1) // 2) + modifier
    else:
        max_prepared = level + modifier

    return max(1, max_prepared)  # Minimum 1


def get_max_spell_level_for_class(class_id: str, level: int) -> int:
    """Get the maximum spell level a class can cast at a given level."""
    if class_id in ["wizard", "cleric", "druid", "sorcerer", "bard"]:
        # Full casters
        if level >= 17:
            return 9
        elif level >= 15:
            return 8
        elif level >= 13:
            return 7
        elif level >= 11:
            return 6
        elif level >= 9:
            return 5
        elif level >= 7:
            return 4
        elif level >= 5:
            return 3
        elif level >= 3:
            return 2
        else:
            return 1
    elif class_id in ["paladin", "ranger", "artificer"]:
        # Half casters (get spells at level 2)
        if level < 2:
            return 0
        elif level >= 17:
            return 5
        elif level >= 13:
            return 4
        elif level >= 9:
            return 3
        elif level >= 5:
            return 2
        else:
            return 1
    elif class_id == "warlock":
        # Warlock pact magic
        if level >= 9:
            return 5
        elif level >= 7:
            return 4
        elif level >= 5:
            return 3
        elif level >= 3:
            return 2
        else:
            return 1
    return 0


@router.get("/{character_id}/spell-preparation")
async def get_spell_preparation(
    character_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Get spell preparation info for a prepared caster.
    Returns available spells from class spell list and current prepared spells.
    """
    result = await db.execute(select(Character).where(Character.id == character_id))
    character = result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    class_id = character.class_id
    is_prepared_caster = class_id in PREPARED_CASTERS

    # Load spell data
    all_spells = get_all_spells()

    # Get max spell level this character can cast
    max_spell_level = get_max_spell_level_for_class(class_id, character.level)

    # Filter spells by class
    available_spells = []
    for spell in all_spells:
        spell_classes = spell.get("classes", [])
        spell_level = spell.get("level", 0)

        # Skip cantrips (level 0) - those are in selected_cantrips
        if spell_level == 0:
            continue

        # Skip spells above max level
        if spell_level > max_spell_level:
            continue

        # Check if this class can use this spell
        if class_id in spell_classes:
            available_spells.append({
                "id": spell.get("id"),
                "name": spell.get("name"),
                "nameEn": spell.get("nameEn"),
                "level": spell_level,
                "school": spell.get("school"),
                "ritual": spell.get("ritual", False),
                "concentration": spell.get("concentration", False),
            })

    # Sort by level then name
    available_spells.sort(key=lambda s: (s["level"], s["name"]))

    # Calculate max prepared spells
    ability_scores = character.ability_scores or {}
    max_prepared = get_max_prepared_spells(class_id, character.level, ability_scores)

    # Current prepared spells
    prepared_spells = character.prepared_spells or []

    # For spellbook casters, only show spells from their spellbook (selected_spells)
    spellbook = []
    if class_id in SPELLBOOK_CASTERS:
        spellbook = character.selected_spells or []
        # Extract spell IDs from spellbook (supports both string and dict formats)
        spellbook_ids = set(extract_spell_ids(spellbook))
        # Wizard can only prepare spells from their spellbook
        available_spells = [s for s in available_spells if s["id"] in spellbook_ids]

    return {
        "is_prepared_caster": is_prepared_caster,
        "class_id": class_id,
        "spellcasting_ability": PREPARED_CASTERS.get(class_id),
        "max_prepared": max_prepared if is_prepared_caster else None,
        "current_prepared_count": len(prepared_spells),
        "prepared_spells": prepared_spells,
        "available_spells": available_spells,
        "spellbook": spellbook if class_id in SPELLBOOK_CASTERS else None,
        "max_spell_level": max_spell_level,
    }


class SpellPreparationRequest(BaseModel):
    prepared_spells: List[str]
    campaign_id: Optional[int] = None


@router.post("/{character_id}/spell-preparation")
async def update_spell_preparation(
    character_id: int,
    req: SpellPreparationRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Update prepared spells for a character.
    Validates that spells are valid for the class and within max prepared limit.
    """
    result = await db.execute(select(Character).where(Character.id == character_id))
    character = result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    class_id = character.class_id

    # Non-prepared casters just use their known spells
    if class_id not in PREPARED_CASTERS:
        raise HTTPException(
            status_code=400,
            detail=f"{class_id} is not a prepared caster. Use selected_spells instead."
        )

    # Calculate max prepared
    ability_scores = character.ability_scores or {}
    max_prepared = get_max_prepared_spells(class_id, character.level, ability_scores)

    if len(req.prepared_spells) > max_prepared:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot prepare more than {max_prepared} spells"
        )

    # Validate spells are available to this class
    valid_spell_ids = set()
    all_spells = get_all_spells()
    max_spell_level = get_max_spell_level_for_class(class_id, character.level)

    for spell in all_spells:
        if class_id in spell.get("classes", []):
            if 0 < spell.get("level", 0) <= max_spell_level:
                valid_spell_ids.add(spell.get("id"))

    # For spellbook casters, must be in spellbook (selected_spells)
    if class_id in SPELLBOOK_CASTERS:
        spellbook = set(extract_spell_ids(character.selected_spells or []))
        valid_spell_ids = valid_spell_ids.intersection(spellbook)

    # Validate all requested spells
    invalid_spells = [s for s in req.prepared_spells if s not in valid_spell_ids]
    if invalid_spells:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid spells for {class_id}: {invalid_spells}"
        )

    # Update prepared spells
    character.prepared_spells = req.prepared_spells
    flag_modified(character, 'prepared_spells')
    await db.commit()

    # Broadcast update
    if req.campaign_id:
        await realtime_publisher.publish_spell_preparation_updated(
            req.campaign_id,
            character_id=character_id,
            prepared_spells=req.prepared_spells,
            prepared_count=len(req.prepared_spells),
            max_prepared=max_prepared,
        )

    return {
        "status": "ok",
        "prepared_spells": req.prepared_spells,
        "prepared_count": len(req.prepared_spells),
        "max_prepared": max_prepared,
    }


class SetFamiliarRequest(BaseModel):
    familiar_id: str
    campaign_id: Optional[int] = None


@router.post("/{character_id}/set-familiar")
async def set_familiar(
    character_id: int,
    req: SetFamiliarRequest,
    db: AsyncSession = Depends(get_db),
):
    """Set familiar form for an existing Chain Pact warlock."""
    result = await db.execute(select(Character).where(Character.id == character_id))
    character = result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    sc = character.subclass_choices or {}
    if sc.get("pactBoon") != "chain":
        raise HTTPException(status_code=400, detail="Character does not have Pact of the Chain")

    # Validate familiar_id
    from app.utils.rules_cache import get_companions_data
    companions_data = get_companions_data()
    cat = companions_data["categories"].get("find_familiar")
    if not cat or not any(c["id"] == req.familiar_id for c in cat["creatures"]):
        raise HTTPException(status_code=400, detail=f"Unknown familiar: {req.familiar_id}")

    sc["familiarForm"] = req.familiar_id
    character.subclass_choices = sc
    flag_modified(character, "subclass_choices")

    if req.campaign_id:
        await _create_companion_instance(
            db, req.campaign_id, character, req.familiar_id,
            category="find_familiar", control_type="familiar"
        )

    await db.commit()
    await db.refresh(character)
    return {"status": "ok", "familiarForm": req.familiar_id}
