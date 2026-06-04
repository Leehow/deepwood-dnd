"""Rules Chat Message model for AI rules Q&A persistence"""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Index
from sqlalchemy.sql import func
from app.db.session import Base


class RulesChatMessage(Base):
    """Stores chat messages for rules AI Q&A, scoped by campaign + user"""
    __tablename__ = "rules_chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(
        Integer,
        ForeignKey("campaigns.id", ondelete="CASCADE"),
        index=True,
        nullable=False
    )
    user_id = Column(String(50), index=True, nullable=False)
    role = Column(String(20), nullable=False)  # 'user' | 'assistant'
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_rules_chat_campaign_user_created", "campaign_id", "user_id", "created_at"),
    )
