"""
Aura Service
Handles aura effects calculation and management for D&D 5E
"""
import logging
from typing import Dict, Any, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm.attributes import flag_modified

from app.models.token import Token
from app.models.character import Character
from app.models.monster_instance import MonsterInstance
from app.services.character_command_service import (
    CONDITION_EFFECT_COLORS,
    CONDITION_EFFECT_ICONS,
)
from app.services.immunity_service import CONDITION_TRANSLATIONS
from app.services.websocket_manager import manager

logger = logging.getLogger(__name__)

DEFAULT_AURA_ICON = "🌀"
DEFAULT_AURA_COLOR = "#38bdf8"
DEFAULT_AURA_FILL = "rgba(56, 189, 248, 0.18)"
DEFAULT_AURA_DESCRIPTION = "位于光环范围内时生效"

# Load aura definitions from effects.json
_aura_definitions: Dict[str, Dict[str, Any]] = {}

SPELL_AURA_OVERRIDES: Dict[str, Dict[str, Any]] = {
    "crusaders_mantle": {
        "id": "crusaders_mantle",
        "name": "十字军披风",
        "description": "光环内非敌对生物的武器命中额外造成 1d4 光耀伤害。",
        "icon": "⚔️",
        "color": "#f59e0b",
        "fill_color": "rgba(245, 158, 11, 0.18)",
        "radius": 30,
        "affects_self": True,
        "affects_allies": True,
        "affects_enemies": False,
        "bonus_damage": [
            {
                "attack_kind": "weapon",
                "formula": "1d4",
                "damage_type": "radiant",
            }
        ],
    },
    "aura_of_vitality": {
        "id": "aura_of_vitality",
        "name": "活力灵光",
        "description": "你可以用附赠动作治疗光环内一个生物 2d6 生命值。",
        "icon": "💚",
        "color": "#22c55e",
        "fill_color": "rgba(34, 197, 94, 0.18)",
        "radius": 30,
        "affects_self": True,
        "affects_allies": True,
        "affects_enemies": True,
    },
    "spirit_guardians": {
        "id": "spirit_guardians",
        "name": "灵体卫士",
        "description": "敌人在光环内速度减半，并在进出/回合开始时承受法术结算效果。",
        "icon": "👻",
        "color": "#f472b6",
        "fill_color": "rgba(244, 114, 182, 0.18)",
        "radius": 15,
        "affects_self": False,
        "affects_allies": False,
        "affects_enemies": True,
        "movement_restriction": "halved",
    },
    "aura_of_purity": {
        "id": "aura_of_purity",
        "name": "净化灵光",
        "description": "光环内生物对毒素伤害具有抗性，且豁免具有优势。",
        "icon": "🫧",
        "color": "#38bdf8",
        "fill_color": "rgba(56, 189, 248, 0.18)",
        "radius": 30,
        "affects_self": True,
        "affects_allies": True,
        "affects_enemies": False,
        "modifiers": [
            {
                "target": "damage_taken",
                "type": "resistance",
                "condition": {"damage_type": "poison"},
            },
            {
                "target": "saving_throw",
                "type": "advantage",
            },
        ],
    },
    "aura_of_life": {
        "id": "aura_of_life",
        "name": "生命灵光",
        "description": "光环内生物对黯蚀伤害具有抗性。",
        "icon": "🌿",
        "color": "#84cc16",
        "fill_color": "rgba(132, 204, 22, 0.18)",
        "radius": 30,
        "affects_self": True,
        "affects_allies": True,
        "affects_enemies": False,
        "modifiers": [
            {
                "target": "damage_taken",
                "type": "resistance",
                "condition": {"damage_type": "necrotic"},
            }
        ],
        "downed_heal_per_turn": 1,
    },
    "circle_of_power": {
        "id": "circle_of_power",
        "name": "原力法阵",
        "description": "光环内友军豁免具有优势，成功通过原本半伤的法术豁免时改为不受伤害。",
        "icon": "🔵",
        "color": "#60a5fa",
        "fill_color": "rgba(96, 165, 250, 0.18)",
        "radius": 30,
        "affects_self": True,
        "affects_allies": True,
        "affects_enemies": False,
        "modifiers": [
            {
                "target": "saving_throw",
                "type": "advantage",
            }
        ],
        "save_success_override": {
            "mode": "no_damage_on_success",
            "scope": "spell",
        },
    },
    "holy_aura": {
        "id": "holy_aura",
        "name": "圣洁灵光",
        "description": "受术生物豁免具有优势，攻击它们的检定具有劣势。",
        "icon": "✨",
        "color": "#facc15",
        "fill_color": "rgba(250, 204, 21, 0.18)",
        "radius": 30,
        "affects_self": True,
        "affects_allies": True,
        "affects_enemies": False,
        "selected_targets_only": True,
        "modifiers": [
            {
                "target": "saving_throw",
                "type": "advantage",
            },
            {
                "target": "incoming_attack",
                "type": "disadvantage",
            },
        ],
        "token_filter": {
            "glow": "#fbbf24",
            "glowRadius": 14,
            "glowAnimation": "pulse",
        },
        "retaliate_on_hit": {
            "condition": "blinded",
            "save_type": "con",
            "attack_kind": "melee",
            "attacker_creature_types": ["fiend", "undead"],
        },
    },
}


