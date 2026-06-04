from sqlalchemy import Column, String, DateTime, Boolean
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.db.session import Base


class User(Base):
    """User Model - Stores user information and roles"""
    __tablename__ = "users"

    id = Column(String(50), primary_key=True, index=True)
    username = Column(String(100), nullable=False)
    email = Column(String(255), unique=True, index=True)
    role = Column(String(20), nullable=False, default="regular")  # admin, regular
    is_active = Column(Boolean, default=True)
    resterlab_user_id = Column(String(50), unique=True, index=True, nullable=True)
    # User preferences (music, sound, UI settings, etc.)
    preferences = Column(JSONB, nullable=False, server_default='{}')
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

