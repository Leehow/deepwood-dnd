"""
Map Marker model for placing markers on battle maps
"""
from sqlalchemy import Column, Integer, String, Float, DateTime, Index, ForeignKey, Text
from sqlalchemy.sql import func
from app.db.session import Base


class MapMarker(Base):
    """Marker for annotating locations on the map"""
    __tablename__ = "map_markers"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), index=True, nullable=False)
    map_url = Column(String(1024), nullable=False)

    # Position (grid coordinates)
    position_x = Column(Float, nullable=False)
    position_y = Column(Float, nullable=False)

    # Marker appearance
    icon = Column(String(20), default="📍")  # Emoji or icon identifier
    label = Column(String(100), nullable=False)  # Marker text label
    color = Column(String(20), default="#ef4444")  # Hex color for marker

    # Optional description
    description = Column(Text, nullable=True)

    # Visibility (for players)
    visible_to_players = Column(Integer, default=1)  # 1 = visible, 0 = DM only

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Composite index for efficient queries
    __table_args__ = (
        Index('ix_campaign_map_markers', 'campaign_id', 'map_url'),
    )
