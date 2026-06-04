"""
User Map Library Model
Stores user's saved maps from AI generation or manual addition
"""
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.db.session import Base


class UserMap(Base):
    """User's personal map library"""
    __tablename__ = "user_maps"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(50), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    url = Column(Text, nullable=False)
    thumbnail_url = Column(Text, nullable=True)

    # Source info
    source_type = Column(String(50), default="manual")  # ai_generated, manual, module
    source_module_id = Column(String(100), nullable=True)
    source_campaign_id = Column(Integer, nullable=True)

    # Map metadata
    environment = Column(String(50), nullable=True)  # forest, dungeon, town, etc.
    description = Column(Text, nullable=True)
    extra_data = Column(JSONB, default={})  # Additional metadata like dimensions, features

    created_at = Column(DateTime(timezone=True), server_default=func.now())
