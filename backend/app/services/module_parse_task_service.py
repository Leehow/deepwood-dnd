from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.module_parse_task import ModuleParseTask
from app.models.raw_module_file import RawModuleFile
from app.services import module_file_manager


def task_to_dict(task: ModuleParseTask) -> dict[str, Any]:
    return {
        "id": task.task_id,
        "file_id": task.file_id,
        "status": task.status,
        "progress": task.progress or 0,
        "current_step": task.current_step,
        "current_message": task.current_message,
        "error_message": task.error_message,
        "steps_completed": task.steps_completed or [],
        "batch_messages": task.batch_messages or [],
        "module_id": task.module_id,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "started_at": task.started_at.isoformat() if task.started_at else None,
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
    }


async def get_active_parse_task_for_file(
    file_id: str,
    db: AsyncSession,
) -> dict[str, Any] | None:
    result = await db.execute(
        select(ModuleParseTask)
        .where(ModuleParseTask.file_id == file_id)
        .where(ModuleParseTask.status.in_(["pending", "running"]))
    )
    db_task = result.scalar_one_or_none()
    if db_task:
        return task_to_dict(db_task)

    return module_file_manager.get_task_by_file_id(file_id)


async def get_raw_file_by_id(
    file_id: str,
    db: AsyncSession,
):
    try:
        file_id_int = int(file_id)
    except ValueError:
        return None

    result = await db.execute(
        select(RawModuleFile).where(RawModuleFile.id == file_id_int)
    )
    return result.scalar_one_or_none()


async def get_parse_task_by_id(
    task_id: str,
    db: AsyncSession,
) -> dict[str, Any] | None:
    result = await db.execute(
        select(ModuleParseTask).where(ModuleParseTask.task_id == task_id)
    )
    db_task = result.scalar_one_or_none()
    if db_task:
        return task_to_dict(db_task)

    return module_file_manager.get_task_by_id(task_id)


def resolve_parse_task_for_websocket(
    file_id: str,
    *,
    raw_file_status: str | None,
    file_manager=module_file_manager,
) -> dict[str, Any]:
    existing_task = file_manager.get_task_by_file_id(file_id)

    if raw_file_status in ["error", "uploaded"] and existing_task:
        tasks = file_manager.load_parse_tasks()
        tasks = [task for task in tasks if task["id"] != existing_task["id"]]
        file_manager.save_parse_tasks(tasks)
        existing_task = None

    if existing_task and existing_task.get("status") == "running":
        return {
            "task_id": existing_task["id"],
            "task": existing_task,
            "resumed": True,
        }

    task = file_manager.create_task(file_id)
    return {
        "task_id": task["id"],
        "task": task,
        "resumed": False,
    }


def build_resume_progress_events(task: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "type": "progress",
            "step": task.get("current_step", ""),
            "message": message,
            "progress": task.get("progress", 0),
        }
        for message in task.get("batch_messages", [])
    ]


def _resolve_cancel_task(cancel_task_fn=None):
    if cancel_task_fn is not None:
        return cancel_task_fn

    from app.domain.parsing.pipeline import cancel_task

    return cancel_task


async def stop_parse_task_and_mark_file(
    task_id: str,
    db: AsyncSession,
    *,
    cancel_task_fn=None,
    stopped_at: datetime | None = None,
) -> dict[str, Any]:
    cancelled = _resolve_cancel_task(cancel_task_fn)(task_id)
    result = await db.execute(
        select(ModuleParseTask).where(ModuleParseTask.task_id == task_id)
    )
    db_task = result.scalar_one_or_none()
    timestamp = stopped_at or datetime.utcnow()

    if db_task:
        db_task.status = "failed"
        db_task.error_message = "用户手动停止解析"
        db_task.completed_at = timestamp

        if db_task.file_id:
            try:
                file_result = await db.execute(
                    select(RawModuleFile).where(RawModuleFile.id == int(db_task.file_id))
                )
                raw_file = file_result.scalar_one_or_none()
                if raw_file:
                    raw_file.status = "error"
            except (ValueError, TypeError):
                pass

        await db.commit()
        return {"message": "Task stopped successfully", "cancelled": cancelled}

    task = module_file_manager.get_task_by_id(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    module_file_manager.update_task(
        task_id,
        {
            "status": "failed",
            "error_message": "用户手动停止解析",
        },
    )

    file_id = task.get("file_id")
    if file_id:
        metadata = module_file_manager.load_raw_metadata()
        for file_data in metadata:
            if file_data["id"] == file_id:
                file_data["status"] = "error"
                break
        module_file_manager.save_raw_metadata(metadata)

    return {"message": "Task stopped successfully", "cancelled": cancelled}
