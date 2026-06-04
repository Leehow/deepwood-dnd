"""
Map View State API routes for persisting user's map view position and scale
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, delete
from typing import Optional

from app.db.session import get_db, get_db_readonly
from app.models.map_view_state import MapViewState
from app.schemas.map_view_state import MapViewStateCreate, MapViewStateUpdate, MapViewStateResponse
from app.core.security import require_auth

router = APIRouter(prefix="/api/map-view-state", tags=["map-view-state"])


@router.get("/{campaign_id}/dm")
async def get_dm_view_state(
    campaign_id: int,
    map_url: str = Query(...),
    db: AsyncSession = Depends(get_db_readonly)
) -> Optional[MapViewStateResponse]:
    """
    Get DM's saved view state for a specific map.
    Used as fallback when a new player has no saved view state.
    """
    from app.models.campaign import Campaign

    try:
        campaign_result = await db.execute(
            select(Campaign).where(Campaign.id == campaign_id)
        )
        campaign = campaign_result.scalar_one_or_none()
        if not campaign:
            return None

        result = await db.execute(
            select(MapViewState).where(
                and_(
                    MapViewState.campaign_id == campaign_id,
                    MapViewState.user_id == campaign.dm_user_id,
                    MapViewState.map_url == map_url
                )
            ).order_by(MapViewState.updated_at.desc())
        )
        view_state = result.scalars().first()
        if view_state:
            return MapViewStateResponse.model_validate(view_state)
        return None

    except Exception as e:
        print(f"[MapViewState] Error getting DM view state: {e}")
        return None


@router.get("/{campaign_id}/me")
async def get_map_view_state(
    campaign_id: int,
    map_url: str = Query(...),
    db: AsyncSession = Depends(get_db_readonly),
    current_user: dict = Depends(require_auth),
) -> Optional[MapViewStateResponse]:
    """
    Get current user's saved view state for a specific map.
    """
    user_id = str(current_user["user_id"])
    try:
        result = await db.execute(
            select(MapViewState).where(
                and_(
                    MapViewState.campaign_id == campaign_id,
                    MapViewState.user_id == user_id,
                    MapViewState.map_url == map_url
                )
            ).order_by(MapViewState.updated_at.desc())
        )
        # Use first() instead of scalar_one_or_none() to handle duplicates
        # Get the most recently updated record
        view_state = result.scalars().first()

        if view_state:
            return MapViewStateResponse.model_validate(view_state)

        # Return default view state if not found
        return None

    except Exception as e:
        print(f"[MapViewState] Error getting view state: {e}")
        raise HTTPException(status_code=500, detail="Failed to get map view state")


@router.put("/{campaign_id}/me")
@router.post("/{campaign_id}/me")
async def save_map_view_state(
    campaign_id: int,
    payload: MapViewStateUpdate,
    map_url: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
) -> dict:
    """
    Save or update current user's view state for a specific map.
    Supports both PUT (normal save) and POST (sendBeacon on page unload).
    """
    user_id = str(current_user["user_id"])
    try:
        # Delete all existing records for this combination (handles duplicates)
        await db.execute(
            delete(MapViewState).where(
                and_(
                    MapViewState.campaign_id == campaign_id,
                    MapViewState.user_id == user_id,
                    MapViewState.map_url == map_url
                )
            )
        )

        # Create new record (use 'if x is not None' to preserve 0.0 values)
        view_state = MapViewState(
            campaign_id=campaign_id,
            user_id=user_id,
            map_url=map_url,
            position_x=payload.position_x if payload.position_x is not None else 0.0,
            position_y=payload.position_y if payload.position_y is not None else 0.0,
            scale=payload.scale if payload.scale is not None else 1.0,
            minimap_collapsed=payload.minimap_collapsed if payload.minimap_collapsed is not None else False
        )
        db.add(view_state)

        await db.commit()

        return {"status": "success", "message": "Map view state saved"}

    except Exception as e:
        await db.rollback()
        print(f"[MapViewState] Error saving view state: {e}")
        raise HTTPException(status_code=500, detail="Failed to save map view state")
