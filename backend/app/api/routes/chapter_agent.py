"""Chapter Agent API — SSE streaming endpoint using Pydantic AI."""
import asyncio
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.module_chat import ChapterChatRequest
from app.services.ai_model_service import ai_model_service
from app.api.routes.module_chat import resolve_module
from app.services.chapter_agent.schemas import AgentSSEEvent
from app.services.chapter_agent.deps import AgentDeps
from app.services.chapter_agent.prompts import build_system_prompt
from app.services.chapter_agent.history import load_history, save_message
from app.services.chapter_agent.agent import create_agent
from app.core.security import require_auth

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Chapter Agent"])


def _sse(evt: AgentSSEEvent) -> str:
    """Format an AgentSSEEvent as an SSE data line."""
    return f"data: {evt.model_dump_json(exclude_none=True)}\n\n"


@router.post("/api/modules/{module_id}/chapter-agent")
async def chapter_agent_stream(
    module_id: str,
    request: ChapterChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Stream chapter-editing agent responses via SSE."""
    user_id = current_user["user_id"]
    module = await resolve_module(db, module_id)
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    usage_params = await ai_model_service.get_usage_params(db, "chapter_agent")
    config = usage_params.config
    module_title = module.title or "未知模组"
    chapter_title = request.chapter_title or ""
    chapter_content = request.chapter_content or ""

    logger.info(
        "[ChapterAgent] module=%s, chapter=%s, content_len=%d, model=%s, user_msg=%s",
        module_title, chapter_title, len(chapter_content), config.model_name, request.content[:80],
    )

    system_prompt = build_system_prompt(module_title, chapter_title, chapter_content)
    agent = create_agent(config, system_prompt)

    # Load conversation history and save the new user message
    history = await load_history(db, module_id, user_id, chapter_title)
    user_msg_id = await save_message(
        db, module_id, user_id, "user", request.content, chapter_title,
    )

    deps = AgentDeps(
        db=db,
        module_id=module_id,
        chapter_title=chapter_title,
        chapter_content=chapter_content,
        user_id=user_id,
    )

    async def generate_sse():
        # 1. Send user_message_id so frontend can track it
        yield _sse(AgentSSEEvent(type="text", user_message_id=user_msg_id))

        full_response = ""
        collected_tool_calls = []
        output_q: asyncio.Queue = asyncio.Queue()

        async def _run_agent():
            try:
                async with agent.run_stream(
                    request.content,
                    deps=deps,
                    message_history=history,
                ) as run:
                    async for text in run.stream_text(delta=True):
                        await output_q.put(("text", text))
                await output_q.put(("end", None))
            except Exception as e:
                await output_q.put(("error", str(e)))

        task = asyncio.create_task(_run_agent())

        try:
            while True:
                # Drain tool events (non-blocking)
                while not deps.tool_event_queue.empty():
                    try:
                        evt = deps.tool_event_queue.get_nowait()
                        collected_tool_calls.append({"name": evt["name"], "summary": evt.get("summary")})
                        yield _sse(AgentSSEEvent(
                            type="tool_call",
                            tool_name=evt["name"],
                            content=evt.get("summary"),
                        ))
                    except asyncio.QueueEmpty:
                        break

                # Wait for text/end/error with short timeout
                try:
                    kind, data = await asyncio.wait_for(
                        output_q.get(), timeout=0.2,
                    )
                    if kind == "text":
                        full_response += data
                        yield _sse(AgentSSEEvent(type="text", content=data))
                    elif kind == "error":
                        yield _sse(AgentSSEEvent(type="error", content=data))
                        break
                    elif kind == "end":
                        # Drain remaining tool events after agent finishes
                        while not deps.tool_event_queue.empty():
                            try:
                                evt = deps.tool_event_queue.get_nowait()
                                collected_tool_calls.append({"name": evt["name"], "summary": evt.get("summary")})
                                yield _sse(AgentSSEEvent(
                                    type="tool_call",
                                    tool_name=evt["name"],
                                    content=evt.get("summary"),
                                ))
                            except asyncio.QueueEmpty:
                                break
                        break
                except asyncio.TimeoutError:
                    continue

            # 2. Send collected edit operations (if any)
            if deps.pending_edits:
                yield _sse(AgentSSEEvent(
                    type="edit",
                    edits=deps.pending_edits,
                ))

            # 3. Persist assistant response and send done
            msg_id = await save_message(
                db, module_id, user_id, "assistant", full_response, chapter_title,
                tool_calls=collected_tool_calls or None,
            )
            yield _sse(AgentSSEEvent(type="done", message_id=msg_id))

        except Exception as e:
            logger.exception("chapter_agent_stream error")
            yield _sse(AgentSSEEvent(type="error", content=str(e)))
        finally:
            if not task.done():
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass

    return StreamingResponse(
        generate_sse(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
