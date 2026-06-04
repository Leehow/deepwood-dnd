from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, Index
from sqlalchemy.sql import func
from app.db.session import Base


class AiChatSession(Base):
    """AI Chat Session - each session has independent AI context"""
    __tablename__ = "ai_chat_sessions"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String(50), nullable=False)
    title = Column(String(100), nullable=False, default="新会话")

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    is_deleted = Column(Boolean, nullable=False, default=False)

    __table_args__ = (
        Index("ix_ai_session_campaign_user", "campaign_id", "user_id"),
    )
