"""JWT security utilities for authentication."""
from datetime import datetime, timedelta
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings

security = HTTPBearer(auto_error=False)


def create_access_token(
    user_id: str,
    email: str,
    role: str,
    display_name: Optional[str] = None,
) -> str:
    """Create a JWT access token."""
    expiration = datetime.utcnow() + timedelta(hours=settings.JWT_EXPIRATION_HOURS)
    payload = {
        "user_id": str(user_id),
        "email": email,
        "role": role,
        "display_name": display_name or email,
        "exp": expiration,
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode and validate a JWT token."""
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM]
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
        )
    except jwt.InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {e}",
        )


async def get_current_user_from_token(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[dict]:
    """
    Extract user info from JWT token.
    Returns None if no token provided (for optional auth).
    """
    if credentials is None:
        return None

    token = credentials.credentials
    return decode_token(token)


async def require_auth(
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer()),
) -> dict:
    """Require valid authentication. Raises 401 if not authenticated."""
    token = credentials.credentials
    return decode_token(token)
