"""
Ruler model for distance measurement on battle maps
"""
from sqlalchemy import Column, Integer, String, Float, DateTime, Index, ForeignKey
from sqlalchemy.sql import func
from app.db.session import Base


class Ruler(Base):
    """Ruler for measuring distances on the map"""
    __tablename__ = "rulers"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), index=True, nullable=False)
    map_url = Column(String(1024), nullable=False)

    # Start point (grid coordinates)
    start_x = Column(Float, nullable=False)
    start_y = Column(Float, nullable=False)

    # End point (grid coordinates)
    end_x = Column(Float, nullable=False)
    end_y = Column(Float, nullable=False)

    # Calculated distance in grid units
    distance = Column(Float, nullable=False)

    # Color for the ruler line (hex format)
    color = Column(String(20), default="#ff0000")

    # Type of ruler: "line" or "circle"
    ruler_type = Column(String(20), default="line", nullable=False, server_default="line")

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Composite index for efficient queries
    __table_args__ = (
        Index('ix_campaign_map_rulers', 'campaign_id', 'map_url'),
    )
