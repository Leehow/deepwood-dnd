from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.services.module_task_flow_service import (
    EmbeddingProgressStore,
    delete_module_embedding_records,
    get_module_embedding_status,
    trigger_module_embedding,
)


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeDb:
    def __init__(self, execute_results):
        self._execute_results = iter(execute_results)

    async def execute(self, _stmt):
        return _ScalarResult(next(self._execute_results))


class _SessionFactory:
    def __init__(self, session):
        self._session = session

    def __call__(self):
        return self

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.mark.asyncio
async def test_trigger_module_embedding_schedules_background_runner_and_marks_completed() -> None:
    module = SimpleNamespace(module_id="module-1", title="矿坑", created_by="user-1")
    db = _FakeDb([module])
    background_session = object()
    stats_service = SimpleNamespace(get_embedding_stats=AsyncMock(return_value={"embedded": False}))

    async def _embed(module_id: str, progress_callback):
        assert module_id == "module-1"
        await progress_callback("处理中", 35)
        return {"status": "success"}

    runner_service = SimpleNamespace(embed_module=AsyncMock(side_effect=_embed))
    progress_store = EmbeddingProgressStore()
    scheduled = []

    def service_factory(session):
        if session is db:
            return stats_service
        if session is background_session:
            return runner_service
        raise AssertionError("unexpected session")

    def scheduler(coro):
        scheduled.append(coro)
        return None

    response = await trigger_module_embedding(
        module_id="module-1",
        requester_id="user-1",
        db=db,
        progress_store=progress_store,
        embedding_service_factory=service_factory,
        session_factory=_SessionFactory(background_session),
        task_scheduler=scheduler,
    )

    assert response == {
        "status": "started",
        "message": "Embedding generation started in background",
    }
    assert progress_store.get("module-1") == {
        "status": "in_progress",
        "progress": 0,
        "message": "开始向量化...",
    }

    await scheduled.pop()

    assert runner_service.embed_module.await_count == 1
    assert progress_store.get("module-1") == {
        "status": "completed",
        "progress": 100,
        "message": "向量化完成!",
    }


@pytest.mark.asyncio
async def test_trigger_module_embedding_returns_already_embedded_without_scheduling() -> None:
    module = SimpleNamespace(module_id="module-2", title="遗迹", created_by="user-2")
    db = _FakeDb([module])
    service = SimpleNamespace(
        get_embedding_stats=AsyncMock(return_value={"embedded": True, "chunk_count": 18})
    )
    scheduled = []

    response = await trigger_module_embedding(
        module_id="module-2",
        requester_id="user-2",
        db=db,
        progress_store=EmbeddingProgressStore(),
        embedding_service_factory=lambda _db: service,
        task_scheduler=lambda coro: scheduled.append(coro),
    )

    assert response == {
        "status": "already_embedded",
        "message": "Module already has 18 embeddings",
        "stats": {"embedded": True, "chunk_count": 18},
    }
    assert scheduled == []


@pytest.mark.asyncio
async def test_get_module_embedding_status_prefers_failed_progress_store_state() -> None:
    module = SimpleNamespace(module_id="module-3", title="旧城", created_by="user-3")
    progress_store = EmbeddingProgressStore()
    progress_store.mark_failed("module-3", "向量化失败: timeout")

    response = await get_module_embedding_status(
        module_id="module-3",
        db=_FakeDb([module]),
        progress_store=progress_store,
        embedding_service_factory=lambda _db: (_ for _ in ()).throw(AssertionError("should not query stats")),
    )

    assert response == {
        "module_id": "module-3",
        "module_title": "旧城",
        "embedded": False,
        "status": "failed",
        "message": "向量化失败: timeout",
    }


@pytest.mark.asyncio
async def test_delete_module_embedding_records_clears_progress_and_deletes_embeddings() -> None:
    module = SimpleNamespace(module_id="module-4", title="塔楼", created_by="owner")
    progress_store = EmbeddingProgressStore()
    progress_store.mark_started("module-4")
    service = SimpleNamespace(delete_module_embeddings=AsyncMock(return_value=7))

    response = await delete_module_embedding_records(
        module_id="module-4",
        requester_id="owner",
        db=_FakeDb([module]),
        progress_store=progress_store,
        embedding_service_factory=lambda _db: service,
    )

    assert response == {"status": "success", "deleted_count": 7}
    assert progress_store.get("module-4") is None
    service.delete_module_embeddings.assert_awaited_once_with("module-4")


@pytest.mark.asyncio
async def test_delete_module_embedding_records_rejects_non_creator() -> None:
    module = SimpleNamespace(module_id="module-5", title="地穴", created_by="owner")

    with pytest.raises(HTTPException) as exc_info:
        await delete_module_embedding_records(
            module_id="module-5",
            requester_id="intruder",
            db=_FakeDb([module]),
            progress_store=EmbeddingProgressStore(),
            embedding_service_factory=lambda _db: SimpleNamespace(),
        )

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Only the creator can delete embeddings"
