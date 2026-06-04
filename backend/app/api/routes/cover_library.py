"""
Cover Library API Routes
Manage user's personal cover image library
"""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel

from app.db.session import get_db
from app.models.user_cover import UserCover
from app.core.security import require_auth


router = APIRouter(prefix="/api/cover-library", tags=["cover-library"])


class CoverLibraryItem(BaseModel):
    id: int
    name: str
    url: str
    thumbnail_url: Optional[str] = None
    source_type: str
    prompt: Optional[str] = None
    created_at: str

    class Config:
        from_attributes = True


class AddCoverRequest(BaseModel):
    name: str
    url: str
    thumbnail_url: Optional[str] = None
    source_type: str = "ai_generated"
    source_module_id: Optional[str] = None
    source_campaign_id: Optional[int] = None
    prompt: Optional[str] = None
    extra_data: Optional[dict] = None


@router.get("", response_model=List[CoverLibraryItem])
async def get_cover_library(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Get user's cover library"""
    user_id = current_user["user_id"]
    result = await db.execute(
        select(UserCover)
        .where(UserCover.user_id == user_id)
        .order_by(UserCover.created_at.desc())
    )
    covers = result.scalars().all()

    return [
        CoverLibraryItem(
            id=c.id,
            name=c.name,
            url=c.url,
            thumbnail_url=c.thumbnail_url,
            source_type=c.source_type or "ai_generated",
            prompt=c.prompt,
            created_at=c.created_at.isoformat() if c.created_at else ""
        )
        for c in covers
    ]


@router.post("", response_model=CoverLibraryItem)
async def add_to_cover_library(
    request: AddCoverRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Add a cover to user's library"""
    user_id = current_user["user_id"]
    user_cover = UserCover(
        user_id=user_id,
        name=request.name,
        url=request.url,
        thumbnail_url=request.thumbnail_url,
        source_type=request.source_type,
        source_module_id=request.source_module_id,
        source_campaign_id=request.source_campaign_id,
        prompt=request.prompt,
        extra_data=request.extra_data or {}
    )
    db.add(user_cover)
    await db.commit()
    await db.refresh(user_cover)

    return CoverLibraryItem(
        id=user_cover.id,
        name=user_cover.name,
        url=user_cover.url,
        thumbnail_url=user_cover.thumbnail_url,
        source_type=user_cover.source_type or "ai_generated",
        prompt=user_cover.prompt,
        created_at=user_cover.created_at.isoformat() if user_cover.created_at else ""
    )


@router.delete("/{cover_id}")
async def remove_from_cover_library(
    cover_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Remove a cover from user's library"""
    user_id = current_user["user_id"]
    result = await db.execute(
        select(UserCover).where(
            (UserCover.id == cover_id) &
            (UserCover.user_id == user_id)
        )
    )
    user_cover = result.scalar_one_or_none()

    if not user_cover:
        raise HTTPException(status_code=404, detail="封面不存在")

    await db.execute(
        delete(UserCover).where(UserCover.id == cover_id)
    )
    await db.commit()

    return {"success": True, "message": "已从封面库移除"}
