from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.exc import IntegrityError
from app.db.session import get_db
from app.models.user import User
from app.core.security import require_auth
from app.core.locale import SUPPORTED_LOCALES, sanitize_preference_locale
from pydantic import BaseModel
from typing import Optional, Dict, Any
from datetime import datetime
import uuid


router = APIRouter(prefix="/users", tags=["Users"])


class UserResponse(BaseModel):
    """Schema for User response"""
    id: str
    username: str
    email: Optional[str]
    role: str
    is_active: bool
    preferences: Dict[str, Any] = {}
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class DisplayNameUpdate(BaseModel):
    """Schema for updating user display name"""
    display_name: str


class PreferencesUpdate(BaseModel):
    """Schema for updating user preferences (partial update)"""
    preferences: Dict[str, Any]


# Static routes MUST come before dynamic routes to avoid conflicts
@router.get("/me/info", response_model=UserResponse)
async def get_current_user_info(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get current user info (for testing, normally would use JWT token)"""
    result = await db.execute(
        select(User).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        # If user doesn't exist in database, create a default regular user
        unique_suffix = uuid.uuid4().hex[:8]
        user = User(
            id=user_id,
            username=f"User {user_id}",
            email=f"user_{unique_suffix}@dnd.local",
            role="regular",
            is_active=True
        )
        db.add(user)
        try:
            await db.commit()
            await db.refresh(user)
        except IntegrityError:
            await db.rollback()
            raise HTTPException(status_code=400, detail="Failed to create user")

    return user


@router.put("/{user_id}/display-name", response_model=UserResponse)
async def update_display_name(
    user_id: str,
    data: DisplayNameUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Update user's display name"""
    if current_user["user_id"] != user_id and current_user.get("user_id") != "0":
        raise HTTPException(status_code=403, detail="Cannot modify another user's display name")
    name = data.display_name.strip()
    if not name or len(name) > 100:
        raise HTTPException(status_code=400, detail="名称不能为空且不超过100个字符")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.username = name
    await db.commit()
    await db.refresh(user)
    return user


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get user by ID"""
    result = await db.execute(
        select(User).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return user


@router.get("/{user_id}/preferences")
async def get_user_preferences(
    user_id: str,
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Get user preferences"""
    result = await db.execute(
        select(User).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        # Return empty preferences for non-existent users (they'll be created on first save)
        return {}

    return user.preferences or {}


@router.post("/{user_id}/preferences")
async def update_user_preferences(
    user_id: str,
    data: PreferencesUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
) -> Dict[str, Any]:
    """Update user preferences (partial merge)"""
    if current_user["user_id"] != user_id and current_user.get("user_id") != "0":
        raise HTTPException(status_code=403, detail="Cannot modify another user's preferences")
    # Sanitize locale so we never persist an unsupported value. Missing key is
    # fine (other preferences may be updated alone); an unparseable value is
    # rejected with 400 so clients fail loudly instead of drifting silently.
    if "locale" in data.preferences:
        normalized = sanitize_preference_locale(data.preferences.get("locale"))
        if normalized is None or normalized not in SUPPORTED_LOCALES:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported locale; expected one of {list(SUPPORTED_LOCALES)}",
            )
        data.preferences["locale"] = normalized
    result = await db.execute(
        select(User).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        # Create user if doesn't exist, use unique email to avoid conflicts
        unique_suffix = uuid.uuid4().hex[:8]
        user = User(
            id=user_id,
            username=f"User {user_id}",
            email=f"user_{unique_suffix}@dnd.local",
            role="regular",
            is_active=True,
            preferences=data.preferences
        )
        db.add(user)
        try:
            await db.commit()
            await db.refresh(user)
            return user.preferences
        except IntegrityError:
            await db.rollback()
            raise HTTPException(status_code=400, detail="Failed to create user")
    else:
        # Merge new preferences with existing ones
        # Create a new dict to ensure SQLAlchemy detects the change
        new_prefs = dict(user.preferences or {})
        new_prefs.update(data.preferences)
        user.preferences = new_prefs
        flag_modified(user, "preferences")

    await db.commit()
    await db.refresh(user)

    return user.preferences

