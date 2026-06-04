"""Module Chat Message model for AI module Q&A persistence"""
from sqlalchemy import Column, Integer, String, Text, DateTime, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.db.session import Base


class ModuleChatMessage(Base):
    """Stores chat messages for module AI Q&A, scoped by module + user"""
    __tablename__ = "module_chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    module_id = Column(
        String(100),
        index=True,
        nullable=False
    )
    user_id = Column(String(50), index=True, nullable=False)
    role = Column(String(20), nullable=False)  # 'user' | 'assistant'
    content = Column(Text, nullable=False)
    # Session ID for multi-conversation support (NULL = legacy messages)
    session_id = Column(Integer, nullable=True, index=True)
    # Optional chapter scope (NULL = module-level chat, non-NULL = chapter editing chat)
    chapter_title = Column(String(300), nullable=True, index=True)
    # Analyzed entities data (for assistant messages with entity markers)
    analyzed_entities = Column(JSONB, nullable=True)
    # Tool calls made during agent response [{"name": "...", "summary": "..."}]
    tool_calls = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_module_chat_module_user_created", "module_id", "user_id", "created_at"),
    )
