from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.character import Character
from app.models.token import Token
from app.services import class_resource_service
from app.services.runtime_schema_service import normalize_character_class_feature_uses


def _safe_flag_modified(instance: Any, attr: str) -> None:
    try:
        flag_modified(instance, attr)
    except Exception:
        return


@dataclass(frozen=True)
class CharacterFeatureUsesUpdateResult:
    character: Character
    campaign_ids: list[int]


@dataclass(frozen=True)
class CharacterResourceUpdateResult:
    character: Character
    resource_id: str
    current: int
    max: int


async def _get_character_or_404(db: AsyncSession, character_id: int) -> Character:
    character = await db.get(Character, character_id)
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")
    return character


def _resolve_resource_bounds(character: Character, resource_id: str) -> tuple[str, dict[str, Any], int]:
    resource = class_resource_service.get_resource_definition(resource_id)
    if not resource:
        raise HTTPException(status_code=400, detail=f"Unknown resource: {resource_id}")

    state_resource_id = class_resource_service.resolve_resource_state_id(resource_id)
    state_resource = class_resource_service.get_resource_definition(state_resource_id) or resource
    ability_scores = character.ability_scores or {}
    max_value = class_resource_service.calculate_resource_max(
        state_resource,
        character.level,
        ability_scores.get("charisma", 10),
        ability_scores.get("wisdom", 10),
        ability_scores.get("intelligence", 10),
    )
    return state_resource_id, state_resource, max_value


async def update_character_feature_uses(
    db: AsyncSession,
    *,
    character_id: int,
    feature_id: str,
    current_uses: int,
    max_uses: int,
) -> CharacterFeatureUsesUpdateResult:
    character = await _get_character_or_404(db, character_id)
    class_feature_uses = dict(
        normalize_character_class_feature_uses(character.class_feature_uses, strict=False) or {}
    )
    class_feature_uses[feature_id] = {
        "current": current_uses,
        "max": max_uses,
    }
    character.class_feature_uses = normalize_character_class_feature_uses(class_feature_uses, strict=True)
    _safe_flag_modified(character, "class_feature_uses")
    await db.commit()
    await db.refresh(character)

    tokens_result = await db.execute(
        select(Token.campaign_id).where(Token.character_id == character_id).distinct()
    )
    campaign_ids = [row[0] for row in tokens_result.fetchall()]
    return CharacterFeatureUsesUpdateResult(character=character, campaign_ids=campaign_ids)


async def restore_character_resource(
    db: AsyncSession,
    *,
    character_id: int,
    resource_id: str,
    amount: int | None,
) -> CharacterResourceUpdateResult:
    character = await _get_character_or_404(db, character_id)
    state_resource_id, _, max_value = _resolve_resource_bounds(character, resource_id)

    current_states = dict(
        normalize_character_class_feature_uses(character.class_feature_uses, strict=False) or {}
    )
    resource_state = current_states.get(state_resource_id, {})
    current_value = resource_state.get("current", max_value)
    new_value = max_value if amount is None else min(current_value + amount, max_value)

    current_states[state_resource_id] = {"current": new_value, "max": max_value}
    character.class_feature_uses = normalize_character_class_feature_uses(current_states, strict=True)
    _safe_flag_modified(character, "class_feature_uses")
    await db.commit()

    return CharacterResourceUpdateResult(
        character=character,
        resource_id=resource_id,
        current=new_value,
        max=max_value,
    )


async def set_character_resource(
    db: AsyncSession,
    *,
    character_id: int,
    resource_id: str,
    value: int,
) -> CharacterResourceUpdateResult:
    character = await _get_character_or_404(db, character_id)
    state_resource_id, _, max_value = _resolve_resource_bounds(character, resource_id)

    current_states = dict(
        normalize_character_class_feature_uses(character.class_feature_uses, strict=False) or {}
    )
    new_value = max(0, min(value, max_value))
    current_states[state_resource_id] = {"current": new_value, "max": max_value}
    character.class_feature_uses = normalize_character_class_feature_uses(current_states, strict=True)
    _safe_flag_modified(character, "class_feature_uses")
    await db.commit()

    return CharacterResourceUpdateResult(
        character=character,
        resource_id=resource_id,
        current=new_value,
        max=max_value,
    )
