"""
API routes for AI-generated map markers
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel

from app.db.session import get_db, get_db_readonly
from app.models.ai_map_marker import AIMapMarker
from app.models.campaign import Campaign
from app.core.security import require_auth
from app.utils.permission_checks import require_campaign_dm

router = APIRouter(prefix="/api/campaigns", tags=["ai-map-markers"])


class AIMapMarkerItem(BaseModel):
    """Single AI map marker"""
    x: str  # Percentage, e.g., "25%"
    y: str  # Percentage, e.g., "30%"
    label: str
    content: str


class AIMapMarkersResponse(BaseModel):
    """Response with all markers for a map"""
    campaign_id: int
    map_url: str
    markers: List[AIMapMarkerItem]


class AIMapMarkersCreate(BaseModel):
    """Request to save AI map markers"""
    map_url: str
    markers: List[AIMapMarkerItem]


@router.get("/{campaign_id}/ai-map-markers", response_model=Optional[AIMapMarkersResponse])
async def get_ai_map_markers(
    campaign_id: int,
    map_url: str = Query(..., description="Current map URL"),
    db: AsyncSession = Depends(get_db_readonly)
):
    """Get AI-generated markers for a specific map"""
    result = await db.execute(
        select(AIMapMarker).where(
            AIMapMarker.campaign_id == campaign_id,
            AIMapMarker.map_url == map_url
        )
    )
    marker_record = result.scalar_one_or_none()

    if not marker_record:
        return None

    return AIMapMarkersResponse(
        campaign_id=marker_record.campaign_id,
        map_url=marker_record.map_url,
        markers=[AIMapMarkerItem(**m) for m in marker_record.markers]
    )


@router.post("/{campaign_id}/ai-map-markers", response_model=AIMapMarkersResponse)
async def save_ai_map_markers(
    campaign_id: int,
    data: AIMapMarkersCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Save AI-generated markers for a map (replaces existing)"""
    await require_campaign_dm(campaign_id, current_user, db)

    # Check if markers already exist for this map
    result = await db.execute(
        select(AIMapMarker).where(
            AIMapMarker.campaign_id == campaign_id,
            AIMapMarker.map_url == data.map_url
        )
    )
    existing = result.scalar_one_or_none()

    markers_data = [m.model_dump() for m in data.markers]

    if existing:
        # Update existing
        existing.markers = markers_data
        await db.commit()
        await db.refresh(existing)
        marker_record = existing
    else:
        # Create new
        marker_record = AIMapMarker(
            campaign_id=campaign_id,
            map_url=data.map_url,
            markers=markers_data
        )
        db.add(marker_record)
        await db.commit()
        await db.refresh(marker_record)

    return AIMapMarkersResponse(
        campaign_id=marker_record.campaign_id,
        map_url=marker_record.map_url,
        markers=[AIMapMarkerItem(**m) for m in marker_record.markers]
    )


@router.delete("/{campaign_id}/ai-map-markers")
async def delete_ai_map_markers(
    campaign_id: int,
    map_url: str = Query(..., description="Current map URL"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Delete AI-generated markers for a specific map"""
    await require_campaign_dm(campaign_id, current_user, db)
    await db.execute(
        delete(AIMapMarker).where(
            AIMapMarker.campaign_id == campaign_id,
            AIMapMarker.map_url == map_url
        )
    )
    await db.commit()
    return {"status": "ok", "message": "Markers deleted"}
