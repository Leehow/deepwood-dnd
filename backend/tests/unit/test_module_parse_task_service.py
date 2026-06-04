from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services.module_parse_task_service import (
    build_resume_progress_events,
    get_active_parse_task_for_file,
    get_parse_task_by_id,
    get_raw_file_by_id,
    resolve_parse_task_for_websocket,
    stop_parse_task_and_mark_file,
)


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeDb:
    def __init__(self, execute_results):
        self._execute_results = iter(execute_results)
        self.commit = AsyncMock()

    async def execute(self, _stmt):
        return _ScalarResult(next(self._execute_results))


@pytest.mark.asyncio
async def test_get_active_parse_task_for_file_prefers_database_task() -> None:
    task = SimpleNamespace(
        task_id="task-1",
        file_id="12",
        status="running",
        progress=35,
        current_step="translate",
        current_message="处理中",
        error_message=None,
        steps_completed=["ocr"],
        batch_messages=["msg"],
        module_id="module-12",
        created_at=datetime(2026, 3, 21, 10, 0, 0),
        started_at=None,
        completed_at=None,
        updated_at=None,
    )

    result = await get_active_parse_task_for_file("12", _FakeDb([task]))

    assert result == {
        "id": "task-1",
        "file_id": "12",
        "status": "running",
        "progress": 35,
        "current_step": "translate",
        "current_message": "处理中",
        "error_message": None,
        "steps_completed": ["ocr"],
        "batch_messages": ["msg"],
        "module_id": "module-12",
        "created_at": "2026-03-21T10:00:00",
        "started_at": None,
        "completed_at": None,
        "updated_at": None,
    }


@pytest.mark.asyncio
async def test_get_parse_task_by_id_falls_back_to_legacy_store(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.module_parse_task_service.module_file_manager.get_task_by_id",
        lambda task_id: {"id": task_id, "status": "running"},
    )

    result = await get_parse_task_by_id("legacy-task", _FakeDb([None]))

    assert result == {"id": "legacy-task", "status": "running"}


@pytest.mark.asyncio
async def test_get_raw_file_by_id_returns_none_for_invalid_id() -> None:
    result = await get_raw_file_by_id("not-an-int", _FakeDb([]))
    assert result is None


def test_resolve_parse_task_for_websocket_resumes_running_task(monkeypatch) -> None:
    file_manager = SimpleNamespace(
        get_task_by_file_id=lambda file_id: {
            "id": "task-1",
            "file_id": file_id,
            "status": "running",
            "progress": 40,
            "current_step": "translate",
            "batch_messages": ["step-1"],
        },
        load_parse_tasks=lambda: [],
        save_parse_tasks=lambda tasks: None,
        create_task=lambda file_id: {"id": "new-task", "file_id": file_id},
    )

    result = resolve_parse_task_for_websocket(
        "12",
        raw_file_status="converted",
        file_manager=file_manager,
    )

    assert result == {
        "task_id": "task-1",
        "task": {
            "id": "task-1",
            "file_id": "12",
            "status": "running",
            "progress": 40,
            "current_step": "translate",
            "batch_messages": ["step-1"],
        },
        "resumed": True,
    }


def test_resolve_parse_task_for_websocket_discards_stale_task_and_creates_new_one() -> None:
    saved_tasks = {}
    file_manager = SimpleNamespace(
        get_task_by_file_id=lambda _file_id: {"id": "old-task", "status": "running"},
        load_parse_tasks=lambda: [{"id": "old-task"}, {"id": "keep-task"}],
        save_parse_tasks=lambda tasks: saved_tasks.setdefault("value", tasks),
        create_task=lambda file_id: {"id": "new-task", "file_id": file_id},
    )

    result = resolve_parse_task_for_websocket(
        "22",
        raw_file_status="error",
        file_manager=file_manager,
    )

    assert result == {
        "task_id": "new-task",
        "task": {"id": "new-task", "file_id": "22"},
        "resumed": False,
    }
    assert saved_tasks["value"] == [{"id": "keep-task"}]


def test_build_resume_progress_events_uses_current_step_and_progress() -> None:
    events = build_resume_progress_events(
        {
            "current_step": "translate",
            "progress": 55,
            "batch_messages": ["msg-1", "msg-2"],
        }
    )

    assert events == [
        {"type": "progress", "step": "translate", "message": "msg-1", "progress": 55},
        {"type": "progress", "step": "translate", "message": "msg-2", "progress": 55},
    ]


@pytest.mark.asyncio
async def test_stop_parse_task_and_mark_file_updates_database_task_and_raw_file() -> None:
    task = SimpleNamespace(task_id="task-2", file_id="7", status="running", error_message=None, completed_at=None)
    raw_file = SimpleNamespace(status="converted")
    db = _FakeDb([task, raw_file])

    response = await stop_parse_task_and_mark_file(
        "task-2",
        db,
        cancel_task_fn=lambda _task_id: True,
        stopped_at=datetime(2026, 3, 21, 11, 0, 0),
    )

    assert response == {"message": "Task stopped successfully", "cancelled": True}
    assert task.status == "failed"
    assert task.error_message == "用户手动停止解析"
    assert raw_file.status == "error"
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_stop_parse_task_and_mark_file_falls_back_to_legacy_store(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.module_parse_task_service.module_file_manager.get_task_by_id",
        lambda task_id: {"id": task_id, "file_id": "file-1"},
    )
    updates = []
    saved_metadata = {}
    monkeypatch.setattr(
        "app.services.module_parse_task_service.module_file_manager.update_task",
        lambda task_id, payload: updates.append((task_id, payload)),
    )
    monkeypatch.setattr(
        "app.services.module_parse_task_service.module_file_manager.load_raw_metadata",
        lambda: [{"id": "file-1", "status": "uploaded"}],
    )
    monkeypatch.setattr(
        "app.services.module_parse_task_service.module_file_manager.save_raw_metadata",
        lambda metadata: saved_metadata.setdefault("value", metadata),
    )

    response = await stop_parse_task_and_mark_file(
        "legacy-task",
        _FakeDb([None]),
        cancel_task_fn=lambda _task_id: False,
    )

    assert response == {"message": "Task stopped successfully", "cancelled": False}
    assert updates == [("legacy-task", {"status": "failed", "error_message": "用户手动停止解析"})]
    assert saved_metadata["value"] == [{"id": "file-1", "status": "error"}]