def _load_aura_definitions() -> Dict[str, Dict[str, Any]]:
    """Load aura definitions from effects.json"""
    global _aura_definitions
    if _aura_definitions:
        return _aura_definitions
    try:
        from app.utils.rules_cache import get_effects_data
        effects_data = get_effects_data()
        auras = effects_data.get("auras", [])
        _aura_definitions = {a["id"]: a for a in auras}
    except Exception as e:
        logger.error(f"Failed to load aura definitions: {e}")
        _aura_definitions = {}
    return _aura_definitions


def get_aura_definition(aura_id: str) -> Optional[Dict[str, Any]]:
    """Get aura definition by ID"""
    definitions = _load_aura_definitions()
    return definitions.get(aura_id) or SPELL_AURA_OVERRIDES.get(aura_id)


def get_all_aura_definitions() -> List[Dict[str, Any]]:
    """Get all aura definitions"""
    definitions = _load_aura_definitions()
    merged = {**SPELL_AURA_OVERRIDES, **definitions}
    return list(merged.values())


def _hex_to_rgba(color: str, alpha: float = 0.18) -> str:
    raw = (color or "").strip().lstrip("#")
    if len(raw) != 6:
        return DEFAULT_AURA_FILL
    try:
        red = int(raw[0:2], 16)
        green = int(raw[2:4], 16)
        blue = int(raw[4:6], 16)
    except ValueError:
        return DEFAULT_AURA_FILL
    return f"rgba({red}, {green}, {blue}, {alpha})"


def _is_active_duration(duration: Any) -> bool:
    if not isinstance(duration, dict):
        return True
    duration_type = duration.get("type")
    if duration_type == "permanent":
        return True
    try:
        return int(duration.get("remaining") or 0) > 0
    except (TypeError, ValueError):
        return True


def _get_status_custom_effects(status_effects: Dict[str, Any] | None) -> List[Dict[str, Any]]:
    if not isinstance(status_effects, dict):
        return []
    custom_effects = status_effects.get("custom_effects")
    if isinstance(custom_effects, list):
        return custom_effects
    monster_effects = status_effects.get("effects")
    if isinstance(monster_effects, list):
        return monster_effects
    return []


def _extract_condition_immunities_from_modifiers(modifiers: List[Dict[str, Any]]) -> List[str]:
    values: List[str] = []
    for modifier in modifiers:
        if modifier.get("type") != "immunity" or modifier.get("target") != "condition":
            continue
        condition_data = modifier.get("condition")
        if isinstance(condition_data, dict):
            raw = condition_data.get("type")
            if raw:
                values.append(str(raw).strip().lower())
        elif condition_data:
            values.append(str(condition_data).strip().lower())
    return [value for value in values if value]


def _extract_damage_immunities_from_modifiers(modifiers: List[Dict[str, Any]]) -> List[str]:
    values: List[str] = []
    for modifier in modifiers:
        if modifier.get("type") != "immunity" or modifier.get("target") != "damage_taken":
            continue
        condition_data = modifier.get("condition")
        if isinstance(condition_data, dict):
            raw = condition_data.get("damage_type")
            if isinstance(raw, list):
                values.extend(str(value).strip().lower() for value in raw if str(value).strip())
            elif raw:
                values.append(str(raw).strip().lower())
    return [value for value in values if value]


def _aura_bonus_value(effect: Dict[str, Any]) -> int:
    best_value = 0
    for modifier in effect.get("modifiers") or []:
        if modifier.get("type") != "bonus":
            continue
        try:
            best_value = max(best_value, int(modifier.get("value") or 0))
        except (TypeError, ValueError):
            continue
    return best_value


def _materialize_aura_modifiers(
    modifiers: List[Dict[str, Any]] | None,
    *,
    source_cha_mod: int = 0,
) -> List[Dict[str, Any]]:
    materialized: List[Dict[str, Any]] = []
    for raw_modifier in modifiers or []:
        if not isinstance(raw_modifier, dict):
            continue
        modifier = dict(raw_modifier)
        raw_value = modifier.get("value")
        if raw_value == "source_cha_mod":
            value = int(source_cha_mod or 0)
            min_value = modifier.get("min_value")
            if min_value is not None:
                try:
                    value = max(int(min_value), value)
                except (TypeError, ValueError):
                    pass
            modifier["value"] = value
        materialized.append(modifier)
    return materialized


def build_runtime_aura_entry(
    *,
    aura_id: str,
    radius: int,
    source_effect_id: str,
    spell_id: Optional[str] = None,
    spell_name: Optional[str] = None,
    spell_save_dc: Optional[int] = None,
    source_token_id: Optional[int] = None,
    source_cha_mod: int = 0,
    selected_target_token_ids: Optional[List[int]] = None,
) -> Dict[str, Any]:
    aura_def = _resolve_runtime_aura_definition(
        {
            "id": aura_id,
            "spell_id": spell_id,
            "name": spell_name,
            "radius": radius,
            "spell_save_dc": spell_save_dc,
            "source_cha_mod": source_cha_mod,
            "selected_target_token_ids": selected_target_token_ids or [],
        }
    )
    return {
        "id": aura_id,
        "spell_id": spell_id or aura_id,
        "spell_save_dc": spell_save_dc,
        "source_effect_id": source_effect_id,
        "source_token_id": source_token_id,
        "radius": radius,
        "source_cha_mod": source_cha_mod,
        "selected_target_token_ids": selected_target_token_ids or [],
        "enabled": True,
        **aura_def,
    }


