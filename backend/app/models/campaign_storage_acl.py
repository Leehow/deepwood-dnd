from sqlalchemy import Column, Integer, String, ForeignKey, UniqueConstraint, Index, DateTime
from sqlalchemy.sql import func

from app.db.session import Base


class CampaignStorageACL(Base):
    __tablename__ = "campaign_storage_acl"

    id = Column(Integer, primary_key=True)
    storage_id = Column(Integer, ForeignKey("campaign_storage.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(50), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("storage_id", "user_id", name="uq_campaign_storage_acl_su"),
        Index("ix_campaign_storage_acl_user", "user_id"),
    )

