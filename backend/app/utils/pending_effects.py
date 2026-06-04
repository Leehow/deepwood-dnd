from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.token import Token
from app.services.spell_effect_cleanup_service import apply_damage_break_cleanup

_DAMAGE_TYPE_ALIASES: Dict[str, List[str]] = {
    "acid": ["acid", "强酸", "酸液"],
    "cold": ["cold", "寒冷", "冰冷"],
    "fire": ["fire", "火焰"],
    "lightning": ["lightning", "闪电"],
    "thunder": ["thunder", "雷鸣"],
    "poison": ["poison", "毒素"],
    "necrotic": ["necrotic", "黯蚀"],
    "radiant": ["radiant", "光耀"],
    "force": ["force", "力场"],
    "psychic": ["psychic", "心灵"],
    "bludgeoning": ["bludgeoning", "钝击"],
    "piercing": ["piercing", "穿刺"],
    "slashing": ["slashing", "挥砍"],
}


def normalize_damage_type(value: Optional[str]) -> str:
    normalized = str(value or "").strip().lower()
    if not normalized:
        return ""
    for canonical, aliases in _DAMAGE_TYPE_ALIASES.items():
        if normalized == canonical or normalized in aliases:
            return canonical
    return normalized


def damage_type_matches(candidate: Optional[str], expected_types: Any) -> bool:
    if not candidate or not expected_types:
        return False

    candidate_normalized = normalize_damage_type(candidate)
    values = expected_types if isinstance(expected_types, list) else [expected_types]
    return any(
        normalize_damage_type(entry) == candidate_normalized
        for entry in values
        if entry is not None
    )


@dataclass
class PendingDamageEffectResult:
    damage_after_effects: int
    triggered: bool = False
    consumed: bool = False
    granted_resistance: bool = False
    active_effects_changed: bool = False
    active_effects: Optional[List[Dict[str, Any]]] = None
    matched_effects: List[Dict[str, Any]] = field(default_factory=list)
    concentration_touched_token_ids: List[int] = field(default_factory=list)


async def apply_pending_damage_received_effects(
    *,
    token: Optional[Token],
    damage_amount: int,
    damage_type: Optional[str],
    db: AsyncSession,
    resistance_already_applied: bool = False,
    immunity_already_applied: bool = False,
    consume_effects: bool = True,
) -> PendingDamageEffectResult:
    """
    Apply one-shot pending effects that trigger when a token receives damage.

    Current supported pending effect metadata:
      metadata.pendingTrigger = "damage_received"
      metadata.pendingEffectType = "grant_resistance"
      metadata.triggerDamageTypes = ["fire", ...]
    """
    result = PendingDamageEffectResult(damage_after_effects=max(0, damage_amount))

    if (
        token is None
        or damage_amount <= 0
        or not damage_type
        or not token.active_effects
    ):
        return result

    effects = list(token.active_effects or [])
    matched_indices: List[int] = []
    matched_effects: List[Dict[str, Any]] = []

    for index, effect in enumerate(effects):
        metadata = effect.get("metadata") or {}
        pending_trigger = str(metadata.get("pendingTrigger") or "").strip().lower()
        pending_type = str(metadata.get("pendingEffectType") or "").strip().lower()
        if pending_trigger != "damage_received":
            continue
        if pending_type not in {"grant_resistance", "damage_resistance"}:
            continue

        trigger_damage_types = metadata.get("triggerDamageTypes") or metadata.get("damageTypes")
        if not damage_type_matches(damage_type, trigger_damage_types):
            continue

        matched_indices.append(index)
        matched_effects.append(effect)

    if matched_indices:
        result.triggered = True
        result.matched_effects = matched_effects

        if not resistance_already_applied and not immunity_already_applied:
            result.damage_after_effects = max(0, result.damage_after_effects // 2)
            result.granted_resistance = True

        if consume_effects:
            remaining_effects = [
                effect
                for index, effect in enumerate(effects)
                if index not in matched_indices
            ]
            token.active_effects = remaining_effects or None
            flag_modified(token, "active_effects")
            await db.flush()

            result.consumed = True
            result.active_effects_changed = True
            result.active_effects = remaining_effects or None

    break_cleanup = await apply_damage_break_cleanup(
        token=token,
        damage_amount=result.damage_after_effects,
        db=db,
    )
    if break_cleanup.active_effects_changed:
        result.active_effects_changed = True
        result.active_effects = token.active_effects or None
    if break_cleanup.concentration_touched_token_ids:
        result.concentration_touched_token_ids.extend(
            break_cleanup.concentration_touched_token_ids
        )
    return result