def strip_spell_aura_entries(
    active_auras: List[Dict[str, Any]] | None,
    *,
    spell_id: str,
    source_token_id: Optional[int] = None,
) -> List[Dict[str, Any]] | None:
    next_auras: List[Dict[str, Any]] = []
    for aura in active_auras or []:
        aura_spell_id = str(aura.get("spell_id") or aura.get("id") or "")
        if aura_spell_id != str(spell_id):
            next_auras.append(aura)
            continue
        if source_token_id is None:
            continue
        try:
            aura_source_token_id = int(aura.get("source_token_id"))
        except (TypeError, ValueError):
            aura_source_token_id = None
        if aura_source_token_id != int(source_token_id):
            next_auras.append(aura)
    return next_auras or None


def build_status_auras_from_status_effects(status_effects: Dict[str, Any] | None) -> List[Dict[str, Any]]:
    """Extract generic aura runtime entries from persisted custom status effects."""
    active_auras: List[Dict[str, Any]] = []

    for effect in _get_status_custom_effects(status_effects):
        if not isinstance(effect, dict):
            continue
        aura_cfg = effect.get("aura")
        if not isinstance(aura_cfg, dict) or aura_cfg.get("enabled") is False:
            continue
        if not _is_active_duration(effect.get("duration")):
            continue

        effect_id = str(effect.get("id") or f"custom_aura_{len(active_auras)}")
        effect_name = str(effect.get("name") or "光环状态")
        color = str(aura_cfg.get("color") or DEFAULT_AURA_COLOR)
        active_auras.append({
            "id": effect_id,
            "source_effect_id": effect_id,
            "name": str(aura_cfg.get("name") or effect_name),
            "description": str(aura_cfg.get("description") or effect_name),
            "radius": int(aura_cfg.get("radius") or 10),
            "icon": str(aura_cfg.get("icon") or DEFAULT_AURA_ICON),
            "color": color,
            "fill_color": str(aura_cfg.get("fill_color") or _hex_to_rgba(color)),
            "enabled": True,
            "affects_self": bool(aura_cfg.get("affects_self", False)),
            "affects_allies": bool(aura_cfg.get("affects_allies", True)),
            "affects_enemies": bool(aura_cfg.get("affects_enemies", False)),
            "requires_conscious": bool(aura_cfg.get("requires_conscious", True)),
            "applies_conditions": [
                str(condition).strip().lower()
                for condition in (aura_cfg.get("applies_conditions") or [])
                if str(condition).strip()
            ],
            "condition_immunities": [
                str(condition).strip().lower()
                for condition in (aura_cfg.get("condition_immunities") or [])
                if str(condition).strip()
            ],
            "modifiers": list(aura_cfg.get("modifiers") or []),
            "bonus_damage": list(aura_cfg.get("bonus_damage") or []),
            "save_success_override": dict(aura_cfg.get("save_success_override") or {}),
            "retaliate_on_hit": dict(aura_cfg.get("retaliate_on_hit") or {}),
            "token_filter": dict(aura_cfg.get("token_filter") or {}),
            "movement_restriction": aura_cfg.get("movement_restriction"),
            "downed_heal_per_turn": aura_cfg.get("downed_heal_per_turn"),
            "selected_targets_only": bool(aura_cfg.get("selected_targets_only", False)),
            "selected_target_token_ids": [
                int(token_id)
                for token_id in (aura_cfg.get("selected_target_token_ids") or [])
                if str(token_id).strip()
            ],
        })

    return active_auras


def build_status_aura_display_effects(status_effects: Dict[str, Any] | None) -> List[Dict[str, Any]]:
    """Create lightweight token active_effect entries so aura statuses look like regular statuses."""
    display_effects: List[Dict[str, Any]] = []

    aura_by_effect_id = {
        str(aura.get("source_effect_id") or aura.get("id") or ""): aura
        for aura in build_status_auras_from_status_effects(status_effects)
    }

    for effect in _get_status_custom_effects(status_effects):
        if not isinstance(effect, dict):
            continue
        effect_id = str(effect.get("id") or "")
        aura = aura_by_effect_id.get(effect_id)
        if not aura:
            continue
        display_effect = {
            "id": effect_id or str(aura.get("source_effect_id") or aura.get("id") or f"aura_display_{len(display_effects)}"),
            "name": str(aura.get("name") or "光环状态"),
            "icon": str(aura.get("icon") or DEFAULT_AURA_ICON),
            "color": str(aura.get("color") or DEFAULT_AURA_COLOR),
            "source": "status_aura",
            "dm_added": True,
            "aura_emitter": True,
            "aura_status": True,
            "radius": aura.get("radius"),
            "description": aura.get("description"),
        }
        duration = effect.get("duration")
        if isinstance(duration, dict) and duration.get("type") != "permanent":
            try:
                display_effect["duration"] = int(duration.get("remaining") or 0)
            except (TypeError, ValueError):
                pass
        display_effects.append(display_effect)

    return display_effects


