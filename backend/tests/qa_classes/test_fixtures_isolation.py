"""Proves the harness fixtures isolate per-test state: each test starts from a clean
DB regardless of run order. If the autouse cleanup did not run between tests, the
second test to execute would observe count == 2."""
import pytest
from sqlalchemy import select, func
from app.models.character import Character

pytestmark = [pytest.mark.asyncio]


async def _insert_probe_and_count(qa_session, qa_user) -> int:
    qa_session.add(Character(
        user_id=qa_user.id, name="Isolation Probe", race_id="human",
        class_id="fighter", level=1, ability_scores={"strength": 10},
        appearance={}, personality={}, selected_skills=[], expertise_skills=[],
        selected_cantrips=[], selected_spells=[], prepared_spells=[], equipment=[],
    ))
    await qa_session.commit()
    return await qa_session.scalar(
        select(func.count()).select_from(Character).where(Character.user_id == qa_user.id)
    )


async def test_isolation_first(qa_session, qa_user):
    assert await _insert_probe_and_count(qa_session, qa_user) == 1


async def test_isolation_second(qa_session, qa_user):
    # Order-independent proof: this sees 1 (not 2) only because the autouse cleanup
    # deleted the other test's row first. A broken cleanup would surface as count == 2.
    assert await _insert_probe_and_count(qa_session, qa_user) == 1
