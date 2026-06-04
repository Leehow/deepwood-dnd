from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from fastapi.responses import StreamingResponse

from app.db.session import async_session_maker
from app.services.monster_item_extractor import monster_item_extractor

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _encode_event(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def stream_module_extraction(
    *,
    module_id: str,
    chapter_titles: list[str] | None,
    extract_callable: Callable[..., Awaitable[dict[str, Any]]],
    session_factory=async_session_maker,
    poll_timeout: float = 0.3,
) -> AsyncIterator[str]:
    progress_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

    async def progress_callback(message: str, percent: int) -> None:
        await progress_queue.put(
            {"type": "progress", "message": message, "percent": percent}
        )

    async with session_factory() as new_db:
        extraction_task = asyncio.create_task(
            extract_callable(
                db=new_db,
                module_id=module_id,
                progress_callback=progress_callback,
                chapter_titles=chapter_titles,
            )
        )

        while not extraction_task.done():
            try:
                message = await asyncio.wait_for(progress_queue.get(), timeout=poll_timeout)
                yield _encode_event(message)
            except asyncio.TimeoutError:
                continue

        while not progress_queue.empty():
            message = await progress_queue.get()
            yield _encode_event(message)

        try:
            result = extraction_task.result()
            yield _encode_event(
                {
                    "type": "complete",
                    "status": result.get("status"),
                    "count": result.get("count"),
                    "message": result.get("message"),
                }
            )
        except Exception as exc:
            yield _encode_event({"type": "error", "message": str(exc)})


def build_module_extraction_response(
    *,
    module_id: str,
    chapter_titles: list[str] | None,
    extract_callable: Callable[..., Awaitable[dict[str, Any]]],
    session_factory=async_session_maker,
) -> StreamingResponse:
    return StreamingResponse(
        stream_module_extraction(
            module_id=module_id,
            chapter_titles=chapter_titles,
            extract_callable=extract_callable,
            session_factory=session_factory,
        ),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


def build_monster_extraction_response(
    *,
    module_id: str,
    chapter_titles: list[str] | None,
    session_factory=async_session_maker,
) -> StreamingResponse:
    return build_module_extraction_response(
        module_id=module_id,
        chapter_titles=chapter_titles,
        extract_callable=monster_item_extractor.extract_monsters_from_toc,
        session_factory=session_factory,
    )


def build_item_extraction_response(
    *,
    module_id: str,
    chapter_titles: list[str] | None,
    session_factory=async_session_maker,
) -> StreamingResponse:
    return build_module_extraction_response(
        module_id=module_id,
        chapter_titles=chapter_titles,
        extract_callable=monster_item_extractor.extract_items_from_toc,
        session_factory=session_factory,
    )
