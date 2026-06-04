from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from app.db.session import Base


class UserAvatar(Base):
    """User Avatar Library - persists all uploaded/generated avatars per user"""
    __tablename__ = "user_avatars"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(100), nullable=False, index=True)
    avatar_url = Column(Text, nullable=False)
    avatar_url_large = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
