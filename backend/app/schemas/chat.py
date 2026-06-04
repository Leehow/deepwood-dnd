from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Any
from datetime import datetime


class ChatMessageCreate(BaseModel):
    content: str = Field(..., min_length=1)
    recipients: List[str] = []  # empty -> public
    message_type: str = "chat"
    reply_to_id: Optional[int] = None
    meta: Optional[dict] = None


class ChatMessageUpdate(BaseModel):
    content: str = Field(..., min_length=1)


class ChatMessageResponse(BaseModel):
    id: int
    campaign_id: int
    sender_user_id: str
    sender_role: str
    sender_character_id: Optional[int]
    message_type: str
    content: str
    recipients: List[str]
    is_private: bool
    mentions: List[str]
    meta: Optional[dict]
    reply_to_id: Optional[int]
    ai_session_id: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime]
    is_deleted: bool
    deleted_at: Optional[datetime]

    model_config = ConfigDict(from_attributes=True)

