"""Helper for authenticating users against the Resterlab database."""
from __future__ import annotations

from typing import Any, Dict, Optional

import bcrypt
from fastapi import HTTPException, status
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings

# Cache engines by URL so we don't recreate pools for every request
_engine_cache: Dict[str, Any] = {}


def _get_engine(db_url: str):
    if db_url in _engine_cache:
        return _engine_cache[db_url]
    engine = create_engine(db_url, pool_pre_ping=True)
    _engine_cache[db_url] = engine
    return engine


class ResterlabAuthService:
    """Minimal credential verifier that reads from the Resterlab users table."""

    def __init__(self, db_url: Optional[str] = None):
        self.db_url = db_url or settings.RESTERLAB_DATABASE_URL
        if not self.db_url:
            raise ValueError("RESTERLAB_DATABASE_URL is not configured")
        self.engine = _get_engine(self.db_url)

    def _fetch_user(self, email: str) -> Optional[Dict[str, Any]]:
        """Fetch user row by email."""
        normalized_email = (email or "").strip().lower()
        if not normalized_email:
            return None

        query = text(
            """
            SELECT id, email, display_name, password_hash, role, is_active, last_login
            FROM users
            WHERE lower(email) = :email
            LIMIT 1
            """
        )

        try:
            with self.engine.connect() as conn:
                row = conn.execute(query, {"email": normalized_email}).mappings().first()
                return dict(row) if row else None
        except SQLAlchemyError as e:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Failed to read Resterlab users: {e}",
            )

    def verify_credentials(self, email: str, password: str) -> Dict[str, Any]:
        """Validate an email/password pair against the Resterlab users table."""
        user = self._fetch_user(email)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password",
            )

        if user.get("is_active") is False:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is deactivated",
            )

        stored_hash = user.get("password_hash") or ""
        if not stored_hash or not bcrypt.checkpw(
            password.encode("utf-8"), stored_hash.encode("utf-8")
        ):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password",
            )

        return {
            "id": user["id"],
            "email": user["email"],
            "display_name": user.get("display_name") or user["email"],
            "role": user.get("role") or "user",
        }


# Singleton instance
_resterlab_auth: Optional[ResterlabAuthService] = None


def get_resterlab_auth() -> ResterlabAuthService:
    """Get or create the singleton ResterlabAuthService instance."""
    global _resterlab_auth
    if _resterlab_auth is None:
        _resterlab_auth = ResterlabAuthService()
    return _resterlab_auth
