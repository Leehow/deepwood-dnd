from pydantic import BaseModel, Field, ConfigDict
from typing import Optional
from datetime import datetime


class CampaignTemplateCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None


class CampaignTemplateResponse(BaseModel):
    id: int
    dm_user_id: str
    name: str
    description: Optional[str] = None
    cover_image: Optional[str] = None
    source_campaign_id: Optional[int] = None
    is_shared: bool = False
    shared_by_name: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class CampaignTemplateListResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    cover_image: Optional[str] = None
    source_campaign_id: Optional[int] = None
    is_shared: bool = False
    shared_by_name: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SharedTemplateResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    cover_image: Optional[str] = None
    shared_by_name: Optional[str] = None
    dm_user_id: str
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class CreateFromTemplateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
