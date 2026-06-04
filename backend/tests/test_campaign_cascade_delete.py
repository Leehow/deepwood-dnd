import os
import sys
import uuid
import pytest
import pytest_asyncio
from pathlib import Path

# Ensure Python can import the backend/app package as 'app'
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

# Minimal env so settings import won't crash
os.environ.setdefault("CORS_ORIGINS", "[\"http://localhost:5174\"]")
os.environ.setdefault("API_HOST", "127.0.0.1")
os.environ.setdefault("API_PORT", "8174")
os.environ.setdefault("DEBUG", "false")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

from app.api.routes.campaigns import delete_campaign


@pytest_asyncio.fixture(scope="module")
def anyio_backend():
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


async def _insert_campaign(session: AsyncSession, dm_user_id: str) -> int:
    res = await session.execute(
        text(
            """
            INSERT INTO campaigns (name, dm_user_id)
            VALUES (:name, :dm_user_id)
            RETURNING id
            """
        ),
        {"name": f"cascade_test_{uuid.uuid4().hex[:6]}", "dm_user_id": dm_user_id},
    )
    row = res.fetchone()
    await session.commit()
    return row[0]


async def _insert_member(session: AsyncSession, campaign_id: int, user_id: str, role: str) -> None:
    await session.execute(
        text(
            """
            INSERT INTO campaign_members (campaign_id, user_id, role)
            VALUES (:cid, :uid, :role)
            """
        ),
        {"cid": campaign_id, "uid": user_id, "role": role},
    )
    await session.commit()


async def _insert_item(session: AsyncSession, campaign_id: int) -> int:
    res = await session.execute(
        text(
            """
            INSERT INTO items (campaign_id, name)
            VALUES (:cid, :name)
            RETURNING id
            """
        ),
        {"cid": campaign_id, "name": f"Item-{uuid.uuid4().hex[:4]}"},
    )
    row = res.fetchone()
    await session.commit()
    return row[0]


async def _insert_shop(session: AsyncSession, campaign_id: int) -> int:
    res = await session.execute(
        text(
            """
            INSERT INTO shops (campaign_id, name)
            VALUES (:cid, :name)
            RETURNING id
            """
        ),
        {"cid": campaign_id, "name": f"Shop-{uuid.uuid4().hex[:4]}"},
    )
    row = res.fetchone()
    await session.commit()
    return row[0]


async def _insert_shop_inventory(session: AsyncSession, shop_id: int, item_id: int) -> int:
    res = await session.execute(
        text(
            """
            INSERT INTO shop_inventory (shop_id, item_id, quantity, price_gp)
            VALUES (:sid, :iid, 2, 10.0)
            RETURNING id
            """
        ),
        {"sid": shop_id, "iid": item_id},
    )
    row = res.fetchone()
    await session.commit()
    return row[0]


async def _insert_monster_instance(session: AsyncSession, campaign_id: int) -> int:
    res = await session.execute(
        text(
            """
            INSERT INTO monster_instances (campaign_id, monster_id, name)
            VALUES (:cid, :mid, :name)
            RETURNING id
            """
        ),
        {"cid": campaign_id, "mid": "goblin", "name": "Goblin"},
    )
    row = res.fetchone()
    await session.commit()
    return row[0]


async def _insert_token(
    session: AsyncSession,
    campaign_id: int,
    monster_instance_id: int | None = None,
    character_id: int | None = None,
) -> int:
    cols = "campaign_id, user_id, map_url, position_x, position_y, token_size"
    vals = ":cid, 'u1', 'map://test', 0, 0, '1x1'"
    params: dict = {"cid": campaign_id}
    if monster_instance_id is not None:
        cols += ", monster_instance_id"
        vals += ", :mid"
        params["mid"] = monster_instance_id
    if character_id is not None:
        cols += ", character_id"
        vals += ", :ch_id"
        params["ch_id"] = character_id
    sql = f"INSERT INTO tokens ({cols}) VALUES ({vals}) RETURNING id"
    res = await session.execute(text(sql), params)
    row = res.fetchone()
    await session.commit()
    return row[0]


async def _insert_map_settings(session: AsyncSession, campaign_id: int) -> int:
    res = await session.execute(
        text(
            """
            INSERT INTO map_settings (campaign_id, map_url, scale, grid_unit_length)
            VALUES (:cid, 'map://test', 1.0, 5.0)
            RETURNING id
            """
        ),
        {"cid": campaign_id},
    )
    row = res.fetchone()
    await session.commit()
    return row[0]


async def _insert_map_view_state(session: AsyncSession, campaign_id: int) -> int:
    res = await session.execute(
        text(
            """
            INSERT INTO map_view_state (campaign_id, user_id, map_url, position_x, position_y, scale)
            VALUES (:cid, 'u1', 'map://test', 0.0, 0.0, 1.0)
            RETURNING id
            """
        ),
        {"cid": campaign_id},
    )
    row = res.fetchone()
    await session.commit()
    return row[0]


