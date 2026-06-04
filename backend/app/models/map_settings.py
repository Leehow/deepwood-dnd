"""Map Settings Model"""
from sqlalchemy import Column, Integer, String, Float, DateTime, func, ForeignKey
from app.db.session import Base


class MapSettings(Base):
    """Map Settings Model - stores map-specific settings for each campaign"""
    __tablename__ = "map_settings"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True)
    map_url = Column(String(500), nullable=False)
    scale = Column(Float, default=1.0)  # Map image scale (0.3 - 3.0)
    grid_unit_length = Column(Float, default=5.0)  # Length represented by one grid cell (default 5 feet)
    anchor_x = Column(Integer, nullable=True)  # Anchor point grid X coordinate
    anchor_y = Column(Integer, nullable=True)  # Anchor point grid Y coordinate
    global_terrain = Column(String(50), nullable=True)  # Global terrain type (forest, dungeon, etc.)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

