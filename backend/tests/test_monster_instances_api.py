"""Regression tests for GET /api/monster-instances/campaign/{id}.

Reproduces the intermittent HTTP 500 (ResponseValidationError / sqlalchemy
MissingGreenlet on `updated_at`) that 3 QA waves hit right after the QA seed
inserts monster instances.

Root cause: the handler lazily normalizes monster payloads and commits. That
UPDATE bumps `updated_at` via `onupdate=func.now()` (a server-generated value),
which the flush leaves *expired* even with `expire_on_commit=False`. Without an
explicit reload, response-model serialization lazy-loads `updated_at` outside the
async greenlet -> MissingGreenlet -> 500. The second call (data already
normalized -> no UPDATE) succeeds, which is why it looked intermittent.
"""
import pytest
from httpx import AsyncClient

from app.models.campaign import Campaign
from app.models.monster_instance import MonsterInstance


@pytest.mark.asyncio
async def test_get_campaign_monsters_first_call_after_seed_returns_200(
    client: AsyncClient, db_session, test_campaign: Campaign
):
    # Mirror the QA seed: insert a monster with an UN-normalized payload. The
    # column default makes currency={}, which the GET handler normalizes to
    # {cp:0,...} on first read -> triggers an UPDATE (and the updated_at bump).
    monster = MonsterInstance(
        campaign_id=test_campaign.id,
        monster_id="qa_goblin",
        name="qa_goblin",
        current_hp=7,
        currency={},
    )
    db_session.add(monster)
    await db_session.commit()

    # The FIRST call, immediately after the commit, must return 200 — not a
    # MissingGreenlet 500 from lazy-loading `updated_at` during serialization.
    resp = await client.get(f"/api/monster-instances/campaign/{test_campaign.id}")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    row = next((m for m in body if m["id"] == monster.id), None)
    assert row is not None
    # The normalization UPDATE bumped updated_at; it must come back as a real
    # (non-null) timestamp, proving the value was reloaded in the async context
    # rather than lazy-loaded at encode time (which would 500) or silenced to null.
    assert row["updated_at"] is not None


@pytest.mark.asyncio
async def test_get_controlled_monsters_first_call_after_seed_returns_200(
    client: AsyncClient, db_session, test_campaign: Campaign, test_dm
):
    # Same MissingGreenlet trap on the sibling by-controller endpoint, which runs
    # the identical normalize-then-commit path before serialization.
    from app.models.character import Character

    owner = Character(
        user_id=str(test_dm.id), name="Owner", race_id="human", class_id="wizard"
    )
    db_session.add(owner)
    await db_session.flush()

    monster = MonsterInstance(
        campaign_id=test_campaign.id,
        monster_id="qa_familiar",
        name="qa_familiar",
        controller_character_id=owner.id,
        control_type="familiar",
        currency={},
    )
    db_session.add(monster)
    await db_session.commit()

    resp = await client.get(
        f"/api/monster-instances/by-controller/{owner.id}",
        params={"campaign_id": test_campaign.id},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert any(m["id"] == monster.id for m in body)
