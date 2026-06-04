from sqlalchemy import Column, String, Integer, DateTime, func, JSON, ForeignKey, Index
from sqlalchemy.orm import relationship
from datetime import datetime
from app.db.session import Base


class ModuleMaps(Base):
    __tablename__ = "module_maps"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), index=True, nullable=False)
    module_id = Column(String(255), index=True, nullable=False)

    # Store maps as JSON array
    # Each map: {id, name, url, chapter, metadata}
    maps = Column(JSON, default=list, nullable=False)

    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    # Composite index for efficient lookups
    __table_args__ = (
        Index('ix_campaign_module', 'campaign_id', 'module_id'),
    )

    def __repr__(self):
        return f"<ModuleMaps campaign_id={self.campaign_id} module_id={self.module_id} maps_count={len(self.maps)}>"
