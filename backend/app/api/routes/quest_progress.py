"""
任务进度管理 API
支持按战役 ID 存储和读取任务进度
"""
from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel
from typing import Dict, Literal

from app.core.security import require_auth
from app.core.dependencies import resolve_campaign_member_context
from app.utils.permission_checks import require_campaign_dm

router = APIRouter(prefix="/api/quest-progress", tags=["quest-progress"])



# 依赖与模型导入
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_db
from app.models.campaign_storage import CampaignStorage

# Pydantic 模型
class QuestStatus(BaseModel):
    """单个任务的状态"""
    status: Literal["not_started", "in_progress", "completed"]


class QuestProgressUpdate(BaseModel):
    """任务进度更新请求"""
    quest_id: str
    status: Literal["not_started", "in_progress", "completed"]


class QuestProgressBatch(BaseModel):
    """批量任务进度"""
    progress: Dict[str, Literal["not_started", "in_progress", "completed"]]


# ---- 新实现：使用 campaign_storage 作为真实存储 ----

def _parse_campaign_id(campaign_id: str) -> int:
    try:
        return int(campaign_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="campaign_id must be integer")


async def db_load_quest_progress(db: AsyncSession, campaign_id_int: int) -> Dict[str, str]:
    stmt = (
        select(CampaignStorage)
        .where(
            CampaignStorage.campaign_id == campaign_id_int,
            CampaignStorage.object_type == "quest_progress",
            CampaignStorage.object_id == "default",
            CampaignStorage.is_active == True,
        )
        .limit(1)
    )
    res = await db.execute(stmt)
    obj = res.scalar_one_or_none()
    return obj.data if obj and obj.data else {}


async def db_save_quest_progress(db: AsyncSession, campaign_id_int: int, progress: Dict[str, str], user_id: str):
    stmt = (
        select(CampaignStorage)
        .where(
            CampaignStorage.campaign_id == campaign_id_int,
            CampaignStorage.object_type == "quest_progress",
            CampaignStorage.object_id == "default",
            CampaignStorage.is_active == True,
        )
        .limit(1)
    )
    res = await db.execute(stmt)
    obj = res.scalar_one_or_none()
    if obj:
        obj.data = progress
        obj.version = (obj.version or 1) + 1
        obj.updated_by = user_id
    else:
        obj = CampaignStorage(
            campaign_id=campaign_id_int,
            object_type="quest_progress",
            object_id="default",
            object_name="Quest Progress",
            category="quest",
            tags=None,
            data=progress,
            source="custom",
            visibility="dm_only",
            is_active=True,
            version=1,
            created_by=user_id,
        )
        db.add(obj)



@router.get("/{campaign_id}")
async def get_campaign_quest_progress(
    campaign_id: str,
    current_user: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """
    获取指定战役的所有任务进度
    """
    cid = _parse_campaign_id(campaign_id)
    await resolve_campaign_member_context(db, cid, current_user)
    progress = await db_load_quest_progress(db, cid)
    return {"campaign_id": campaign_id, "progress": progress}


@router.get("/{campaign_id}/{quest_id}")
async def get_quest_status(
    campaign_id: str,
    quest_id: str,
    current_user: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """获取指定任务的进度状态"""
    cid = _parse_campaign_id(campaign_id)
    await resolve_campaign_member_context(db, cid, current_user)
    progress = await db_load_quest_progress(db, cid)
    status_value = progress.get(quest_id, "not_started")
    return {"campaign_id": campaign_id, "quest_id": quest_id, "status": status_value}


@router.put("/{campaign_id}/{quest_id}")
async def update_quest_status(
    campaign_id: str,
    quest_id: str,
    update: QuestStatus,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """更新指定任务的进度状态（只写新库）"""
    cid = _parse_campaign_id(campaign_id)
    await require_campaign_dm(cid, current_user, db)
    progress = await db_load_quest_progress(db, cid)
    progress[quest_id] = update.status
    await db_save_quest_progress(db, cid, progress, current_user["user_id"])
    return {"campaign_id": campaign_id, "quest_id": quest_id, "status": update.status, "message": "Quest status updated successfully"}


@router.post("/{campaign_id}/batch")
async def batch_update_quest_progress(
    campaign_id: str,
    batch: QuestProgressBatch,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """批量更新任务进度（只写新库）"""
    cid = _parse_campaign_id(campaign_id)
    await require_campaign_dm(cid, current_user, db)
    progress = await db_load_quest_progress(db, cid)
    progress.update(batch.progress)
    await db_save_quest_progress(db, cid, progress, current_user["user_id"])
    return {"campaign_id": campaign_id, "progress": progress, "message": f"Updated {len(batch.progress)} quest statuses"}


@router.delete("/{campaign_id}")
async def clear_campaign_quest_progress(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """清空指定战役的所有任务进度（新库置空数据；不再删除旧文件）"""
    cid = _parse_campaign_id(campaign_id)
    await require_campaign_dm(cid, current_user, db)
    await db_save_quest_progress(db, cid, {}, current_user["user_id"])
    return {"campaign_id": campaign_id, "message": "Quest progress cleared successfully"}


@router.delete("/{campaign_id}/{quest_id}")
async def reset_quest_status(
    campaign_id: str,
    quest_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """重置指定任务的进度状态（新库置空该任务键）"""
    cid = _parse_campaign_id(campaign_id)
    await require_campaign_dm(cid, current_user, db)
    progress = await db_load_quest_progress(db, cid)
    if quest_id in progress:
        del progress[quest_id]
        await db_save_quest_progress(db, cid, progress, current_user["user_id"])
        return {"campaign_id": campaign_id, "quest_id": quest_id, "message": "Quest status reset to not_started"}
    else:
        return {"campaign_id": campaign_id, "quest_id": quest_id, "message": "Quest was already in not_started state"}