def _resolve_runtime_aura_definition(aura_data: Dict[str, Any]) -> Dict[str, Any]:
    aura_id = str(aura_data.get("id") or aura_data.get("aura_id") or "")
    predefined = get_aura_definition(aura_id) or {}
    color = str(aura_data.get("color") or predefined.get("color") or DEFAULT_AURA_COLOR)
    fill_color = str(aura_data.get("fill_color") or predefined.get("fill_color") or _hex_to_rgba(color))
    description = str(aura_data.get("description") or predefined.get("description") or DEFAULT_AURA_DESCRIPTION)
    raw_modifiers = list(aura_data.get("modifiers") or predefined.get("modifiers") or [])
    condition_immunities = [
        str(condition).strip().lower()
        for condition in (
            aura_data.get("condition_immunities")
            or predefined.get("condition_immunities")
            or _extract_condition_immunities_from_modifiers(raw_modifiers)
        )
        if str(condition).strip()
    ]

    return {
        "id": aura_id,
        "spell_id": str(aura_data.get("spell_id") or predefined.get("spell_id") or aura_id or ""),
        "spell_save_dc": aura_data.get("spell_save_dc") or predefined.get("spell_save_dc"),
        "name": str(aura_data.get("name") or predefined.get("name") or aura_id or "光环"),
        "description": description,
        "icon": str(aura_data.get("icon") or predefined.get("icon") or DEFAULT_AURA_ICON),
        "color": color,
        "fill_color": fill_color,
        "radius": int(aura_data.get("radius") or predefined.get("radius") or 10),
        "affects_self": bool(aura_data.get("affects_self", predefined.get("affects_self", True))),
        "affects_allies": bool(aura_data.get("affects_allies", predefined.get("affects_allies", True))),
        "affects_enemies": bool(aura_data.get("affects_enemies", predefined.get("affects_enemies", False))),
        "requires_conscious": bool(aura_data.get("requires_conscious", predefined.get("requires_conscious", True))),
        "applies_conditions": [
            str(condition).strip().lower()
            for condition in (aura_data.get("applies_conditions") or predefined.get("applies_conditions") or [])
            if str(condition).strip()
        ],
        "condition_immunities": condition_immunities,
        "modifiers": raw_modifiers,
        "bonus_damage": list(aura_data.get("bonus_damage") or predefined.get("bonus_damage") or []),
        "save_success_override": dict(
            aura_data.get("save_success_override") or predefined.get("save_success_override") or {}
        ),
        "retaliate_on_hit": dict(aura_data.get("retaliate_on_hit") or predefined.get("retaliate_on_hit") or {}),
        "token_filter": dict(aura_data.get("token_filter") or predefined.get("token_filter") or {}),
        "movement_restriction": aura_data.get("movement_restriction") or predefined.get("movement_restriction"),
        "downed_heal_per_turn": aura_data.get("downed_heal_per_turn") or predefined.get("downed_heal_per_turn"),
        "selected_targets_only": bool(
            aura_data.get("selected_targets_only", predefined.get("selected_targets_only", False))
        ),
        "selected_target_token_ids": [
            int(token_id)
            for token_id in (aura_data.get("selected_target_token_ids") or predefined.get("selected_target_token_ids") or [])
            if str(token_id).strip()
        ],
    }


def _status_condition_key_for_token(token: Token) -> Optional[str]:
    if token.character_id:
        return "active_conditions"
    if token.monster_instance_id:
        return "conditions"
    return None


def _build_aura_condition_effect(
    *,
    condition: str,
    aura_update: Dict[str, Any],
    source_token: Token,
) -> Dict[str, Any]:
    source_name = source_token.instance_name or f"Token {source_token.id}"
    aura_name = str(aura_update.get("aura_name") or aura_update.get("aura_id") or "光环")
    translated_name = CONDITION_TRANSLATIONS.get(condition, condition)
    effect: Dict[str, Any] = {
        "id": f"aura_condition_{condition}",
        "name": translated_name,
        "condition": condition,
        "icon": CONDITION_EFFECT_ICONS.get(condition, "❓"),
        "color": CONDITION_EFFECT_COLORS.get(condition, "#6b7280"),
        "source": f"{aura_name}（{source_name}）",
        "from_caster": source_name,
        "aura_applied": True,
        "aura_id": aura_update.get("aura_id"),
        "aura_name": aura_name,
        "aura_source_token_id": source_token.id,
        "aura_source_effect_id": aura_update.get("source_effect_id"),
        "break_conditions": ["leave_aura_range", "aura_ended"],
    }
    return effect


def _build_aura_status_entry(
    *,
    condition: str,
    aura_update: Dict[str, Any],
    source_token: Token,
) -> Dict[str, Any]:
    source_name = source_token.instance_name or f"Token {source_token.id}"
    aura_name = str(aura_update.get("aura_name") or aura_update.get("aura_id") or "光环")
    return {
        "condition": condition,
        "name": CONDITION_TRANSLATIONS.get(condition, condition),
        "duration": {"type": "permanent", "value": 0, "remaining": 0, "v": 2},
        "source": {
            "type": "aura",
            "name": aura_name,
            "caster_id": str(source_token.id),
            "caster_name": source_name,
            "aura_id": aura_update.get("aura_id"),
            "source_effect_id": aura_update.get("source_effect_id"),
        },
        "removal": {
            "type": "manual",
            "description": "离开光环范围或光环结束时移除",
        },
        "aura_applied": True,
    }


