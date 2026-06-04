"""Character draft CRUD — one draft per user for the creation wizard."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_db
from app.core.security import require_auth
from app.models.character_draft import CharacterDraft

router = APIRouter(prefix="/api/character-drafts", tags=["character-drafts"])


class DraftUpsertRequest(BaseModel):
    current_step: int = 1
    wizard_state: dict


class DraftResponse(BaseModel):
    id: int
    user_id: str
    current_step: int
    wizard_state: dict

    class Config:
        from_attributes = True


@router.get("", response_model=DraftResponse | None)
async def get_draft(
    auth: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Return the current user's draft, or null if none exists."""
    user_id = auth["user_id"]
    result = await db.execute(
        select(CharacterDraft).where(CharacterDraft.user_id == user_id)
    )
    draft = result.scalar_one_or_none()
    if not draft:
        return None
    return draft


@router.put("", response_model=DraftResponse)
async def upsert_draft(
    body: DraftUpsertRequest,
    auth: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Create or update the current user's draft (upsert)."""
    user_id = auth["user_id"]
    result = await db.execute(
        select(CharacterDraft).where(CharacterDraft.user_id == user_id)
    )
    draft = result.scalar_one_or_none()

    if draft:
        draft.current_step = body.current_step
        draft.wizard_state = body.wizard_state
    else:
        draft = CharacterDraft(
            user_id=user_id,
            current_step=body.current_step,
            wizard_state=body.wizard_state,
        )
        db.add(draft)

    await db.commit()
    await db.refresh(draft)
    return draft


@router.delete("", status_code=204)
async def delete_draft(
    auth: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Delete the current user's draft after character creation completes."""
    user_id = auth["user_id"]
    result = await db.execute(
        select(CharacterDraft).where(CharacterDraft.user_id == user_id)
    )
    draft = result.scalar_one_or_none()
    if draft:
        await db.delete(draft)
        await db.commit()
