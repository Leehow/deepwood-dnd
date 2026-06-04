"""Map Marker Schemas"""
from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime


class MapMarkerBase(BaseModel):
    """Base schema for MapMarker"""
    map_url: str
    position_x: float
    position_y: float
    icon: str = "📍"
    label: str
    color: str = "#ef4444"
    description: Optional[str] = None
    visible_to_players: int = 1


class MapMarkerCreate(MapMarkerBase):
    """Schema for creating MapMarker"""
    pass


class MapMarkerUpdate(BaseModel):
    """Schema for updating MapMarker"""
    position_x: Optional[float] = None
    position_y: Optional[float] = None
    icon: Optional[str] = None
    label: Optional[str] = None
    color: Optional[str] = None
    description: Optional[str] = None
    visible_to_players: Optional[int] = None


class MapMarkerResponse(MapMarkerBase):
    """Schema for MapMarker response"""
    id: int
    campaign_id: int
    created_at: datetime
    updated_at: Optional[datetime]

    model_config = ConfigDict(from_attributes=True)
