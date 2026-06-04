"""Drawing Schemas"""
from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime


class DrawingPoint(BaseModel):
    """A point in 2D space"""
    x: float
    y: float


class DrawingBase(BaseModel):
    """Base schema for Drawing"""
    campaign_id: int
    map_url: str
    type: str  # "ruler", "circle", "sketch", "arrow"
    color: str = "#ff0000"
    stroke_color: str = "#ff0000"
    fill_color: Optional[str] = None
    stroke_width: int = 2


class RulerCreate(BaseModel):
    """Schema for creating Ruler"""
    map_url: str
    start_x: float
    start_y: float
    end_x: float
    end_y: float
    distance: float
    color: str = "#ff0000"


class CircleCreate(BaseModel):
    """Schema for creating Circle"""
    map_url: str
    center_x: float
    center_y: float
    radius: float
    color: str = "#ff0000"
    fill_color: Optional[str] = None
    stroke_width: int = 2


class SketchCreate(BaseModel):
    """Schema for creating Sketch (freehand drawing)"""
    map_url: str
    points: List[Dict[str, float]]  # [{x, y}, {x, y}, ...]
    color: str = "#ff0000"
    stroke_width: int = 2


class ArrowCreate(BaseModel):
    """Schema for creating Arrow"""
    map_url: str
    points: List[Dict[str, float]]  # [{x, y}, {x, y}] - start and end
    color: str = "#ff0000"
    stroke_width: int = 2


class DrawingCreate(DrawingBase):
    """Schema for creating Drawing (generic)"""
    pass


class DrawingUpdate(BaseModel):
    """Schema for updating Drawing"""
    end_x: Optional[float] = None
    end_y: Optional[float] = None
    distance: Optional[float] = None
    center_x: Optional[float] = None
    center_y: Optional[float] = None
    radius: Optional[float] = None
    points: Optional[List[Dict[str, float]]] = None
    color: Optional[str] = None
    stroke_color: Optional[str] = None
    fill_color: Optional[str] = None
    stroke_width: Optional[int] = None


class DrawingResponse(DrawingBase):
    """Schema for Drawing response"""
    id: int
    created_by_user_id: str
    start_x: Optional[float] = None
    start_y: Optional[float] = None
    end_x: Optional[float] = None
    end_y: Optional[float] = None
    distance: Optional[float] = None
    center_x: Optional[float] = None
    center_y: Optional[float] = None
    radius: Optional[float] = None
    points: Optional[List[Dict[str, float]]] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
