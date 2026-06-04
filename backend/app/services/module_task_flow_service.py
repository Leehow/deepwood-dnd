from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import async_session_factory
from app.models.parsed_module import ParsedModule

logger = logging.getLogger(__name__)


class EmbeddingProgressStore:
    def __init__(self) -> None:
        self._progress: dict[str, dict[str, Any]] = {}

    def get(self, module_id: str) -> dict[str, Any] | None:
        progress = self._progress.get(module_id)
        if progress is None:
            return None
        return dict(progress)

    def is_in_progress(self, module_id: str) -> bool:
        progress = self._progress.get(module_id)
        return bool(progress and progress.get("status") == "in_progress")

    def mark_started(self, module_id: str) -> None:
        self._progress[module_id] = {
            "status": "in_progress",
            "progress": 0,
            "message": "开始向量化...",
        }

    def mark_progress(self, module_id: str, message: str, progress: int) -> None:
        self._progress[module_id] = {
            "status": "in_progress",
            "progress": progress,
            "message": message,
        }

    def mark_completed(self, module_id: str, message: str = "向量化完成!") -> None:
        self._progress[module_id] = {
            "status": "completed",
            "progress": 100,
            "message": message,
        }

    def mark_failed(self, module_id: str, message: str) -> None:
        self._progress[module_id] = {
            "status": "failed",
            "progress": 0,
            "message": message,
        }

    def clear(self, module_id: str) -> None:
        self._progress.pop(module_id, None)


embedding_progress_store = EmbeddingProgressStore()


def _resolve_embedding_service_factory(embedding_service_factory=None):
    if embedding_service_factory is not None:
        return embedding_service_factory

    from app.services.module_embedding_service import ModuleEmbeddingService

    return ModuleEmbeddingService


async def get_required_module(db: AsyncSession, module_id: str) -> ParsedModule:
    result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == module_id)
    )
    module = result.scalar_one_or_none()
    if not module:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Module '{module_id}' not found",
        )
    return module


def ensure_module_creator(module: ParsedModule, requester_id: str, *, action: str) -> None:
    if module.created_by != requester_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Only the creator can {action}",
        )


def _build_in_progress_response(module_id: str, progress: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": "in_progress",
        "message": "Embedding is already in progress",
        "progress": progress.get("progress", 0),
        "module_id": module_id,
    }


def _build_status_payload(
    *,
    module: ParsedModule,
    progress: dict[str, Any] | None,
    stats: dict[str, Any] | None,
) -> dict[str, Any]:
    if progress and progress.get("status") == "in_progress":
        return {
            "module_id": module.module_id,
            "module_title": module.title,
            "embedded": False,
            "status": "in_progress",
            "progress": progress.get("progress", 0),
            "message": progress.get("message", "处理中..."),
        }

    if progress and progress.get("status") == "failed":
        return {
            "module_id": module.module_id,
            "module_title": module.title,
            "embedded": False,
            "status": "failed",
            "message": progress.get("message", "向量化失败"),
        }

    resolved_stats = stats or {"embedded": False}
    return {
        "module_id": module.module_id,
        "module_title": module.title,
        "status": "completed" if resolved_stats.get("embedded") else "not_started",
        **resolved_stats,
    }


async def _run_module_embedding(
    module_id: str,
    *,
    progress_store: EmbeddingProgressStore,
    session_factory=async_session_factory,
    embedding_service_factory=None,
) -> None:
    try:
        service_factory = _resolve_embedding_service_factory(embedding_service_factory)
        async with session_factory() as session:
            service = service_factory(session)

            async def progress_callback(message: str, progress: int) -> None:
                progress_store.mark_progress(module_id, message, progress)

            await service.embed_module(module_id, progress_callback=progress_callback)

        progress_store.mark_completed(module_id)
        logger.info("Embedding completed for module %s", module_id)
    except Exception as exc:
        progress_store.mark_failed(module_id, f"向量化失败: {exc}")
        logger.error("Embedding failed for module %s: %s", module_id, exc)


async def trigger_module_embedding(
    *,
    module_id: str,
    requester_id: str,
    db: AsyncSession,
    progress_store: EmbeddingProgressStore = embedding_progress_store,
    embedding_service_factory=None,
    session_factory=async_session_factory,
    task_scheduler=asyncio.create_task,
) -> dict[str, Any]:
    if progress_store.is_in_progress(module_id):
        progress = progress_store.get(module_id) or {}
        return _build_in_progress_response(module_id, progress)

    service_factory = _resolve_embedding_service_factory(embedding_service_factory)
    module = await get_required_module(db, module_id)
    ensure_module_creator(module, requester_id, action="trigger embedding")

    embedding_service = service_factory(db)
    stats = await embedding_service.get_embedding_stats(module_id)
    if stats.get("embedded"):
        return {
            "status": "already_embedded",
            "message": f"Module already has {stats['chunk_count']} embeddings",
            "stats": stats,
        }

    progress_store.mark_started(module_id)
    task_scheduler(
        _run_module_embedding(
            module_id,
            progress_store=progress_store,
            session_factory=session_factory,
            embedding_service_factory=service_factory,
        )
    )
    return {
        "status": "started",
        "message": "Embedding generation started in background",
    }


async def get_module_embedding_status(
    *,
    module_id: str,
    db: AsyncSession,
    progress_store: EmbeddingProgressStore = embedding_progress_store,
    embedding_service_factory=None,
) -> dict[str, Any]:
    module = await get_required_module(db, module_id)
    progress = progress_store.get(module_id)

    if progress and progress.get("status") in {"in_progress", "failed"}:
        return _build_status_payload(module=module, progress=progress, stats=None)

    service_factory = _resolve_embedding_service_factory(embedding_service_factory)
    embedding_service = service_factory(db)
    stats = await embedding_service.get_embedding_stats(module_id)
    return _build_status_payload(module=module, progress=progress, stats=stats)


async def delete_module_embedding_records(
    *,
    module_id: str,
    requester_id: str,
    db: AsyncSession,
    progress_store: EmbeddingProgressStore = embedding_progress_store,
    embedding_service_factory=None,
) -> dict[str, Any]:
    module = await get_required_module(db, module_id)
    ensure_module_creator(module, requester_id, action="delete embeddings")

    service_factory = _resolve_embedding_service_factory(embedding_service_factory)
    embedding_service = service_factory(db)
    deleted_count = await embedding_service.delete_module_embeddings(module_id)
    progress_store.clear(module_id)

    return {
        "status": "success",
        "deleted_count": deleted_count,
    }
