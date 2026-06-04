"""Map Settings Schemas"""
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional
from datetime import datetime


class MapSettingsBase(BaseModel):
    """Base schema for Map Settings"""
    campaign_id: int
    map_url: str
    scale: float = Field(default=1.0, ge=0.3, le=5.0)
    grid_unit_length: float = Field(default=5.0, gt=0)  # Length unit per grid cell
    anchor_x: Optional[int] = None
    anchor_y: Optional[int] = None
    global_terrain: Optional[str] = None


class MapSettingsCreate(MapSettingsBase):
    """Schema for creating Map Settings"""
    pass


class MapSettingsUpdate(BaseModel):
    """Schema for updating Map Settings"""
    scale: Optional[float] = Field(None, ge=0.3, le=5.0)
    grid_unit_length: Optional[float] = Field(None, gt=0)
    anchor_x: Optional[int] = None
    anchor_y: Optional[int] = None
    global_terrain: Optional[str] = None


class MapSettingsResponse(MapSettingsBase):
    """Schema for Map Settings response"""
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

