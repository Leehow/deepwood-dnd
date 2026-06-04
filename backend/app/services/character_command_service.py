from __future__ import annotations

from datetime import datetime
from typing import Any

from app.models.character import Character
from app.utils.item_payload_normalizer import normalize_character_equipment_payloads

DEFAULT_CURRENCY = {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}
_CONDITION_ICONS = {
    "blinded": "🙈",
    "charmed": "💕",
    "deafened": "🙉",
    "exhaustion": "😫",
    "frightened": "😨",
    "grappled": "🤝",
    "incapacitated": "🚫",
    "invisible": "👻",
    "paralyzed": "😵",
    "petrified": "🗿",
    "poisoned": "🤢",
    "prone": "⬇️",
    "restrained": "🕸️",
    "stunned": "⚡",
    "unconscious": "💤",
    "silenced": "🔇",
    "diseased": "🤒",
    "sleep": "💤",
    "aging": "👴",
    "confused": "🌀",
}
_CONDITION_COLORS = {
    "blinded": "#374151",
    "charmed": "#ec4899",
    "deafened": "#374151",
    "exhaustion": "#92400e",
    "frightened": "#7c3aed",
    "grappled": "#d97706",
    "incapacitated": "#6b7280",
    "invisible": "#6366f1",
    "paralyzed": "#dc2626",
    "petrified": "#78716c",
    "poisoned": "#16a34a",
    "prone": "#92400e",
    "restrained": "#92400e",
    "stunned": "#eab308",
    "unconscious": "#1e40af",
    "silenced": "#64748b",
    "diseased": "#84cc16",
    "sleep": "#1e40af",
    "aging": "#78716c",
    "confused": "#f59e0b",
}
CONDITION_EFFECT_ICONS = _CONDITION_ICONS
CONDITION_EFFECT_COLORS = _CONDITION_COLORS


def merge_extracted_currency(
    base_currency: dict[str, Any] | None,
    currency_extracted: dict[str, int],
) -> dict[str, int]:
    merged_currency = dict(base_currency or DEFAULT_CURRENCY)
    for coin_type, amount in currency_extracted.items():
        merged_currency[coin_type] = int(merged_currency.get(coin_type) or 0) + int(amount or 0)
    return merged_currency


def prepare_character_create_payload(char_dict: dict[str, Any]) -> dict[str, Any]:
    next_payload = dict(char_dict)
    normalized_equipment, currency_extracted, _ = normalize_character_equipment_payloads(next_payload.get("equipment") or [])
    next_payload["equipment"] = normalized_equipment
    if any(currency_extracted.values()):
        next_payload["currency"] = merge_extracted_currency(next_payload.get("currency"), currency_extracted)
    return next_payload


def prepare_partial_character_update(
    character: Character,
    update_dict: dict[str, Any],
) -> dict[str, Any]:
    next_update = dict(update_dict)
    if "equipment" not in next_update:
        return next_update

    normalized_equipment, currency_extracted, _ = normalize_character_equipment_payloads(next_update.get("equipment") or [])
    next_update["equipment"] = normalized_equipment
    if any(currency_extracted.values()):
        next_update["currency"] = merge_extracted_currency(
            next_update.get("currency") or character.currency,
            currency_extracted,
        )
    return next_update


def collect_character_campaign_ids(
    tokens: list[Any],
    *,
    extra_campaign_id: Any = None,
) -> list[str]:
    seen: set[str] = set()
    campaign_ids: list[str] = []

    if extra_campaign_id is not None:
        cid = str(extra_campaign_id)
        if cid not in seen:
            seen.add(cid)
            campaign_ids.append(cid)

    for token in tokens:
        campaign_id = getattr(token, "campaign_id", None)
        if campaign_id is None:
            continue
        cid = str(campaign_id)
        if cid in seen:
            continue
        seen.add(cid)
        campaign_ids.append(cid)

    return campaign_ids


def collect_changed_feature_uses(
    previous_states: dict[str, Any] | None,
    current_states: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    previous = dict(previous_states or {})
    current = dict(current_states or {})
    changed: list[dict[str, Any]] = []

    for feature_id, state in current.items():
        if not isinstance(state, dict):
            continue

        previous_state = previous.get(feature_id)
        current_uses = state.get("current")
        max_uses = state.get("max")

        if (
            isinstance(previous_state, dict)
            and previous_state.get("current") == current_uses
            and previous_state.get("max") == max_uses
        ):
            continue

        changed.append(
            {
                "feature_id": str(feature_id),
                "current_uses": current_uses,
                "max_uses": max_uses,
            }
        )

    return changed


def build_dm_condition_effects(
    active_conditions: list[Any],
    *,
    condition_translations: dict[str, str],
) -> list[dict[str, Any]]:
    condition_effects: list[dict[str, Any]] = []
    for active_condition in active_conditions:
        condition_id = (
            active_condition.get("condition", "")
            if isinstance(active_condition, dict)
            else str(active_condition)
        )
        duration = active_condition.get("duration") if isinstance(active_condition, dict) else None
        condition_name = condition_translations.get(condition_id, condition_id)
        rounds_left = None
        if isinstance(duration, dict) and duration.get("type") != "permanent":
            rounds_left = duration.get("remaining")

        condition_effect = {
            "id": f"condition_{condition_id}",
            "name": condition_name,
            "condition": condition_id,
            "icon": _CONDITION_ICONS.get(condition_id, "❓"),
            "color": _CONDITION_COLORS.get(condition_id, "#6b7280"),
            "dm_added": True,
        }
        if rounds_left is not None:
            condition_effect["duration"] = rounds_left
        condition_effects.append(condition_effect)

    return condition_effects


def merge_dm_status_effects(
    existing_effects: list[dict[str, Any]] | None,
    condition_effects: list[dict[str, Any]],
    synced_effects: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    non_dm_effects = [effect for effect in (existing_effects or []) if not effect.get("dm_added")]
    return non_dm_effects + condition_effects + list(synced_effects or [])


def build_resource_use_broadcast_data(
    *,
    chat_id: int,
    character_id: int,
    character_name: str,
    user_id: str | None,
    resource_id: str,
    resource_name: str,
    content: str,
    created_at: Any,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    created_at_iso = (
        created_at.isoformat()
        if hasattr(created_at, "isoformat")
        else str(created_at or datetime.utcnow().isoformat())
    )
    payload = {
        "id": chat_id,
        "character_id": character_id,
        "character_name": character_name,
        "user_id": user_id,
        "resource_id": resource_id,
        "resource_name": resource_name,
        "content": content,
        "created_at": created_at_iso,
    }
    for key, value in (extra or {}).items():
        if value is not None:
            payload[key] = value
    return payload


def build_character_level_event_data(
    *,
    character_id: int,
    character_name: str,
    new_level: int,
) -> dict[str, Any]:
    return {
        "character_id": character_id,
        "character_name": character_name,
        "new_level": new_level,
    }
