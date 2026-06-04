"""Module Chat Session model for multi-conversation support"""
from sqlalchemy import Column, Integer, String, DateTime, Index
from sqlalchemy.sql import func
from app.db.session import Base


class ModuleChatSession(Base):
    """Stores chat sessions for module AI Q&A, scoped by module + user"""
    __tablename__ = "module_chat_sessions"

    id = Column(Integer, primary_key=True, index=True)
    module_id = Column(String(100), nullable=False, index=True)
    user_id = Column(String(50), nullable=False, index=True)
    campaign_id = Column(Integer, nullable=True, index=True)
    title = Column(String(200), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_chat_session_module_user_campaign", "module_id", "user_id", "campaign_id"),
    )
