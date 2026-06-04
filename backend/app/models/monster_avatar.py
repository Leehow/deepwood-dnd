from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from app.db.session import Base


class MonsterAvatar(Base):
    """Monster Avatar Model - Shared library of monster avatars"""
    __tablename__ = "monster_avatars"

    id = Column(Integer, primary_key=True, index=True)
    monster_id = Column(String(100), nullable=True, index=True)  # Legacy: ID from monsters.json
    monster_name = Column(String(200), nullable=True, index=True)  # New: Monster name for lookup
    avatar_url = Column(Text, nullable=False)  # URL to the avatar image
    avatar_url_large = Column(Text, nullable=True)  # Large avatar URL (512x512)
    created_by = Column(String(100))  # User ID who generated this avatar
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    usage_count = Column(Integer, default=0)  # Track popularity

