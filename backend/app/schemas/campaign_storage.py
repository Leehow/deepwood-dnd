from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict


class CampaignStorageBase(BaseModel):
    object_type: str = Field(..., max_length=50)
    object_id: str = Field(..., max_length=100)
    object_name: str = Field(..., max_length=200)
    category: Optional[str] = Field(default=None, max_length=100)
    tags: Optional[List[str]] = None
    data: Dict[str, Any]
    visibility: Optional[str] = Field(default="dm_only", pattern=r"^(dm_only|all_players|specific_players)$")
    source: Optional[str] = Field(default="custom", max_length=50)
    source_id: Optional[str] = Field(default=None, max_length=100)


class CampaignStorageCreate(CampaignStorageBase):
    created_by: str = Field(..., max_length=50)


class CampaignStorageUpdate(BaseModel):
    object_name: Optional[str] = Field(default=None, max_length=200)
    category: Optional[str] = Field(default=None, max_length=100)
    tags: Optional[List[str]] = None
    data: Optional[Dict[str, Any]] = None
    visibility: Optional[str] = Field(default=None, pattern=r"^(dm_only|all_players|specific_players)$")
    source_id: Optional[str] = Field(default=None, max_length=100)
    is_active: Optional[bool] = None
    version: int = Field(..., ge=1, description="Current object version for OCC compare")
    updated_by: str = Field(..., max_length=50)


class CampaignStorageResponse(BaseModel):
    id: int
    campaign_id: int
    object_type: str
    object_id: str
    object_name: str
    category: Optional[str]
    tags: Optional[List[str]]
    data: Dict[str, Any]
    source: Optional[str]
    source_id: Optional[str]
    visibility: str
    is_active: bool
    version: int
    created_at: datetime
    updated_at: Optional[datetime]
    created_by: str
    updated_by: Optional[str]

    model_config = ConfigDict(from_attributes=True)




class ACLModifyRequest(BaseModel):
    target_user_id: str = Field(..., max_length=50)
