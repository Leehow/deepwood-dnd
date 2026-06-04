"""Tests for the current authentication API contract."""

from types import SimpleNamespace

from fastapi import FastAPI, HTTPException
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.api.routes.auth import router
from app.core.security import create_access_token
from app.db.session import get_db
from app.models.user import User

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


class FakeScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class FakeAsyncSession:
    def __init__(self):
        self.users_by_id: dict[str, User] = {}
        self.users_by_resterlab_id: dict[str, User] = {}

    async def execute(self, statement):
        criterion = list(statement._where_criteria)[0]
        field_name = getattr(criterion.left, "key", None)
        field_value = getattr(criterion.right, "value", None)

        if field_name == "resterlab_user_id":
            return FakeScalarResult(self.users_by_resterlab_id.get(str(field_value)))
        if field_name == "id":
            return FakeScalarResult(self.users_by_id.get(str(field_value)))

        raise AssertionError(f"Unsupported query field: {field_name}")

    def add(self, user: User):
        self.users_by_id[str(user.id)] = user
        if user.resterlab_user_id:
            self.users_by_resterlab_id[str(user.resterlab_user_id)] = user

    async def commit(self):
        return None

    async def refresh(self, user: User):
        return None


@pytest_asyncio.fixture
async def fake_db_session() -> FakeAsyncSession:
    return FakeAsyncSession()


@pytest_asyncio.fixture
async def client(fake_db_session: FakeAsyncSession):
    app = FastAPI()
    app.include_router(router)

    async def override_get_db():
        yield fake_db_session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


class TestAuthEndpoints:
    async def test_login_creates_local_user(
        self,
        client: AsyncClient,
        fake_db_session: FakeAsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ):
        monkeypatch.setattr(
            "app.api.routes.auth.get_resterlab_auth",
            lambda: SimpleNamespace(
                verify_credentials=lambda email, password: {
                    "id": "123",
                    "email": email,
                    "display_name": "Alice",
                    "role": "admin",
                }
            ),
        )

        response = await client.post(
            "/api/auth/login",
            json={"email": "alice@example.com", "password": "secret"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["token_type"] == "bearer"
        assert data["user"] == {
            "id": "resterlab_123",
            "email": "alice@example.com",
            "display_name": "Alice",
            "role": "admin",
        }
        assert data["access_token"]

        created_user = fake_db_session.users_by_id["resterlab_123"]
        assert created_user.email == "alice@example.com"
        assert created_user.username == "Alice"
        assert created_user.resterlab_user_id == "123"

    async def test_login_updates_existing_local_user_preserving_display_name(
        self,
        client: AsyncClient,
        fake_db_session: FakeAsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ):
        existing_user = User(
            id="resterlab_123",
            username="Local Alias",
            email="old@example.com",
            role="regular",
            is_active=True,
            resterlab_user_id="123",
        )
        fake_db_session.add(existing_user)

        monkeypatch.setattr(
            "app.api.routes.auth.get_resterlab_auth",
            lambda: SimpleNamespace(
                verify_credentials=lambda email, password: {
                    "id": "123",
                    "email": "updated@example.com",
                    "display_name": "Remote Name",
                    "role": "admin",
                }
            ),
        )

        response = await client.post(
            "/api/auth/login",
            json={"email": "updated@example.com", "password": "secret"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["user"]["display_name"] == "Local Alias"
        assert data["user"]["email"] == "updated@example.com"
        assert data["user"]["role"] == "admin"
        assert existing_user.email == "updated@example.com"
        assert existing_user.role == "admin"

    async def test_login_invalid_credentials(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ):
        monkeypatch.setattr(
            "app.api.routes.auth.get_resterlab_auth",
            lambda: SimpleNamespace(
                verify_credentials=lambda email, password: (_ for _ in ()).throw(
                    HTTPException(status_code=401, detail="Invalid email or password")
                )
            ),
        )

        response = await client.post(
            "/api/auth/login",
            json={"email": "alice@example.com", "password": "wrong"},
        )

        assert response.status_code == 401
        assert response.json()["detail"] == "Invalid email or password"

    async def test_get_current_user(self, client: AsyncClient, fake_db_session: FakeAsyncSession):
        user = User(
            id="test-user",
            username="testuser",
            email="test@example.com",
            role="regular",
            is_active=True,
        )
        fake_db_session.add(user)
        token = create_access_token(
            user_id=user.id,
            email=user.email,
            role=user.role,
            display_name=user.username,
        )

        response = await client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        assert response.json() == {
            "id": "test-user",
            "email": "test@example.com",
            "display_name": "testuser",
            "role": "regular",
        }

    async def test_get_current_user_requires_auth(self, client: AsyncClient):
        response = await client.get("/api/auth/me")
        assert response.status_code == 401

    async def test_get_current_user_rejects_invalid_token(self, client: AsyncClient):
        response = await client.get(
            "/api/auth/me",
            headers={"Authorization": "Bearer invalid_token"},
        )
        assert response.status_code == 401

    async def test_get_current_user_returns_404_for_missing_local_user(
        self,
        client: AsyncClient,
    ):
        token = create_access_token(
            user_id="missing-user",
            email="missing@example.com",
            role="regular",
            display_name="Missing User",
        )

        response = await client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "User not found"
