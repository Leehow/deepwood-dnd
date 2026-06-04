import os
import sys
import uuid
import pytest
import pytest_asyncio
import asyncio
from pathlib import Path

from typing import Optional

# Ensure Python can import the backend/app package as 'app'
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

# Ensure app settings won't crash when importing models/routes
os.environ["CORS_ORIGINS"] = "[\"http://localhost:5174\"]"
os.environ.setdefault("API_HOST", "127.0.0.1")
os.environ.setdefault("API_PORT", "8174")
os.environ.setdefault("DEBUG", "false")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

from fastapi import HTTPException

# Import endpoint functions and schemas
from app.api.routes.campaign_storage import (
    list_storage_acl,
    add_storage_acl,
    remove_storage_acl,
)
from app.schemas.campaign_storage import ACLModifyRequest

from app.api.routes.campaign_storage import (
    list_storage_objects,
    get_storage_object,
    update_storage_object,
)
from app.schemas.campaign_storage import CampaignStorageUpdate
from app.services.websocket_manager import manager


@pytest_asyncio.fixture(scope="module")
def anyio_backend():
    # Enable pytest-asyncio/anyio compatibility if present
    return "asyncio"


@pytest_asyncio.fixture()
async def db_engine():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        pytest.skip("DATABASE_URL not set; skipping DB-backed tests")
    engine = create_async_engine(database_url, echo=False, future=True)
    try:
        yield engine
    finally:
        await engine.dispose()


@pytest_asyncio.fixture()
async def db_session(db_engine):
    async_session_maker = sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)
    async with async_session_maker() as session:
        yield session
        # no automatic cleanup; tests will cleanup explicitly


async def _insert_campaign(session: AsyncSession, dm_user_id: str) -> int:
    res = await session.execute(
        text(
            """
            INSERT INTO campaigns (name, dm_user_id)
            VALUES (:name, :dm_user_id)
            RETURNING id
            """
        ),
        {"name": f"test_campaign_{uuid.uuid4().hex[:8]}", "dm_user_id": dm_user_id},
    )
    row = res.fetchone()
    await session.commit()
    return row[0]


async def _insert_storage(
    session: AsyncSession,
    *,
    campaign_id: int,
    object_type: str,
    object_id: str,
    object_name: str,
    visibility: str,
) -> int:
    res = await session.execute(
        text(
            """
            INSERT INTO campaign_storage (
                campaign_id, object_type, object_id, object_name,
                data, visibility, created_by
            ) VALUES (:cid, :ot, :oid, :on, '{}'::jsonb, :vis, :by)
            RETURNING id
            """
        ),
        {
            "cid": campaign_id,
            "ot": object_type,
            "oid": object_id,
            "on": object_name,
            "vis": visibility,
            "by": "tester",
        },
    )
    row = res.fetchone()
    await session.commit()
    return row[0]


async def _insert_acl(session: AsyncSession, *, storage_id: int, user_id: str) -> None:
    await session.execute(
        text(
            """
            INSERT INTO campaign_storage_acl (storage_id, user_id)
            VALUES (:sid, :uid)
            ON CONFLICT DO NOTHING
            """
        ),
        {"sid": storage_id, "uid": user_id},
    )
    await session.commit()


async def _cleanup(session: AsyncSession, campaign_id: int):
    # Ensure session is not in a failed/rolled-back state
    try:
        await session.rollback()
    except Exception:
        pass

    # Delete storage ACLs for this campaign's storage rows, then storage, then campaign
    await session.execute(
        text(
            """
            DELETE FROM campaign_storage_acl
            WHERE storage_id IN (
                SELECT id FROM campaign_storage WHERE campaign_id = :cid
            )
            """
        ),
        {"cid": campaign_id},
    )
    await session.execute(text("DELETE FROM campaign_storage WHERE campaign_id = :cid"), {"cid": campaign_id})
    await session.execute(text("DELETE FROM campaigns WHERE id = :cid"), {"cid": campaign_id})
    await session.commit()


