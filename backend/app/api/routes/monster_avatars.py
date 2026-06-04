from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text, or_
from typing import List
from urllib.parse import unquote

from app.db.session import get_db
from app.models.monster_avatar import MonsterAvatar
from app.schemas.monster_avatar import (
    MonsterAvatarResponse,
    MonsterAvatarLibraryResponse,
    MonsterAvatarCreate
)
from app.core.security import require_auth

router = APIRouter(prefix="/api/monster-avatars", tags=["monster-avatars"])


@router.get("/library/by-name/{monster_name}", response_model=MonsterAvatarLibraryResponse)
async def get_monster_avatar_library_by_name(
    monster_name: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get all available avatars for a specific monster by name from the shared library
    Uses fuzzy matching to handle AI-generated name variations
    """
    # URL decode the monster name
    decoded_name = unquote(monster_name)

    # Use raw SQL for bi-directional fuzzy matching
    # Match if: name contains search term OR search term contains name
    result = await db.execute(
        text("""
            SELECT id, monster_id, monster_name, avatar_url, avatar_url_large,
                   created_by, created_at, usage_count
            FROM monster_avatars
            WHERE monster_name ILIKE :pattern
               OR :search_name ILIKE '%' || monster_name || '%'
            ORDER BY usage_count DESC, created_at DESC
        """),
        {"pattern": f"%{decoded_name}%", "search_name": decoded_name}
    )
    rows = result.fetchall()

    # Convert to MonsterAvatar objects
    avatars = [
        MonsterAvatar(
            id=row[0],
            monster_id=row[1],
            monster_name=row[2],
            avatar_url=row[3],
            avatar_url_large=row[4],
            created_by=row[5],
            created_at=row[6],
            usage_count=row[7]
        )
        for row in rows
    ]

    return MonsterAvatarLibraryResponse(
        monster_name=decoded_name,
        avatars=avatars,
        total_count=len(avatars)
    )


@router.get("/library/{monster_id}", response_model=MonsterAvatarLibraryResponse)
async def get_monster_avatar_library(
    monster_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    [Legacy] Get all available avatars for a specific monster type from the shared library
    """
    result = await db.execute(
        select(MonsterAvatar)
        .where(MonsterAvatar.monster_id == monster_id)
        .order_by(MonsterAvatar.usage_count.desc(), MonsterAvatar.created_at.desc())
    )
    avatars = result.scalars().all()

    # Get monster_name from first avatar if exists
    monster_name = avatars[0].monster_name if avatars else monster_id

    return MonsterAvatarLibraryResponse(
        monster_name=monster_name or monster_id,
        avatars=avatars,
        total_count=len(avatars)
    )


@router.post("/library", response_model=MonsterAvatarResponse, status_code=status.HTTP_201_CREATED)
async def add_avatar_to_library(
    avatar: MonsterAvatarCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Add a newly generated avatar to the shared library
    """
    db_avatar = MonsterAvatar(**avatar.model_dump())
    db.add(db_avatar)
    await db.commit()
    await db.refresh(db_avatar)
    return db_avatar


@router.post("/library/{avatar_id}/use", response_model=MonsterAvatarResponse)
async def increment_avatar_usage(
    avatar_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Increment usage count when an avatar is selected from the library
    """
    result = await db.execute(
        select(MonsterAvatar).where(MonsterAvatar.id == avatar_id)
    )
    avatar = result.scalar_one_or_none()

    if not avatar:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Avatar with id {avatar_id} not found"
        )

    avatar.usage_count += 1
    await db.commit()
    await db.refresh(avatar)
    return avatar


@router.delete("/library/{avatar_id}")
async def delete_avatar_from_library(
    avatar_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Delete an avatar from the shared library"""
    result = await db.execute(
        select(MonsterAvatar).where(MonsterAvatar.id == avatar_id)
    )
    avatar = result.scalar_one_or_none()
    if not avatar:
        raise HTTPException(status_code=404, detail="Avatar not found")

    await db.delete(avatar)
    await db.commit()
    return {"success": True, "deleted_id": avatar_id}


@router.get("/popular", response_model=List[MonsterAvatarResponse])
async def get_popular_avatars(
    limit: int = 20,
    db: AsyncSession = Depends(get_db)
):
    """
    Get most popular avatars across all monster types
    """
    result = await db.execute(
        select(MonsterAvatar)
        .order_by(MonsterAvatar.usage_count.desc())
        .limit(limit)
    )
    avatars = result.scalars().all()
    return avatars
