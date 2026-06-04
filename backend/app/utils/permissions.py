"""User permissions utilities"""

from enum import Enum
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional


class UserRole(str, Enum):
    """User role enumeration"""
    ADMIN = "admin"
    REGULAR = "regular"


async def get_user_role(user_id: str, db: AsyncSession) -> UserRole:
    """
    Get user role from database

    Args:
        user_id: User ID
        db: Database session

    Returns:
        UserRole: User's role (defaults to REGULAR if user not found)
    """
    from app.models.user import User

    result = await db.execute(
        select(User.role).where(User.id == user_id)
    )
    role = result.scalar_one_or_none()

    if role == "admin":
        return UserRole.ADMIN
    return UserRole.REGULAR


async def is_admin(user_id: str, db: AsyncSession) -> bool:
    """
    Check if user is admin

    Args:
        user_id: User ID
        db: Database session

    Returns:
        bool: True if user is admin
    """
    role = await get_user_role(user_id, db)
    return role == UserRole.ADMIN


async def require_admin(user_id: str, db: AsyncSession) -> None:
    """
    Require admin permission, raise HTTPException if not admin

    Args:
        user_id: User ID
        db: Database session

    Raises:
        HTTPException: 403 Forbidden if user is not admin
    """
    if not await is_admin(user_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin permission required"
        )