def _build_aura_buff_effect(
    *,
    aura_update: Dict[str, Any],
    source_token: Token,
) -> Optional[Dict[str, Any]]:
    modifiers = list(aura_update.get("modifiers") or [])
    condition_immunities = [
        str(condition).strip().lower()
        for condition in (aura_update.get("condition_immunities") or [])
        if str(condition).strip()
    ]
    bonus_damage = list(aura_update.get("bonus_damage") or [])
    save_success_override = dict(aura_update.get("save_success_override") or {})
    retaliate_on_hit = dict(aura_update.get("retaliate_on_hit") or {})
    token_filter = dict(aura_update.get("token_filter") or {})
    movement_restriction = aura_update.get("movement_restriction")
    downed_heal_per_turn = aura_update.get("downed_heal_per_turn")

    if not any(
        [
            modifiers,
            condition_immunities,
            bonus_damage,
            save_success_override,
            retaliate_on_hit,
            token_filter,
            movement_restriction,
            downed_heal_per_turn is not None,
        ]
    ):
        return None

    source_name = source_token.instance_name or f"Token {source_token.id}"
    aura_name = str(aura_update.get("aura_name") or aura_update.get("aura_id") or "光环")
    damage_immunities = _extract_damage_immunities_from_modifiers(modifiers)
    metadata: Dict[str, Any] = {
        "aura": {
            "aura_id": aura_update.get("aura_id"),
            "source_effect_id": aura_update.get("source_effect_id"),
            "source_token_id": source_token.id,
        }
    }
    if condition_immunities or damage_immunities:
        metadata["immunities"] = {}
        if condition_immunities:
            metadata["immunities"]["condition"] = condition_immunities
        if damage_immunities:
            metadata["immunities"]["damage"] = damage_immunities

    effect: Dict[str, Any] = {
        "id": f"aura_buff_{aura_update.get('aura_id')}_{source_token.id}",
        "name": aura_name,
        "icon": aura_update.get("icon") or DEFAULT_AURA_ICON,
        "color": aura_update.get("color") or DEFAULT_AURA_COLOR,
        "source": f"{aura_name}（{source_name}）",
        "from_caster": source_name,
        "description": aura_update.get("description"),
        "aura_applied": True,
        "aura_id": aura_update.get("aura_id"),
        "aura_name": aura_name,
        "aura_source_token_id": source_token.id,
        "aura_source_effect_id": aura_update.get("source_effect_id"),
        "source_token_id": source_token.id,
        "spell_id": aura_update.get("spell_id"),
        "spell_save_dc": aura_update.get("spell_save_dc"),
        "break_conditions": ["leave_aura_range", "aura_ended"],
        "metadata": metadata,
    }
    if modifiers:
        effect["modifiers"] = modifiers
    if bonus_damage:
        effect["bonus_damage"] = bonus_damage
    if save_success_override:
        effect["save_success_override"] = save_success_override
    if retaliate_on_hit:
        effect["retaliate_on_hit"] = retaliate_on_hit
    if token_filter:
        effect["token_filter"] = token_filter
        effect["tokenFilter"] = token_filter
    if movement_restriction:
        effect["movement_restriction"] = movement_restriction
    if downed_heal_per_turn is not None:
        effect["downed_heal_per_turn"] = int(downed_heal_per_turn)
    return effect


