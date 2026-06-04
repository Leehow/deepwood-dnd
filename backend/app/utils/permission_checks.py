"""
Permission checking utilities for D&D platform.
Centralized permission validation to eliminate code duplication.

current_user is always a dict (JWT payload) from require_auth,
containing keys: user_id, email, role, display_name.
"""

from typing import Optional
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.campaign import Campaign


class PermissionError(HTTPException):
    """Custom exception for permission violations."""

    def __init__(self, detail: str = "Permission denied"):
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail
        )


def _uid(current_user: dict) -> str:
    """Extract user_id from JWT payload dict."""
    return str(current_user["user_id"])


async def check_dm_permission(
    campaign_id: int,
    current_user: dict,
    db: AsyncSession,
    allow_admin: bool = True
) -> Campaign:
    """
    Check if the current user is the DM of the campaign.

    Returns:
        The campaign object if permission check passes

    Raises:
        HTTPException: 404 if campaign not found, 403 if not DM
    """
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id)
    )
    campaign = result.scalar_one_or_none()

    if not campaign:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Campaign {campaign_id} not found"
        )

    uid = _uid(current_user)
    is_dm = campaign.dm_user_id == uid
    is_admin = allow_admin and uid == "0"

    if not (is_dm or is_admin):
        raise PermissionError(
            detail="Only the DM can perform this action"
        )

    return campaign


async def require_campaign_dm(
    campaign_id: int,
    current_user: dict,
    db: AsyncSession,
) -> Campaign:
    """Shorthand: verify user is the DM of the given campaign."""
    return await check_dm_permission(campaign_id, current_user, db)


async def check_campaign_member(
    campaign_id: int,
    current_user: dict,
    db: AsyncSession,
    allow_dm: bool = True,
    allow_player: bool = True
) -> Campaign:
    """
    Check if user is a member of the campaign (DM or player).

    Returns:
        The campaign object if permission check passes

    Raises:
        HTTPException: 404 if campaign not found, 403 if not member
    """
    from app.models.character import Character

    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id)
    )
    campaign = result.scalar_one_or_none()

    if not campaign:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Campaign {campaign_id} not found"
        )

    uid = _uid(current_user)

    # Check if user is DM
    if allow_dm and campaign.dm_user_id == uid:
        return campaign

    # Check if user is a player
    if allow_player:
        result = await db.execute(
            select(Character).where(
                Character.campaign_id == campaign_id,
                Character.user_id == uid
            )
        )
        character = result.scalar_one_or_none()
        if character:
            return campaign

    # Admin bypass
    if uid == "0":
        return campaign

    raise PermissionError(
        detail="You are not a member of this campaign"
    )


async def check_character_owner(
    character_id: int,
    current_user: dict,
    db: AsyncSession,
    allow_dm: bool = True
) -> tuple:
    """
    Check if user owns the character or is the campaign DM.

    Returns:
        Tuple of (character, campaign) if permission check passes

    Raises:
        HTTPException: 404 if character not found, 403 if not owner/DM
    """
    from app.models.character import Character

    result = await db.execute(
        select(Character).where(Character.id == character_id)
    )
    character = result.scalar_one_or_none()

    if not character:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Character {character_id} not found"
        )

    result = await db.execute(
        select(Campaign).where(Campaign.id == character.campaign_id)
    )
    campaign = result.scalar_one_or_none()

    if not campaign:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Campaign not found"
        )

    uid = _uid(current_user)
    is_owner = character.user_id == uid
    is_dm = allow_dm and campaign.dm_user_id == uid
    is_admin = uid == "0"

    if not (is_owner or is_dm or is_admin):
        raise PermissionError(
            detail="You do not have permission to access this character"
        )

    return character, campaign


def require_admin(current_user: dict) -> None:
    """
    Require the current user to be an admin.

    Raises:
        HTTPException: 403 if not admin
    """
    if _uid(current_user) != "0":
        raise PermissionError(
            detail="Admin access required"
        )