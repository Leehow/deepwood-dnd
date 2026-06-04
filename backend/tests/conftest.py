"""
Pytest fixtures for backend testing.
Provides database, client, and authentication fixtures.
"""

import asyncio
import os
import sys
from pathlib import Path
from typing import AsyncGenerator, Generator
from urllib.parse import urlparse
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.pool import NullPool

os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.main import app
from app.core.config import settings
from app.db.session import Base, get_db
from app.core.security import create_access_token
from app.models.user import User
from app.models.campaign import Campaign


def _resolve_test_database_url() -> str | None:
    """Resolve a safe database URL for destructive DB-backed tests."""
    explicit_test_url = os.getenv("TEST_DATABASE_URL")
    if explicit_test_url:
        return explicit_test_url

    database_url = getattr(settings, "DATABASE_URL", None)
    if not database_url:
        return None

    db_name = urlparse(database_url).path.lstrip("/").lower()
    if db_name.endswith("_test") or db_name.startswith("test_"):
        return database_url

    return None


TEST_DATABASE_URL = _resolve_test_database_url()


@pytest.fixture(scope="session")
def event_loop() -> Generator:
    """Create event loop for async tests."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="function")
async def test_engine():
    """Create test database engine."""
    if not TEST_DATABASE_URL:
        pytest.skip(
            "No safe test database configured; set TEST_DATABASE_URL or use a "
            "DATABASE_URL that points to a *_test database"
        )

    engine = create_async_engine(
        TEST_DATABASE_URL,
        poolclass=NullPool,
        echo=False,
    )

    # Phase 1 — connection probe. A genuinely unavailable test DB (not running,
    # missing database, bad credentials) should SKIP these tests gracefully.
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:
        await engine.dispose()
        pytest.skip(f"Test database is unavailable: {exc}")

    # Phase 2 — schema build. The DB is reachable, so a create_all failure here is
    # a real schema/model error (e.g. a duplicate index), not an unavailable DB.
    # Surface it as a hard error: masking it as a skip is what previously hid the
    # module_embeddings duplicate-index bug and let every DB-backed test silently SKIP.
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    except Exception as exc:
        await engine.dispose()
        raise RuntimeError(
            "Test schema build failed (Base.metadata.create_all). The test database "
            "is reachable, so this is a real schema/model error, not an unavailable "
            f"database: {exc}"
        ) from exc

    yield engine

    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
    except SQLAlchemyError:
        pass

    await engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def db_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    """Create database session for tests."""
    async_session = async_sessionmaker(
        test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    async with async_session() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture(scope="function")
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """Create test client with database override."""

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def test_user(db_session: AsyncSession) -> User:
    """Create a test user."""
    user = User(
        id="test-user",
        username="testuser",
        email="test@example.com",
        role="regular",
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def test_dm(db_session: AsyncSession) -> User:
    """Create a test DM user."""
    user = User(
        id="test-dm",
        username="testdm",
        email="dm@example.com",
        role="admin",
        is_active=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def auth_headers(test_user: User) -> dict:
    """Get authentication headers for test user."""
    token = create_access_token(
        user_id=str(test_user.id),
        email=test_user.email or "",
        role=test_user.role,
        display_name=test_user.username,
    )
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def dm_auth_headers(test_dm: User) -> dict:
    """Get authentication headers for DM user."""
    token = create_access_token(
        user_id=str(test_dm.id),
        email=test_dm.email or "",
        role=test_dm.role,
        display_name=test_dm.username,
    )
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def test_campaign(db_session: AsyncSession, test_dm: User) -> Campaign:
    """Create a test campaign."""
    campaign = Campaign(
        name="Test Campaign",
        description="A test campaign",
        dm_user_id=test_dm.id,
        meta={"setting": "Sundered Realms"},
    )
    db_session.add(campaign)
    await db_session.commit()
    await db_session.refresh(campaign)
    return campaign


# Mock fixtures for external services

@pytest.fixture
def mock_ai_service():
    """Mock AI service for tests."""
    mock = AsyncMock()
    mock.generate_response.return_value = "Test AI response"
    mock.analyze_command.return_value = {"type": "attack", "target": "goblin"}
    return mock


@pytest.fixture
def mock_redis():
    """Mock Redis client for tests."""
    mock = MagicMock()
    mock.get.return_value = None
    mock.set.return_value = True
    mock.delete.return_value = True
    return mock


@pytest.fixture
def mock_websocket():
    """Mock WebSocket for tests."""
    mock = AsyncMock()
    mock.accept = AsyncMock()
    mock.send_json = AsyncMock()
    mock.receive_json = AsyncMock(return_value={"type": "ping"})
    mock.close = AsyncMock()
    return mock


# Test data factories

@pytest.fixture
def character_data():
    """Factory for character test data.

    Emits a valid ``CharacterCreate`` body for ``POST /api/characters``
    (see ``app/schemas/character_sheet.py``). That schema requires
    ``user_id``/``raceId``/``classId`` plus nested
    ``abilityScores``/``appearance``/``personality`` objects, so a flat
    payload is rejected with 422. We send the nested objects empty so every
    field falls back to its schema default (abilities = 10,
    appearance/personality = ""). snake_case keys work because
    ``CharacterCreate`` sets ``populate_by_name=True``.

    ``user_id`` defaults to ``"test-user"`` to match the ``auth_headers``
    fixture, so ``list_characters`` (which scopes by the authenticated user,
    not the ``campaign_id`` query param) resolves ownership. Extra kwargs
    (e.g. ``campaign_id``, ``max_hp``) are ignored by the schema and harmless.
    """
    def _create(
        name: str = "Test Character",
        race_id: str = "human",
        class_id: str = "fighter",
        level: int = 1,
        user_id: str = "test-user",
        **kwargs
    ):
        body = {
            "user_id": user_id,
            "name": name,
            "race_id": race_id,
            "class_id": class_id,
            "level": level,
            "ability_scores": {},
            "appearance": {},
            "personality": {},
        }
        body.update(kwargs)
        return body
    return _create


@pytest.fixture
def monster_data():
    """Factory for monster test data."""
    def _create(
        name: str = "Goblin",
        size: str = "Small",
        monster_type: str = "Humanoid",
        **kwargs
    ):
        return {
            "name": name,
            "size": size,
            "type": monster_type,
            "armor_class": kwargs.get("armor_class", 15),
            "hit_points": kwargs.get("hit_points", 7),
            "speed": kwargs.get("speed", "30 ft."),
            "challenge_rating": kwargs.get("challenge_rating", "1/4"),
            **kwargs
        }
    return _create


# Utility fixtures

@pytest.fixture
def temp_file(tmp_path):
    """Create a temporary file for testing."""
    def _create(content: str = "", filename: str = "test.txt"):
        file_path = tmp_path / filename
        file_path.write_text(content)
        return file_path
    return _create


@pytest.fixture
def sample_pdf(tmp_path):
    """Create a sample PDF file for testing."""
    # Create minimal PDF
    pdf_content = b"""%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
trailer << /Size 4 /Root 1 0 R >>
startxref
196
%%EOF"""

    file_path = tmp_path / "test.pdf"
    file_path.write_bytes(pdf_content)
    return file_path
