"""Map View State Schemas"""
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional
from datetime import datetime


class MapViewStateBase(BaseModel):
    """Base schema for Map View State"""
    campaign_id: int
    user_id: str
    map_url: str
    position_x: float = Field(default=0.0)
    position_y: float = Field(default=0.0)
    scale: float = Field(default=1.0, ge=0.1, le=5.0)
    minimap_collapsed: bool = Field(default=False)


class MapViewStateCreate(MapViewStateBase):
    """Schema for creating Map View State"""
    pass


class MapViewStateUpdate(BaseModel):
    """Schema for updating Map View State"""
    position_x: Optional[float] = None
    position_y: Optional[float] = None
    scale: Optional[float] = Field(None, ge=0.1, le=5.0)
    minimap_collapsed: Optional[bool] = None


class MapViewStateResponse(MapViewStateBase):
    """Schema for Map View State response"""
    id: int
    created_at: datetime
    updated_at: Optional[datetime]

    model_config = ConfigDict(from_attributes=True)
