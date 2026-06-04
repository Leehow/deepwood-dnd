from sqlalchemy import Column, String, Integer, DateTime, JSON, ForeignKey, Index
from datetime import datetime
from app.db.session import Base


class MapTerrain(Base):
    __tablename__ = "map_terrain_cells"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), index=True, nullable=False)
    map_url = Column(String(1024), nullable=False)

    # Store cells as JSON array: [{x, y, type, properties?}, ...]
    cells = Column(JSON, default=list, nullable=False)

    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index('ix_terrain_campaign_map', 'campaign_id', 'map_url'),
    )

    def __repr__(self):
        return f"<MapTerrain campaign_id={self.campaign_id} map_url={self.map_url} cells={len(self.cells) if self.cells else 0}>"
