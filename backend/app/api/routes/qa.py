"""QA-only endpoints for the spell-runtime browser QA harness.

Gated behind settings.QA_MODE: every route 404s when the flag is off, so
production behavior is unaffected. Callers must be DM of the target campaign.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import require_auth
from app.db.session import get_db
from app.services.qa import arena_service, forced_roll
from app.utils.permission_checks import require_campaign_dm

router = APIRouter(prefix="/qa", tags=["qa"])


def require_qa_mode() -> None:
    if not settings.QA_MODE:
        raise HTTPException(status_code=404, detail="Not Found")


async def _assert_dm(db: AsyncSession, campaign_id: int, current_user: dict) -> None:
    await require_campaign_dm(campaign_id, current_user, db)


class ForcedRollRequest(BaseModel):
    rolls: list[int]


class ResetRequest(BaseModel):
    campaign_id: int
    spell_id: str | None = None


class StartCombatRequest(BaseModel):
    campaign_id: int
    order: list[int]


class NextTurnRequest(BaseModel):
    campaign_id: int


@router.post("/forced-roll")
async def queue_forced_rolls(
    payload: ForcedRollRequest,
    _: None = Depends(require_qa_mode),
    current_user: dict = Depends(require_auth),
):
    forced_roll.push_forced_rolls(payload.rolls)
    return {"queued": len(payload.rolls), "queue_size": forced_roll.queue_size()}


@router.post("/seed")
async def seed(
    _: None = Depends(require_qa_mode),
    current_user: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await arena_service.seed_arena(db, dm_user_id=str(current_user["user_id"]))


@router.post("/reset")
async def reset(
    payload: ResetRequest,
    _: None = Depends(require_qa_mode),
    current_user: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    await _assert_dm(db, payload.campaign_id, current_user)
    # Clear any leftover forced rolls so each spell starts from a clean dice
    # queue (otherwise a stale roll contaminates the next cast's attack/save).
    forced_roll.clear_forced_rolls()
    return await arena_service.reset_arena(db, payload.campaign_id, payload.spell_id)


@router.get("/snapshot")
async def snapshot(
    campaign_id: int,
    _: None = Depends(require_qa_mode),
    current_user: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    await _assert_dm(db, campaign_id, current_user)
    return await arena_service.snapshot_arena(db, campaign_id)


@router.post("/start-combat")
async def start_combat(
    payload: StartCombatRequest,
    _: None = Depends(require_qa_mode),
    current_user: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    await _assert_dm(db, payload.campaign_id, current_user)
    return await arena_service.start_combat(
        db, payload.campaign_id, payload.order, str(current_user["user_id"]))


@router.post("/next-turn")
async def next_turn(
    payload: NextTurnRequest,
    _: None = Depends(require_qa_mode),
    current_user: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    await _assert_dm(db, payload.campaign_id, current_user)
    return await arena_service.next_turn(db, payload.campaign_id)
