from sqlalchemy import Column, String, Integer, DateTime, func, JSON, ForeignKey, Index
from sqlalchemy.orm import relationship
from datetime import datetime
from app.db.session import Base


class FogOfWar(Base):
    __tablename__ = "fog_of_war"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), index=True, nullable=False)
    map_url = Column(String(1024), nullable=False)

    # Store cells as JSON array: [[x1, y1], [x2, y2], ...]
    cells = Column(JSON, default=list, nullable=False)

    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    # Composite index for efficient lookups
    __table_args__ = (
        Index('ix_campaign_map', 'campaign_id', 'map_url'),
    )

    def __repr__(self):
        return f"<FogOfWar campaign_id={self.campaign_id} map_url={self.map_url} cells={len(self.cells)}>"
