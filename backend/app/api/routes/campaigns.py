from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import load_only
from sqlalchemy.orm.attributes import flag_modified
from typing import List, Optional, Literal
from app.db.session import get_db
from pydantic import BaseModel, Field

from app.models.campaign import Campaign, CampaignMember
from app.models.character import Character
from app.models.user import User
from app.schemas.campaign import (
    CampaignCreate,
    CampaignUpdate,
    CampaignResponse,
    CampaignRuleOptionsResponse,
    CampaignMemberResponse,
    CampaignListResponse,
    SidebarStateUpdate,
    SidebarStateResponse,
    VirtualPlayerCreate,
    VirtualPlayerUpdate,
    VirtualPlayerImport,
)
from app.core.security import require_auth
from app.core.dependencies import resolve_campaign_member_context
from app.services.realtime_publisher import realtime_publisher
from app.services.campaign_rule_assembler import CampaignRuleAssembler
from app.utils.permission_checks import require_campaign_dm, check_campaign_member

router = APIRouter(prefix="/campaigns", tags=["campaigns"])
campaign_rule_assembler = CampaignRuleAssembler()


async def _sync_player_count(db: AsyncSession, campaign_id: int):
    """Sync current_players with actual member count (excludes DM)."""
    count_result = await db.execute(
        select(func.count()).select_from(CampaignMember).where(
            CampaignMember.campaign_id == campaign_id,
            CampaignMember.role != "dm",
        )
    )
    real_count = count_result.scalar() or 0
    await db.execute(
        Campaign.__table__.update()
        .where(Campaign.id == campaign_id)
        .values(current_players=real_count)
    )
    return real_count


@router.post("", response_model=CampaignResponse)
async def create_campaign(
    campaign: CampaignCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Create a new campaign"""
    # Create campaign
    payload = campaign.model_dump()
    # Map API field 'metadata' to ORM attribute 'meta'
    if 'metadata' in payload and payload['metadata'] is not None:
        payload['meta'] = payload.pop('metadata')
    # Caller identity is always derived from bearer token.
    payload["dm_user_id"] = str(current_user["user_id"])
    db_campaign = Campaign(**payload)
    db.add(db_campaign)
    await db.flush()

    # Add creator as DM member
    db_member = CampaignMember(
        campaign_id=db_campaign.id,
        user_id=str(current_user["user_id"]),
        role="dm"
    )
    db.add(db_member)

    await db.commit()

    # Re-select including metadata
    res = await db.execute(
        select(Campaign).where(Campaign.id == db_campaign.id)
    )
    c = res.scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=500, detail="Failed to load created campaign")

    return c


@router.get("", response_model=List[CampaignListResponse])
async def list_campaigns(
    status: str = None,
    db: AsyncSession = Depends(get_db)
):
    """List all campaigns using ORM (metadata column now exists)."""
    # Subquery: real member count per campaign (exclude DM)
    member_count_sq = (
        select(
            CampaignMember.campaign_id,
            func.count().label("member_count"),
        )
        .where(CampaignMember.role != "dm")
        .group_by(CampaignMember.campaign_id)
        .subquery()
    )

    stmt = (
        select(
            Campaign.id,
            Campaign.name,
            Campaign.dm_user_id,
            Campaign.max_players,
            func.coalesce(member_count_sq.c.member_count, 0).label("current_players"),
            Campaign.level_range,
            Campaign.status,
            Campaign.description,
            Campaign.current_map_url,
            Campaign.selected_module_id,
            Campaign.cover_image,
            Campaign.created_at,
            Campaign.updated_at,
            User.username.label("dm_display_name"),
        )
        .outerjoin(User, Campaign.dm_user_id == User.id)
        .outerjoin(member_count_sq, Campaign.id == member_count_sq.c.campaign_id)
    )
    if status:
        stmt = stmt.where(Campaign.status == status)
    stmt = stmt.order_by(Campaign.created_at.desc())

    res = await db.execute(stmt)
    rows = res.all()

    def _co(v, d):
        return v if v is not None else d

    return [
        {
            "id": r.id,
            "name": r.name,
            "dm_user_id": r.dm_user_id,
            "dm_display_name": r.dm_display_name,
            "max_players": _co(r.max_players, 4),
            "current_players": _co(r.current_players, 0),
            "level_range": r.level_range,
            "status": _co(r.status, "recruiting"),
            "description": r.description,
            "current_map_url": r.current_map_url,
            "selected_module_id": r.selected_module_id,
            "cover_image": r.cover_image,
            "created_at": r.created_at,
            "updated_at": r.updated_at,
        }
        for r in rows
    ]


@router.get("/{campaign_id}", response_model=CampaignResponse)
async def get_campaign(
    campaign_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Get campaign by ID using ORM (includes metadata)."""
    res = await db.execute(
        select(Campaign)
        .where(Campaign.id == campaign_id)
    )
    c = res.scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return c


@router.get("/{campaign_id}/rule-options", response_model=CampaignRuleOptionsResponse)
async def get_campaign_rule_options(
    campaign_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Return the Phase 0 campaign-scoped character option pool."""
    del current_user

    result = await db.execute(select(Campaign).where(Campaign.id == campaign_id))
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    return campaign_rule_assembler.assemble_rule_options(campaign)


@router.put("/{campaign_id}", response_model=CampaignResponse)
async def update_campaign(
    campaign_id: int,
    campaign_update: CampaignUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Update campaign"""
    await require_campaign_dm(campaign_id, current_user, db)

    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id)
    )
    campaign = result.scalar_one_or_none()

    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    # Update fields
    update_data = campaign_update.model_dump(exclude_unset=True)
    # Map API field 'metadata' to ORM attribute 'meta'
    if 'metadata' in update_data:
        update_data['meta'] = update_data.pop('metadata')
    for field, value in update_data.items():
        setattr(campaign, field, value)

    await db.commit()

    # Return the updated campaign including metadata
    res = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id)
    )
    c = res.scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")

    return c


