"""
Character CRUD operations.
Split from characters.py as part of code modularization.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional, Dict, Any

from pydantic import BaseModel

from app.db.session import get_db
from app.models.token import Token
from app.models.character import Character
from app.schemas.character_sheet import (
    CharacterCreate,
    CharacterResponse,
    CharacterListItem,
)
from app.services.character_sheet_service import character_sheet_service
from app.services.realtime_publisher import realtime_publisher
from app.core.security import require_auth

router = APIRouter(prefix="/characters", tags=["Characters"])


class AvatarUpdateRequest(BaseModel):
    avatar: str


class CharacterPartialUpdate(BaseModel):
    """Schema for partial character updates (e.g., equipment only)"""
    equipment: Optional[List[Dict[str, Any]]] = None
    prepared_spells: Optional[List[str]] = None
    currency: Optional[Dict[str, int]] = None
    spell_slots_state: Optional[List[int]] = None


class LevelUpRequest(BaseModel):
    """Schema for character level up request"""
    class_choice: str
    feature_choices: Optional[Dict[str, Any]] = None


@router.post("", response_model=CharacterResponse, status_code=status.HTTP_201_CREATED)
async def create_character(
    character_data: CharacterCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Create a new character"""
    char_dict = character_data.model_dump(by_alias=False)

    char_dict['appearance'] = character_data.appearance.model_dump()
    char_dict['personality'] = character_data.personality.model_dump()
    char_dict['ability_scores'] = character_data.ability_scores.model_dump()

    if character_data.subclass_choices:
        char_dict['subclass_choices'] = character_data.subclass_choices.model_dump()
    if character_data.race_choices:
        char_dict['race_choices'] = character_data.race_choices.model_dump()

    character = Character(**char_dict)
    db.add(character)
    await db.commit()
    await db.refresh(character)

    return character


@router.get("", response_model=List[CharacterListItem])
async def list_characters(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get all characters for a user"""
    result = await db.execute(
        select(Character)
        .where(Character.user_id == user_id)
        .order_by(Character.created_at.desc())
    )
    characters = result.scalars().all()
    return characters


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

    return character


@router.get("/{character_id}/sheet")
async def get_character_sheet(
    character_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Get character sheet with computed features, actions, and spells"""
    result = await db.execute(
        select(Character).where(Character.id == character_id)
    )
    character = result.scalar_one_or_none()

    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Character not found"
        )

    sheet = character_sheet_service.get_character_sheet(character)
    return sheet


@router.put("/{character_id}", response_model=CharacterResponse)
async def update_character(
    character_id: int,
    character_data: CharacterCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
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

    # Broadcast updated spell slots to all campaigns
    try:
        if getattr(character, "spell_slots_state", None) is not None:
            token_campaigns_result = await db.execute(
                select(Token.campaign_id)
                .where(Token.character_id == character.id)
                .distinct()
            )
            campaign_ids = [row[0] for row in token_campaigns_result.all() if row[0] is not None]
            for campaign_id in campaign_ids:
                await realtime_publisher.publish_spell_slots_updated(
                    campaign_id,
                    character_id=int(character.id),
                    spell_slots_state=character.spell_slots_state,
                )
    except Exception:
        pass

    return character


@router.post("/{character_id}", response_model=CharacterResponse)
async def partial_update_character(
    character_id: int,
    update_data: CharacterPartialUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
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

    update_dict = update_data.model_dump(exclude_unset=True)
    for key, value in update_dict.items():
        setattr(character, key, value)

    await db.commit()
    await db.refresh(character)

    # Broadcast updated spell slots to all campaigns where this character has tokens
    if 'spell_slots_state' in update_dict:
        try:
            token_campaigns_result = await db.execute(
                select(Token.campaign_id)
                .where(Token.character_id == character.id)
                .distinct()
            )
            campaign_ids = [row[0] for row in token_campaigns_result.all() if row[0] is not None]
            for campaign_id in campaign_ids:
                await realtime_publisher.publish_spell_slots_updated(
                    campaign_id,
                    character_id=int(character.id),
                    spell_slots_state=character.spell_slots_state,
                )
        except Exception:
            pass

    return character


@router.post("/{character_id}/avatar", response_model=CharacterResponse)
async def update_character_avatar(
    character_id: int,
    req: AvatarUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
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
    await db.commit()
    await db.refresh(character)

    # Broadcast avatar update to all campaigns
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


@router.delete("/{character_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_character(
    character_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
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