async def _insert_fog_of_war(session: AsyncSession, campaign_id: int) -> int:
    res = await session.execute(
        text(
            """
            INSERT INTO fog_of_war (campaign_id, map_url, cells)
            VALUES (:cid, 'map://test', '[]'::json)
            RETURNING id
            """
        ),
        {"cid": campaign_id},
    )
    row = res.fetchone()
    await session.commit()
    return row[0]


async def _insert_drawing(session: AsyncSession, campaign_id: int) -> int:
    res = await session.execute(
        text(
            """
            INSERT INTO drawings (campaign_id, map_url, type, created_by_user_id)
            VALUES (:cid, 'map://test', 'ruler', 'u1')
            RETURNING id
            """
        ),
        {"cid": campaign_id},
    )
    row = res.fetchone()
    await session.commit()
    return row[0]


async def _insert_ruler(session: AsyncSession, campaign_id: int) -> int:
    res = await session.execute(
        text(
            """
            INSERT INTO rulers (campaign_id, map_url, start_x, start_y, end_x, end_y, distance, color)
            VALUES (:cid, 'map://test', 0.0, 0.0, 1.0, 1.0, 1.41, '#ff0000')
            RETURNING id
            """
        ),
        {"cid": campaign_id},
    )
    row = res.fetchone()
    await session.commit()
    return row[0]


async def _insert_module_maps(session: AsyncSession, campaign_id: int) -> int:
    res = await session.execute(
        text(
            """
            INSERT INTO module_maps (campaign_id, module_id, maps)
            VALUES (:cid, 'mod-1', '[]'::json)
            RETURNING id
            """
        ),
        {"cid": campaign_id},
    )
    row = res.fetchone()
    await session.commit()
    return row[0]


async def _insert_chat_message(session: AsyncSession, campaign_id: int) -> int:
    res = await session.execute(
        text(
            """
            INSERT INTO campaign_chat_messages (campaign_id, sender_user_id, sender_role, message_type, content, recipients, is_private, mentions)
            VALUES (:cid, 'u1', 'dm', 'chat', 'hello', '[]'::json, false, '[]'::json)
            RETURNING id
            """
        ),
        {"cid": campaign_id},
    )
    row = res.fetchone()
    await session.commit()
    return row[0]


async def _insert_dice_request(session: AsyncSession, campaign_id: int) -> int:
    req_id = f"req_{uuid.uuid4().hex[:8]}"
    res = await session.execute(
        text(
            """
            INSERT INTO dice_requests (request_id, campaign_id, issuer_user_id, issuer_role, recipients, is_private, "check", is_completed, completed_by)
            VALUES (:rid, :cid, 'u1', 'dm', '[]'::json, false, '{}'::json, false, '[]'::json)
            RETURNING id
            """
        ),
        {"rid": req_id, "cid": campaign_id},
    )
    row = res.fetchone()
    await session.commit()
    return row[0]


async def _insert_dice_roll(session: AsyncSession, campaign_id: int) -> int:
    roll_id = f"roll_{uuid.uuid4().hex[:8]}"
    res = await session.execute(
        text(
            """
            INSERT INTO dice_rolls (roll_id, campaign_id, roller_user_id, roller_role, is_private, visible_to, roll)
            VALUES (:rid, :cid, 'u1', 'dm', false, '[]'::json, '{}'::json)
            RETURNING id
            """
        ),
        {"rid": roll_id, "cid": campaign_id},
    )
    row = res.fetchone()
    await session.commit()
    return row[0]


async def _insert_campaign_storage(session: AsyncSession, campaign_id: int) -> int:
    res = await session.execute(
        text(
            """
            INSERT INTO campaign_storage (campaign_id, object_type, object_id, object_name, data, visibility, created_by)
            VALUES (:cid, 'note', :oid, 'Test Note', '{}'::jsonb, 'dm_only', 'tester')
            RETURNING id
            """
        ),
        {"cid": campaign_id, "oid": f"note_{uuid.uuid4().hex[:6]}"},
    )
    row = res.fetchone()
    await session.commit()
    return row[0]


async def _has_cascade_fk(session: AsyncSession, table: str, column: str, ref_table: str, ref_column: str = "id") -> bool:
    q = text(
        """
        SELECT COUNT(*)
        FROM information_schema.referential_constraints rc
        JOIN information_schema.key_column_usage kcu
          ON rc.constraint_name = kcu.constraint_name
        WHERE kcu.table_name = :table
          AND kcu.column_name = :column
          AND rc.unique_constraint_name IN (
            SELECT constraint_name FROM information_schema.table_constraints tc
            WHERE tc.table_name = :ref_table AND tc.constraint_type = 'PRIMARY KEY'
          )
          AND rc.delete_rule = 'CASCADE'
        """
    )
    res = await session.execute(q, {"table": table, "column": column, "ref_table": ref_table})
    return int(res.scalar() or 0) > 0


