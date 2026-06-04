"""Campaign Template API routes — save/list/delete/restore/share."""
import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy import select
from sqlalchemy.sql import func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.campaign import Campaign
from app.models.user import User
from app.models.campaign_template import CampaignTemplate
from app.schemas.campaign_template import (
    CampaignTemplateCreate,
    CampaignTemplateResponse,
    CampaignTemplateListResponse,
    SharedTemplateResponse,
    CreateFromTemplateRequest,
)
from app.services.campaign_template_service import (
    serialize_campaign_to_template,
    create_campaign_from_template,
)
from app.core.security import require_auth

logger = logging.getLogger(__name__)

router = APIRouter(tags=["campaign-templates"])


# ── Save / Upsert ──────────────────────────────────────────────

@router.post(
    "/campaigns/{campaign_id}/save-as-template",
    response_model=CampaignTemplateResponse,
)
async def save_campaign_as_template(
    campaign_id: int,
    payload: CampaignTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Serialize a campaign into a reusable template (upsert)."""
    user_id = current_user["user_id"]
    try:
        template_data = await serialize_campaign_to_template(campaign_id, user_id, db)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))

    res = await db.execute(select(Campaign).where(Campaign.id == campaign_id))
    campaign = res.scalar_one()

    # Upsert: one template per campaign per user
    res = await db.execute(
        select(CampaignTemplate).where(
            CampaignTemplate.source_campaign_id == campaign_id,
            CampaignTemplate.dm_user_id == user_id,
        )
    )
    tpl = res.scalar_one_or_none()

    if tpl:
        tpl.name = payload.name
        tpl.description = payload.description
        tpl.cover_image = campaign.cover_image
        tpl.template_data = template_data
        tpl.updated_at = func.now()
    else:
        tpl = CampaignTemplate(
            dm_user_id=user_id,
            name=payload.name,
            description=payload.description,
            cover_image=campaign.cover_image,
            source_campaign_id=campaign_id,
            template_data=template_data,
        )
        db.add(tpl)

    await db.flush()
    await db.refresh(tpl)
    return tpl


# ── Share / Unshare ─────────────────────────────────────────────

@router.post(
    "/campaigns/{campaign_id}/share-template",
    response_model=CampaignTemplateResponse,
)
async def share_campaign_template(
    campaign_id: int,
    payload: CampaignTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Share (or update shared) campaign template. Saves + sets is_shared=True."""
    user_id = current_user["user_id"]
    try:
        template_data = await serialize_campaign_to_template(campaign_id, user_id, db)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))

    res = await db.execute(select(Campaign).where(Campaign.id == campaign_id))
    campaign = res.scalar_one()

    # Look up display name
    user_res = await db.execute(select(User).where(User.id == user_id))
    user = user_res.scalar_one_or_none()
    display_name = user.username if user else user_id[:8]

    # Upsert
    res = await db.execute(
        select(CampaignTemplate).where(
            CampaignTemplate.source_campaign_id == campaign_id,
            CampaignTemplate.dm_user_id == user_id,
        )
    )
    tpl = res.scalar_one_or_none()

    if tpl:
        tpl.name = payload.name
        tpl.description = payload.description
        tpl.cover_image = campaign.cover_image
        tpl.template_data = template_data
        tpl.is_shared = True
        tpl.shared_by_name = display_name
        tpl.updated_at = func.now()
    else:
        tpl = CampaignTemplate(
            dm_user_id=user_id,
            name=payload.name,
            description=payload.description,
            cover_image=campaign.cover_image,
            source_campaign_id=campaign_id,
            template_data=template_data,
            is_shared=True,
            shared_by_name=display_name,
        )
        db.add(tpl)

    await db.flush()
    await db.refresh(tpl)
    return tpl


# ── Query ───────────────────────────────────────────────────────

