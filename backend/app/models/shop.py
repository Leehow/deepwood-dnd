from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, Float, ForeignKey
from sqlalchemy.sql import func
from app.db.session import Base


class Shop(Base):
    """Shop model - Stores shops within a campaign"""
    __tablename__ = "shops"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), index=True, nullable=False)

    # Basic
    name = Column(String(200), nullable=False)
    description = Column(Text)
    appearance_description = Column(Text)  # Used for AI avatar generation prompt

    # Finance
    gold_gp = Column(Integer, default=0)  # Shop's gold reserve (gp)
    accepts_selling = Column(Boolean, default=True)  # Whether players can sell to this shop
    discount_rate = Column(Float, default=0.5)  # Buy-back coefficient (0.0~1.0), default 0.5

    # Avatar
    avatar_url = Column(Text)  # Small avatar (128x128)
    avatar_url_large = Column(Text)  # Large avatar (512x512)
    has_avatar = Column(Boolean, default=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

