"""
Unified drawing model for rulers, circles, sketches, and arrows on battle maps
"""
from sqlalchemy import Column, Integer, String, Float, DateTime, Index, JSON, ForeignKey
from sqlalchemy.sql import func
from app.db.session import Base
from enum import Enum


class DrawingType(str, Enum):
    """Types of drawings on the map"""
    RULER = "ruler"
    CIRCLE = "circle"
    SKETCH = "sketch"
    ARROW = "arrow"


class Drawing(Base):
    """Unified drawing model for all drawing types"""
    __tablename__ = "drawings"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), index=True, nullable=False)
    map_url = Column(String(1024), nullable=False)

    # Drawing type
    type = Column(String(50), nullable=False, default=DrawingType.RULER.value)

    # Owner of the drawing
    created_by_user_id = Column(String(255), nullable=False)

    # Ruler fields (start and end points in grid coordinates)
    start_x = Column(Float, nullable=True)
    start_y = Column(Float, nullable=True)
    end_x = Column(Float, nullable=True)
    end_y = Column(Float, nullable=True)
    distance = Column(Float, nullable=True)

    # Circle fields
    center_x = Column(Float, nullable=True)
    center_y = Column(Float, nullable=True)
    radius = Column(Float, nullable=True)

    # Sketch and Arrow fields (stored as JSON array of points)
    # For sketch: [{x, y}, {x, y}, ...] - path points
    # For arrow: [{x, y}, {x, y}] - start and end points
    points = Column(JSON, nullable=True)

    # Common styling fields
    color = Column(String(20), default="#ff0000")
    stroke_color = Column(String(20), default="#ff0000")
    fill_color = Column(String(20), nullable=True)
    stroke_width = Column(Integer, default=2)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Composite index for efficient queries
    __table_args__ = (
        Index('ix_campaign_map_drawings', 'campaign_id', 'map_url'),
        Index('ix_drawing_creator', 'created_by_user_id'),
    )
