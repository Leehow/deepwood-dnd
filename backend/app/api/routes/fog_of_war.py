"""
Fog of War API routes for D&D battle map with database persistence
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel
from typing import List
import json

from app.db.session import get_db, get_db_readonly
from app.models.fog_of_war import FogOfWar
from app.core.security import require_auth
from app.utils.permission_checks import require_campaign_dm

router = APIRouter(prefix="/api/campaigns", tags=["fog-of-war"])

class FogOfWarData(BaseModel):
    mapUrl: str
    cells: List[List[int]]  # [[x, y], [x, y], ...]

@router.get("/{campaign_id}/fog-of-war")
async def get_fog_of_war(
    campaign_id: int,
    map_url: str = Query(...),
    db: AsyncSession = Depends(get_db_readonly)
):
    """
    从数据库获取指定地图的迷雾数据
    """
    try:
        # 查询数据库
        result = await db.execute(
            select(FogOfWar).where(
                (FogOfWar.campaign_id == campaign_id) &
                (FogOfWar.map_url == map_url)
            )
        )
        fog_record = result.scalar_one_or_none()

        if fog_record:
            # 返回 cell 列表
            return {
                "mapUrl": map_url,
                "cells": fog_record.cells
            }

        # 如果没有迷雾数据，返回空迷雾
        return {
            "mapUrl": map_url,
            "cells": []
        }
    except Exception as e:
        import traceback
        print(f"[FogOfWar] Error getting fog data: {e}")
        print(f"[FogOfWar] Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to get fog data: {str(e)}")

@router.put("/{campaign_id}/fog-of-war")
async def save_fog_of_war(
    campaign_id: int,
    fog_data: FogOfWarData,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    保存迷雾数据到数据库
    """
    await require_campaign_dm(campaign_id, current_user, db)
    try:
        # 直接使用传来的 cells 数据（已经是 [[x, y], ...] 格式）
        cells_data = fog_data.cells

        # 查询现有记录
        result = await db.execute(
            select(FogOfWar).where(
                (FogOfWar.campaign_id == campaign_id) &
                (FogOfWar.map_url == fog_data.mapUrl)
            )
        )
        fog_record = result.scalar_one_or_none()

        if fog_record:
            # 更新现有记录
            fog_record.cells = cells_data
            await db.merge(fog_record)
        else:
            # 创建新记录
            fog_record = FogOfWar(
                campaign_id=campaign_id,
                map_url=fog_data.mapUrl,
                cells=cells_data
            )
            db.add(fog_record)

        await db.commit()

        print(f"[FogOfWar] Saved fog data for campaign {campaign_id}, map {fog_data.mapUrl}: {len(cells_data)} cells")

        return {"status": "success", "message": "Fog data saved"}
    except Exception as e:
        await db.rollback()
        import traceback
        print(f"[FogOfWar] Error saving fog data: {e}")
        print(f"[FogOfWar] Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to save fog data: {str(e)}")

@router.delete("/{campaign_id}/fog-of-war")
async def clear_fog_of_war(
    campaign_id: int,
    map_url: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    清除指定地图的所有迷雾数据
    """
    await require_campaign_dm(campaign_id, current_user, db)
    try:
        # 删除数据库记录
        await db.execute(
            delete(FogOfWar).where(
                (FogOfWar.campaign_id == campaign_id) &
                (FogOfWar.map_url == map_url)
            )
        )

        await db.commit()

        print(f"[FogOfWar] Cleared fog data for campaign {campaign_id}, map {map_url}")

        return {"status": "success", "message": "Fog data cleared"}
    except Exception as e:
        await db.rollback()
        print(f"[FogOfWar] Error clearing fog data: {e}")
        raise HTTPException(status_code=500, detail="Failed to clear fog data")
