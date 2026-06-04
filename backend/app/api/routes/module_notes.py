"""Module notes API routes"""
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.db.session import get_db
from app.models.module_note import ModuleNote
from app.schemas.module_note import (
    ModuleNoteCreate,
    ModuleNoteUpdate,
    ModuleNoteResponse,
    ModuleNotesListResponse,
)
from app.services.ai_service import AIService
from app.core.security import require_auth

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/modules", tags=["module-notes"])


@router.get("/{module_id}/notes", response_model=ModuleNotesListResponse)
async def get_notes(
    module_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Get all notes for a module"""
    user_id = current_user["user_id"]
    result = await db.execute(
        select(ModuleNote)
        .where(ModuleNote.module_id == module_id)
        .where(ModuleNote.user_id == user_id)
        .order_by(ModuleNote.created_at.desc())
    )
    notes = result.scalars().all()
    return ModuleNotesListResponse(notes=notes, total=len(notes))


@router.post("/{module_id}/notes", response_model=ModuleNoteResponse)
async def create_note(
    module_id: str,
    data: ModuleNoteCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Create a new note with AI-generated title"""
    user_id = current_user["user_id"]
    content = data.content.strip()

    # AI generate title (best-effort, don't block save on failure)
    try:
        from app.api.routes.ai_settings import _get_usage_model_type, get_model_config
        model_type = await _get_usage_model_type(db, "note_title_generation")
        config = await get_model_config(db, model_type)

        messages = [
            {"role": "user", "content": f"请为以下笔记内容生成一个简短的标题（10字以内），只返回标题文本，不要加任何标点或前缀：\n{content[:500]}"}
        ]
        title = await AIService.generate_completion(
            api_url=config.api_url,
            api_key=config.api_key,
            model=config.model_name,
            messages=messages,
            temperature=0.3,
            max_tokens=100,
        )
        title = title.strip().strip("\"'""''#")
        if title:
            content = f"# {title}\n\n{content}"
    except Exception as e:
        logger.warning(f"AI title generation failed, saving without title: {e}")

    note = ModuleNote(
        module_id=module_id,
        user_id=user_id,
        content=content,
    )
    db.add(note)
    await db.commit()
    await db.refresh(note)
    return note


@router.put("/{module_id}/notes/{note_id}", response_model=ModuleNoteResponse)
async def update_note(
    module_id: str,
    note_id: int,
    data: ModuleNoteUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Update an existing note (content and/or collapsed state)"""
    user_id = current_user["user_id"]
    result = await db.execute(
        select(ModuleNote)
        .where(ModuleNote.id == note_id)
        .where(ModuleNote.module_id == module_id)
        .where(ModuleNote.user_id == user_id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    # Update only provided fields
    if data.content is not None:
        note.content = data.content
    if data.is_collapsed is not None:
        note.is_collapsed = data.is_collapsed

    await db.commit()
    await db.refresh(note)
    return note


@router.delete("/{module_id}/notes/{note_id}")
async def delete_note(
    module_id: str,
    note_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Delete a note"""
    user_id = current_user["user_id"]
    result = await db.execute(
        select(ModuleNote)
        .where(ModuleNote.id == note_id)
        .where(ModuleNote.module_id == module_id)
        .where(ModuleNote.user_id == user_id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    await db.delete(note)
    await db.commit()
    return {"success": True, "message": "Note deleted"}
