"""Module Chat Session CRUD routes for multi-conversation support"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func
from typing import Optional

from app.db.session import get_db
from app.models.module_chat_session import ModuleChatSession
from app.models.module_chat import ModuleChatMessage
from app.schemas.module_chat import (
    ModuleChatSessionCreate,
    ModuleChatSessionUpdate,
    ModuleChatSessionResponse,
)
from app.services.ai_model_service import ai_model_service
from app.core.security import require_auth

router = APIRouter(
    prefix="/api/modules/{module_id}/chat/sessions",
    tags=["Module Chat Sessions"],
)
logger = logging.getLogger(__name__)


async def _session_with_count(db: AsyncSession, session: ModuleChatSession) -> dict:
    """Build response dict with message_count."""
    count_result = await db.execute(
        select(func.count(ModuleChatMessage.id)).where(
            ModuleChatMessage.session_id == session.id
        )
    )
    count = count_result.scalar() or 0
    return {
        "id": session.id,
        "module_id": session.module_id,
        "user_id": session.user_id,
        "campaign_id": session.campaign_id,
        "title": session.title,
        "message_count": count,
        "created_at": session.created_at,
        "updated_at": session.updated_at,
    }


@router.get("", response_model=list[ModuleChatSessionResponse])
async def list_sessions(
    module_id: str,
    campaign_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """List sessions. Auto-creates a default session if none exist."""
    user_id = current_user["user_id"]
    filters = [
        ModuleChatSession.module_id == module_id,
        ModuleChatSession.user_id == user_id,
    ]
    if campaign_id is not None:
        filters.append(ModuleChatSession.campaign_id == campaign_id)

    result = await db.execute(
        select(ModuleChatSession).where(*filters).order_by(ModuleChatSession.updated_at.desc())
    )
    sessions = list(result.scalars().all())

    # Auto-create default session if none exist
    if not sessions:
        new_session = ModuleChatSession(
            module_id=module_id,
            user_id=user_id,
            campaign_id=campaign_id,
            title="新对话",
        )
        db.add(new_session)
        await db.flush()
        await db.refresh(new_session)
        sessions = [new_session]

    return [await _session_with_count(db, s) for s in sessions]


@router.post("", response_model=ModuleChatSessionResponse)
async def create_session(
    module_id: str,
    body: ModuleChatSessionCreate,
    campaign_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Create a new chat session."""
    user_id = current_user["user_id"]
    session = ModuleChatSession(
        module_id=module_id,
        user_id=user_id,
        campaign_id=campaign_id,
        title=body.title or "新对话",
    )
    db.add(session)
    await db.flush()
    await db.refresh(session)
    return await _session_with_count(db, session)


@router.patch("/{session_id}", response_model=ModuleChatSessionResponse)
async def update_session(
    module_id: str,
    session_id: int,
    body: ModuleChatSessionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Rename a chat session."""
    session = await db.get(ModuleChatSession, session_id)
    if not session or session.module_id != module_id:
        raise HTTPException(404, "Session not found")
    session.title = body.title
    await db.flush()
    await db.refresh(session)
    return await _session_with_count(db, session)


@router.delete("/{session_id}")
async def delete_session(
    module_id: str,
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Delete a session and all its messages."""
    session = await db.get(ModuleChatSession, session_id)
    if not session or session.module_id != module_id:
        raise HTTPException(404, "Session not found")

    await db.execute(
        delete(ModuleChatMessage).where(ModuleChatMessage.session_id == session_id)
    )
    await db.delete(session)
    return {"status": "success"}


@router.post("/{session_id}/generate-title", response_model=ModuleChatSessionResponse)
async def generate_session_title(
    module_id: str,
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Auto-generate a title from the first Q&A pair in the session."""
    session = await db.get(ModuleChatSession, session_id)
    if not session or session.module_id != module_id:
        raise HTTPException(404, "Session not found")

    # Get first user + assistant messages
    result = await db.execute(
        select(ModuleChatMessage)
        .where(ModuleChatMessage.session_id == session_id)
        .order_by(ModuleChatMessage.created_at.asc())
        .limit(4)
    )
    msgs = list(result.scalars().all())
    user_msg = next((m for m in msgs if m.role == "user"), None)
    asst_msg = next((m for m in msgs if m.role == "assistant"), None)
    if not user_msg:
        raise HTTPException(400, "No messages in session")

    asst_preview = (asst_msg.content[:150] + "...") if asst_msg else ""
    prompt = (
        f'用户问: "{user_msg.content}"\n'
        f'AI答: "{asst_preview}"\n'
        f"请根据这段对话生成一个简短的中文标题（4-8个字），只输出标题文本。"
    )

    try:
        usage_params = await ai_model_service.get_usage_params(db, "module_title_generation")
        config = usage_params.config
        if not config:
            raise HTTPException(500, "No AI config for title generation")

        import httpx
        headers = {"Authorization": f"Bearer {config.api_key}", "Content-Type": "application/json"}
        payload = {
            "model": config.model_name,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 30,
            "temperature": 0.3,
        }
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(f"{config.api_url}/chat/completions", json=payload, headers=headers)
            resp.raise_for_status()
            title = resp.json()["choices"][0]["message"]["content"].strip().strip('"\'')

        session.title = title[:200]
        await db.flush()
        await db.refresh(session)
    except Exception as e:
        logger.warning(f"Title generation failed: {e}")
        # Not fatal – keep existing title

    return await _session_with_count(db, session)