@router.get(
    "/campaign-templates",
    response_model=List[CampaignTemplateListResponse],
)
async def list_templates(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """List all templates owned by the user."""
    user_id = current_user["user_id"]
    res = await db.execute(
        select(CampaignTemplate)
        .where(CampaignTemplate.dm_user_id == user_id)
        .order_by(CampaignTemplate.created_at.desc())
    )
    return res.scalars().all()


@router.get(
    "/campaign-templates/shared",
    response_model=List[SharedTemplateResponse],
)
async def list_shared_templates(
    db: AsyncSession = Depends(get_db),
):
    """List all publicly shared templates."""
    res = await db.execute(
        select(CampaignTemplate)
        .where(CampaignTemplate.is_shared.is_(True))
        .order_by(CampaignTemplate.updated_at.desc().nulls_last(),
                  CampaignTemplate.created_at.desc())
    )
    return res.scalars().all()


@router.get("/campaign-templates/{template_id}/preview")
async def get_template_preview(
    template_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Return template metadata + full template_data for a shared template (read-only preview)."""
    res = await db.execute(
        select(CampaignTemplate).where(CampaignTemplate.id == template_id)
    )
    tpl = res.scalar_one_or_none()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    if not tpl.is_shared:
        raise HTTPException(status_code=403, detail="Template is not shared")
    return {
        "id": tpl.id,
        "name": tpl.name,
        "description": tpl.description,
        "cover_image": tpl.cover_image,
        "shared_by_name": tpl.shared_by_name,
        "created_at": tpl.created_at.isoformat() if tpl.created_at else None,
        "template_data": tpl.template_data,
    }


@router.get(
    "/campaigns/{campaign_id}/template-status",
    response_model=Optional[CampaignTemplateResponse],
)
async def get_campaign_template_status(
    campaign_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Check if this campaign already has a saved template."""
    user_id = current_user["user_id"]
    res = await db.execute(
        select(CampaignTemplate).where(
            CampaignTemplate.source_campaign_id == campaign_id,
            CampaignTemplate.dm_user_id == user_id,
        )
    )
    tpl = res.scalar_one_or_none()
    if not tpl:
        return None
    return tpl


# ── Clone shared template to user's library ─────────────────────

@router.post(
    "/campaign-templates/{template_id}/clone",
    response_model=CampaignTemplateListResponse,
)
async def clone_template_to_library(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Clone a shared template into the user's own template library."""
    user_id = current_user["user_id"]
    res = await db.execute(
        select(CampaignTemplate).where(CampaignTemplate.id == template_id)
    )
    src = res.scalar_one_or_none()
    if not src:
        raise HTTPException(status_code=404, detail="Template not found")
    if not src.is_shared:
        raise HTTPException(status_code=403, detail="Template is not shared")
    if src.dm_user_id == user_id:
        raise HTTPException(status_code=400, detail="Cannot clone your own template")

    clone = CampaignTemplate(
        dm_user_id=user_id,
        name=src.name,
        description=src.description,
        cover_image=src.cover_image,
        source_campaign_id=None,
        template_data=src.template_data,
        is_shared=False,
    )
    db.add(clone)
    await db.flush()
    await db.refresh(clone)
    return clone


# ── Delete ──────────────────────────────────────────────────────

@router.delete("/campaign-templates/{template_id}")
async def delete_template(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Delete a campaign template."""
    user_id = current_user["user_id"]
    res = await db.execute(
        select(CampaignTemplate).where(CampaignTemplate.id == template_id)
    )
    tpl = res.scalar_one_or_none()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    if tpl.dm_user_id != user_id:
        raise HTTPException(status_code=403, detail="Permission denied")

    await db.delete(tpl)
    return {"message": "Template deleted"}


# ── Create campaign from template ───────────────────────────────

@router.post(
    "/campaign-templates/{template_id}/create-campaign",
    response_model=dict,
)
async def create_campaign_from_template_endpoint(
    template_id: int,
    payload: CreateFromTemplateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Create a new campaign from a saved template."""
    user_id = current_user["user_id"]
    res = await db.execute(
        select(CampaignTemplate).where(CampaignTemplate.id == template_id)
    )
    tpl = res.scalar_one_or_none()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    if tpl.dm_user_id != user_id:
        raise HTTPException(status_code=403, detail="Permission denied")

    try:
        campaign = await create_campaign_from_template(
            template_data=tpl.template_data,
            dm_user_id=user_id,
            name=payload.name,
            description=payload.description,
            db=db,
        )
    except Exception as e:
        logger.exception("Failed to create campaign from template")
        raise HTTPException(status_code=500, detail=f"Failed to restore template: {e}")

    return {
        "id": campaign.id,
        "name": campaign.name,
        "message": "Campaign created from template",
    }
