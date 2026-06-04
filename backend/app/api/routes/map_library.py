"""
Map Library API Routes
Manage user's personal map library
"""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel

from app.db.session import get_db
from app.models.user_map import UserMap
from app.core.security import require_auth


router = APIRouter(prefix="/api/map-library", tags=["map-library"])


class MapLibraryItem(BaseModel):
    id: int
    name: str
    url: str
    thumbnail_url: Optional[str] = None
    source_type: str
    environment: Optional[str] = None
    description: Optional[str] = None
    created_at: str

    class Config:
        from_attributes = True


class AddMapRequest(BaseModel):
    name: str
    url: str
    thumbnail_url: Optional[str] = None
    source_type: str = "manual"
    source_module_id: Optional[str] = None
    source_campaign_id: Optional[int] = None
    environment: Optional[str] = None
    description: Optional[str] = None
    extra_data: Optional[dict] = None


@router.get("", response_model=List[MapLibraryItem])
async def get_map_library(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Get user's map library"""
    user_id = current_user["user_id"]
    result = await db.execute(
        select(UserMap)
        .where(UserMap.user_id == user_id)
        .order_by(UserMap.created_at.desc())
    )
    maps = result.scalars().all()

    return [
        MapLibraryItem(
            id=m.id,
            name=m.name,
            url=m.url,
            thumbnail_url=m.thumbnail_url,
            source_type=m.source_type or "manual",
            environment=m.environment,
            description=m.description,
            created_at=m.created_at.isoformat() if m.created_at else ""
        )
        for m in maps
    ]


@router.post("", response_model=MapLibraryItem)
async def add_to_map_library(
    request: AddMapRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Add a map to user's library"""
    user_id = current_user["user_id"]
    # Check if already exists (same url for same user)
    existing = await db.execute(
        select(UserMap).where(
            (UserMap.user_id == user_id) &
            (UserMap.url == request.url)
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="地图已在库中")

    user_map = UserMap(
        user_id=user_id,
        name=request.name,
        url=request.url,
        thumbnail_url=request.thumbnail_url,
        source_type=request.source_type,
        source_module_id=request.source_module_id,
        source_campaign_id=request.source_campaign_id,
        environment=request.environment,
        description=request.description,
        extra_data=request.extra_data or {}
    )
    db.add(user_map)
    await db.commit()
    await db.refresh(user_map)

    return MapLibraryItem(
        id=user_map.id,
        name=user_map.name,
        url=user_map.url,
        thumbnail_url=user_map.thumbnail_url,
        source_type=user_map.source_type or "manual",
        environment=user_map.environment,
        description=user_map.description,
        created_at=user_map.created_at.isoformat() if user_map.created_at else ""
    )


@router.delete("/{map_id}")
async def remove_from_map_library(
    map_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Remove a map from user's library"""
    user_id = current_user["user_id"]
    result = await db.execute(
        select(UserMap).where(
            (UserMap.id == map_id) &
            (UserMap.user_id == user_id)
        )
    )
    user_map = result.scalar_one_or_none()

    if not user_map:
        raise HTTPException(status_code=404, detail="地图不存在")

    await db.execute(
        delete(UserMap).where(UserMap.id == map_id)
    )
    await db.commit()

    return {"success": True, "message": "已从地图库移除"}
