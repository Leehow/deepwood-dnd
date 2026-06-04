from sqlalchemy import Column, String, DateTime, Integer, Text, ForeignKey, Enum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.session import Base
import enum


class ModelType(str, enum.Enum):
    """Enum for AI model types"""
    CHAT = "CHAT"
    FAST = "FAST"
    MEDIUM = "MEDIUM"
    ADVANCED = "ADVANCED"
    SUPER_ADVANCED = "SUPER_ADVANCED"
    VISION = "VISION"
    FAST_IMAGE = "FAST_IMAGE"
    MEDIUM_IMAGE = "MEDIUM_IMAGE"
    ADVANCED_IMAGE = "ADVANCED_IMAGE"
    TRANSLATION = "TRANSLATION"
    MUSIC = "MUSIC"
    EMBEDDING = "EMBEDDING"
    RERANK = "RERANK"
    STT = "STT"  # Speech-to-Text
    TTS = "TTS"  # Text-to-Speech


class AIAPISettings(Base):
    """AI API Settings Model - Main settings table"""
    __tablename__ = "ai_api_settings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(50), unique=True, index=True, nullable=False, default="global")
    usage_configs = Column(JSONB, default={}, nullable=False, server_default='{}')
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # One-to-many relationship with model configs
    model_configs = relationship(
        "AIModelConfig",
        back_populates="settings",
        cascade="all, delete-orphan"
    )


class AIModelConfig(Base):
    """AI Model Configuration - Individual model settings"""
    __tablename__ = "ai_model_configs"

    id = Column(Integer, primary_key=True, index=True)
    settings_id = Column(Integer, ForeignKey("ai_api_settings.id", ondelete="CASCADE"), nullable=False, index=True)
    model_type = Column(Enum(ModelType), nullable=False, index=True)
    api_url = Column(String(500), nullable=True)
    api_key = Column(Text, nullable=True)
    model_name = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Many-to-one relationship with settings
    settings = relationship("AIAPISettings", back_populates="model_configs")

    __table_args__ = (
        # Ensure each settings can only have one config per model type
        {"schema": None},
    )
