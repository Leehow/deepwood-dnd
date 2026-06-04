from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional


class MonsterAvatarBase(BaseModel):
    monster_id: Optional[str] = None  # Legacy field
    monster_name: Optional[str] = None  # New: lookup by name
    avatar_url: str
    avatar_url_large: Optional[str] = None
    created_by: Optional[str] = None


class MonsterAvatarCreate(MonsterAvatarBase):
    pass


class MonsterAvatarResponse(MonsterAvatarBase):
    id: int
    created_at: datetime
    usage_count: int

    model_config = ConfigDict(from_attributes=True)


class MonsterAvatarLibraryResponse(BaseModel):
    """Response for avatar library query"""
    monster_name: str  # Changed from monster_id
    avatars: list[MonsterAvatarResponse]
    total_count: int
