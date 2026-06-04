"""
Map Terrain API routes - terrain cell data persistence
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel
from typing import List, Optional, Any

from app.db.session import get_db, get_db_readonly
from app.models.map_terrain import MapTerrain
from app.core.security import require_auth
from app.utils.permission_checks import require_campaign_dm

router = APIRouter(prefix="/api/campaigns", tags=["map-terrain"])


class TerrainCellData(BaseModel):
    x: int
    y: int
    type: str
    properties: Optional[dict] = None


class TerrainData(BaseModel):
    mapUrl: str
    cells: List[dict]  # [{x, y, type, properties?}, ...]


@router.get("/{campaign_id}/terrain")
async def get_terrain(
    campaign_id: int,
    map_url: str = Query(...),
    db: AsyncSession = Depends(get_db_readonly),
):
    try:
        result = await db.execute(
            select(MapTerrain).where(
                (MapTerrain.campaign_id == campaign_id) &
                (MapTerrain.map_url == map_url)
            )
        )
        record = result.scalar_one_or_none()
        if record:
            return {"mapUrl": map_url, "cells": record.cells}
        return {"mapUrl": map_url, "cells": []}
    except Exception as e:
        print(f"[MapTerrain] Error getting terrain data: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get terrain data: {str(e)}")


@router.put("/{campaign_id}/terrain")
async def save_terrain(
    campaign_id: int,
    terrain_data: TerrainData,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    await require_campaign_dm(campaign_id, current_user, db)
    try:
        result = await db.execute(
            select(MapTerrain).where(
                (MapTerrain.campaign_id == campaign_id) &
                (MapTerrain.map_url == terrain_data.mapUrl)
            )
        )
        record = result.scalar_one_or_none()

        if record:
            record.cells = terrain_data.cells
            await db.merge(record)
        else:
            record = MapTerrain(
                campaign_id=campaign_id,
                map_url=terrain_data.mapUrl,
                cells=terrain_data.cells,
            )
            db.add(record)

        await db.commit()
        print(f"[MapTerrain] Saved terrain for campaign {campaign_id}, map {terrain_data.mapUrl}: {len(terrain_data.cells)} cells")
        return {"status": "success", "message": "Terrain data saved"}
    except Exception as e:
        await db.rollback()
        print(f"[MapTerrain] Error saving terrain data: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save terrain data: {str(e)}")


@router.delete("/{campaign_id}/terrain")
async def clear_terrain(
    campaign_id: int,
    map_url: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    await require_campaign_dm(campaign_id, current_user, db)
    try:
        await db.execute(
            delete(MapTerrain).where(
                (MapTerrain.campaign_id == campaign_id) &
                (MapTerrain.map_url == map_url)
            )
        )
        await db.commit()
        print(f"[MapTerrain] Cleared terrain for campaign {campaign_id}, map {map_url}")
        return {"status": "success", "message": "Terrain data cleared"}
    except Exception as e:
        await db.rollback()
        print(f"[MapTerrain] Error clearing terrain data: {e}")
        raise HTTPException(status_code=500, detail="Failed to clear terrain data")
