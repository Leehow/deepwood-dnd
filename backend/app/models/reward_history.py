from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, JSON
from sqlalchemy.sql import func
from app.db.session import Base


class RewardHistory(Base):
    """Reward history model - tracks XP and currency awards"""
    __tablename__ = "reward_history"

    id = Column(Integer, primary_key=True, index=True)
    character_id = Column(Integer, ForeignKey("characters.id", ondelete="CASCADE"), nullable=False, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True)

    reward_type = Column(String(20), nullable=False, index=True)  # 'xp' or 'currency'

    # XP fields
    xp_amount = Column(Integer, nullable=True)
    xp_source = Column(String(100), nullable=True)  # 'Combat', 'Quest', 'Roleplay', etc.

    # Currency fields
    currency_changes = Column(JSON, nullable=True)  # {"cp": 100, "gp": -10}
    currency_source = Column(String(100), nullable=True)  # 'Loot', 'Quest', 'Trade', etc.

    # Common fields
    description = Column(Text, nullable=True)
    is_private = Column(Boolean, default=False, nullable=False)
    awarded_by = Column(String(50), nullable=False)  # DM's user_id
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
