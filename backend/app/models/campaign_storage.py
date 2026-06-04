from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, Index, UniqueConstraint, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB, ARRAY
from sqlalchemy.sql import func

from app.db.session import Base


class CampaignStorage(Base):
    __tablename__ = "campaign_storage"

    id = Column(Integer, primary_key=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True)

    # Object identification
    object_type = Column(String(50), nullable=False, index=True)
    object_id = Column(String(100), nullable=False)
    object_name = Column(String(200), nullable=False)

    # Categorization
    category = Column(String(100), index=True)
    tags = Column(ARRAY(Text))

    # Flexible data
    data = Column(JSONB, nullable=False)

    # Metadata
    source = Column(String(50), default="custom")
    source_id = Column(String(100))
    visibility = Column(String(20), default="dm_only")  # dm_only, all_players, specific_players

    # State tracking
    is_active = Column(Boolean, nullable=False, default=True)
    version = Column(Integer, nullable=False, default=1)

    # Timestamps & audit
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    created_by = Column(String(50), nullable=False)
    updated_by = Column(String(50))

    __table_args__ = (
        UniqueConstraint("campaign_id", "object_type", "object_id", name="uq_campaign_storage_obj"),
        Index("ix_campaign_storage_tags", "tags", postgresql_using="gin"),
        Index("ix_campaign_storage_data", "data", postgresql_using="gin"),
        Index("ix_campaign_storage_campaign_type", "campaign_id", "object_type"),
        Index("ix_campaign_storage_campaign_category", "campaign_id", "category"),
    )

