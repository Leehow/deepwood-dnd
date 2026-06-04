"""Resource Chat model for storing AI Q&A about campaign resources (monsters, items)"""
from sqlalchemy import Column, Integer, String, Text, DateTime, Index
from sqlalchemy.sql import func
from app.db.session import Base


class ResourceChatMessage(Base):
    """Chat message for resource-related AI queries"""
    __tablename__ = "resource_chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, nullable=False, index=True)
    user_id = Column(String(50), nullable=False, index=True)
    role = Column(String(20), nullable=False)  # 'user' or 'assistant'
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index('idx_resource_chat_campaign_user', 'campaign_id', 'user_id'),
    )
