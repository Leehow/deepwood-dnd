"""Module note schemas"""
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field, ConfigDict


class ModuleNoteCreate(BaseModel):
    """Schema for creating a note"""
    content: str = Field(..., min_length=1, description="Note content")


class ModuleNoteUpdate(BaseModel):
    """Schema for updating a note"""
    content: Optional[str] = Field(None, min_length=1, description="Note content")
    is_collapsed: Optional[bool] = Field(None, description="Collapsed state")


class ModuleNoteResponse(BaseModel):
    """Schema for note response"""
    id: int
    module_id: str
    user_id: str
    content: str
    is_collapsed: bool = True
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ModuleNotesListResponse(BaseModel):
    """Schema for list of notes"""
    notes: List[ModuleNoteResponse]
    total: int
