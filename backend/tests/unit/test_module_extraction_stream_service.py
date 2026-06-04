import json

import pytest

from app.services.module_extraction_stream_service import (
    SSE_HEADERS,
    build_module_extraction_response,
    stream_module_extraction,
)


class _SessionFactory:
    def __init__(self, session):
        self._session = session

    def __call__(self):
        return self

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        return False


async def _collect_events(generator):
    events = []
    async for chunk in generator:
        payload = chunk.removeprefix("data: ").strip()
        events.append(json.loads(payload))
    return events


@pytest.mark.asyncio
async def test_stream_module_extraction_emits_progress_and_complete_events() -> None:
    session = object()

    async def extract_callable(*, db, module_id, progress_callback, chapter_titles):
        assert db is session
        assert module_id == "module-1"
        assert chapter_titles == ["第一章"]
        await progress_callback("开始", 10)
        await progress_callback("处理中", 70)
        return {"status": "success", "count": 3, "message": "完成"}

    events = await _collect_events(
        stream_module_extraction(
            module_id="module-1",
            chapter_titles=["第一章"],
            extract_callable=extract_callable,
            session_factory=_SessionFactory(session),
            poll_timeout=0.01,
        )
    )

    assert events == [
        {"type": "progress", "message": "开始", "percent": 10},
        {"type": "progress", "message": "处理中", "percent": 70},
        {"type": "complete", "status": "success", "count": 3, "message": "完成"},
    ]


@pytest.mark.asyncio
async def test_stream_module_extraction_emits_error_event_on_failure() -> None:
    async def extract_callable(*, db, module_id, progress_callback, chapter_titles):
        await progress_callback("开始", 10)
        raise RuntimeError("boom")

    events = await _collect_events(
        stream_module_extraction(
            module_id="module-2",
            chapter_titles=None,
            extract_callable=extract_callable,
            session_factory=_SessionFactory(object()),
            poll_timeout=0.01,
        )
    )

    assert events == [
        {"type": "progress", "message": "开始", "percent": 10},
        {"type": "error", "message": "boom"},
    ]


def test_build_module_extraction_response_preserves_sse_headers() -> None:
    async def extract_callable(*, db, module_id, progress_callback, chapter_titles):
        return {"status": "success", "count": 0, "message": "ok"}

    response = build_module_extraction_response(
        module_id="module-3",
        chapter_titles=None,
        extract_callable=extract_callable,
        session_factory=_SessionFactory(object()),
    )

    assert response.media_type == "text/event-stream"
    for key, value in SSE_HEADERS.items():
        assert response.headers[key] == value
