"""
AI Map Marker model for storing AI-generated map annotations
These markers use percentage-based coordinates (e.g., "25%", "30%")
"""
from sqlalchemy import Column, Integer, String, DateTime, Index, ForeignKey, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.db.session import Base


class AIMapMarker(Base):
    """AI-generated markers for annotating locations on the map"""
    __tablename__ = "ai_map_markers"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), index=True, nullable=False)
    map_url = Column(String(1024), nullable=False)

    # Store markers as JSON array: [{"x": "25%", "y": "30%", "label": "城堡", "content": "描述"}]
    markers = Column(JSONB, nullable=False, default=[])

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Composite index for efficient queries
    __table_args__ = (
        Index('ix_campaign_ai_map_markers', 'campaign_id', 'map_url', unique=True),
    )
