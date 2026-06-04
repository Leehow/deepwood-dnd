from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from typing import List, Optional
from pydantic import BaseModel, Field, ConfigDict
from datetime import datetime

from app.core.dependencies import resolve_campaign_member_context
from app.core.security import require_auth
from app.db.session import get_db
from app.models.ai_chat_session import AiChatSession
from app.models.chat_message import ChatMessage

router = APIRouter(prefix="/campaigns", tags=["AI Sessions"])


# --- Schemas ---

class AiSessionCreate(BaseModel):
    title: str = Field(default="新会话", max_length=100)


class AiSessionUpdate(BaseModel):
    title: str = Field(..., min_length=1, max_length=100)


class AiSessionResponse(BaseModel):
    id: int
    campaign_id: int
    user_id: str
    title: str
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# --- Endpoints ---

@router.get("/{campaign_id}/ai-sessions", response_model=List[AiSessionResponse])
async def list_ai_sessions(
    campaign_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """List all AI chat sessions for a user in a campaign."""
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    stmt = (
        select(AiChatSession)
        .where(
            AiChatSession.campaign_id == campaign_id,
            AiChatSession.user_id == context.user_id,
            AiChatSession.is_deleted == False,
        )
        .order_by(AiChatSession.created_at.desc())
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/{campaign_id}/ai-sessions", response_model=AiSessionResponse, status_code=status.HTTP_201_CREATED)
async def create_ai_session(
    campaign_id: int,
    body: AiSessionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Create a new AI chat session."""
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    session = AiChatSession(
        campaign_id=campaign_id,
        user_id=context.user_id,
        title=body.title,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@router.patch("/{campaign_id}/ai-sessions/{session_id}", response_model=AiSessionResponse)
async def rename_ai_session(
    campaign_id: int,
    session_id: int,
    body: AiSessionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Rename an AI chat session."""
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    session = await db.get(AiChatSession, session_id)
    if not session or session.campaign_id != campaign_id or session.user_id != context.user_id:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.is_deleted:
        raise HTTPException(status_code=400, detail="Session already deleted")

    session.title = body.title
    await db.commit()
    await db.refresh(session)
    return session


@router.delete("/{campaign_id}/ai-sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ai_session(
    campaign_id: int,
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Soft-delete an AI chat session and its messages."""
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    session = await db.get(AiChatSession, session_id)
    if not session or session.campaign_id != campaign_id or session.user_id != context.user_id:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.is_deleted:
        return None

    session.is_deleted = True

    # Soft-delete all messages in this session
    await db.execute(
        update(ChatMessage)
        .where(ChatMessage.ai_session_id == session_id)
        .values(is_deleted=True)
    )
    await db.commit()
    return None
