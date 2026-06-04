from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.locale import (
    DEFAULT_LOCALE,
    LocaleContext,
    build_locale_context,
)
from app.core.security import decode_token, get_current_user_from_token
from app.db.session import get_db
from app.models.campaign import Campaign, CampaignMember
from app.models.user import User


@dataclass(slots=True)
class CampaignMemberContext:
    campaign_id: int
    user_id: str
    role: str
    selected_character_id: int | None
    campaign: Campaign
    membership: CampaignMember | None
    is_dm: bool
    is_admin: bool


async def resolve_campaign_member_context(
    db: AsyncSession,
    campaign_id: int,
    current_user: dict,
) -> CampaignMemberContext:
    campaign_result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id)
    )
    campaign = campaign_result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Campaign not found",
        )

    user_id = str(current_user["user_id"])
    is_admin = user_id == "0"
    is_dm = is_admin or campaign.dm_user_id == user_id

    membership_result = await db.execute(
        select(CampaignMember)
        .where(
            CampaignMember.campaign_id == campaign_id,
            CampaignMember.user_id == user_id,
        )
        .order_by(CampaignMember.id.desc())
    )
    membership = membership_result.scalars().first()

    if not is_dm and not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this campaign",
        )

    return CampaignMemberContext(
        campaign_id=campaign_id,
        user_id=user_id,
        role="dm" if is_dm else (membership.role or "player"),
        selected_character_id=membership.selected_character_id if membership else None,
        campaign=campaign,
        membership=membership,
        is_dm=is_dm,
        is_admin=is_admin,
    )


async def resolve_campaign_member_context_from_token(
    db: AsyncSession,
    campaign_id: int,
    token: str,
) -> CampaignMemberContext:
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing websocket token",
        )

    current_user = decode_token(token)
    return await resolve_campaign_member_context(db, campaign_id, current_user)


async def _load_user_preference_locale(
    db: AsyncSession,
    user_id: Optional[str],
) -> Optional[str]:
    """Return the raw ``preferences.locale`` for a user, if any.

    Returns ``None`` when the user is unknown, has no preferences, or no
    ``locale`` key. The resolver downstream is responsible for validation;
    this helper does not raise.
    """
    if not user_id:
        return None
    result = await db.execute(select(User.preferences).where(User.id == str(user_id)))
    row = result.scalar_one_or_none()
    if not isinstance(row, dict):
        return None
    value = row.get("locale")
    return value if isinstance(value, str) else None


async def resolve_locale_context_for_user(
    db: AsyncSession,
    *,
    user_id: Optional[str],
    accept_language: Optional[str],
    default: str = DEFAULT_LOCALE,
) -> LocaleContext:
    """Build a :class:`LocaleContext` from header + persisted preference.

    Pure-ish helper: takes already-extracted inputs so it can be reused by
    both the HTTP FastAPI dependency and the WebSocket connection path
    without coupling either to ``Request`` / ``WebSocket`` mechanics.
    """
    preference = await _load_user_preference_locale(db, user_id)
    return build_locale_context(
        user_preference=preference,
        accept_language=accept_language,
        default=default,
    )


async def get_locale_context(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[dict] = Depends(get_current_user_from_token),
) -> LocaleContext:
    """FastAPI dependency: resolve the per-request locale context.

    Falls back to ``Accept-Language`` header + default when no
    authenticated user is present. Never raises — an unparseable locale or
    a stray preferences value simply falls through to the next precedence
    step.
    """
    user_id: Optional[str] = None
    if isinstance(current_user, dict):
        raw = current_user.get("user_id")
        if raw is not None:
            user_id = str(raw)
    accept_language = request.headers.get("accept-language")
    return await resolve_locale_context_for_user(
        db,
        user_id=user_id,
        accept_language=accept_language,
    )
