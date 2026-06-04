from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.db.session import Base


class CampaignTemplate(Base):
    __tablename__ = "campaign_templates"

    id = Column(Integer, primary_key=True, index=True)
    dm_user_id = Column(String(50), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    cover_image = Column(Text, nullable=True)
    source_campaign_id = Column(Integer, nullable=True)
    template_data = Column(JSONB, nullable=False)
    is_shared = Column(Boolean, nullable=False, server_default="false")
    shared_by_name = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
