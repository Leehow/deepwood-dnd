from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
from datetime import datetime
from app.models.ai_settings import ModelType


# ============= AI Model Config Schemas =============

class AIModelConfigBase(BaseModel):
    """Base schema for AI Model Configuration"""
    model_type: ModelType
    api_url: Optional[str] = None
    api_key: Optional[str] = None
    model_name: Optional[str] = None


class AIModelConfigCreate(AIModelConfigBase):
    """Schema for creating AI Model Configuration"""
    pass


class AIModelConfigUpdate(BaseModel):
    """Schema for updating AI Model Configuration"""
    api_url: Optional[str] = None
    api_key: Optional[str] = None
    model_name: Optional[str] = None


class AIModelConfigResponse(AIModelConfigBase):
    """Schema for AI Model Configuration response"""
    id: int
    settings_id: int
    created_at: datetime
    updated_at: Optional[datetime]

    model_config = ConfigDict(from_attributes=True)


# ============= AI API Settings Schemas =============

class AIAPISettingsCreate(BaseModel):
    """Schema for creating AI API Settings with model configs"""
    model_configs: List[AIModelConfigCreate] = []


class AIAPISettingsUpdate(BaseModel):
    """Schema for updating AI API Settings with model configs"""
    model_configs: List[AIModelConfigCreate] = []


class AIAPISettingsResponse(BaseModel):
    """Schema for AI API Settings response with nested model configs"""
    id: int
    user_id: str
    model_configs: List[AIModelConfigResponse] = []
    created_at: datetime
    updated_at: Optional[datetime]

    model_config = ConfigDict(from_attributes=True)


# ============= Helper Schemas =============

class ModelInfo(BaseModel):
    """Schema for model information from API"""
    id: str
    object: str
    created: Optional[int] = None
    owned_by: Optional[str] = None


class ModelsListResponse(BaseModel):
    """Schema for models list response from OpenAI-compatible API"""
    data: list[ModelInfo]
    object: str = "list"
