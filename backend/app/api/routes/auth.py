"""Authentication routes for login/logout."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_db
from app.models.user import User
from app.services.resterlab_auth import get_resterlab_auth
from app.core.security import create_access_token, require_auth

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AuthUser(BaseModel):
    id: str
    email: str
    display_name: str
    role: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: AuthUser


@router.post("/login", response_model=AuthResponse)
async def login(
    payload: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Authenticate user against Resterlab database and issue JWT token.
    Also creates/updates local User record for app-specific data.
    """
    # Verify credentials against Resterlab
    resterlab_auth = get_resterlab_auth()
    rest_user = resterlab_auth.verify_credentials(payload.email, payload.password)

    # Find or create local user record
    resterlab_user_id = str(rest_user["id"])
    result = await db.execute(
        select(User).where(User.resterlab_user_id == resterlab_user_id)
    )
    local_user = result.scalar_one_or_none()

    if not local_user:
        # Create new local user with generated id
        user_id = f"resterlab_{resterlab_user_id}"
        local_user = User(
            id=user_id,
            username=rest_user["display_name"],
            email=rest_user["email"],
            role=rest_user["role"],
            is_active=True,
            resterlab_user_id=resterlab_user_id,
        )
        db.add(local_user)
        await db.commit()
        await db.refresh(local_user)
    else:
        # Update email and role from Resterlab, but preserve locally-set display name
        local_user.email = rest_user["email"]
        local_user.role = rest_user["role"]
        await db.commit()

    # Use locally saved display name (user may have customized it)
    display_name = local_user.username or rest_user["display_name"]

    # Create JWT token
    token = create_access_token(
        user_id=str(local_user.id),
        email=rest_user["email"],
        role=rest_user["role"],
        display_name=display_name,
    )

    return AuthResponse(
        access_token=token,
        user=AuthUser(
            id=str(local_user.id),
            email=rest_user["email"],
            display_name=display_name,
            role=rest_user["role"],
        ),
    )


@router.get("/me", response_model=AuthUser)
async def get_me(
    current_user: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Get current authenticated user info."""
    user_id = current_user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return AuthUser(
        id=str(user.id),
        email=user.email or "",
        display_name=user.username or user.email or "",
        role=user.role or "user",
    )
