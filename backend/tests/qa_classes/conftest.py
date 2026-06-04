"""Session-scoped DB + client fixtures for the class/level-up QA harness.

Distinct from the global conftest fixtures (`client`, `auth_headers`), which use a
per-test engine (create_all/drop_all every test). With hundreds of option probes that
would be far too slow, so this harness creates the schema ONCE per session and cleans
up the QA user's characters after each test (characters are user-owned and do not
cascade — explicit cleanup is required regardless).
"""
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.pool import NullPool

from app.main import app
from app.db.session import Base, get_db
from app.core.security import create_access_token
from app.models.user import User
from app.models.character import Character
from tests.conftest import TEST_DATABASE_URL


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def qa_engine():
    if not TEST_DATABASE_URL:
        pytest.skip("No *_test database configured; set TEST_DATABASE_URL")
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def qa_session(qa_engine, qa_user_id) -> AsyncSession:
    maker = async_sessionmaker(qa_engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as session:
        yield session
        # Per-test isolation: delete the QA user's characters created during the test.
        # This lives in the session teardown (not an autouse fixture) so pure-logic
        # tests that never request a DB session stay decoupled from TEST_DATABASE_URL.
        await session.execute(delete(Character).where(Character.user_id == qa_user_id))
        await session.commit()


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def qa_user_id(qa_engine) -> str:
    maker = async_sessionmaker(qa_engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as session:
        existing = await session.get(User, "qa-classes-user")
        if existing is None:
            session.add(User(
                id="qa-classes-user", username="qaclasses",
                email="qaclasses@example.com", role="admin", is_active=True,
            ))
            await session.commit()
    return "qa-classes-user"


@pytest_asyncio.fixture
async def qa_user(qa_session, qa_user_id) -> User:
    return await qa_session.get(User, qa_user_id)


@pytest.fixture
def qa_headers(qa_user_id) -> dict:
    token = create_access_token(
        user_id=qa_user_id, email="qaclasses@example.com",
        role="admin", display_name="qaclasses",
    )
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def qa_client(qa_session) -> AsyncClient:
    async def override_get_db():
        yield qa_session
    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def _neutralize_post_creation(monkeypatch):
    """Stop the create endpoint's fire-and-forget post-creation task.

    `create_character` does `asyncio.create_task(process_character_post_creation(
    ..., db_url=str(settings.DATABASE_URL)))`, which opens its OWN asyncpg connection
    to settings.DATABASE_URL — the dev DB, NOT the test DB our get_db override uses.
    That task races test teardown ("Task was destroyed but it is pending") and, at the
    scale of hundreds of probes, would hammer the dev DB and cause flakiness. Replacing
    it with a no-op keeps the harness hermetic to the test DB and spawns no dangling
    task. `monkeypatch.setattr` raises if the symbol is ever renamed, so this can't
    silently rot (the create endpoint re-imports it from the source module each call).
    """
    async def _noop(*args, **kwargs):
        return None
    monkeypatch.setattr(
        "app.services.character_post_creation_service.process_character_post_creation",
        _noop,
    )
