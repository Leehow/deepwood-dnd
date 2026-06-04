from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, JSON, Index, ForeignKey
from sqlalchemy.sql import func
from app.db.session import Base


class ChatMessage(Base):
    """Campaign Chat Message Model (flexible: relational + JSON)

    - Supports public and private messages
    - Extensible via JSON fields (mentions, attachments, meta)
    """
    __tablename__ = "campaign_chat_messages"

    id = Column(Integer, primary_key=True, index=True)

    # Scope
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), index=True, nullable=False)

    # Sender
    sender_user_id = Column(String(50), index=True, nullable=False)
    sender_role = Column(String(20), nullable=False)  # dm | player | ai
    sender_character_id = Column(Integer, index=True, nullable=True)

    # Content
    message_type = Column(String(20), nullable=False, default="chat")  # chat | system | dice | ai
    content = Column(Text, nullable=False)

    # Visibility & routing
    recipients = Column(JSON, nullable=False, default=list)  # array of user_ids for private messages; empty -> public
    is_private = Column(Boolean, nullable=False, default=False)

    # Extensible metadata
    mentions = Column(JSON, nullable=False, default=list)  # e.g., ["ai", "user_1"]
    meta = Column(JSON)  # free-form for future features (attachments, reactions, etc.)

    # AI session (only for AI assistant messages)
    ai_session_id = Column(Integer, ForeignKey("ai_chat_sessions.id", ondelete="SET NULL"), nullable=True)

    # Threading
    reply_to_id = Column(Integer, nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Soft delete
    is_deleted = Column(Boolean, nullable=False, default=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_chat_campaign_created_at", "campaign_id", "created_at"),
    )