@pytest.mark.asyncio
async def test_visibility_filters_list_and_get(db_session: AsyncSession):
    dm_id = "dm_123"
    player_id = "player_1"

    cid = await _insert_campaign(db_session, dm_id)

    try:
        obj_type = "npc"
        obj_dm_only = f"npc_{uuid.uuid4().hex[:6]}"
        obj_all = f"npc_{uuid.uuid4().hex[:6]}"
        obj_spec = f"npc_{uuid.uuid4().hex[:6]}"

        sid_dm = await _insert_storage(db_session, campaign_id=cid, object_type=obj_type, object_id=obj_dm_only, object_name="DM Only", visibility="dm_only")
        sid_all = await _insert_storage(db_session, campaign_id=cid, object_type=obj_type, object_id=obj_all, object_name="All Players", visibility="all_players")
        sid_spec = await _insert_storage(db_session, campaign_id=cid, object_type=obj_type, object_id=obj_spec, object_name="Specific Players", visibility="specific_players")

        # Grant ACL to player for specific_players object
        await _insert_acl(db_session, storage_id=sid_spec, user_id=player_id)

        # DM sees all
        dm_list = await list_storage_objects(campaign_id=cid, object_type=obj_type, tags=None, db=db_session, user_id=dm_id)
        assert {o.object_id for o in dm_list} == {obj_dm_only, obj_all, obj_spec}

        # Player sees all_players and specific with ACL
        player_list = await list_storage_objects(campaign_id=cid, object_type=obj_type, tags=None, db=db_session, user_id=player_id)
        assert {o.object_id for o in player_list} == {obj_all, obj_spec}

        # Player forbidden to get dm_only
        with pytest.raises(HTTPException) as ei:
            await get_storage_object(campaign_id=cid, object_type=obj_type, object_id=obj_dm_only, db=db_session, user_id=player_id)
        assert ei.value.status_code == 403

        # Player can get specific_players with ACL
        obj = await get_storage_object(campaign_id=cid, object_type=obj_type, object_id=obj_spec, db=db_session, user_id=player_id)
        assert obj.object_id == obj_spec
    finally:
        await _cleanup(db_session, cid)


@pytest.mark.asyncio
async def test_occ_update_conflict(db_session: AsyncSession, monkeypatch):
    # Monkeypatch broadcast to avoid WS side effects
    async def _noop(*args, **kwargs):
        return None
    monkeypatch.setattr(manager, "broadcast_to_campaign", _noop)

    dm_id = "dm_999"
    cid = await _insert_campaign(db_session, dm_id)

    try:
        obj_type = "item"
        oid = f"item_{uuid.uuid4().hex[:6]}"
        await _insert_storage(db_session, campaign_id=cid, object_type=obj_type, object_id=oid, object_name="Sword", visibility="dm_only")

        # First update with correct version=1
        payload = CampaignStorageUpdate(version=1, updated_by="tester", data={"rarity": "rare"})
        updated = await update_storage_object(campaign_id=cid, object_type=obj_type, object_id=oid, payload=payload, db=db_session)
        assert updated.version == 2
        assert updated.data.get("rarity") == "rare"

        # Second update with stale version=1 should 409
        with pytest.raises(HTTPException) as ei:
            payload2 = CampaignStorageUpdate(version=1, updated_by="tester", data={"rarity": "legendary"})
            await update_storage_object(campaign_id=cid, object_type=obj_type, object_id=oid, payload=payload2, db=db_session)
        assert ei.value.status_code == 409
        detail = ei.value.detail
        assert isinstance(detail, dict) and detail.get("message") == "Version conflict"
        assert detail.get("current_version") == 2
    finally:
        await _cleanup(db_session, cid)





@pytest.mark.asyncio
async def test_acl_management_requires_dm_and_updates_list(db_session: AsyncSession, monkeypatch):
    # Avoid WS side effects
    async def _noop(*args, **kwargs):
        return None
    monkeypatch.setattr(manager, "broadcast_to_campaign", _noop)

    dm_id = "dm_acl"
    player_id = "player_acl_1"
    cid = await _insert_campaign(db_session, dm_id)

    try:
        obj_type = "note"
        oid = f"note_{uuid.uuid4().hex[:6]}"
        await _insert_storage(db_session, campaign_id=cid, object_type=obj_type, object_id=oid, object_name="Secret Note", visibility="specific_players")

        # DM adds ACL
        users = await add_storage_acl(campaign_id=cid, object_type=obj_type, object_id=oid, body=ACLModifyRequest(target_user_id=player_id), user_id=dm_id, db=db_session)
        assert player_id in users

        # DM lists ACL
        users2 = await list_storage_acl(campaign_id=cid, object_type=obj_type, object_id=oid, user_id=dm_id, db=db_session)
        assert users2 == users

        # Non-DM cannot list ACL
        with pytest.raises(HTTPException) as ei:
            await list_storage_acl(campaign_id=cid, object_type=obj_type, object_id=oid, user_id=player_id, db=db_session)
        assert ei.value.status_code == 403

        # DM removes ACL
        users3 = await remove_storage_acl(campaign_id=cid, object_type=obj_type, object_id=oid, target_user_id=player_id, user_id=dm_id, db=db_session)
        assert player_id not in users3
    finally:
        await _cleanup(db_session, cid)


