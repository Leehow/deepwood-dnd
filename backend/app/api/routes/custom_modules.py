"""Custom modules API routes - 自定义冒险模组CRUD"""
import json
import logging
import uuid
from pathlib import Path
from typing import Optional, List
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Header, Query, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_

from app.db.session import get_db
from app.models.custom_module import CustomModule
from app.schemas.custom_module import (
    CustomModuleCreate,
    CustomModuleUpdate,
    CustomModuleResponse,
    CustomModuleListItem,
    CustomModuleListResponse,
    ModuleTemplate,
    RecommendedLevel,
)
from app.core.security import require_auth

router = APIRouter(prefix="/api/custom-modules", tags=["custom-modules"])


def _load_templates() -> List[ModuleTemplate]:
    """Load module templates from JSON file"""
    from app.utils.rules_cache import get_module_templates_data
    data = get_module_templates_data()

    templates = []
    for item in data:
        templates.append(ModuleTemplate(
            id=item["id"],
            name=item["name"],
            name_en=item.get("name_en"),
            default_title=item.get("default_title"),
            icon=item.get("icon", "📜"),
            type=item.get("type", "mixed"),
            description=item["description"],
            recommended_level=RecommendedLevel(
                min=item["recommended_level"]["min"],
                max=item["recommended_level"]["max"],
            ),
            estimated_sessions=item.get("estimated_sessions", "1-2"),
            default_goals=item.get("default_goals", []),
            ai_prompts=item.get("ai_prompts", {}),
            default_chapters=item.get("default_chapters", []),
            default_level_min=item.get("default_level_min", 1),
            default_level_max=item.get("default_level_max", 5),
        ))
    return templates


# 从JSON文件加载模板
TEMPLATES: List[ModuleTemplate] = _load_templates()

logger = logging.getLogger(__name__)


async def _trigger_embedding(module_id: str, chapters: list):
    """Trigger embedding for custom module chapters (fire-and-forget, errors logged).
    Creates its own DB session so it can run as a background task."""
    try:
        from app.db.session import async_session_maker
        from app.services.module_embedding_service import ModuleEmbeddingService
        async with async_session_maker() as db:
            service = ModuleEmbeddingService(db)
            result = await service.embed_chapters(module_id, chapters)
            logger.info(f"[CustomModule] embed {module_id}: {result}")
    except Exception as e:
        logger.error(f"[CustomModule] embed failed for {module_id}: {e}")



@router.get("/templates", response_model=List[ModuleTemplate])
async def list_templates():
    """获取所有可用模板"""
    return TEMPLATES