async def _sync_aura_applied_conditions(
    all_tokens: List[Token],
    aura_updates: List[Dict[str, Any]],
    db: AsyncSession,
) -> List[Dict[str, Any]]:
    token_map = {token.id: token for token in all_tokens}
    desired_conditions_by_token: Dict[int, Dict[str, Dict[str, Any]]] = {}
    desired_buffs_by_token: Dict[int, Dict[str, Dict[str, Any]]] = {}

    for aura_update in aura_updates:
        source_token = token_map.get(int(aura_update.get("source_token_id") or 0))
        if not source_token:
            continue
        applies_conditions = [
            str(condition).strip().lower()
            for condition in (aura_update.get("applies_conditions") or [])
            if str(condition).strip()
        ]
        if not applies_conditions:
            applies_conditions = []
        buff_effect = _build_aura_buff_effect(
            aura_update=aura_update,
            source_token=source_token,
        )

        for target_id in aura_update.get("affected_token_ids") or []:
            target_id_int = int(target_id)
            target_bucket = desired_conditions_by_token.setdefault(target_id_int, {})
            for condition in applies_conditions:
                if condition in target_bucket:
                    continue
                target_bucket[condition] = {
                    "effect": _build_aura_condition_effect(
                        condition=condition,
                        aura_update=aura_update,
                        source_token=source_token,
                    ),
                    "status": _build_aura_status_entry(
                        condition=condition,
                        aura_update=aura_update,
                        source_token=source_token,
                    ),
                }
            if buff_effect:
                buff_bucket = desired_buffs_by_token.setdefault(target_id_int, {})
                stack_key = str(aura_update.get("aura_id") or aura_update.get("spell_id") or buff_effect["id"])
                existing = buff_bucket.get(stack_key)
                if existing is None or _aura_bonus_value(buff_effect) > _aura_bonus_value(existing):
                    buff_bucket[stack_key] = buff_effect

    character_cache: Dict[int, Character] = {}
    monster_cache: Dict[int, MonsterInstance] = {}
    changed_payloads: List[Dict[str, Any]] = []

    for token in all_tokens:
        desired_conditions = desired_conditions_by_token.get(token.id, {})
        desired_buffs = desired_buffs_by_token.get(token.id, {})
        current_effects = list(token.active_effects or [])
        base_effects = [effect for effect in current_effects if not effect.get("aura_applied")]
        occupied_conditions = {
            str(effect.get("condition") or "").strip().lower()
            for effect in base_effects
            if isinstance(effect, dict) and effect.get("condition")
        }
        next_aura_buffs = [
            effect
            for _, effect in sorted(desired_buffs.items(), key=lambda item: str(item[1].get("id") or item[0]))
        ]
        next_aura_effects = [
            payload["effect"]
            for condition, payload in sorted(desired_conditions.items())
            if condition not in occupied_conditions
        ]
        next_effects = base_effects + next_aura_buffs + next_aura_effects

        status_effects_obj: Character | MonsterInstance | None = None
        status_effects_value: Dict[str, Any] | None = None
        status_key = _status_condition_key_for_token(token)
        status_changed = False

        if token.character_id:
            if token.character_id not in character_cache:
                character_cache[token.character_id] = await db.get(Character, token.character_id)
            status_effects_obj = character_cache[token.character_id]
        elif token.monster_instance_id:
            if token.monster_instance_id not in monster_cache:
                monster_cache[token.monster_instance_id] = await db.get(MonsterInstance, token.monster_instance_id)
            status_effects_obj = monster_cache[token.monster_instance_id]

        if status_key and status_effects_obj is not None:
            current_status = dict(getattr(status_effects_obj, "status_effects", {}) or {})
            existing_conditions = list(current_status.get(status_key, []))
            base_conditions = [
                entry for entry in existing_conditions
                if not (isinstance(entry, dict) and entry.get("aura_applied"))
            ]
            occupied_status_conditions = {
                str(
                    entry.get("condition", "")
                    if isinstance(entry, dict)
                    else entry
                ).strip().lower()
                for entry in base_conditions
                if str(
                    entry.get("condition", "")
                    if isinstance(entry, dict)
                    else entry
                ).strip()
            }
            next_aura_conditions = [
                payload["status"]
                for condition, payload in sorted(desired_conditions.items())
                if condition not in occupied_status_conditions
            ]
            next_conditions = base_conditions + next_aura_conditions
            if next_conditions != existing_conditions:
                current_status[status_key] = next_conditions
                status_effects_obj.status_effects = current_status
                flag_modified(status_effects_obj, "status_effects")
                status_changed = True
            status_effects_value = current_status
        elif status_effects_obj is not None:
            status_effects_value = dict(getattr(status_effects_obj, "status_effects", {}) or {})

        if next_effects != current_effects:
            token.active_effects = next_effects if next_effects else None
            flag_modified(token, "active_effects")

        if next_effects != current_effects or status_changed:
            payload: Dict[str, Any] = {
                "token_id": token.id,
                "active_effects": token.active_effects or [],
            }
            if token.character_id and status_effects_value is not None:
                payload["character_id"] = int(token.character_id)
                payload["character_status_effects"] = status_effects_value
            if token.monster_instance_id and status_effects_value is not None:
                payload["monster_instance_id"] = int(token.monster_instance_id)
                payload["monster_status_effects"] = status_effects_value
            changed_payloads.append(payload)

    if changed_payloads:
        await db.commit()

    return changed_payloads


def calculate_distance(token1: Token, token2: Token, grid_size: int = 5) -> float:
    """
    Calculate distance between two tokens in feet.
    Uses center-to-center distance with token size consideration.
    """
    # Parse token sizes
    def parse_size(size_str: str) -> tuple:
        if not size_str:
            return (1, 1)
        parts = size_str.split('x')
        return (int(parts[0]), int(parts[1]) if len(parts) > 1 else int(parts[0]))

    size1 = parse_size(token1.token_size or "1x1")
    size2 = parse_size(token2.token_size or "1x1")

    # Calculate centers (position is top-left corner)
    center1_x = token1.position_x + (size1[0] / 2)
    center1_y = token1.position_y + (size1[1] / 2)
    center2_x = token2.position_x + (size2[0] / 2)
    center2_y = token2.position_y + (size2[1] / 2)

    # Calculate grid distance and convert to feet
    dx = abs(center1_x - center2_x)
    dy = abs(center1_y - center2_y)

    # Use diagonal distance (D&D uses max of dx, dy for grid movement)
    grid_distance = max(dx, dy)
    return grid_distance * grid_size


def is_token_conscious(token: Token) -> bool:
    """Check if token is conscious (not at 0 HP or has unconscious condition)"""
    # Check HP
    if token.current_hp is not None and token.current_hp <= 0:
        return False

    # Check for unconscious/incapacitated conditions
    if token.active_effects:
        incapacitated_conditions = {'unconscious', 'paralyzed', 'petrified', 'stunned'}
        for effect in token.active_effects:
            effect_key = str(effect.get('condition') or effect.get('id') or '').lower()
            if effect_key in incapacitated_conditions:
                return False

    return True


def should_receive_aura(
    source_token: Token,
    target_token: Token,
    aura_def: Dict[str, Any],
    in_combat: bool = False
) -> bool:
    """
    Determine if target should receive aura effect from source.

    Rules:
    - Source must be conscious (if aura requires it)
    - Target must be conscious to receive benefits
    - Outside combat: affects all eligible targets
    - In combat: affects based on faction and aura settings
    """
    # Check if source must be conscious
    if aura_def.get("requires_conscious", True) and not is_token_conscious(source_token):
        return False

    selected_target_ids = {
        int(token_id)
        for token_id in (aura_def.get("selected_target_token_ids") or [])
        if str(token_id).strip()
    }
    if aura_def.get("selected_targets_only") and selected_target_ids:
        return target_token.id in selected_target_ids

    # Self-targeting
    if source_token.id == target_token.id:
        return aura_def.get("affects_self", True)

    # Target must be conscious to receive aura benefits
    if not is_token_conscious(target_token):
        return False

    source_faction = source_token.faction or "player"
    target_faction = target_token.faction or "player"

    # Same faction = ally, different faction = enemy.
    # We also honor this outside combat so generic hostile auras still work on the map.
    if source_faction == target_faction:
        return aura_def.get("affects_allies", True)
    if in_combat or source_faction != target_faction:
        return aura_def.get("affects_enemies", False)

    # Outside combat, affect based on aura settings
    return aura_def.get("affects_allies", True)


