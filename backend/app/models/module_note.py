"""Module preparation notes model"""
from sqlalchemy import Column, Integer, String, Text, DateTime, Index, Boolean
from sqlalchemy.sql import func

from app.db.session import Base


class ModuleNote(Base):
    """DM's preparation notes for a module"""
    __tablename__ = "module_notes"

    id = Column(Integer, primary_key=True, index=True)
    module_id = Column(String(100), index=True, nullable=False)
    user_id = Column(String(50), index=True, nullable=False)
    content = Column(Text, nullable=False)
    is_collapsed = Column(Boolean, default=True, nullable=False)  # 折叠状态
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_module_notes_module_user", "module_id", "user_id"),
    )
