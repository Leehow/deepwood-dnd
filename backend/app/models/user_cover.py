"""
User Cover Library Model
Stores user's saved cover images from AI generation
"""
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.db.session import Base


class UserCover(Base):
    """User's personal cover image library"""
    __tablename__ = "user_covers"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(50), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    url = Column(Text, nullable=False)
    thumbnail_url = Column(Text, nullable=True)

    # Source info
    source_type = Column(String(50), default="ai_generated")  # ai_generated, manual
    source_module_id = Column(String(100), nullable=True)
    source_campaign_id = Column(Integer, nullable=True)

    # Generation metadata
    prompt = Column(Text, nullable=True)  # AI prompt used to generate
    extra_data = Column(JSONB, default={})

    created_at = Column(DateTime(timezone=True), server_default=func.now())