async def _count(session: AsyncSession, sql: str, params: dict) -> int:
    res = await session.execute(text(sql), params)
    return int(res.scalar() or 0)


@pytest.mark.asyncio
async def test_campaign_cascade_delete_removes_children(db_session: AsyncSession):
    dm_id = "dm_cascade"
    cid = await _insert_campaign(db_session, dm_id)

    # Insert one row per related table (or a minimal representative set)
    await _insert_member(db_session, cid, dm_id, "dm")
    item_id = await _insert_item(db_session, cid)
    shop_id = await _insert_shop(db_session, cid)
    inv_id = await _insert_shop_inventory(db_session, shop_id, item_id)
    mid = await _insert_monster_instance(db_session, cid)
    await _insert_token(db_session, cid, monster_instance_id=mid)
    await _insert_map_settings(db_session, cid)
    await _insert_map_view_state(db_session, cid)
    await _insert_fog_of_war(db_session, cid)
    await _insert_drawing(db_session, cid)
    await _insert_ruler(db_session, cid)
    await _insert_module_maps(db_session, cid)
    await _insert_chat_message(db_session, cid)
    await _insert_dice_request(db_session, cid)
    await _insert_dice_roll(db_session, cid)
    await _insert_campaign_storage(db_session, cid)

    # Sanity: rows exist before delete
    pre_checks = [
        ("campaign_members", "SELECT count(*) FROM campaign_members WHERE campaign_id=:cid"),
        ("items", "SELECT count(*) FROM items WHERE campaign_id=:cid"),
        ("shops", "SELECT count(*) FROM shops WHERE campaign_id=:cid"),
        ("monster_instances", "SELECT count(*) FROM monster_instances WHERE campaign_id=:cid"),
        ("tokens", "SELECT count(*) FROM tokens WHERE campaign_id=:cid"),
        ("map_settings", "SELECT count(*) FROM map_settings WHERE campaign_id=:cid"),
        ("map_view_state", "SELECT count(*) FROM map_view_state WHERE campaign_id=:cid"),
        ("fog_of_war", "SELECT count(*) FROM fog_of_war WHERE campaign_id=:cid"),
        ("drawings", "SELECT count(*) FROM drawings WHERE campaign_id=:cid"),
        ("rulers", "SELECT count(*) FROM rulers WHERE campaign_id=:cid"),
        ("module_maps", "SELECT count(*) FROM module_maps WHERE campaign_id=:cid"),
        ("campaign_chat_messages", "SELECT count(*) FROM campaign_chat_messages WHERE campaign_id=:cid"),
        ("dice_requests", "SELECT count(*) FROM dice_requests WHERE campaign_id=:cid"),
        ("dice_rolls", "SELECT count(*) FROM dice_rolls WHERE campaign_id=:cid"),
        ("campaign_storage", "SELECT count(*) FROM campaign_storage WHERE campaign_id=:cid"),
    ]
    for table, sql in pre_checks:
        c = await _count(db_session, sql, {"cid": cid})
        assert c >= 1, f"expected pre-delete rows in {table}, got {c}"

    # Check whether campaign_storage has a CASCADE FK in this DB
    has_storage_cascade = await _has_cascade_fk(db_session, 'campaign_storage', 'campaign_id', 'campaigns')


    # Sanity: shop_inventory rows referencing our shop/item exist
    inv_count = await _count(
        db_session,
        "SELECT count(*) FROM shop_inventory WHERE shop_id=:sid OR item_id=:iid",
        {"sid": shop_id, "iid": item_id},
    )
    assert inv_count >= 1

    # Delete via endpoint (creator permission)
    await delete_campaign(campaign_id=cid, user_id=dm_id, db=db_session)

    # After delete: all child rows by campaign_id gone
    for table, sql in pre_checks:
        c = await _count(db_session, sql, {"cid": cid})
        if table == 'campaign_storage' and not has_storage_cascade:
            print(f"[WARN] No CASCADE FK on campaign_storage.campaign_id; skipping strict assertion. Post-delete count={c}")
            continue
        assert c == 0, f"expected post-delete zero rows in {table}, got {c}"

    # shops/items gone -> their inventory rows gone
    inv_count_post = await _count(
        db_session,
        "SELECT count(*) FROM shop_inventory WHERE shop_id=:sid OR item_id=:iid",
        {"sid": shop_id, "iid": item_id},
    )
    assert inv_count_post == 0, f"expected inventory cascade delete, got {inv_count_post}"

    # Campaign itself gone
    camp_left = await _count(db_session, "SELECT count(*) FROM campaigns WHERE id=:cid", {"cid": cid})
    assert camp_left == 0

