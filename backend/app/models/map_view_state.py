from sqlalchemy import Column, String, Integer, Float, Boolean, DateTime, Index, ForeignKey
from datetime import datetime
from app.db.session import Base


class MapViewState(Base):
    __tablename__ = "map_view_state"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), index=True, nullable=False)
    user_id = Column(String(255), index=True, nullable=False)
    map_url = Column(String(1024), nullable=False)

    # Store view position and scale
    position_x = Column(Float, default=0.0, nullable=False)
    position_y = Column(Float, default=0.0, nullable=False)
    scale = Column(Float, default=1.0, nullable=False)
    minimap_collapsed = Column(Boolean, default=False, nullable=False)

    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    # Composite index for efficient lookups
    __table_args__ = (
        Index('ix_campaign_user_map', 'campaign_id', 'user_id', 'map_url'),
    )

    def __repr__(self):
        return f"<MapViewState campaign_id={self.campaign_id} user_id={self.user_id} map_url={self.map_url}>"