@router.post("", response_model=CustomModuleResponse)
async def create_module(
    data: CustomModuleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """创建新的自定义模组"""
    user_id = current_user["user_id"]
    module_id = str(uuid.uuid4())

    # 如果指定了模板，使用模板的默认值
    chapters = []
    level_min = data.recommended_level_min
    level_max = data.recommended_level_max

    if data.template_id:
        template = next((t for t in TEMPLATES if t.id == data.template_id), None)
        if template:
            if data.template_id == "blank":
                from app.data.templates.guide_builder import build_guide_chapters
                chapters = build_guide_chapters()
            else:
                chapters = template.default_chapters
            level_min = level_min or template.default_level_min
            level_max = level_max or template.default_level_max

    module = CustomModule(
        module_id=module_id,
        title=data.title,
        description=data.description,
        template_id=data.template_id,
        chapters=chapters,
        npcs=[],
        locations=[],
        encounters=[],
        treasures=[],
        recommended_level_min=level_min,
        recommended_level_max=level_max,
        estimated_sessions=data.estimated_sessions,
        created_by=user_id,
        is_shared=False,
    )

    db.add(module)
    await db.commit()
    await db.refresh(module)

    # Auto-embed if the module has chapters with content
    if chapters:
        await _trigger_embedding(module_id, chapters)

    return module


@router.get("", response_model=CustomModuleListResponse)
async def list_modules(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """获取用户的自定义模组列表"""
    user_id = current_user["user_id"]
    offset = (page - 1) * page_size

    # 查询总数
    count_result = await db.execute(
        select(func.count(CustomModule.id))
        .where(CustomModule.created_by == user_id)
    )
    total = count_result.scalar() or 0

    # 查询列表
    result = await db.execute(
        select(CustomModule)
        .where(CustomModule.created_by == user_id)
        .order_by(CustomModule.updated_at.desc().nullsfirst(), CustomModule.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    modules = result.scalars().all()

    return CustomModuleListResponse(
        items=[CustomModuleListItem.model_validate(m) for m in modules],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/shared", response_model=CustomModuleListResponse)
async def list_shared_modules(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """浏览公开分享的模组"""
    user_id = current_user["user_id"]
    offset = (page - 1) * page_size

    # 查询总数 (共享的或自己的)
    count_result = await db.execute(
        select(func.count(CustomModule.id))
        .where(or_(CustomModule.is_shared == True, CustomModule.created_by == user_id))
    )
    total = count_result.scalar() or 0

    # 查询列表
    result = await db.execute(
        select(CustomModule)
        .where(or_(CustomModule.is_shared == True, CustomModule.created_by == user_id))
        .order_by(CustomModule.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    modules = result.scalars().all()

    return CustomModuleListResponse(
        items=[CustomModuleListItem.model_validate(m) for m in modules],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{module_id}", response_model=CustomModuleResponse)
async def get_module(
    module_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """获取单个自定义模组"""
    user_id = current_user["user_id"]
    result = await db.execute(
        select(CustomModule)
        .where(CustomModule.module_id == module_id)
    )
    module = result.scalar_one_or_none()

    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    # 权限检查：只能查看自己的或公开的
    if module.created_by != user_id and not module.is_shared:
        raise HTTPException(status_code=403, detail="Access denied")

    return module


@router.put("/{module_id}", response_model=CustomModuleResponse)
async def update_module(
    module_id: str,
    data: CustomModuleUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """更新自定义模组"""
    user_id = current_user["user_id"]
    result = await db.execute(
        select(CustomModule)
        .where(CustomModule.module_id == module_id)
        .where(CustomModule.created_by == user_id)
    )
    module = result.scalar_one_or_none()

    if not module:
        raise HTTPException(status_code=404, detail="Module not found or access denied")

    # 更新字段
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(module, key, value)

    await db.commit()
    await db.refresh(module)

    # Re-embed if chapters were updated
    if "chapters" in update_data:
        await _trigger_embedding(module.module_id, module.chapters or [])

    return module


@router.delete("/{module_id}")
async def delete_module(
    module_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """删除自定义模组"""
    user_id = current_user["user_id"]
    result = await db.execute(
        select(CustomModule)
        .where(CustomModule.module_id == module_id)
        .where(CustomModule.created_by == user_id)
    )
    module = result.scalar_one_or_none()

    if not module:
        raise HTTPException(status_code=404, detail="Module not found or access denied")

    # Delete embeddings first
    try:
        from app.services.module_embedding_service import ModuleEmbeddingService
        service = ModuleEmbeddingService(db)
        await service.delete_module_embeddings(module_id)
    except Exception as e:
        logger.error(f"[CustomModule] delete embeddings failed for {module_id}: {e}")

    await db.delete(module)
    await db.commit()
    return {"success": True, "message": "Module deleted"}


@router.post("/{module_id}/duplicate", response_model=CustomModuleResponse)
async def duplicate_module(
    module_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """复制一个模组（可以复制共享的模组）"""
    user_id = current_user["user_id"]
    result = await db.execute(
        select(CustomModule)
        .where(CustomModule.module_id == module_id)
    )
    source = result.scalar_one_or_none()

    if not source:
        raise HTTPException(status_code=404, detail="Module not found")

    # 只能复制自己的或共享的
    if source.created_by != user_id and not source.is_shared:
        raise HTTPException(status_code=403, detail="Access denied")

    new_module = CustomModule(
        module_id=str(uuid.uuid4()),
        title=f"{source.title} (副本)",
        description=source.description,
        template_id=source.template_id,
        chapters=source.chapters or [],
        npcs=source.npcs or [],
        locations=source.locations or [],
        encounters=source.encounters or [],
        treasures=source.treasures or [],
        recommended_level_min=source.recommended_level_min,
        recommended_level_max=source.recommended_level_max,
        estimated_sessions=source.estimated_sessions,
        created_by=user_id,
        is_shared=False,
    )

    db.add(new_module)
    await db.commit()
    await db.refresh(new_module)

    # Embed the duplicated module
    if new_module.chapters:
        await _trigger_embedding(new_module.module_id, new_module.chapters)

    return new_module


@router.patch("/{module_id}/share")
async def toggle_share(
    module_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """切换模组的共享状态"""
    user_id = current_user["user_id"]
    result = await db.execute(
        select(CustomModule)
        .where(CustomModule.module_id == module_id)
        .where(CustomModule.created_by == user_id)
    )
    module = result.scalar_one_or_none()

    if not module:
        raise HTTPException(status_code=404, detail="Module not found or access denied")

    module.is_shared = not module.is_shared
    await db.commit()
    await db.refresh(module)

    return {"success": True, "is_shared": module.is_shared}


@router.put("/{module_id}/chapters")
async def update_custom_module_chapters(
    module_id: str,
    chapters: list = Body(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """更新自定义模组的章节内容"""
    user_id = current_user["user_id"]
    result = await db.execute(
        select(CustomModule)
        .where(CustomModule.module_id == module_id)
        .where(CustomModule.created_by == user_id)
    )
    module = result.scalar_one_or_none()

    if not module:
        raise HTTPException(status_code=404, detail="Module not found or access denied")

    module.chapters = chapters
    await db.commit()

    # Re-embed in background (don't block the save response)
    background_tasks.add_task(_trigger_embedding, module_id, chapters)

    return {"message": "Chapters updated successfully", "chapters_count": len(chapters)}
