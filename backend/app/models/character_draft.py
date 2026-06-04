from sqlalchemy import Column, Integer, String, JSON, DateTime
from sqlalchemy.sql import func
from app.db.session import Base


class CharacterDraft(Base):
    """Stores in-progress character creation wizard state (one per user)."""
    __tablename__ = "character_drafts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(50), unique=True, nullable=False, index=True)
    current_step = Column(Integer, default=1)
    wizard_state = Column(JSON, nullable=False)  # Full CharacterState blob
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