def get_tokens_in_aura_range(
    source_token: Token,
    all_tokens: List[Token],
    radius: int,
    aura_def: Dict[str, Any],
    in_combat: bool = False
) -> List[Token]:
    """Get all tokens within aura range that should receive the effect"""
    affected = []

    for target in all_tokens:
        # Skip non-character/monster tokens (items, shops, etc.)
        if not target.character_id and not target.monster_instance_id:
            continue

        # Check distance
        distance = calculate_distance(source_token, target)
        if distance > radius:
            continue

        # Check if should receive aura
        if should_receive_aura(source_token, target, aura_def, in_combat):
            affected.append(target)

    return affected


def resolve_aura_stacking(
    token: Token,
    aura_effects: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Resolve aura stacking - same-named auras don't stack, use best value.

    Args:
        token: The target token receiving auras
        aura_effects: List of {aura_id, source_token_id, bonus_value, aura_def}

    Returns:
        List of resolved (non-stacking) aura effects
    """
    # Group by aura_id
    by_aura_id: Dict[str, List[Dict[str, Any]]] = {}
    for effect in aura_effects:
        aura_id = effect["aura_id"]
        if aura_id not in by_aura_id:
            by_aura_id[aura_id] = []
        by_aura_id[aura_id].append(effect)

    resolved = []
    for aura_id, effects in by_aura_id.items():
        if len(effects) == 1:
            resolved.append(effects[0])
        else:
            # Take highest bonus value (for auras with numeric bonuses)
            best = max(effects, key=lambda e: e.get("bonus_value", 0))
            resolved.append(best)

    return resolved


async def toggle_aura(
    token_id: int,
    aura_id: str,
    enabled: bool,
    db: AsyncSession
) -> Dict[str, Any]:
    """
    Toggle an aura on/off for a token.

    Returns:
        Dict with success status and updated aura state
    """
    # Get token
    result = await db.execute(select(Token).where(Token.id == token_id))
    token = result.scalar_one_or_none()
    if not token:
        return {"success": False, "error": "Token not found"}

    # Get aura definition
    aura_def = get_aura_definition(aura_id)
    if not aura_def:
        return {"success": False, "error": f"Unknown aura: {aura_id}"}

    # Get character data for source_cha_mod if needed
    source_cha_mod = 0
    source_level = 1
    if token.character_id:
        char_result = await db.execute(
            select(Character).where(Character.id == token.character_id)
        )
        character = char_result.scalar_one_or_none()
        if character and character.ability_scores:
            cha_score = character.ability_scores.get("charisma", 10)
            source_cha_mod = (cha_score - 10) // 2
            source_level = character.level or 1

    # Determine radius based on level
    radius = aura_def.get("radius", 10)
    if source_level >= 18 and "radius_18" in aura_def:
        radius = aura_def["radius_18"]

    # Update active_auras - create a new list to ensure SQLAlchemy detects the change
    active_auras = list(token.active_auras or [])

    if enabled:
        # Add or update aura
        existing_idx = next((i for i, a in enumerate(active_auras) if a.get("id") == aura_id), None)
        if existing_idx is not None:
            # Update existing - create new dict to ensure change detection
            active_auras[existing_idx] = {
                **active_auras[existing_idx],
                "radius": radius,
                "source_cha_mod": source_cha_mod
            }
        else:
            active_auras.append({
                "id": aura_id,
                "radius": radius,
                "source_cha_mod": source_cha_mod,
                "enabled": True
            })
    else:
        # Remove aura
        active_auras = [a for a in active_auras if a.get("id") != aura_id]

    token.active_auras = active_auras if active_auras else None
    flag_modified(token, "active_auras")
    await db.commit()
    await db.refresh(token)

    return {
        "success": True,
        "token_id": token_id,
        "aura_id": aura_id,
        "enabled": enabled,
        "radius": radius if enabled else 0,
        "active_auras": active_auras
    }


async def recalculate_auras_for_map(
    campaign_id: int,
    map_url: str,
    db: AsyncSession,
    in_combat: bool = False
) -> List[Dict[str, Any]]:
    """
    Recalculate aura effects for all tokens on a map.
    Called after token movement or combat state changes.

    Returns:
        List of aura update payloads for WebSocket broadcast
    """
    # Get all tokens on this map
    result = await db.execute(
        select(Token).where(
            and_(
                Token.campaign_id == campaign_id,
                Token.map_url == map_url
            )
        )
    )
    all_tokens = list(result.scalars().all())

    # Find all tokens with active auras
    aura_sources = [t for t in all_tokens if t.active_auras]

    updates = []

    for source_token in aura_sources:
        for aura_data in source_token.active_auras:
            if not isinstance(aura_data, dict) or aura_data.get("enabled") is False:
                continue
            aura_id = aura_data.get("id")
            aura_def = _resolve_runtime_aura_definition(aura_data)
            if not aura_id and not aura_def.get("name"):
                continue

            radius = aura_data.get("radius", aura_def.get("radius", 10))
            source_cha_mod = aura_data.get("source_cha_mod", 0)
            materialized_modifiers = _materialize_aura_modifiers(
                aura_def.get("modifiers"),
                source_cha_mod=int(source_cha_mod or 0),
            )

            # Get affected tokens
            affected = get_tokens_in_aura_range(
                source_token, all_tokens, radius, aura_def, in_combat
            )

            updates.append({
                "type": "aura_effect",
                "source_token_id": source_token.id,
                "aura_id": aura_id,
                "aura_name": aura_def.get("name", aura_id),
                "radius": radius,
                "color": aura_def.get("color", "#fbbf24"),
                "fill_color": aura_def.get("fill_color", "rgba(251, 191, 36, 0.15)"),
                "icon": aura_def.get("icon", "🛡️"),
                "description": aura_def.get("description"),
                "affected_token_ids": [t.id for t in affected],
                "source_cha_mod": source_cha_mod,
                "source_effect_id": aura_data.get("source_effect_id"),
                "applies_conditions": aura_def.get("applies_conditions", []),
                "condition_immunities": aura_def.get("condition_immunities", []),
                "modifiers": materialized_modifiers,
                "bonus_damage": aura_def.get("bonus_damage", []),
                "save_success_override": aura_def.get("save_success_override", {}),
                "retaliate_on_hit": aura_def.get("retaliate_on_hit", {}),
                "token_filter": aura_def.get("token_filter", {}),
                "movement_restriction": aura_def.get("movement_restriction"),
                "downed_heal_per_turn": aura_def.get("downed_heal_per_turn"),
                "spell_id": aura_def.get("spell_id"),
                "spell_save_dc": aura_def.get("spell_save_dc"),
                "selected_targets_only": aura_def.get("selected_targets_only", False),
                "selected_target_token_ids": aura_def.get("selected_target_token_ids", []),
            })

    return updates


async def on_token_move(
    token_id: int,
    campaign_id: int,
    map_url: str,
    db: AsyncSession
) -> None:
    """
    Called when a token moves. Recalculates auras and broadcasts updates.
    """
    # Check if there's an active combat to determine faction filtering
    from app.models.campaign_storage import CampaignStorage
    combat_result = await db.execute(
        select(CampaignStorage).where(
            and_(
                CampaignStorage.campaign_id == campaign_id,
                CampaignStorage.object_type == "combat",
                CampaignStorage.object_id == "current",
                CampaignStorage.is_active == True
            )
        )
    )
    combat = combat_result.scalar_one_or_none()
    in_combat = combat is not None

    # Recalculate auras
    aura_updates = await recalculate_auras_for_map(
        campaign_id, map_url, db, in_combat
    )

    result = await db.execute(
        select(Token).where(
            and_(
                Token.campaign_id == campaign_id,
                Token.map_url == map_url
            )
        )
    )
    all_tokens = list(result.scalars().all())
    changed_payloads = await _sync_aura_applied_conditions(all_tokens, aura_updates, db)

    await manager.broadcast_to_campaign(
        {
            "type": "aura_update",
            "data": {
                "auras": aura_updates,
                "triggered_by_token": token_id
            }
        },
        campaign_id
    )

    from app.services.realtime_publisher import realtime_publisher

    for payload in changed_payloads:
        await realtime_publisher.publish_token_active_effects_updated(
            campaign_id,
            **payload,
        )


async def on_combat_state_change(
    campaign_id: int,
    map_url: str,
    combat_started: bool,
    db: AsyncSession
) -> None:
    """
    Called when combat starts or ends. Recalculates aura effects.
    """
    aura_updates = await recalculate_auras_for_map(
        campaign_id, map_url, db, in_combat=combat_started
    )

    result = await db.execute(
        select(Token).where(
            and_(
                Token.campaign_id == campaign_id,
                Token.map_url == map_url
            )
        )
    )
    all_tokens = list(result.scalars().all())
    changed_payloads = await _sync_aura_applied_conditions(all_tokens, aura_updates, db)

    await manager.broadcast_to_campaign(
        {
            "type": "aura_update",
            "data": {
                "auras": aura_updates,
                "combat_state_changed": True,
                "in_combat": combat_started
            }
        },
        campaign_id
    )

    from app.services.realtime_publisher import realtime_publisher

    for payload in changed_payloads:
        await realtime_publisher.publish_token_active_effects_updated(
            campaign_id,
            **payload,
        )


def get_available_auras_for_character(
    class_id: str,
    subclass_id: Optional[str],
    level: int
) -> List[Dict[str, Any]]:
    """
    Get list of auras available to a character based on class/level.
    """
    all_auras = get_all_aura_definitions()
    available = []

    for aura in all_auras:
        prereqs = aura.get("prerequisites", {})

        # Check class requirement
        required_classes = prereqs.get("class", [])
        if required_classes and class_id not in required_classes:
            continue

        # Check subclass requirement
        required_subclasses = prereqs.get("subclass", [])
        if required_subclasses and subclass_id not in required_subclasses:
            continue

        # Check level requirement
        required_level = prereqs.get("level", 1)
        if level < required_level:
            continue

        available.append(aura)

    return available