@router.delete("/{campaign_id}")
async def delete_campaign(
    campaign_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Delete campaign (only creator or admin can delete)"""
    await require_campaign_dm(campaign_id, current_user, db)
    user_id = current_user["user_id"]

    result = await db.execute(
        select(Campaign).options(load_only(
            Campaign.id,
            Campaign.name,
            Campaign.dm_user_id,
            Campaign.max_players,
            Campaign.current_players,
            Campaign.level_range,
            Campaign.status,
            Campaign.description,
            Campaign.current_map_url,
            Campaign.selected_module_id,
            Campaign.created_at,
            Campaign.updated_at,
        )).where(Campaign.id == campaign_id)
    )
    campaign = result.scalar_one_or_none()

    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    # Rely on DB-level ON DELETE CASCADE to remove all related rows
    await db.delete(campaign)
    await db.commit()

    print(f"[Campaign] Deleted campaign {campaign_id} by user {user_id}")
    return {"message": "Campaign deleted successfully"}


@router.post("/{campaign_id}/join", response_model=CampaignMemberResponse)
async def join_campaign(
    campaign_id: int,
    _body: dict | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Join a campaign as a player"""
    # Check if campaign exists
    result = await db.execute(
        select(Campaign).options(load_only(
            Campaign.id,
            Campaign.name,
            Campaign.dm_user_id,
            Campaign.max_players,
            Campaign.current_players,
            Campaign.level_range,
            Campaign.status,
            Campaign.description,
            Campaign.current_map_url,
            Campaign.selected_module_id,
            Campaign.created_at,
            Campaign.updated_at,
        )).where(Campaign.id == campaign_id)
    )
    campaign = result.scalar_one_or_none()

    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    current_user_id = str(current_user["user_id"])

    # Check if user already joined
    result = await db.execute(
        select(CampaignMember).where(
            CampaignMember.campaign_id == campaign_id,
            CampaignMember.user_id == current_user_id
        )
    )
    existing_member = result.scalar_one_or_none()

    if existing_member:
        # User already joined, allow them to rejoin even if campaign is full
        return existing_member

    # Check if campaign is full (only for new members)
    if campaign.current_players >= campaign.max_players:
        raise HTTPException(status_code=400, detail="Campaign is full")

    # Add member
    db_member = CampaignMember(
        campaign_id=campaign_id,
        user_id=current_user_id,
        role="player",
    )
    db.add(db_member)

    # Sync player count from actual members
    await db.flush()
    await _sync_player_count(db, campaign_id)

    try:
        await db.commit()
        await db.refresh(db_member)
    except IntegrityError:
        # Race condition: another request already added this user
        await db.rollback()
        # Query the existing member (created by the concurrent request)
        result = await db.execute(
            select(CampaignMember).where(
                CampaignMember.campaign_id == campaign_id,
                CampaignMember.user_id == current_user_id
            )
        )
        db_member = result.scalar_one_or_none()
        if db_member:
            return db_member
        # This shouldn't happen, but raise an error if it does
        raise HTTPException(status_code=500, detail="Failed to join campaign")

    return db_member


@router.get("/{campaign_id}/members", response_model=List[CampaignMemberResponse])
async def list_campaign_members(
    campaign_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """List all members of a campaign"""
    await resolve_campaign_member_context(db, campaign_id, current_user)
    result = await db.execute(
        select(CampaignMember).where(CampaignMember.campaign_id == campaign_id)
    )
    members = result.scalars().all()

    return members


class MemberCheckResponse(BaseModel):
    is_member: bool
    role: str | None = None


@router.get("/{campaign_id}/members/me/check", response_model=MemberCheckResponse)
async def check_my_campaign_membership(
    campaign_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    current_user_id = str(current_user["user_id"])
    campaign_result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id)
    )
    campaign = campaign_result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    if campaign.dm_user_id == current_user_id:
        return MemberCheckResponse(is_member=True, role="dm")

    member_result = await db.execute(
        select(CampaignMember).where(
            CampaignMember.campaign_id == campaign_id,
            CampaignMember.user_id == current_user_id,
        ).limit(1)
    )
    member = member_result.scalar_one_or_none()
    return MemberCheckResponse(
        is_member=member is not None,
        role=member.role if member else None,
    )


@router.get("/{campaign_id}/members/{user_id}/check", response_model=MemberCheckResponse)
async def check_campaign_membership(
    campaign_id: int,
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Check if user is a member of campaign (returns 200 always)"""
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    if not context.is_dm and context.user_id != str(user_id):
        raise HTTPException(status_code=403, detail="Forbidden")
    result = await db.execute(
        select(CampaignMember).where(
            CampaignMember.campaign_id == campaign_id,
            CampaignMember.user_id == user_id
        ).limit(1)
    )
    member = result.scalar_one_or_none()
    return MemberCheckResponse(
        is_member=member is not None,
        role=member.role if member else None
    )


@router.get("/{campaign_id}/members/{user_id}", response_model=CampaignMemberResponse)
async def get_campaign_member(
    campaign_id: int,
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Get member info in a campaign"""
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    if not context.is_dm and context.user_id != str(user_id):
        raise HTTPException(status_code=403, detail="Forbidden")
    result = await db.execute(
        select(CampaignMember).where(
            CampaignMember.campaign_id == campaign_id,
            CampaignMember.user_id == user_id
        ).order_by(CampaignMember.id.desc())
    )
    members = result.scalars().all()

    if not members:
        raise HTTPException(status_code=404, detail="Member not found")

    # Handle duplicates by returning the most recent one
    member = members[0]

    # Clean up duplicates if they exist
    if len(members) > 1:
        print(f"[WARNING] Found {len(members)} duplicate campaign members for user {user_id} in campaign {campaign_id}, using most recent")
        # Keep only the most recent
        for duplicate in members[1:]:
            await db.delete(duplicate)
        await db.commit()

    return member


@router.delete("/{campaign_id}/members/{user_id}")
async def remove_campaign_member(
    campaign_id: int,
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Leave a campaign or kick a member (DM only)"""
    caller_id = str(current_user["user_id"])

    # Find the member to remove
    result = await db.execute(
        select(CampaignMember).where(
            CampaignMember.campaign_id == campaign_id,
            CampaignMember.user_id == user_id
        )
    )
    member = result.scalar_one_or_none()

    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    # Check if this is a DM kicking someone (caller != target)
    is_dm_kick = caller_id != user_id

    if is_dm_kick:
        # Verify that the caller is a DM
        dm_check = await db.execute(
            select(CampaignMember).where(
                CampaignMember.campaign_id == campaign_id,
                CampaignMember.user_id == caller_id,
                CampaignMember.role == "dm"
            )
        )
        if not dm_check.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="Only DM can kick members")
    else:
        # Self-leave: Can't leave if you're the DM
        if member.role == "dm":
            raise HTTPException(status_code=400, detail="DM cannot leave campaign")

    # Remove member
    await db.delete(member)

    # Sync player count from actual members
    await db.flush()
    await _sync_player_count(db, campaign_id)

    await db.commit()

    # Send WebSocket notification if this is a DM kick
    if is_dm_kick:
        await realtime_publisher.publish_kicked(
            campaign_id,
            recipients=[user_id],
            message="You have been removed from this campaign by the DM",
        )

    return {"message": "Member removed successfully" if is_dm_kick else "Left campaign successfully"}


@router.post("/{campaign_id}/current-map")
async def update_current_map(
    campaign_id: int,
    map_url: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Update the current map for a campaign"""
    await require_campaign_dm(campaign_id, current_user, db)

    result = await db.execute(
        select(Campaign).options(load_only(
            Campaign.id,
            Campaign.name,
            Campaign.dm_user_id,
            Campaign.max_players,
            Campaign.current_players,
            Campaign.level_range,
            Campaign.status,
            Campaign.description,
            Campaign.current_map_url,
            Campaign.selected_module_id,
            Campaign.created_at,
            Campaign.updated_at,
        )).where(Campaign.id == campaign_id)
    )
    campaign = result.scalar_one_or_none()

    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    campaign.current_map_url = map_url
    await db.commit()
    await db.refresh(campaign)

    return {"message": "Current map updated successfully", "current_map_url": map_url}


class MapSettingsUpdate(BaseModel):
    """Schema for updating map display settings"""
    scale: Optional[float] = Field(None, ge=0.1, le=5.0)
    rotation: Optional[int] = Field(None)  # 0, 90, 180, 270
    flipH: Optional[bool] = None
    flipV: Optional[bool] = None


@router.post("/{campaign_id}/map-settings")
async def update_map_settings(
    campaign_id: int,
    settings: MapSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Update map display settings (scale, rotation, flip) stored in campaign metadata"""
    await require_campaign_dm(campaign_id, current_user, db)

    result = await db.execute(
        select(Campaign).options(load_only(
            Campaign.id,
            Campaign.meta,
        )).where(Campaign.id == campaign_id)
    )
    campaign = result.scalar_one_or_none()

    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    # Get current meta or initialize
    current_meta = campaign.meta or {}

    # Get or initialize map_settings
    map_settings = current_meta.get("map_settings", {})

    # Update only provided fields
    if settings.scale is not None:
        map_settings["scale"] = settings.scale
    if settings.rotation is not None:
        # Normalize rotation to 0, 90, 180, 270
        map_settings["rotation"] = settings.rotation % 360
    if settings.flipH is not None:
        map_settings["flipH"] = settings.flipH
    if settings.flipV is not None:
        map_settings["flipV"] = settings.flipV

    # Update meta
    current_meta["map_settings"] = map_settings
    campaign.meta = current_meta

    # Mark as modified for JSONB
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(campaign, "meta")

    await db.commit()

    return {"message": "Map settings updated", "map_settings": map_settings}


@router.post("/{campaign_id}/selected-module")
async def update_selected_module(
    campaign_id: int,
    module_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Update the selected module for a campaign"""
    await require_campaign_dm(campaign_id, current_user, db)

    result = await db.execute(
        select(Campaign).options(load_only(
            Campaign.id,
            Campaign.name,
            Campaign.dm_user_id,
            Campaign.max_players,
            Campaign.current_players,
            Campaign.level_range,
            Campaign.status,
            Campaign.description,
            Campaign.current_map_url,
            Campaign.selected_module_id,
            Campaign.created_at,
            Campaign.updated_at,
        )).where(Campaign.id == campaign_id)
    )
    campaign = result.scalar_one_or_none()

    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    campaign.selected_module_id = module_id
    await db.commit()
    await db.refresh(campaign)

    return {"message": "Selected module updated successfully", "selected_module_id": module_id}


class SelectedCharacterUpdate(BaseModel):
    character_id: int


async def _get_selected_character_for_user(
    campaign_id: int,
    user_id: str,
    db: AsyncSession,
):
    """Get the selected character id for a user in a campaign (persisted in database)."""
    # First try to get player role (use .first() to handle duplicates)
    result = await db.execute(
        select(CampaignMember).where(
            CampaignMember.campaign_id == campaign_id,
            CampaignMember.user_id == user_id,
            CampaignMember.role == "player"
        ).limit(1)
    )
    member = result.scalar_one_or_none()

    # If no player role found, try to get any role (including DM)
    if not member:
        result = await db.execute(
            select(CampaignMember).where(
                CampaignMember.campaign_id == campaign_id,
                CampaignMember.user_id == user_id
            ).limit(1)
        )
        member = result.scalar_one_or_none()

    # If still no member found, auto-create a player role member
    if not member:
        # Verify campaign exists
        campaign_result = await db.execute(
            select(Campaign).where(Campaign.id == campaign_id)
        )
        campaign = campaign_result.scalar_one_or_none()
        if not campaign:
            raise HTTPException(status_code=404, detail="Campaign not found")

        # Create player member
        member = CampaignMember(
            campaign_id=campaign_id,
            user_id=user_id,
            role="player"
        )
        db.add(member)
        await db.commit()
        await db.refresh(member)
        print(f"[Campaign] Auto-created player member for user {user_id} in campaign {campaign_id}")

    return {"selected_character_id": member.selected_character_id}


@router.get("/{campaign_id}/members/me/selected-character")
async def get_my_selected_character(
    campaign_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    return await _get_selected_character_for_user(campaign_id, context.user_id, db)


@router.get("/{campaign_id}/members/{user_id}/selected-character")
async def get_selected_character(
    campaign_id: int,
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    normalized_user_id = context.user_id if user_id == "me" else str(user_id)
    if not context.is_dm and context.user_id != normalized_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return await _get_selected_character_for_user(campaign_id, normalized_user_id, db)


async def _set_selected_character_for_user(
    campaign_id: int,
    user_id: str,
    body: SelectedCharacterUpdate,
    db: AsyncSession,
):
    """Persist the selected character id for a user in a campaign (database)."""
    from app.models.token import Token

    # Get campaign first to check current_map_url
    campaign_result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id)
    )
    campaign = campaign_result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    # Find any campaign member for this user (regardless of role)
    # UniqueConstraint ensures only one record per campaign+user
    result = await db.execute(
        select(CampaignMember).where(
            CampaignMember.campaign_id == campaign_id,
            CampaignMember.user_id == user_id,
        ).limit(1)
    )
    member = result.scalar_one_or_none()

    # If no member found at all, auto-create a player member
    if not member:
        # Create player member
        member = CampaignMember(
            campaign_id=campaign_id,
            user_id=user_id,
            role="player"
        )
        db.add(member)
        await db.flush()  # Flush to get the ID but don't commit yet
        await _sync_player_count(db, campaign_id)
        print(f"[Campaign] Auto-created player member for user {user_id} in campaign {campaign_id}")

    # Verify the character exists and belongs to the user
    char_result = await db.execute(
        select(Character).where(Character.id == body.character_id)
    )
    character = char_result.scalar_one_or_none()

    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    if character.user_id != user_id:
        raise HTTPException(status_code=403, detail="Character does not belong to this user")

    # Delete user's old tokens on current map before changing character
    # This ensures only one token per user per map
    new_token_data = None
    if campaign.current_map_url:
        old_tokens = await db.execute(
            select(Token).where(
                Token.campaign_id == campaign_id,
                Token.user_id == user_id,
                Token.map_url == campaign.current_map_url,
                Token.character_id != body.character_id  # Don't delete if same character
            )
        )
        # Save position from old token to use for new token
        old_token_position = None
        for token in old_tokens.scalars().all():
            old_token_position = (token.position_x, token.position_y)
            print(f"[Campaign] Deleting old token {token.id} (char={token.character_id}) for user {user_id}")
            await db.delete(token)

        # Check if new character already has a token on this map
        existing_token = await db.execute(
            select(Token).where(
                Token.campaign_id == campaign_id,
                Token.character_id == body.character_id,
                Token.map_url == campaign.current_map_url
            )
        )
        if not existing_token.scalar_one_or_none():
            # Create new token for the character
            # Use old token position, or find a suitable position
            if old_token_position:
                pos_x, pos_y = old_token_position
            else:
                # Find empty position near center
                from sqlalchemy import and_
                existing_positions = await db.execute(
                    select(Token.position_x, Token.position_y).where(
                        and_(
                            Token.campaign_id == campaign_id,
                            Token.map_url == campaign.current_map_url
                        )
                    )
                )
                used = {(r.position_x, r.position_y) for r in existing_positions.all()}
                # 查询锚点作为 token 生成中心点
                from app.models.map_settings import MapSettings
                anchor_result = await db.execute(
                    select(MapSettings).where(
                        and_(
                            MapSettings.campaign_id == campaign_id,
                            MapSettings.map_url == campaign.current_map_url
                        )
                    )
                )
                anchor_settings = anchor_result.scalar_one_or_none()
                if anchor_settings and anchor_settings.anchor_x is not None and anchor_settings.anchor_y is not None:
                    center_x, center_y = anchor_settings.anchor_x, anchor_settings.anchor_y
                else:
                    center_x, center_y = 15, 10
                deltas = [
                    (0, 0), (1, 0), (0, 1), (-1, 0), (0, -1),
                    (1, 1), (-1, 1), (1, -1), (-1, -1),
                    (2, 0), (0, 2), (-2, 0), (0, -2),
                ]
                pos_x, pos_y = center_x, center_y
                for dx, dy in deltas:
                    if (center_x + dx, center_y + dy) not in used:
                        pos_x, pos_y = center_x + dx, center_y + dy
                        break

            new_token = Token(
                campaign_id=campaign_id,
                character_id=body.character_id,
                user_id=user_id,
                map_url=campaign.current_map_url,
                position_x=pos_x,
                position_y=pos_y,
                token_size="1x1",
                instance_name=character.name
            )
            db.add(new_token)
            await db.flush()
            new_token_data = {
                "id": new_token.id,
                "campaign_id": new_token.campaign_id,
                "character_id": new_token.character_id,
                "user_id": new_token.user_id,
                "map_url": new_token.map_url,
                "position_x": new_token.position_x,
                "position_y": new_token.position_y,
                "token_size": new_token.token_size,
                "instance_name": new_token.instance_name,
                "character_name": character.name,
                "character_race": character.race_id,
                "character_class": character.class_id,
                "character_level": character.level,
                "avatar": character.avatar,
                "avatar_large": character.avatar_large,
            }
            print(f"[Campaign] Created new token {new_token.id} for character {body.character_id} at ({pos_x}, {pos_y})")

    # Update the selected character and character_name
    member.selected_character_id = body.character_id
    member.character_name = character.name  # Sync character name
    await db.commit()
    await db.refresh(member)

    await realtime_publisher.publish_character_selected(
        campaign_id,
        user_id=user_id,
        character_id=body.character_id,
        character_name=character.name,
    )

    # Broadcast new token if created
    if new_token_data:
        await realtime_publisher.publish_token_placed(
            campaign_id,
            token=new_token_data,
        )

    return {"selected_character_id": member.selected_character_id}


@router.post("/{campaign_id}/members/me/selected-character")
async def set_my_selected_character(
    campaign_id: int,
    body: SelectedCharacterUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    return await _set_selected_character_for_user(campaign_id, context.user_id, body, db)


@router.post("/{campaign_id}/members/{user_id}/selected-character")
async def set_selected_character(
    campaign_id: int,
    user_id: str,
    body: SelectedCharacterUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    normalized_user_id = context.user_id if user_id == "me" else str(user_id)
    if not context.is_dm and context.user_id != normalized_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return await _set_selected_character_for_user(campaign_id, normalized_user_id, body, db)


# ============== Notes API ==============

class NotesUpdate(BaseModel):
    """Schema for updating player notes"""
    quests: str = ""
    npcs: str = ""
    personal: str = ""


@router.get("/{campaign_id}/members/{user_id}/notes")
async def get_member_notes(
    campaign_id: int,
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Get player notes for a campaign"""
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    normalized_user_id = context.user_id if user_id == "me" else str(user_id)
    if not context.is_dm and context.user_id != normalized_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    result = await db.execute(
        select(CampaignMember).where(
            CampaignMember.campaign_id == campaign_id,
            CampaignMember.user_id == normalized_user_id
        ).limit(1)
    )
    member = result.scalar_one_or_none()

    if not member:
        # Return empty notes if member not found
        return {"quests": "", "npcs": "", "personal": ""}

    notes = member.notes or {}
    return {
        "quests": notes.get("quests", ""),
        "npcs": notes.get("npcs", ""),
        "personal": notes.get("personal", "")
    }


@router.get("/{campaign_id}/members/me/notes")
async def get_my_notes(
    campaign_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    return await get_member_notes(
        campaign_id=campaign_id,
        user_id=context.user_id,
        db=db,
        current_user=current_user,
    )


@router.put("/{campaign_id}/members/{user_id}/notes")
async def update_member_notes(
    campaign_id: int,
    user_id: str,
    body: NotesUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Update player notes for a campaign"""
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    normalized_user_id = context.user_id if user_id == "me" else str(user_id)
    if not context.is_dm and context.user_id != normalized_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    result = await db.execute(
        select(CampaignMember).where(
            CampaignMember.campaign_id == campaign_id,
            CampaignMember.user_id == normalized_user_id
        ).limit(1)
    )
    member = result.scalar_one_or_none()

    if not member:
        # Auto-create member if not exists
        campaign_result = await db.execute(
            select(Campaign).where(Campaign.id == campaign_id)
        )
        campaign = campaign_result.scalar_one_or_none()
        if not campaign:
            raise HTTPException(status_code=404, detail="Campaign not found")

        member = CampaignMember(
            campaign_id=campaign_id,
            user_id=normalized_user_id,
            role="player",
            notes={}
        )
        db.add(member)
        await db.flush()

    # Update notes
    member.notes = {
        "quests": body.quests,
        "npcs": body.npcs,
        "personal": body.personal
    }
    await db.commit()
    await db.refresh(member)

    return {"status": "success", "notes": member.notes}


@router.put("/{campaign_id}/members/me/notes")
async def update_my_notes(
    campaign_id: int,
    body: NotesUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    return await update_member_notes(
        campaign_id=campaign_id,
        user_id=context.user_id,
        body=body,
        db=db,
        current_user=current_user,
    )


# ============== Sidebar State API ==============

@router.get("/{campaign_id}/members/{user_id}/sidebar-state/{role}", response_model=SidebarStateResponse)
async def get_sidebar_state(
    campaign_id: int,
    user_id: str,
    role: Literal["dm", "player"],
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Get sidebar state for a user in a campaign by role"""
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    normalized_user_id = context.user_id if user_id == "me" else str(user_id)
    if not context.is_dm and context.user_id != normalized_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    result = await db.execute(
        select(CampaignMember).where(
            CampaignMember.campaign_id == campaign_id,
            CampaignMember.user_id == normalized_user_id
        ).limit(1)
    )
    member = result.scalar_one_or_none()

    # Default values
    default_state = {"tab": "characters", "width": 384, "subTabs": {}}

    if not member:
        return default_state

    notes = member.notes or {}
    sidebar_state = notes.get("sidebar_state", {})
    role_state = sidebar_state.get(role, default_state)

    return {
        "tab": role_state.get("tab", "characters"),
        "width": role_state.get("width", 384),
        "subTabs": role_state.get("subTabs", {}),
        "hotbarExpanded": role_state.get("hotbarExpanded", False),
        "dmSelectedCharacterId": role_state.get("dmSelectedCharacterId", None),
        "spellExpandedLevels": role_state.get("spellExpandedLevels", {}),
        "floatingChat": role_state.get("floatingChat", None),
        "floatingCharPanel": role_state.get("floatingCharPanel", None),
        "chatFilters": role_state.get("chatFilters", None)
    }


@router.get("/{campaign_id}/members/me/sidebar-state/{role}", response_model=SidebarStateResponse)
async def get_my_sidebar_state(
    campaign_id: int,
    role: Literal["dm", "player"],
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    return await get_sidebar_state(
        campaign_id=campaign_id,
        user_id=context.user_id,
        role=role,
        db=db,
        current_user=current_user,
    )


@router.post("/{campaign_id}/members/{user_id}/sidebar-state")
async def update_sidebar_state(
    campaign_id: int,
    user_id: str,
    body: SidebarStateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Update sidebar state for a user in a campaign"""
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    normalized_user_id = context.user_id if user_id == "me" else str(user_id)
    if not context.is_dm and context.user_id != normalized_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    result = await db.execute(
        select(CampaignMember).where(
            CampaignMember.campaign_id == campaign_id,
            CampaignMember.user_id == normalized_user_id
        ).limit(1)
    )
    member = result.scalar_one_or_none()

    if not member:
        # Auto-create member if not exists
        campaign_result = await db.execute(
            select(Campaign).where(Campaign.id == campaign_id)
        )
        campaign = campaign_result.scalar_one_or_none()
        if not campaign:
            raise HTTPException(status_code=404, detail="Campaign not found")

        member = CampaignMember(
            campaign_id=campaign_id,
            user_id=normalized_user_id,
            role=body.role,
            notes={}
        )
        db.add(member)
        await db.flush()

    # Get existing notes and update sidebar_state
    # Must copy dict and use flag_modified for SQLAlchemy to detect JSONB changes
    notes = dict(member.notes) if member.notes else {}
    sidebar_state = notes.get("sidebar_state", {})
    sidebar_state[body.role] = {
        "tab": body.tab,
        "width": body.width,
        "subTabs": body.subTabs or {},
        "hotbarExpanded": body.hotbarExpanded if body.hotbarExpanded is not None else sidebar_state.get(body.role, {}).get("hotbarExpanded", False),
        "dmSelectedCharacterId": body.dmSelectedCharacterId if body.dmSelectedCharacterId is not None else sidebar_state.get(body.role, {}).get("dmSelectedCharacterId", None),
        "spellExpandedLevels": body.spellExpandedLevels if body.spellExpandedLevels is not None else sidebar_state.get(body.role, {}).get("spellExpandedLevels", {}),
        "floatingChat": body.floatingChat if body.floatingChat is not None else sidebar_state.get(body.role, {}).get("floatingChat", None),
        "floatingCharPanel": body.floatingCharPanel if body.floatingCharPanel is not None else sidebar_state.get(body.role, {}).get("floatingCharPanel", None),
        "chatFilters": body.chatFilters if body.chatFilters is not None else sidebar_state.get(body.role, {}).get("chatFilters", None)
    }
    notes["sidebar_state"] = sidebar_state
    member.notes = notes
    flag_modified(member, "notes")

    await db.commit()

    return {"status": "success", "sidebar_state": sidebar_state[body.role]}


@router.post("/{campaign_id}/members/me/sidebar-state")
async def update_my_sidebar_state(
    campaign_id: int,
    body: SidebarStateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    return await update_sidebar_state(
        campaign_id=campaign_id,
        user_id=context.user_id,
        body=body,
        db=db,
        current_user=current_user,
    )


# ============== Virtual Players API ==============

@router.post("/{campaign_id}/virtual-players", response_model=CampaignMemberResponse)
async def create_virtual_player(
    campaign_id: int,
    body: VirtualPlayerCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Create a virtual player in a campaign (DM only)"""
    import uuid

    await require_campaign_dm(campaign_id, current_user, db)

    # Generate virtual player user_id
    vp_user_id = f"vp_{uuid.uuid4().hex[:8]}"

    db_member = CampaignMember(
        campaign_id=campaign_id,
        user_id=vp_user_id,
        role="player",
        is_virtual=True,
        display_name=body.display_name,
    )
    db.add(db_member)
    await db.flush()
    await _sync_player_count(db, campaign_id)
    await db.commit()
    await db.refresh(db_member)

    await realtime_publisher.publish_virtual_player_event(
        campaign_id,
        event_type="virtual_player_added",
        data={
            "member_id": db_member.id,
            "user_id": vp_user_id,
            "display_name": body.display_name,
        },
    )

    return db_member


@router.put("/{campaign_id}/virtual-players/{member_id}", response_model=CampaignMemberResponse)
async def update_virtual_player(
    campaign_id: int,
    member_id: int,
    body: VirtualPlayerUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Update a virtual player's display name (DM only)"""
    await require_campaign_dm(campaign_id, current_user, db)

    result = await db.execute(
        select(CampaignMember).where(
            CampaignMember.id == member_id,
            CampaignMember.campaign_id == campaign_id,
            CampaignMember.is_virtual == True,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Virtual player not found")

    member.display_name = body.display_name
    await db.commit()
    await db.refresh(member)
    return member


@router.delete("/{campaign_id}/virtual-players/{member_id}")
async def delete_virtual_player(
    campaign_id: int,
    member_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Delete a virtual player and associated characters (DM only)"""
    await require_campaign_dm(campaign_id, current_user, db)

    result = await db.execute(
        select(CampaignMember).where(
            CampaignMember.id == member_id,
            CampaignMember.campaign_id == campaign_id,
            CampaignMember.is_virtual == True,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Virtual player not found")

    vp_user_id = member.user_id

    # Delete associated characters
    char_result = await db.execute(
        select(Character).where(Character.user_id == vp_user_id)
    )
    for char in char_result.scalars().all():
        await db.delete(char)

    # Delete member
    await db.delete(member)
    await db.flush()
    await _sync_player_count(db, campaign_id)

    await db.commit()

    await realtime_publisher.publish_virtual_player_event(
        campaign_id,
        event_type="virtual_player_removed",
        data={
            "member_id": member_id,
            "user_id": vp_user_id,
        },
    )

    return {"message": "Virtual player deleted successfully"}


@router.get("/virtual-library/characters")
async def get_virtual_character_library(
    current_user: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Get all virtual characters created by this DM across all campaigns"""
    user_id = str(current_user["user_id"])

    # Find all campaigns where user is DM
    campaigns_result = await db.execute(
        select(Campaign).where(Campaign.dm_user_id == user_id)
    )
    dm_campaigns = campaigns_result.scalars().all()
    if not dm_campaigns:
        return []

    campaign_map = {c.id: c.name for c in dm_campaigns}
    campaign_ids = list(campaign_map.keys())

    # Find all virtual members in those campaigns
    members_result = await db.execute(
        select(CampaignMember).where(
            CampaignMember.campaign_id.in_(campaign_ids),
            CampaignMember.is_virtual == True,
        )
    )
    virtual_members = members_result.scalars().all()
    if not virtual_members:
        return []

    # Get characters for those virtual members
    vp_user_ids = [m.user_id for m in virtual_members]
    member_info = {m.user_id: m for m in virtual_members}

    chars_result = await db.execute(
        select(Character).where(Character.user_id.in_(vp_user_ids))
    )
    characters = chars_result.scalars().all()

    result = []
    for char in characters:
        member = member_info.get(char.user_id)
        if not member:
            continue
        result.append({
            "id": char.id,
            "name": char.name,
            "race_id": char.race_id,
            "class_id": char.class_id,
            "subclass_id": char.subclass_id,
            "level": char.level,
            "avatar": char.avatar,
            "display_name": member.display_name,
            "campaign_id": member.campaign_id,
            "campaign_name": campaign_map.get(member.campaign_id, ""),
        })
    return result


@router.post("/{campaign_id}/virtual-players/import", response_model=CampaignMemberResponse)
async def import_virtual_player(
    campaign_id: int,
    body: VirtualPlayerImport,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Import a character from the virtual library into a campaign"""
    import uuid

    await require_campaign_dm(campaign_id, current_user, db)

    # Load source character
    result = await db.execute(select(Character).where(Character.id == body.source_character_id))
    source_char = result.scalar_one_or_none()
    if not source_char:
        raise HTTPException(status_code=404, detail="Source character not found")

    # Create VP member
    vp_user_id = f"vp_{uuid.uuid4().hex[:8]}"
    db_member = CampaignMember(
        campaign_id=campaign_id,
        user_id=vp_user_id,
        role="player",
        is_virtual=True,
        display_name=body.display_name,
    )
    db.add(db_member)

    # Clone character — copy all fields except id, user_id, timestamps
    skip_fields = {"id", "user_id", "created_at", "updated_at"}
    clone_data = {}
    for col in Character.__table__.columns:
        if col.name not in skip_fields:
            clone_data[col.name] = getattr(source_char, col.name)
    clone_data["user_id"] = vp_user_id

    new_char = Character(**clone_data)
    db.add(new_char)

    await db.flush()

    # Assign character
    db_member.selected_character_id = new_char.id
    await _sync_player_count(db, campaign_id)
    await db.commit()
    await db.refresh(db_member)

    await realtime_publisher.publish_virtual_player_event(
        campaign_id,
        event_type="virtual_player_added",
        data={
            "member_id": db_member.id,
            "user_id": vp_user_id,
            "display_name": body.display_name,
            "character_name": new_char.name,
        },
    )

    return db_member


# ============== Module-based Campaign Info Generation API ==============

@router.post("/generate-info-from-module/{module_id}")
async def generate_campaign_info_from_module(
    module_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Generate campaign name and description from module content using FAST model.
    This is used when creating a new campaign based on a module.
    """
    import httpx
    from app.models.parsed_module import ParsedModule
    from app.models.ai_settings import AIAPISettings, AIModelConfig, ModelType

    # Get module content
    module_result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == module_id)
    )
    module = module_result.scalar_one_or_none()

    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    # Build context from module
    module_info = module.module_info or {}
    title = module_info.get("title") or module.title or "Unknown Adventure"
    description = module_info.get("description", "")

    # Get chapter titles for context
    chapters = module.chapters or []
    chapter_titles = [ch.get("title", "") for ch in chapters[:10] if ch.get("title")]

    # Get some monster/NPC names for flavor
    monsters = module.monsters or []
    monster_names = [m.get("name", "") for m in monsters[:5] if m.get("name")]

    # Get AI settings
    settings_result = await db.execute(
        select(AIAPISettings).where(AIAPISettings.user_id == "global")
    )
    settings = settings_result.scalar_one_or_none()

    if not settings:
        # Return module's own title/description if no AI settings
        return {
            "name": title,
            "description": description or f"基于模组《{title}》的战役",
            "ai_generated": False
        }

    # Get FAST model for generation
    fast_config_result = await db.execute(
        select(AIModelConfig).where(
            (AIModelConfig.settings_id == settings.id) &
            (AIModelConfig.model_type == ModelType.FAST)
        )
    )
    fast_config = fast_config_result.scalar_one_or_none()

    if not fast_config or not fast_config.api_url or not fast_config.api_key:
        # Return module's own title/description if FAST model not configured
        return {
            "name": title,
            "description": description or f"基于模组《{title}》的战役",
            "ai_generated": False
        }

    # Build generation request
    context_text = f"""模组名称: {title}
模组描述: {description}
章节标题: {', '.join(chapter_titles) if chapter_titles else '无'}
重要角色/怪物: {', '.join(monster_names) if monster_names else '无'}"""

    prompt_request = f"""你是一个D&D战役命名助手。根据以下模组信息，生成一个吸引人的战役名称和简短描述。

{context_text}

要求：
1. 战役名称应该简洁有力，能够吸引玩家（8-15个字）
2. 描述应该简短但有吸引力，让玩家想要参与（50-80个字）
3. 使用中文
4. 严格按照以下JSON格式输出，不要输出其他内容：
{{"name": "战役名称", "description": "战役描述"}}

请生成:"""

    # Call FAST model
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            api_url = fast_config.api_url.rstrip("/")
            headers = {
                "Authorization": f"Bearer {fast_config.api_key}",
                "Content-Type": "application/json"
            }

            resp = await client.post(
                f"{api_url}/chat/completions",
                headers=headers,
                json={
                    "model": fast_config.model_name,
                    "messages": [{"role": "user", "content": prompt_request}],
                    "temperature": 0.7,
                    "max_tokens": 200
                }
            )

            if resp.status_code != 200:
                return {
                    "name": title,
                    "description": description or f"基于模组《{title}》的战役",
                    "ai_generated": False
                }

            data = resp.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

            # Parse JSON response
            import json
            import re

            # Try to extract JSON from response
            json_match = re.search(r'\{[^{}]*\}', content)
            if json_match:
                try:
                    result = json.loads(json_match.group())
                    return {
                        "name": result.get("name", title),
                        "description": result.get("description", description),
                        "ai_generated": True
                    }
                except json.JSONDecodeError:
                    pass

            # Fallback to module info
            return {
                "name": title,
                "description": description or f"基于模组《{title}》的战役",
                "ai_generated": False
            }

    except Exception as e:
        print(f"[CampaignInfo] AI generation failed: {e}", flush=True)
        return {
            "name": title,
            "description": description or f"基于模组《{title}》的战役",
            "ai_generated": False
        }


# ============== Auto Import All Resources API ==============

@router.post("/{campaign_id}/auto-import-all")
async def auto_import_all_resources(
    campaign_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Automatically import all resources (maps, monsters, items) from the selected module.
    This is called when DM first enters a campaign that was created with a module.
    """
    import uuid
    from datetime import datetime
    from app.models.parsed_module import ParsedModule
    from app.models.module_maps import ModuleMaps
    from app.models.monster_instance import MonsterInstance
    from app.models.item import Item

    # Get campaign
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id)
    )
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    module_id = campaign.selected_module_id
    if not module_id:
        return {"success": False, "message": "No module selected"}

    # Check if auto import is pending
    meta = campaign.meta or {}
    if not meta.get("auto_import_pending"):
        return {"success": True, "message": "Auto import already completed or not needed"}

    # Get module
    module_result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == module_id)
    )
    module = module_result.scalar_one_or_none()
    if not module:
        return {"success": False, "message": "Module not found"}

    results = {
        "maps_added": 0,
        "monsters_added": 0,
        "items_added": 0,
        "maps_skipped": 0,
        "monsters_skipped": 0,
        "items_skipped": 0,
    }

    # 1. Import maps
    images = module.images or []
    map_images = [img for img in images if (img.get("category") or img.get("type") or "").lower() in ("map", "地图")]
    first_map_url = None  # Track first map for auto-display

    if map_images:
        # Check existing module maps
        existing_result = await db.execute(
            select(ModuleMaps).where(
                (ModuleMaps.campaign_id == campaign_id) &
                (ModuleMaps.module_id == module_id)
            )
        )
        existing_record = existing_result.scalar_one_or_none()
        existing_map_ids = set()
        if existing_record and existing_record.maps:
            existing_map_ids = {m.get("id") for m in existing_record.maps if isinstance(m, dict)}

        # Build new maps
        new_maps = []
        for img in map_images:
            map_id = f"map_{int(datetime.now().timestamp()*1000)}_{uuid.uuid4().hex[:8]}"
            if map_id in existing_map_ids:
                results["maps_skipped"] += 1
                continue

            map_url = img.get("oss_url") or img.get("thumbnail_url") or ""
            if not map_url:
                continue

            # Get map name from chapter_title (DB field) or chapter (API field) or description
            map_name = (
                img.get("chapter_title") or
                img.get("chapter") or
                img.get("section") or
                (img.get("description") or "")[:30] or
                "未命名地图"
            )

            # Track first map URL
            if first_map_url is None:
                first_map_url = map_url

            new_maps.append({
                "id": map_id,
                "name": map_name,
                "url": map_url,
                "chapter": img.get("chapter_title") or img.get("chapter") or "",
                "metadata": {
                    "type": img.get("category") or img.get("type") or "map",
                    "image_id": img.get("image_id"),
                    "auto_imported": True
                }
            })

        if new_maps:
            if existing_record:
                existing_record.maps = (existing_record.maps or []) + new_maps
                flag_modified(existing_record, "maps")
            else:
                new_record = ModuleMaps(
                    campaign_id=campaign_id,
                    module_id=module_id,
                    maps=new_maps
                )
                db.add(new_record)
            results["maps_added"] = len(new_maps)

    # 2. Import monsters/NPCs
    monsters = module.monsters or []
    if monsters:
        # Get existing monsters
        existing_monsters_result = await db.execute(
            select(MonsterInstance.name, MonsterInstance.name_cn).where(
                MonsterInstance.campaign_id == campaign_id
            )
        )
        existing_names = set()
        for row in existing_monsters_result:
            if row[0]:
                existing_names.add(row[0].lower())
            if row[1]:
                existing_names.add(row[1].lower())

        for monster_data in monsters:
            monster_name = monster_data.get("name") or monster_data.get("name_cn") or ""
            if not monster_name:
                continue
            if monster_name.lower() in existing_names:
                results["monsters_skipped"] += 1
                continue

            # Create monster instance with available data
            # Build monster_data JSON with all the extra fields
            full_monster_data = {
                "traits": monster_data.get("traits") or [],
                "actions": monster_data.get("actions") or [],
                "legendary_actions": monster_data.get("legendary_actions") or [],
                "skills": monster_data.get("skills") or {},
                "senses": monster_data.get("senses") or "",
                "languages": monster_data.get("languages") or "",
                "description": monster_data.get("description") or "",
                "source_module": module.title or module_id,
            }

            # Parse speed into JSON format
            speed_raw = monster_data.get("speed") or monster_data.get("speeds") or "30 ft."
            if isinstance(speed_raw, str):
                speeds = {"walk": 30}  # Default
                # Try to parse "30 ft." or "30 ft., fly 60 ft." etc.
                import re
                walk_match = re.search(r"(\d+)\s*(?:ft\.?|尺)", speed_raw)
                if walk_match:
                    speeds["walk"] = int(walk_match.group(1))
            else:
                speeds = speed_raw

            hp_value = monster_data.get("hp") or monster_data.get("hit_points") or 10

            new_monster = MonsterInstance(
                campaign_id=campaign_id,
                monster_id=f"monster_{uuid.uuid4().hex[:12]}",
                name=monster_data.get("name_en") or monster_name,
                name_cn=monster_data.get("name_cn") or monster_data.get("name"),
                entity_type="npc" if monster_data.get("is_npc") else "monster",
                size=monster_data.get("size") or "Medium",
                type=monster_data.get("type") or "humanoid",
                alignment=monster_data.get("alignment"),
                challenge_rating=str(monster_data.get("cr") or monster_data.get("challenge_rating") or "0"),
                armor_class=monster_data.get("ac") or monster_data.get("armor_class") or 10,
                hit_points=hp_value,
                hit_dice=monster_data.get("hit_dice") or "",
                ability_scores=monster_data.get("abilities") or monster_data.get("ability_scores") or {},
                speeds=speeds,
                monster_data=full_monster_data,
                avatar_url=monster_data.get("avatar_url") or monster_data.get("image_url"),
                current_hp=hp_value,
            )
            db.add(new_monster)
            results["monsters_added"] += 1
            existing_names.add(monster_name.lower())

    # 3. Import items
    items = module.items or []
    if items:
        # Get existing items
        existing_items_result = await db.execute(
            select(Item.name).where(Item.campaign_id == campaign_id)
        )
        existing_item_names = {row[0].lower() for row in existing_items_result if row[0]}

        for item_data in items:
            item_name = item_data.get("name") or ""
            if not item_name:
                continue
            if item_name.lower() in existing_item_names:
                results["items_skipped"] += 1
                continue

            # Create item with available data
            # name field stores primary name (could be English or Chinese)
            # name_cn stores Chinese name if available
            primary_name = item_data.get("name_en") or item_name
            chinese_name = item_data.get("name_cn") if item_data.get("name_en") else None

            new_item = Item(
                campaign_id=campaign_id,
                name=primary_name,
                name_cn=chinese_name or (item_name if item_name != primary_name else None),
                category=item_data.get("category") or item_data.get("type") or "wondrous_item",
                rarity=item_data.get("rarity") or "common",
                description=item_data.get("description") or "",
                requires_attunement=item_data.get("requires_attunement", False),
                source_module=module.title or module_id,
                is_custom=False,
            )
            db.add(new_item)
            results["items_added"] += 1
            existing_item_names.add(item_name.lower())

    # Update campaign metadata to mark import as complete
    meta["auto_import_pending"] = False
    meta["auto_import_completed"] = True
    meta["auto_import_results"] = results
    campaign.meta = meta
    flag_modified(campaign, "meta")

    # Auto-set first map as current map if campaign has no map set
    if results["maps_added"] > 0 and not campaign.current_map_url and first_map_url:
        campaign.current_map_url = first_map_url

    await db.commit()

    return {
        "success": True,
        "message": f"自动导入完成: {results['maps_added']}张地图, {results['monsters_added']}个怪物/NPC, {results['items_added']}个物品",
        "results": results
    }


# ============== Cover Image Generation API ==============

class CoverImageGenerateRequest(BaseModel):
    """Request to generate AI cover image"""
    custom_prompt: Optional[str] = None  # Optional custom prompt
    save_to_library: bool = True  # Save to user's cover library


@router.post("/generate-cover-from-module/{module_id}")
async def generate_cover_from_module(
    module_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Generate AI cover image directly from module content (without requiring a campaign).
    Used during campaign creation process.
    """
    import asyncio
    import uuid
    import httpx
    import base64
    import re
    from app.models.parsed_module import ParsedModule
    from app.models.ai_settings import AIAPISettings, AIModelConfig, ModelType

    print(f"[CoverFromModule] Starting for module_id={module_id}", flush=True)

    try:
        # Get module content
        module_result = await db.execute(
            select(ParsedModule).where(ParsedModule.module_id == module_id)
        )
        module = module_result.scalar_one_or_none()

        if not module:
            raise HTTPException(status_code=404, detail="Module not found")

        # Build context from module
        module_info = module.module_info or {}
        title = module_info.get("title") or module.title or "Unknown Adventure"
        description = module_info.get("description", "")

        # Get chapter titles for context
        chapters = module.chapters or []
        chapter_titles = [ch.get("title", "") for ch in chapters[:10] if ch.get("title")]

        # Get some monster/NPC names for flavor
        monsters = module.monsters or []
        monster_names = [m.get("name", "") for m in monsters[:5] if m.get("name")]

        print(f"[CoverFromModule] Module: {title}, chapters={len(chapter_titles)}, monsters={len(monster_names)}", flush=True)

        # Get AI settings
        settings_result = await db.execute(
            select(AIAPISettings).where(AIAPISettings.user_id == "global")
        )
        settings = settings_result.scalar_one_or_none()

        if not settings:
            raise HTTPException(status_code=500, detail="AI settings not configured")

        # Get FAST model for prompt generation
        fast_config_result = await db.execute(
            select(AIModelConfig).where(
                (AIModelConfig.settings_id == settings.id) &
                (AIModelConfig.model_type == ModelType.FAST)
            )
        )
        fast_config = fast_config_result.scalar_one_or_none()

        if not fast_config or not fast_config.api_url or not fast_config.api_key:
            raise HTTPException(status_code=500, detail="FAST model not configured")

        # Build prompt generation request
        context_text = f"""模组名称: {title}
描述: {description}
章节: {', '.join(chapter_titles) if chapter_titles else '无'}
重要角色/怪物: {', '.join(monster_names) if monster_names else '无'}"""

        prompt_request = f"""你是一个D&D战役封面图生成助手。根据以下模组信息，生成一个用于AI图像生成的英文提示词。

{context_text}

要求：
1. 生成一个适合D&D/奇幻风格的史诗场景描述
2. 使用英文
3. 描述应该包含环境、氛围、光影效果
4. 适合作为战役封面图
5. 200字以内
6. 只输出提示词本身，不要任何其他解释

示例风格: "Epic fantasy landscape, ancient castle on a cliff overlooking a misty valley, dramatic sunset lighting, dark storm clouds gathering, mysterious and foreboding atmosphere, digital painting, cinematic composition, 4k detailed"

请生成提示词:"""

        # Call FAST model
        print(f"[CoverFromModule] Calling FAST model for prompt generation...", flush=True)
        async with httpx.AsyncClient(timeout=60.0) as client:
            api_url = fast_config.api_url.rstrip("/")
            headers = {
                "Authorization": f"Bearer {fast_config.api_key}",
                "Content-Type": "application/json"
            }

            resp = await client.post(
                f"{api_url}/chat/completions",
                headers=headers,
                json={
                    "model": fast_config.model_name,
                    "messages": [{"role": "user", "content": prompt_request}],
                    "temperature": 0.7,
                    "max_tokens": 500
                }
            )

            if resp.status_code != 200:
                print(f"[CoverFromModule] FAST model failed: {resp.status_code} - {resp.text[:200]}", flush=True)
                raise HTTPException(status_code=502, detail=f"Prompt generation failed: {resp.text}")

            data = resp.json()
            image_prompt = data.get("choices", [{}])[0].get("message", {}).get("content", "")

            if not image_prompt:
                raise HTTPException(status_code=502, detail="Failed to generate image prompt")

        print(f"[CoverFromModule] Generated prompt: {image_prompt[:100]}...", flush=True)

        # Check usage_configs for cover_image_generation
        model_type_str = "ADVANCED_IMAGE"
        if settings.usage_configs:
            config_value = settings.usage_configs.get("cover_image_generation")
            if config_value:
                if isinstance(config_value, dict):
                    model_type_str = config_value.get("model", "ADVANCED_IMAGE")
                else:
                    model_type_str = config_value

        print(f"[CoverFromModule] Using {model_type_str} model for image generation", flush=True)

        image_config_result = await db.execute(
            select(AIModelConfig).where(
                (AIModelConfig.settings_id == settings.id) &
                (AIModelConfig.model_type == ModelType(model_type_str))
            )
        )
        image_config = image_config_result.scalar_one_or_none()

        if not image_config or not image_config.api_url or not image_config.api_key:
            print(f"[CoverFromModule] ERROR: {model_type_str} model not configured", flush=True)
            raise HTTPException(status_code=500, detail=f"{model_type_str} model not configured. Please configure it in /api-usage settings.")

        # Generate image
        api_url = image_config.api_url.rstrip("/")
        model_name = image_config.model_name or ""

        headers = {
            "Authorization": f"Bearer {image_config.api_key}",
            "Content-Type": "application/json"
        }

        is_dashscope = "dashscope.aliyuncs.com" in api_url
        is_legacy_image_api = "api.openai.com" in api_url  # 只有传统 OpenAI 用 /images/generations

        image_bytes = None
        image_url = None

        print(f"[CoverFromModule] Generating image with {api_url}, model={model_name}", flush=True)

        async with httpx.AsyncClient(timeout=180.0) as client:
            if is_dashscope:
                headers["X-DashScope-Async"] = "enable"
                payload = {
                    "model": model_name or "wanx2.1-t2i-turbo",
                    "input": {"prompt": image_prompt},
                    "parameters": {"size": "1024*1024", "n": 1}
                }

                resp = await client.post(
                    "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
                    headers=headers,
                    json=payload
                )
                resp.raise_for_status()
                data = resp.json()

                if "output" in data and "task_id" in data["output"]:
                    task_id = data["output"]["task_id"]
                    poll_url = f"https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}"
                    print(f"[CoverFromModule] Dashscope task created: {task_id}", flush=True)

                    for i in range(60):
                        await asyncio.sleep(3)
                        poll_resp = await client.get(poll_url, headers={"Authorization": f"Bearer {image_config.api_key}"})
                        poll_data = poll_resp.json()

                        status = poll_data.get("output", {}).get("task_status")
                        if i % 5 == 0:
                            print(f"[CoverFromModule] Polling ({i}/60): status={status}", flush=True)
                        if status == "SUCCEEDED":
                            results = poll_data.get("output", {}).get("results", [])
                            if results and "url" in results[0]:
                                image_url = results[0]["url"]
                                img_resp = await client.get(image_url)
                                image_bytes = img_resp.content
                            break
                        elif status in ("FAILED", "CANCELED"):
                            print(f"[CoverFromModule] Image generation {status}", flush=True)
                            raise HTTPException(status_code=502, detail=f"Image generation {status}")

            elif is_legacy_image_api:
                # 传统 OpenAI /images/generations 端点
                resp = await client.post(
                    f"{api_url}/images/generations",
                    headers=headers,
                    json={
                        "model": model_name,
                        "prompt": image_prompt,
                        "n": 1,
                        "size": "1024x1024"
                    }
                )
                resp.raise_for_status()
                data = resp.json()

                if "data" in data and data["data"]:
                    if "url" in data["data"][0]:
                        image_url = data["data"][0]["url"]
                    elif "b64_json" in data["data"][0]:
                        image_bytes = base64.b64decode(data["data"][0]["b64_json"])

            else:
                # 默认：使用 chat/completions 生成图像（适用于 Gemini、GPT-4o 等多模态模型）
                resp = await client.post(
                    f"{api_url}/chat/completions",
                    headers=headers,
                    json={
                        "model": model_name,
                        "messages": [{"role": "user", "content": image_prompt}]
                    }
                )
                resp.raise_for_status()
                data = resp.json()

                if "choices" in data and data["choices"]:
                    content = data["choices"][0].get("message", {}).get("content", "")
                    # 尝试解析 base64 图片
                    match = re.search(r'data:image/[^;]+;base64,([A-Za-z0-9+/=]+)', content)
                    if match:
                        image_bytes = base64.b64decode(match.group(1))
                    else:
                        # 尝试解析 markdown 链接格式的 URL
                        url_match = re.search(r'\((https?://[^)]+)\)', content)
                        if url_match:
                            image_url = url_match.group(1)
                        # 尝试直接 URL
                        elif content.startswith("http"):
                            image_url = content.strip()
                        # 尝试直接 base64
                        elif len(content) > 1000:
                            try:
                                image_bytes = base64.b64decode(content)
                            except Exception:
                                pass

        # Upload to OSS if we have image bytes
        if image_bytes:
            from app.domain.parsing.oss_storage import get_oss_storage
            oss = get_oss_storage()
            cover_id = str(uuid.uuid4())[:8]
            # 使用与战役设置相同的上传方法
            image_url = await oss.upload_map_image_async(image_bytes, 0, f"module-cover-{cover_id}", "module_cover")
            print(f"[CoverFromModule] Uploaded to OSS: {image_url}", flush=True)

        if not image_url:
            raise HTTPException(status_code=502, detail="Failed to generate or upload image")

        # Save to user's cover library
        from app.models.user_cover import UserCover
        cover_name = f"{title} - AI封面"
        new_cover = UserCover(
            user_id=current_user["user_id"],
            name=cover_name,
            url=image_url,
            thumbnail_url=image_url,
            source_type="ai_generated",
            source_module_id=module_id,
            prompt=image_prompt
        )
        db.add(new_cover)
        await db.commit()

        print(f"[CoverFromModule] Success! cover_id={new_cover.id}", flush=True)
        return {
            "success": True,
            "cover_url": image_url,
            "prompt": image_prompt,
            "cover_id": new_cover.id
        }

    except HTTPException:
        raise
    except httpx.TimeoutException as e:
        print(f"[CoverFromModule] Timeout error: {e}", flush=True)
        raise HTTPException(status_code=504, detail="Request timeout. Image generation took too long.")
    except httpx.HTTPStatusError as e:
        print(f"[CoverFromModule] HTTP error: {e.response.status_code} - {e.response.text[:200]}", flush=True)
        raise HTTPException(status_code=502, detail=f"Image API error: {e.response.text[:200]}")
    except Exception as e:
        print(f"[CoverFromModule] Unexpected error: {type(e).__name__}: {e}", flush=True)
        raise HTTPException(status_code=500, detail=f"Cover generation failed: {str(e)}")


@router.post("/{campaign_id}/generate-cover-image")
async def generate_cover_image(
    campaign_id: int,
    body: CoverImageGenerateRequest = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Generate AI cover image for campaign based on active module content.

    Uses FAST model to generate prompt from module content,
    then IMAGE model (cover_image_generation) to generate the image.
    """
    import asyncio
    import uuid
    import httpx
    import base64
    import re

    # Get campaign with selected module
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id)
    )
    campaign = result.scalar_one_or_none()

    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    module_id = campaign.selected_module_id
    if not module_id:
        raise HTTPException(status_code=400, detail="Campaign has no active module selected")

    # Get module content
    from app.models.parsed_module import ParsedModule
    module_result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == module_id)
    )
    module = module_result.scalar_one_or_none()

    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    # Build context from module
    module_info = module.module_info or {}
    title = module_info.get("title") or module.title or "Unknown Adventure"
    description = module_info.get("description", "")

    # Get chapter titles for context
    chapters = module.chapters or []
    chapter_titles = [ch.get("title", "") for ch in chapters[:10] if ch.get("title")]

    # Get some monster/NPC names for flavor
    monsters = module.monsters or []
    monster_names = [m.get("name", "") for m in monsters[:5] if m.get("name")]

    # If custom prompt provided, use it directly
    if body and body.custom_prompt:
        image_prompt = body.custom_prompt
    else:
        # Generate prompt using FAST AI model
        from app.models.ai_settings import AIAPISettings, AIModelConfig, ModelType

        settings_result = await db.execute(
            select(AIAPISettings).where(AIAPISettings.user_id == "global")
        )
        settings = settings_result.scalar_one_or_none()

        if not settings:
            raise HTTPException(status_code=500, detail="AI settings not configured")

        # Get FAST model for prompt generation
        fast_config_result = await db.execute(
            select(AIModelConfig).where(
                (AIModelConfig.settings_id == settings.id) &
                (AIModelConfig.model_type == ModelType.FAST)
            )
        )
        fast_config = fast_config_result.scalar_one_or_none()

        if not fast_config or not fast_config.api_url or not fast_config.api_key:
            raise HTTPException(status_code=500, detail="FAST model not configured")

        # Build prompt generation request
        context_text = f"""模组名称: {title}
描述: {description}
章节: {', '.join(chapter_titles) if chapter_titles else '无'}
重要角色/怪物: {', '.join(monster_names) if monster_names else '无'}"""

        prompt_request = f"""你是一个D&D战役封面图生成助手。根据以下模组信息，生成一个用于AI图像生成的英文提示词。

{context_text}

要求：
1. 生成一个适合D&D/奇幻风格的史诗场景描述
2. 使用英文
3. 描述应该包含环境、氛围、光影效果
4. 适合作为战役封面图
5. 200字以内
6. 只输出提示词本身，不要任何其他解释

示例风格: "Epic fantasy landscape, ancient castle on a cliff overlooking a misty valley, dramatic sunset lighting, dark storm clouds gathering, mysterious and foreboding atmosphere, digital painting, cinematic composition, 4k detailed"

请生成提示词:"""

        # Call FAST model
        async with httpx.AsyncClient(timeout=60.0) as client:
            api_url = fast_config.api_url.rstrip("/")
            headers = {
                "Authorization": f"Bearer {fast_config.api_key}",
                "Content-Type": "application/json"
            }

            resp = await client.post(
                f"{api_url}/chat/completions",
                headers=headers,
                json={
                    "model": fast_config.model_name,
                    "messages": [{"role": "user", "content": prompt_request}],
                    "temperature": 0.7,
                    "max_tokens": 500
                }
            )

            if resp.status_code != 200:
                raise HTTPException(status_code=502, detail=f"Prompt generation failed: {resp.text}")

            data = resp.json()
            image_prompt = data.get("choices", [{}])[0].get("message", {}).get("content", "")

            if not image_prompt:
                raise HTTPException(status_code=502, detail="Failed to generate image prompt")

    print(f"[CoverImage] Generated prompt: {image_prompt[:100]}...", flush=True)

    # Get IMAGE model for cover_image_generation
    from app.models.ai_settings import AIAPISettings, AIModelConfig, ModelType

    settings_result = await db.execute(
        select(AIAPISettings).where(AIAPISettings.user_id == "global")
    )
    settings = settings_result.scalar_one_or_none()

    # Check usage_configs for cover_image_generation
    model_type_str = "ADVANCED_IMAGE"  # Default
    if settings and settings.usage_configs:
        config_value = settings.usage_configs.get("cover_image_generation")
        if config_value:
            if isinstance(config_value, dict):
                model_type_str = config_value.get("model", "ADVANCED_IMAGE")
            else:
                model_type_str = config_value

    image_config_result = await db.execute(
        select(AIModelConfig).where(
            (AIModelConfig.settings_id == settings.id) &
            (AIModelConfig.model_type == ModelType(model_type_str))
        )
    )
    image_config = image_config_result.scalar_one_or_none()

    if not image_config or not image_config.api_url or not image_config.api_key:
        raise HTTPException(status_code=500, detail=f"{model_type_str} model not configured")

    # Generate image
    api_url = image_config.api_url.rstrip("/")
    model_name = image_config.model_name or ""

    headers = {
        "Authorization": f"Bearer {image_config.api_key}",
        "Content-Type": "application/json"
    }

    is_dashscope = "dashscope.aliyuncs.com" in api_url
    is_legacy_image_api = "api.openai.com" in api_url  # 只有传统 OpenAI 用 /images/generations

    image_bytes = None

    async with httpx.AsyncClient(timeout=180.0) as client:
        if is_dashscope:
            # DashScope API
            headers["X-DashScope-Async"] = "enable"
            payload = {
                "model": model_name or "wanx2.1-t2i-turbo",
                "input": {"prompt": image_prompt},
                "parameters": {"size": "1024*1024", "n": 1}
            }

            resp = await client.post(
                "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
                headers=headers,
                json=payload
            )
            resp.raise_for_status()
            data = resp.json()

            # Poll for result
            if "output" in data and "task_id" in data["output"]:
                task_id = data["output"]["task_id"]
                poll_url = f"https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}"

                for _ in range(60):
                    await asyncio.sleep(3)
                    poll_resp = await client.get(poll_url, headers={"Authorization": f"Bearer {image_config.api_key}"})
                    poll_data = poll_resp.json()

                    status = poll_data.get("output", {}).get("task_status")
                    if status == "SUCCEEDED":
                        results = poll_data.get("output", {}).get("results", [])
                        if results and "url" in results[0]:
                            img_resp = await client.get(results[0]["url"])
                            image_bytes = img_resp.content
                        break
                    elif status in ("FAILED", "CANCELED"):
                        raise HTTPException(status_code=502, detail=f"Image generation {status}")

        elif is_legacy_image_api:
            # 传统 OpenAI /images/generations 端点
            resp = await client.post(
                f"{api_url}/images/generations",
                headers=headers,
                json={
                    "model": model_name,
                    "prompt": image_prompt,
                    "n": 1,
                    "size": "1024x1024",
                    "response_format": "b64_json"
                }
            )
            resp.raise_for_status()
            data = resp.json()

            if "data" in data and data["data"]:
                b64 = data["data"][0].get("b64_json")
                if b64:
                    image_bytes = base64.b64decode(b64)

        else:
            # 默认：使用 chat/completions 生成图像（适用于 Gemini、GPT-4o 等多模态模型）
            resp = await client.post(
                f"{api_url}/chat/completions",
                headers=headers,
                json={
                    "model": model_name,
                    "messages": [{"role": "user", "content": image_prompt}]
                }
            )
            resp.raise_for_status()
            data = resp.json()

            if "choices" in data and data["choices"]:
                content = data["choices"][0].get("message", {}).get("content", "")
                # 尝试解析 base64 图片
                match = re.search(r'data:image/[^;]+;base64,([A-Za-z0-9+/=]+)', content)
                if match:
                    image_bytes = base64.b64decode(match.group(1))
                elif content.startswith("http"):
                    img_resp = await client.get(content)
                    image_bytes = img_resp.content
                # 尝试解析 markdown 链接格式的 URL
                else:
                    url_match = re.search(r'\((https?://[^)]+)\)', content)
                    if url_match:
                        img_resp = await client.get(url_match.group(1))
                        image_bytes = img_resp.content
                    elif len(content) > 1000:
                        try:
                            image_bytes = base64.b64decode(content)
                        except Exception:
                            pass

    if not image_bytes:
        raise HTTPException(status_code=502, detail="Image generation returned no data")

    # Upload to OSS
    from app.domain.parsing.oss_storage import get_oss_storage
    oss = get_oss_storage()

    cover_id = str(uuid.uuid4())[:8]
    # 使用 upload_map_image 方法上传封面图
    cover_url = await oss.upload_map_image_async(image_bytes, campaign_id, f"cover-{cover_id}", "campaign_cover")

    if not cover_url:
        raise HTTPException(status_code=502, detail="Failed to upload cover image to OSS")

    print(f"[CoverImage] SUCCESS: campaign {campaign_id} -> {cover_url}", flush=True)

    # Save to user's cover library
    cover_id_saved = None
    if body is None or body.save_to_library:
        from app.models.user_cover import UserCover
        user_cover = UserCover(
            user_id=current_user["user_id"],
            name=f"{title} 封面",
            url=cover_url,
            source_type="ai_generated",
            source_module_id=module_id,
            source_campaign_id=campaign_id,
            prompt=image_prompt,
            extra_data={}
        )
        db.add(user_cover)
        await db.commit()
        await db.refresh(user_cover)
        cover_id_saved = user_cover.id
        print(f"[CoverImage] Saved to library: cover_id={cover_id_saved}", flush=True)

    return {
        "success": True,
        "cover_url": cover_url,
        "prompt": image_prompt[:200] + "..." if len(image_prompt) > 200 else image_prompt,
        "cover_id": cover_id_saved
    }


# ============= AI Map Generation =============

class MapPromptOptimizeRequest(BaseModel):
    description: str

class MapGenerateRequest(BaseModel):
    description: str


@router.post("/{campaign_id}/optimize-map-prompt")
async def optimize_map_prompt(
    campaign_id: int,
    request: MapPromptOptimizeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Use AI to optimize/expand a map description for better generation results."""
    if not request.description or len(request.description.strip()) < 4:
        raise HTTPException(status_code=400, detail="描述太短，至少4个字")

    from app.models.ai_settings import AIAPISettings, AIModelConfig, ModelType
    import httpx

    # Get model config for map_prompt_optimize (falls back to FAST)
    result = await db.execute(
        select(AIAPISettings).where(AIAPISettings.user_id == "global")
    )
    settings = result.scalar_one_or_none()
    if not settings:
        raise HTTPException(status_code=500, detail="AI settings not configured")

    # Determine model type
    model_type_str = "FAST"
    if settings.usage_configs:
        val = settings.usage_configs.get("map_prompt_optimize")
        if val:
            model_type_str = val.get("model", "FAST") if isinstance(val, dict) else val

    config_result = await db.execute(
        select(AIModelConfig).where(
            (AIModelConfig.settings_id == settings.id) &
            (AIModelConfig.model_type == ModelType(model_type_str))
        )
    )
    config = config_result.scalar_one_or_none()
    if not config or not config.api_url or not config.api_key:
        raise HTTPException(status_code=500, detail="AI模型未配置")

    system_prompt = """你是一个D&D 5E地图场景描述优化专家。用户会给你一段简短的地图描述，你需要将它扩展为详细的、适合生成战术地图的场景描述。

要求：
- 保持中文输出
- 描述环境类型（森林、地下城、城镇等）
- 添加光照条件（明亮、昏暗、黑暗等）
- 描述关键地标和特征（建筑、自然景观、障碍物等）
- 提及建筑风格和氛围
- 添加天气/环境细节
- 保持200字以内
- 直接输出优化后的描述，不要加任何前缀或解释"""

    endpoint = config.api_url.rstrip('/')
    if not endpoint.endswith('/chat/completions'):
        endpoint += '/chat/completions'

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                endpoint,
                json={
                    "model": config.model_name,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": request.description.strip()},
                    ],
                    "max_tokens": 500,
                    "temperature": 0.7,
                },
                headers={
                    "Authorization": f"Bearer {config.api_key}",
                    "Content-Type": "application/json",
                },
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=500, detail="AI调用失败")

        data = resp.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        if not content:
            raise HTTPException(status_code=500, detail="AI返回空响应")

        return {"optimized": content.strip()}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[MapPromptOptimize] Error: {e}", flush=True)
        raise HTTPException(status_code=500, detail=f"AI调用失败: {str(e)}")


@router.post("/{campaign_id}/generate-ai-map")
async def generate_ai_map(
    campaign_id: int,
    request: MapGenerateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Generate a tactical map from a text description using AI image generation."""
    if not request.description or len(request.description.strip()) < 4:
        raise HTTPException(status_code=400, detail="描述太短，至少4个字")

    from app.services.map_generation_service import map_generation_service

    # Build map_data dict for the generation service
    desc = request.description.strip()
    # Use first 20 chars as name, or full description if short
    map_name = desc[:20] + ("..." if len(desc) > 20 else "")

    map_data = {
        "name": map_name,
        "description": desc,
        "environment": "dungeon",
        "lighting": "dim",
    }

    result = await map_generation_service.generate_map(
        db=db,
        campaign_id=campaign_id,
        module_id="ai_standalone",
        map_data=map_data,
    )

    return result
