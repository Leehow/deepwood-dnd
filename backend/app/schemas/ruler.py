"""Ruler Schemas"""
from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime


class RulerBase(BaseModel):
    """Base schema for Ruler"""
    campaign_id: int
    map_url: str
    start_x: float
    start_y: float
    end_x: float
    end_y: float
    distance: float
    color: str = "#ff0000"
    ruler_type: str = "line"


class RulerCreate(BaseModel):
    """Schema for creating Ruler"""
    map_url: str
    start_x: float
    start_y: float
    end_x: float
    end_y: float
    distance: float
    color: str = "#ff0000"
    ruler_type: str = "line"


class RulerUpdate(BaseModel):
    """Schema for updating Ruler"""
    end_x: Optional[float] = None
    end_y: Optional[float] = None
    distance: Optional[float] = None
    color: Optional[str] = None


class RulerResponse(RulerBase):
    """Schema for Ruler response"""
    id: int
    created_at: datetime
    updated_at: Optional[datetime]

    model_config = ConfigDict(from_attributes=True)
