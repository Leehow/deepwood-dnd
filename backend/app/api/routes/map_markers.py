"""
Map Marker API routes for placing markers on battle maps
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from typing import List

from app.db.session import get_db, get_db_readonly
from app.models.map_marker import MapMarker
from app.schemas.map_marker import MapMarkerCreate, MapMarkerUpdate, MapMarkerResponse
from app.services.realtime_publisher import realtime_publisher
from app.core.security import require_auth
from app.utils.permission_checks import require_campaign_dm

router = APIRouter(prefix="/api/campaigns", tags=["map-markers"])


@router.get("/{campaign_id}/markers")
async def get_markers(
    campaign_id: int,
    map_url: str = Query(...),
    db: AsyncSession = Depends(get_db_readonly)
) -> List[MapMarkerResponse]:
    """Get all markers for a specific map"""
    try:
        result = await db.execute(
            select(MapMarker).where(
                (MapMarker.campaign_id == campaign_id) &
                (MapMarker.map_url == map_url)
            )
        )
        markers = result.scalars().all()
        return [MapMarkerResponse.model_validate(marker) for marker in markers]
    except Exception as e:
        print(f"[MapMarker] Error getting markers: {e}")
        raise HTTPException(status_code=500, detail="Failed to get markers")


@router.post("/{campaign_id}/markers")
async def create_marker(
    campaign_id: int,
    marker: MapMarkerCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
) -> MapMarkerResponse:
    """Create a new marker"""
    await require_campaign_dm(campaign_id, current_user, db)
    try:
        new_marker = MapMarker(
            campaign_id=campaign_id,
            map_url=marker.map_url,
            position_x=marker.position_x,
            position_y=marker.position_y,
            icon=marker.icon,
            label=marker.label,
            color=marker.color,
            description=marker.description,
            visible_to_players=marker.visible_to_players
        )
        db.add(new_marker)
        await db.commit()
        await db.refresh(new_marker)

        response = MapMarkerResponse.model_validate(new_marker)

        # Broadcast to all clients
        await realtime_publisher.publish_marker_created(
            campaign_id,
            marker=response.model_dump(mode="json"),
        )

        print(f"[MapMarker] Created marker {new_marker.id} for campaign {campaign_id}")
        return response
    except Exception as e:
        await db.rollback()
        print(f"[MapMarker] Error creating marker: {e}")
        raise HTTPException(status_code=500, detail="Failed to create marker")


@router.post("/{campaign_id}/markers/{marker_id}")
async def update_marker(
    campaign_id: int,
    marker_id: int,
    marker_update: MapMarkerUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
) -> MapMarkerResponse:
    """Update a marker"""
    await require_campaign_dm(campaign_id, current_user, db)
    try:
        result = await db.execute(
            select(MapMarker).where(
                (MapMarker.id == marker_id) &
                (MapMarker.campaign_id == campaign_id)
            )
        )
        marker = result.scalar_one_or_none()

        if not marker:
            raise HTTPException(status_code=404, detail="Marker not found")

        # Update fields
        update_data = marker_update.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(marker, field, value)

        await db.commit()
        await db.refresh(marker)

        response = MapMarkerResponse.model_validate(marker)

        # Broadcast to all clients
        await realtime_publisher.publish_marker_updated(
            campaign_id,
            marker=response.model_dump(mode="json"),
        )

        print(f"[MapMarker] Updated marker {marker_id} for campaign {campaign_id}")
        return response
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        print(f"[MapMarker] Error updating marker: {e}")
        raise HTTPException(status_code=500, detail="Failed to update marker")


@router.delete("/{campaign_id}/markers/{marker_id}")
async def delete_marker(
    campaign_id: int,
    marker_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
) -> dict:
    """Delete a marker"""
    await require_campaign_dm(campaign_id, current_user, db)
    try:
        result = await db.execute(
            select(MapMarker).where(
                (MapMarker.id == marker_id) &
                (MapMarker.campaign_id == campaign_id)
            )
        )
        marker = result.scalar_one_or_none()

        if not marker:
            raise HTTPException(status_code=404, detail="Marker not found")

        map_url = marker.map_url
        await db.delete(marker)
        await db.commit()

        # Broadcast to all clients
        await realtime_publisher.publish_marker_deleted(
            campaign_id,
            marker_id=marker_id,
            map_url=map_url,
        )

        print(f"[MapMarker] Deleted marker {marker_id} from campaign {campaign_id}")
        return {"status": "success", "message": "Marker deleted"}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        print(f"[MapMarker] Error deleting marker: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete marker")


@router.delete("/{campaign_id}/markers")
async def clear_all_markers(
    campaign_id: int,
    map_url: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
) -> dict:
    """Clear all markers for a specific map"""
    await require_campaign_dm(campaign_id, current_user, db)
    try:
        await db.execute(
            delete(MapMarker).where(
                (MapMarker.campaign_id == campaign_id) &
                (MapMarker.map_url == map_url)
            )
        )
        await db.commit()

        # Broadcast to all clients
        await realtime_publisher.publish_markers_cleared(
            campaign_id,
            map_url=map_url,
        )

        print(f"[MapMarker] Cleared all markers for campaign {campaign_id}, map {map_url}")
        return {"status": "success", "message": "All markers cleared"}
    except Exception as e:
        await db.rollback()
        print(f"[MapMarker] Error clearing markers: {e}")
        raise HTTPException(status_code=500, detail="Failed to clear markers")
