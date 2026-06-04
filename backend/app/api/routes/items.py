from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, exists
from typing import List, Optional
from pydantic import BaseModel
import httpx
import json
import logging
import re

from app.db.session import get_db
from app.models.item import Item
from app.models.parsed_module import ParsedModule
from app.models.shop_inventory import ShopInventory
from app.models.chest_inventory import ChestInventory
from app.schemas.item import ItemCreate, ItemUpdate, ItemResponse
from app.services.avatar_service import avatar_service
from app.services.magic_item_parser import magic_item_parser
from app.services.ai_model_service import ai_model_service
from app.models.ai_settings import ModelType
from app.core.security import require_auth
from app.utils.permission_checks import require_campaign_dm
from app.utils.avatar_urls import is_temporary_avatar_url, materialize_avatar_url

router = APIRouter(prefix="/api/items", tags=["items"])
logger = logging.getLogger(__name__)


async def _ensure_item_avatar_is_permanent(item: Item, db: AsyncSession) -> bool:
    """Repair temp avatar URLs by uploading to OSS or regenerating once."""
    if not item.avatar_url or not is_temporary_avatar_url(item.avatar_url):
        return False

    repaired = await materialize_avatar_url(item.avatar_url, "item", item.id, item.name or "")

    if not repaired:
        try:
            small_url, large_url = await avatar_service.generate_avatar(
                db=db,
                entity_type="item",
                entity_id=item.id,
                name=item.name or "",
                description=item.description or "",
                category=item.category or "",
            )
            repaired = await materialize_avatar_url(small_url, "item", item.id, item.name or "")
            if not repaired:
                repaired = (small_url, large_url)
        except Exception as exc:
            logger.warning("Failed to regenerate avatar for item %s[%s]: %s", item.name, item.id, exc)
            return False

    item.avatar_url, item.avatar_url_large = repaired
    item.has_avatar = True
    return True


@router.post("", response_model=ItemResponse, status_code=status.HTTP_201_CREATED)
async def create_item(
    item: ItemCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Create a new item in the campaign resource library
    """
    await require_campaign_dm(item.campaign_id, current_user, db)
    db_item = Item(**item.model_dump())
    db.add(db_item)
    await db.commit()
    await db.refresh(db_item)
    return db_item


@router.get("/campaign/{campaign_id}", response_model=List[ItemResponse])
async def get_campaign_items(
    campaign_id: int,
    category: str = Query(None, description="Filter by category"),
    is_custom: bool = Query(None, description="Filter by is_custom flag"),
    db: AsyncSession = Depends(get_db)
):
    """
    Get all items for a specific campaign, optionally filtered by category.
    Excludes items that belong to shops or chests (container-only items).
    """
    # Subqueries to find items that are in shop/chest inventories
    in_shop = exists().where(ShopInventory.item_id == Item.id)
    in_chest = exists().where(ChestInventory.item_id == Item.id)

    query = select(Item).where(
        Item.campaign_id == campaign_id,
        ~in_shop,
        ~in_chest,
    )

    if category:
        query = query.where(Item.category == category)

    if is_custom is not None:
        query = query.where(Item.is_custom == is_custom)

    query = query.order_by(Item.name)

    result = await db.execute(query)
    items = result.scalars().all()
    changed = False
    for item in items:
        if await _ensure_item_avatar_is_permanent(item, db):
            changed = True
    if changed:
        await db.commit()
    return items


# ================== AI Import Routes (must be before /{item_id}) ==================
# These routes must come before /{item_id} to avoid route conflicts


class AvatarPreviewRequest(BaseModel):
    """生成物品头像预览"""
    appearance: str | None = None
    name: str | None = None
    description: str | None = None
    categories: list[str] = []


@router.get("/avatar-library")
async def get_item_avatar_library(
    campaign_id: int = Query(None, description="可选，不传则查所有战役"),
    db: AsyncSession = Depends(get_db),
):
    """
    获取已有头像的物品列表，用于图标复用。
    跨所有战役查询，按名称去重（同名物品只返回一个）。
    """
    query = select(Item).where(Item.has_avatar == True)
    if campaign_id:
        query = query.order_by(Item.campaign_id == campaign_id, Item.name)
    else:
        query = query.order_by(Item.name)

    result = await db.execute(query.limit(100))
    items = result.scalars().all()
    changed = False
    for item in items:
        if await _ensure_item_avatar_is_permanent(item, db):
            changed = True
    if changed:
        await db.commit()

    # 按名称去重，优先保留当前战役的
    seen_names: dict[str, dict] = {}
    for item in items:
        if item.name not in seen_names:
            seen_names[item.name] = {
                "id": item.id,
                "name": item.name,
                "category": item.category,
                "avatar_url": item.avatar_url,
                "avatar_url_large": item.avatar_url_large,
            }
    return list(seen_names.values())[:50]


@router.post("/generate-avatar-preview")
async def generate_avatar_preview(
    request: AvatarPreviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    根据外貌描述生成物品头像预览图。
    用于创建物品前预览生成的图标。
    """
    # 构建图像生成prompt
    text_parts = []
    if request.name:
        text_parts.append(f"物品名称: {request.name}")
    if request.appearance:
        text_parts.append(f"外貌: {request.appearance}")
    if request.description:
        text_parts.append(f"描述: {request.description[:200]}")
    if request.categories:
        cat_labels = {
            "weapon": "武器", "armor": "护甲",
            "jewelry": "首饰", "adventuring": "冒险物品",
            "magical": "法术物品",
        }
        labels = [cat_labels.get(c, c) for c in request.categories if c in cat_labels]
        if labels:
            text_parts.append(f"类别: {', '.join(labels)}")

    if not text_parts:
        raise HTTPException(status_code=400, detail="请提供名称、外貌描述或物品描述")

    # 用 FAST 模型生成图像 prompt
    image_prompt = await _generate_preview_image_prompt(db, text_parts)

    # 用 avatar_service 生成图片
    try:
        small_url, large_url = await avatar_service.generate_avatar(
            db=db,
            entity_type="item",
            entity_id=0,  # 预览用，不关联实体
            name=request.name or "preview",
            description=request.description or "",
            appearance=request.appearance or "",
            category=request.categories[0] if request.categories else "",
            prompt_override=image_prompt if image_prompt else None,
        )
        return {"avatar_url": small_url, "avatar_url_large": large_url}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"图标生成失败: {e}")


PREVIEW_IMAGE_PROMPT_TEMPLATE = """你是D&D 5E物品图标设计专家。请根据以下信息生成一段简洁的英文图像生成提示词。

## 物品信息
{info}

## 风格要求（必须严格遵守）
- 扁平化游戏UI图标风格 (flat design game UI icon)
- 暗色纯色背景（深紫色、深棕色或深灰色）
- 简洁的几何形状，清晰的轮廓线
- 物品居中，占据画面80%
- 少量星星或光点作为装饰
- 无复杂细节，小尺寸(64px)也能清晰辨认

## 输出要求
生成一段60词以内的英文描述。格式：
"Flat design game icon, [物品描述], centered on dark purple background, clean geometric shapes, minimalist style, small sparkle decorations, game UI asset"

只返回英文描述，不要其他内容。"""


async def _generate_preview_image_prompt(db: AsyncSession, text_parts: list[str]) -> str:
    """Use FAST model to generate an image prompt from item description parts"""
    try:
        config = await ai_model_service.get_model_config(db, ModelType.FAST)
    except Exception as e:
        print(f"[AvatarPreview] No FAST model, skipping prompt generation: {e}")
        return ""

    info = "\n".join(text_parts)
    prompt = PREVIEW_IMAGE_PROMPT_TEMPLATE.format(info=info)

    endpoint = config.api_url.rstrip('/')
    if not endpoint.endswith('/chat/completions'):
        endpoint = endpoint + '/chat/completions'

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                endpoint,
                json={
                    "model": config.model_name,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 300,
                    "temperature": 0.7
                },
                headers={
                    "Authorization": f"Bearer {config.api_key}",
                    "Content-Type": "application/json",
                },
            )

        if resp.status_code != 200:
            print(f"[AvatarPreview] LLM API error: {resp.status_code}")
            return ""

        data = resp.json()
        image_prompt = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        print(f"[AvatarPreview] Generated image prompt: {image_prompt[:100]}...")
        return image_prompt.strip()

    except Exception as e:
        print(f"[AvatarPreview] LLM call failed: {e}")
        return ""


class AIImportSingleRequest(BaseModel):
    """AI格式化单个物品并导入"""
    module_id: str
    campaign_id: int
    item_index: int  # 物品在模组中的索引


class AIImportBatchRequest(BaseModel):
    """AI批量格式化导入所有物品"""
    module_id: str
    campaign_id: int


@router.post("/ai-import-single")
async def ai_import_single_item(
    request: AIImportSingleRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    AI格式化单个物品后导入到资源库。
    使用FAST模型将原始物品数据格式化为结构化数据。
    """
    await require_campaign_dm(request.campaign_id, current_user, db)
    # Get module
    result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == request.module_id)
    )
    module = result.scalar_one_or_none()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    module_items = module.items or []
    if request.item_index < 0 or request.item_index >= len(module_items):
        raise HTTPException(status_code=400, detail="Invalid item index")

    raw_item = module_items[request.item_index]

    # Check duplicate
    existing = await db.execute(
        select(Item).where(
            Item.campaign_id == request.campaign_id,
            Item.name == raw_item.get("name")
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"物品 '{raw_item.get('name')}' 已存在")

    # Format with LLM
    formatted = await _format_item_with_llm(db, raw_item)

    # Create Item
    new_item = Item(
        campaign_id=request.campaign_id,
        name=formatted.get("name", raw_item.get("name", "Unknown")),
        name_cn=formatted.get("name") if not formatted.get("name_en") else None,
        category=formatted.get("category", "wondrous_item"),
        subcategory=formatted.get("subcategory"),
        rarity=_normalize_rarity(formatted.get("rarity", "common")),
        description=formatted.get("description", ""),
        damage=formatted.get("damage"),
        properties=formatted.get("properties"),
        requires_attunement=bool(formatted.get("requires_attunement", False)),
        attunement_by=formatted.get("attunement_by"),
        magic_bonus=formatted.get("magic_bonus"),
        extra_damage=formatted.get("extra_damage"),
        abilities=formatted.get("abilities"),
        charges=formatted.get("charges"),
        item_spells=formatted.get("item_spells"),
        sentient=formatted.get("sentient"),
        source_module=module.title or request.module_id,
        is_custom=False,
    )

    db.add(new_item)
    await db.commit()
    await db.refresh(new_item)

    return new_item


@router.post("/ai-import-batch")
async def ai_import_batch_items(
    request: AIImportBatchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    AI一键导入：批量格式化所有物品后导入到资源库。
    使用FAST模型逐个格式化物品数据。
    """
    await require_campaign_dm(request.campaign_id, current_user, db)
    # Get module
    result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == request.module_id)
    )
    module = result.scalar_one_or_none()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    module_items = module.items or []
    if not module_items:
        raise HTTPException(status_code=400, detail="Module has no items")

    imported_items = []
    skipped = 0

    for raw_item in module_items:
        # Check duplicate
        existing = await db.execute(
            select(Item).where(
                Item.campaign_id == request.campaign_id,
                Item.name == raw_item.get("name")
            )
        )
        if existing.scalar_one_or_none():
            skipped += 1
            continue

        # Format with LLM
        formatted = await _format_item_with_llm(db, raw_item)

        # Create Item
        new_item = Item(
            campaign_id=request.campaign_id,
            name=formatted.get("name", raw_item.get("name", "Unknown")),
            name_cn=formatted.get("name") if not formatted.get("name_en") else None,
            category=formatted.get("category", "wondrous_item"),
            subcategory=formatted.get("subcategory"),
            rarity=_normalize_rarity(formatted.get("rarity", "common")),
            description=formatted.get("description", ""),
            damage=formatted.get("damage"),
            properties=formatted.get("properties"),
            requires_attunement=bool(formatted.get("requires_attunement", False)),
            attunement_by=formatted.get("attunement_by"),
            magic_bonus=formatted.get("magic_bonus"),
            extra_damage=formatted.get("extra_damage"),
            abilities=formatted.get("abilities"),
            charges=formatted.get("charges"),
            item_spells=formatted.get("item_spells"),
            sentient=formatted.get("sentient"),
            source_module=module.title or request.module_id,
            is_custom=False,
        )

        db.add(new_item)
        await db.flush()
        imported_items.append(new_item)

    await db.commit()

    # Refresh all items
    for item in imported_items:
        await db.refresh(item)

    return {
        "imported_count": len(imported_items),
        "skipped_count": skipped,
        "items": imported_items
    }


class ParseCustomItemRequest(BaseModel):
    """从自然语言描述解析物品"""
    campaign_id: int
    description: str  # 用户输入的物品描述文本
    categories: list[str] = []  # 物品种类提示，如 ["weapon", "magical"]
    name: str | None = None  # 用户指定的名称（可选，留空则AI自动生成）
    appearance: str | None = None  # 用户指定的外貌描述（可选）
    avatar_url: str | None = None  # 前端已生成的预览头像URL
    parsed_data: dict | None = None  # 预览编辑后的完整数据，有值时跳过AI解析


class ParseCustomItemPreviewRequest(BaseModel):
    """预览解析物品（不入库）"""
    description: str
    categories: list[str] = []
    name: str | None = None
    appearance: str | None = None
    avatar_url: str | None = None


@router.post("/parse-custom/preview")
async def preview_custom_item(
    request: ParseCustomItemPreviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    预览解析自定义物品：调用AI解析但不入库，返回解析后的JSON + 头像URL。
    """
    if not request.description or len(request.description.strip()) < 5:
        raise HTTPException(status_code=400, detail="物品描述太短，请提供更详细的描述")

    llm_description = request.description
    if request.appearance:
        llm_description += f"\n\n外貌描述：{request.appearance}"

    parsed = await _parse_custom_item_with_llm(db, llm_description, request.categories)

    # 如果用户指定了名称，覆盖AI生成的
    if request.name:
        parsed["name"] = request.name

    # 规范化稀有度
    if parsed.get("rarity"):
        parsed["rarity"] = _normalize_rarity(parsed["rarity"])

    # 头像：优先用前端传入的，否则自动生成
    avatar_url = request.avatar_url
    avatar_url_large = request.avatar_url
    if not avatar_url:
        try:
            item_name = parsed.get("name", "自定义物品")
            appearance_text = request.appearance or parsed.get("appearance") or ""
            text_parts = [f"物品名称: {item_name}"]
            if appearance_text:
                text_parts.append(f"外貌: {appearance_text}")
            elif parsed.get("description"):
                text_parts.append(f"描述: {parsed['description'][:200]}")
            cat = parsed.get("category", "")
            if cat:
                text_parts.append(f"类别: {cat}")
            image_prompt = await _generate_preview_image_prompt(db, text_parts)
            small_url, large_url = await avatar_service.generate_avatar(
                db=db, entity_type="item", entity_id=0,
                name=item_name, description=parsed.get("description", ""),
                appearance=appearance_text, category=cat,
                prompt_override=image_prompt if image_prompt else None,
            )
            avatar_url = small_url
            avatar_url_large = large_url
        except Exception:
            pass  # 头像生成失败不阻断预览

    return {
        "parsed": parsed,
        "avatar_url": avatar_url,
        "avatar_url_large": avatar_url_large,
    }


@router.post("/parse-custom", response_model=ItemResponse)
async def parse_and_create_custom_item(
    request: ParseCustomItemRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    从自然语言描述解析并创建自定义物品。
    使用FAST模型分析用户输入的文字描述，自动提取物品属性并创建。
    """
    if not request.description or len(request.description.strip()) < 5:
        raise HTTPException(status_code=400, detail="物品描述太短，请提供更详细的描述")

    await require_campaign_dm(request.campaign_id, current_user, db)

    # 如果前端传入了预览编辑后的完整数据，跳过AI解析
    if request.parsed_data:
        parsed = request.parsed_data
        _validate_parsed_item(parsed)
    else:
        # 如果用户提供了外貌描述，追加到主描述中供LLM参考
        llm_description = request.description
        if request.appearance:
            llm_description += f"\n\n外貌描述：{request.appearance}"

        # Parse with LLM
        parsed = await _parse_custom_item_with_llm(db, llm_description, request.categories)

    # 如果用户指定了名称，优先使用
    item_name = request.name if request.name else parsed.get("name", "自定义物品")

    # Check duplicate — if same name exists in this campaign, return existing item
    existing = await db.execute(
        select(Item).where(
            Item.campaign_id == request.campaign_id,
            Item.name == item_name
        )
    )
    existing_item = existing.scalar_one_or_none()
    if existing_item:
        if request.avatar_url and (not existing_item.has_avatar or is_temporary_avatar_url(existing_item.avatar_url)):
            repaired = await materialize_avatar_url(
                request.avatar_url,
                "item",
                existing_item.id,
                item_name,
            )
            if repaired:
                existing_item.avatar_url, existing_item.avatar_url_large = repaired
                existing_item.has_avatar = True
                await db.commit()
                await db.refresh(existing_item)
        # 如果已有物品没头像，补生成一个
        if not existing_item.has_avatar:
            try:
                text_parts = [f"物品名称: {item_name}"]
                if request.appearance:
                    text_parts.append(f"外貌: {request.appearance}")
                elif existing_item.description:
                    text_parts.append(f"描述: {existing_item.description[:200]}")
                cat = existing_item.category or ""
                if cat:
                    text_parts.append(f"类别: {cat}")
                image_prompt = await _generate_preview_image_prompt(db, text_parts)
                small_url, large_url = await avatar_service.generate_avatar(
                    db=db, entity_type="item", entity_id=existing_item.id,
                    name=item_name, description=existing_item.description or "",
                    appearance=request.appearance or "", category=cat,
                    prompt_override=image_prompt if image_prompt else None,
                )
                existing_item.avatar_url = small_url
                existing_item.avatar_url_large = large_url
                existing_item.has_avatar = True
                await db.commit()
                await db.refresh(existing_item)
            except Exception:
                pass
        return existing_item

    # Create Item
    new_item = Item(
        campaign_id=request.campaign_id,
        name=item_name,
        name_cn=item_name if not parsed.get("name_en") else None,
        category=parsed.get("category", "wondrous_item"),
        subcategory=parsed.get("subcategory"),
        cost=parsed.get("cost"),
        weight=parsed.get("weight"),
        rarity=_normalize_rarity(parsed.get("rarity", "common")),
        description=parsed.get("description", request.description),
        damage=parsed.get("damage"),
        range=parsed.get("range"),
        properties=parsed.get("properties"),
        armor_class=parsed.get("armor_class"),
        requires_attunement=bool(parsed.get("requires_attunement", False)),
        attunement_by=parsed.get("attunement_by"),
        magic_bonus=parsed.get("magic_bonus"),
        extra_damage=parsed.get("extra_damage"),
        abilities=parsed.get("abilities"),
        charges=parsed.get("charges"),
        item_spells=parsed.get("item_spells"),
        sentient=parsed.get("sentient"),
        source_module=None,
        is_custom=True,
    )

    db.add(new_item)
    await db.commit()
    await db.refresh(new_item)

    if request.avatar_url:
        repaired = await materialize_avatar_url(
            request.avatar_url,
            "item",
            new_item.id,
            item_name,
        )
        if repaired:
            new_item.avatar_url, new_item.avatar_url_large = repaired
        else:
            new_item.avatar_url = request.avatar_url
            new_item.avatar_url_large = request.avatar_url
        new_item.has_avatar = True
        await db.commit()
        await db.refresh(new_item)

    # 如果没有头像，自动用名称+描述生成一个
    if not new_item.has_avatar:
        try:
            # 优先使用用户填写的外貌 > LLM生成的外貌 > 物品描述
            appearance_text = request.appearance or parsed.get("appearance") or ""
            text_parts = [f"物品名称: {item_name}"]
            if appearance_text:
                text_parts.append(f"外貌: {appearance_text}")
            elif parsed.get("description"):
                text_parts.append(f"描述: {parsed['description'][:200]}")
            cat = parsed.get("category", "")
            if cat:
                text_parts.append(f"类别: {cat}")
            image_prompt = await _generate_preview_image_prompt(db, text_parts)
            small_url, large_url = await avatar_service.generate_avatar(
                db=db,
                entity_type="item",
                entity_id=new_item.id,
                name=item_name,
                description=parsed.get("description", ""),
                appearance=request.appearance or "",
                category=cat,
                prompt_override=image_prompt if image_prompt else None,
            )
            new_item.avatar_url = small_url
            new_item.avatar_url_large = large_url
            new_item.has_avatar = True
            await db.commit()
            await db.refresh(new_item)
        except Exception:
            pass  # 头像生成失败不阻断物品创建

    return new_item


@router.get("/{item_id}", response_model=ItemResponse)
async def get_item(
    item_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    Get a specific item by ID
    """
    result = await db.execute(
        select(Item).where(Item.id == item_id)
    )
    item = result.scalar_one_or_none()

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Item with id {item_id} not found"
        )

    if await _ensure_item_avatar_is_permanent(item, db):
        await db.commit()
        await db.refresh(item)

    return item


@router.post("/{item_id}", response_model=ItemResponse)
async def update_item(
    item_id: int,
    item_update: ItemUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Update an existing item
    """
    result = await db.execute(
        select(Item).where(Item.id == item_id)
    )
    item = result.scalar_one_or_none()

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Item with id {item_id} not found"
        )

    await require_campaign_dm(item.campaign_id, current_user, db)

    # Update only provided fields
    update_data = item_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(item, field, value)

    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(
    item_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Delete an item from the campaign resource library
    """
    result = await db.execute(
        select(Item).where(Item.id == item_id)
    )
    item = result.scalar_one_or_none()

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Item with id {item_id} not found"
        )

    await require_campaign_dm(item.campaign_id, current_user, db)

    await db.execute(delete(Item).where(Item.id == item_id))
    await db.commit()
    return None


@router.delete("/campaign/{campaign_id}/all", status_code=status.HTTP_200_OK)
async def delete_all_items(
    campaign_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Delete all items from a campaign's resource library.
    Also removes related shop_inventory records.
    """
    await require_campaign_dm(campaign_id, current_user, db)
    from app.models.shop_inventory import ShopInventory

    # First, get all item IDs for this campaign
    result = await db.execute(
        select(Item.id).where(Item.campaign_id == campaign_id)
    )
    item_ids = [row[0] for row in result.all()]

    if not item_ids:
        return {"deleted_count": 0, "message": "No items to delete"}

    # Delete shop_inventory records that reference these items
    await db.execute(
        delete(ShopInventory).where(ShopInventory.item_id.in_(item_ids))
    )

    # Delete all items
    await db.execute(
        delete(Item).where(Item.campaign_id == campaign_id)
    )

    await db.commit()

    return {"deleted_count": len(item_ids), "message": f"Deleted {len(item_ids)} items"}




class ItemAvatarGenRequest(BaseModel):
    prompt_override: Optional[str] = None
    size: Optional[str] = "256x256"


# Prompt for generating image description from item data
ITEM_IMAGE_PROMPT_TEMPLATE = """你是D&D 5E物品图标设计专家。请根据以下物品信息生成一段简洁的英文图像生成提示词。

## 物品信息
名称: {name}
{name_en_line}
类别: {category}
稀有度: {rarity}
{description_line}
{abilities_line}

## 风格要求（必须严格遵守）
生成的图标必须是：
- 扁平化游戏UI图标风格 (flat design game UI icon)
- 暗色纯色背景（深紫色、深棕色或深灰色）
- 简洁的几何形状，清晰的轮廓线
- 物品居中，占据画面80%
- 少量星星或光点作为装饰
- 无复杂细节，小尺寸(64px)也能清晰辨认
- 类似移动游戏道具图标的简约风格

## 输出要求
生成一段60词以内的英文描述。格式示例：
"Flat design game icon, [物品描述], centered on dark purple background, clean geometric shapes, minimalist style, small sparkle decorations, game UI asset"

只返回英文描述，不要其他内容。"""


async def _generate_item_image_prompt(db: AsyncSession, item: Item) -> str:
    """Use FAST model to generate an image prompt from item data"""
    try:
        config = await ai_model_service.get_model_config(db, ModelType.FAST)
    except Exception as e:
        print(f"[ItemAvatar] No FAST model, using default prompt: {e}")
        return ""  # Will use default prompt in avatar_service

    # Build description parts
    name_en_line = f"英文名: {item.name_cn}" if item.name_cn else ""
    description_line = f"描述: {item.description or item.description_cn or ''}"

    # Build abilities description
    abilities_text = ""
    if item.abilities:
        ability_names = [a.get("name", "") for a in item.abilities[:5]]
        abilities_text = f"特殊能力: {', '.join(ability_names)}"

    prompt = ITEM_IMAGE_PROMPT_TEMPLATE.format(
        name=item.name,
        name_en_line=name_en_line,
        category=item.category or "magic item",
        rarity=item.rarity or "common",
        description_line=description_line[:300] if description_line else "",
        abilities_line=abilities_text
    )

    endpoint = config.api_url.rstrip('/')
    if not endpoint.endswith('/chat/completions'):
        endpoint = endpoint + '/chat/completions'

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                endpoint,
                json={
                    "model": config.model_name,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 300,
                    "temperature": 0.7
                },
                headers={
                    "Authorization": f"Bearer {config.api_key}",
                    "Content-Type": "application/json",
                },
            )

        if resp.status_code != 200:
            print(f"[ItemAvatar] LLM API error: {resp.status_code}")
            return ""

        data = resp.json()
        image_prompt = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        print(f"[ItemAvatar] Generated image prompt: {image_prompt[:100]}...")
        return image_prompt.strip()

    except Exception as e:
        print(f"[ItemAvatar] LLM call failed: {e}")
        return ""


@router.post("/{item_id}/generate-avatar", response_model=ItemResponse)
async def generate_item_avatar(
    item_id: int,
    db: AsyncSession = Depends(get_db),
    body: Optional[ItemAvatarGenRequest] = None,
    current_user: dict = Depends(require_auth),
):
    """Generate an avatar image for an item using LLM + AVATAR model.

    1. First uses FAST model to generate an image description from item data
    2. Then uses AVATAR model to generate the actual image
    """
    print(f"[ItemAvatar] START item_id={item_id}", flush=True)

    # Ensure item exists first
    result = await db.execute(select(Item).where(Item.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Item with id {item_id} not found")

    await require_campaign_dm(item.campaign_id, current_user, db)

    try:
        # Generate image prompt using LLM (if no override provided)
        prompt_override = body.prompt_override if body else None
        if not prompt_override:
            prompt_override = await _generate_item_image_prompt(db, item)

        # Use AvatarService to generate avatar (returns tuple: small_url, large_url)
        small_url, large_url = await avatar_service.generate_avatar(
            db=db,
            entity_type="item",
            entity_id=item.id,
            name=item.name or "",
            description=item.description or item.description_cn or "",
            category=item.category or "",
            subcategory=item.subcategory or "",
            prompt_override=prompt_override if prompt_override else None,
        )

        if is_temporary_avatar_url(small_url):
            repaired = await materialize_avatar_url(small_url, "item", item.id, item.name or "")
            if repaired:
                small_url, large_url = repaired

        # Update item with avatar URLs (small for 1x1, large for bigger displays)
        item.avatar_url = small_url
        item.avatar_url_large = large_url
        item.has_avatar = True
        await db.commit()
        await db.refresh(item)

        print(f"[ItemAvatar] DONE item_id={item_id} -> small={small_url}, large={large_url}", flush=True)
        return item

    except HTTPException:
        # Re-raise HTTPExceptions from avatar_service
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to generate item avatar: {e}")


class ImportFromModuleRequest(BaseModel):
    module_id: str
    campaign_id: int
    item_indices: Optional[List[int]] = None  # If None, import all items


class ImportResult(BaseModel):
    imported_count: int
    skipped_count: int
    items: List[ItemResponse]


@router.post("/import-from-module", response_model=ImportResult)
async def import_items_from_module(
    request: ImportFromModuleRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Import magic items from a parsed module into a campaign's item library.

    - module_id: The parsed module to import from
    - campaign_id: Target campaign
    - item_indices: Optional list of item indices to import (0-based). If None, imports all.
    """
    await require_campaign_dm(request.campaign_id, current_user, db)
    # Get the parsed module
    result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == request.module_id)
    )
    module = result.scalar_one_or_none()

    if not module:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Module {request.module_id} not found"
        )

    module_items = module.items or []
    if not module_items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Module has no parsed items"
        )

    # Filter items if indices provided
    if request.item_indices is not None:
        items_to_import = []
        for idx in request.item_indices:
            if 0 <= idx < len(module_items):
                items_to_import.append(module_items[idx])
    else:
        items_to_import = module_items

    imported_items = []
    skipped = 0

    for item_data in items_to_import:
        # Check for duplicate by name in same campaign
        existing = await db.execute(
            select(Item).where(
                Item.campaign_id == request.campaign_id,
                Item.name == item_data.get("name")
            )
        )
        if existing.scalar_one_or_none():
            skipped += 1
            continue

        # Create Item from parsed data
        new_item = Item(
            campaign_id=request.campaign_id,
            name=item_data.get("name", "Unknown"),
            name_cn=item_data.get("name") if not item_data.get("name_en") else None,
            category=item_data.get("category", "wondrous_item"),
            subcategory=item_data.get("subcategory"),
            rarity=item_data.get("rarity", "common"),
            description=item_data.get("description", ""),
            damage=item_data.get("damage"),
            properties=item_data.get("properties"),
            # Magic item fields
            requires_attunement=item_data.get("requires_attunement", False),
            attunement_by=item_data.get("attunement_by"),
            magic_bonus=item_data.get("magic_bonus"),
            extra_damage=item_data.get("extra_damage"),
            abilities=item_data.get("abilities"),
            charges=item_data.get("charges"),
            item_spells=item_data.get("item_spells"),
            sentient=item_data.get("sentient"),
            source_module=module.title or request.module_id,
            is_custom=False,
        )

        db.add(new_item)
        await db.flush()
        imported_items.append(new_item)

    await db.commit()

    # Refresh all items to get IDs
    for item in imported_items:
        await db.refresh(item)

    return ImportResult(
        imported_count=len(imported_items),
        skipped_count=skipped,
        items=imported_items
    )


@router.get("/module/{module_id}/preview", response_model=List[dict])
async def preview_module_items(
    module_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Preview items from a parsed module before importing.
    Returns the raw parsed item data with indices for selective import.
    """
    result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == module_id)
    )
    module = result.scalar_one_or_none()

    if not module:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Module {module_id} not found"
        )

    items = module.items or []

    # Add index to each item for selective import
    return [{"index": i, **item} for i, item in enumerate(items)]


@router.post("/module/{module_id}/reparse-structured")
async def reparse_module_items_structured(
    module_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Re-parse module items from simple format to structured format using LLM.
    This converts items with (name, description, actions) to full structured data
    including abilities, charges, spells, etc.
    """
    # Verify user is module creator
    module = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == module_id)
    )
    module = module.scalar_one_or_none()
    if not module:
        raise HTTPException(status_code=404, detail=f"Module {module_id} not found")
    uid = str(current_user["user_id"])
    if module.created_by != uid and uid != "0":
        raise HTTPException(status_code=403, detail="Only the module creator can reparse items")

    result = await magic_item_parser.reparse_module_items(db, module_id)

    if result.get("status") == "error":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result.get("message", "Failed to reparse items")
        )

    return result


# ================== AI Import APIs (using FAST model) ==================

# Prompt for formatting a single item
SINGLE_ITEM_FORMAT_PROMPT = """你是D&D 5E魔法物品数据格式化专家。请将以下物品格式化为结构化JSON。

## 输入物品
{content}

## 输出要求
返回单个JSON对象（不是数组），包含以下字段：
```json
{{
  "name": "中文名称",
  "name_en": "英文名称（如果有）",
  "category": "物品类别(weapon/armor/ammunition/wondrous_item/wand/rod/ring/potion/scroll/staff)",
  "subcategory": "子类别（如适用）",
  "rarity": "稀有度(common/uncommon/rare/very_rare/legendary/artifact)",
  "requires_attunement": true/false,
  "attunement_by": "同调限制（如有）",
  "description": "物品描述",
  "magic_bonus": null或数字,
  "damage": null或{{"dice": "骰子", "type": "伤害类型"}},
  "extra_damage": null或{{"dice": "骰子", "type": "伤害类型"}},
  "abilities": [
    {{
      "name": "能力名称",
      "type": "passive/active/rechargeable/triggered",
      "description": "能力描述",
      "uses": null或{{"per": "day/long_rest/short_rest", "max": 数量}}
    }}
  ],
  "charges": null或{{"max": 最大充能, "recharge": {{"time": "dawn", "amount": "1d6+1"}}}},
  "item_spells": null或[{{"name": "法术名", "charges": 消耗, "level": 环阶}}],
  "properties": ["武器特性列表"]
}}
```

只返回JSON对象，不要其他内容。"""


async def _format_item_with_llm(db: AsyncSession, raw_item: dict) -> dict:
    """Use FAST model to format a raw item into structured format"""
    try:
        config = await ai_model_service.get_model_config(db, ModelType.FAST)
    except Exception as e:
        print(f"[AI Import] Failed to get FAST model config: {e}")
        return raw_item  # Return as-is if no AI available

    # Build content from raw item
    content = f"### {raw_item.get('name', 'Unknown')}\n"
    if raw_item.get('name_en'):
        content += f"英文名: {raw_item.get('name_en')}\n"
    if raw_item.get('description'):
        content += f"\n{raw_item.get('description')}\n"
    if raw_item.get('actions'):
        content += f"\n特殊能力:\n{raw_item.get('actions')}\n"

    prompt = SINGLE_ITEM_FORMAT_PROMPT.format(content=content)

    endpoint = config.api_url.rstrip('/')
    if not endpoint.endswith('/chat/completions'):
        endpoint = endpoint + '/chat/completions'

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                endpoint,
                json={
                    "model": config.model_name,
                    "messages": [
                        {"role": "user", "content": prompt}
                    ],
                    "max_tokens": 2000,
                    "temperature": 0.1
                },
                headers={
                    "Authorization": f"Bearer {config.api_key}",
                    "Content-Type": "application/json",
                },
            )

        if resp.status_code != 200:
            print(f"[AI Import] LLM API error: {resp.status_code}")
            return raw_item

        data = resp.json()
        response_content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

        if not response_content:
            return raw_item

        # Parse JSON from response
        parsed = _parse_json_object(response_content)
        if parsed:
            return parsed

        return raw_item

    except Exception as e:
        print(f"[AI Import] LLM call failed: {e}")
        return raw_item


def _parse_json_object(text: str) -> dict:
    """Parse JSON object from LLM response"""
    # Direct parse
    try:
        result = json.loads(text)
        if isinstance(result, dict):
            return result
    except:
        pass

    # Extract from code block
    code_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', text)
    if code_match:
        try:
            result = json.loads(code_match.group(1))
            if isinstance(result, dict):
                return result
        except:
            pass

    # Find object brackets
    brace_match = re.search(r'\{[\s\S]*\}', text)
    if brace_match:
        try:
            result = json.loads(brace_match.group(0))
            if isinstance(result, dict):
                return result
        except:
            pass

    return None


def _normalize_rarity(rarity: str) -> str:
    """Normalize rarity to standard format"""
    if not rarity:
        return "common"
    rarity_lower = rarity.lower()
    mapping = {
        "普通": "common", "不常见": "uncommon", "罕见": "rare",
        "非常罕见": "very_rare", "极罕见": "very_rare",
        "传奇": "legendary", "神器": "artifact",
    }
    for cn, en in mapping.items():
        if cn in rarity_lower:
            return en
    for v in ["common", "uncommon", "rare", "very_rare", "legendary", "artifact"]:
        if v in rarity_lower:
            return v
    return "common"


# ================== Custom Item Parsing (from text description) ==================

# Prompt for parsing custom item from natural language
CUSTOM_ITEM_PARSE_PROMPT = """你是D&D 5E物品数据解析专家。请从以下自然语言描述中提取物品信息，并格式化为结构化JSON。

## 用户输入
{description}

## 输出要求
返回单个JSON对象，包含以下字段：
```json
{{
  "name": "物品中文名称",
  "name_en": "英文名称（如果有）",
  "appearance": "物品外观的简洁视觉描述（50字以内），用于生成图标。重点描述形状、颜色、材质、发光效果等视觉特征。",
  "category": "物品类别(weapon/armor/ammunition/wondrous_item/wand/rod/ring/potion/scroll/staff/adventuring_gear/tool)",
  "subcategory": "子类别（如剑类型: longsword/shortsword/greatsword 等）",
  "rarity": "稀有度(common/uncommon/rare/very_rare/legendary/artifact)",
  "requires_attunement": true或false,
  "attunement_by": "同调限制（如'法术施放者'、'善良阵营'等，无则null）",
  "description": "物品完整的叙事性描述，包含外观、手感、材质、魔法效果等丰富细节。基于用户提供的数值和设定，用流畅的中文叙述展开。不要简单罗列数值，而要融入描述性文字中。",
  "cost": null或{{"amount": 数值, "unit": "gp"}},
  "weight": null或重量数值(磅),
  "magic_bonus": null或数字(+1/+2/+3武器或护甲的加值),
  "damage": null或{{"dice": "骰子如1d8", "type": "伤害类型如slashing/piercing/bludgeoning/fire/cold等"}},
  "extra_damage": null或{{"dice": "骰子", "type": "伤害类型"}},
  "range": null或{{"normal": 常规射程(尺), "long": 最大射程(尺)}}，远程武器必须填写,
  "armor_class": null或{{"base": AC基础值, "dex_bonus": true/false}},
  "abilities": [
    {{
      "name": "能力名称",
      "type": "passive/active/rechargeable/triggered",
      "description": "能力描述",
      "uses": null或{{"per": "day/long_rest/short_rest", "max": 使用次数}}
    }}
  ],
  "charges": null或{{"max": 最大充能, "recharge": {{"time": "dawn", "amount": "1d6+1"}}}},
  "item_spells": null或[{{"name": "法术名", "charges": 消耗充能数, "level": 施法环阶}}],
  "properties": ["武器特性如finesse/versatile/two-handed/ammunition/loading/thrown等"]
}}
```

## 注意事项
- **name 必须是简短的物品名称**（2-6个字），如"寒冰长剑"、"混沌板甲"、"爆弹枪"。绝不要把用户的指令（如"生成一个..."、"帮我做..."）当作名称。从描述中提炼出最合适的物品名称。
- **严格保留用户提供的具体数值**（伤害骰、射程、价格等），不要擅自修改
- description 字段应是丰富的叙事性描述，将用户给出的数值融入文字叙述中
- 如果描述不够详细，根据D&D 5E规则合理推断补充
- 稀有度映射：普通=common, 非凡=uncommon, 稀有=rare, 非常稀有=very_rare, 传奇=legendary, 神器=artifact
- 如果是武器，务必填写damage和相关properties；远程/投掷武器必须填写range
- 如果是护甲，务必填写armor_class
- 如果是弹药/子弹/箭矢类物品，category必须设为"ammunition"，不要设为adventuring_gear
- abilities数组可以为空[]，但不要省略这个字段

只返回JSON对象，不要其他内容。"""


def _validate_parsed_item(parsed: dict) -> None:
    """Validate and fix inconsistencies in AI-parsed item data.
    Mutates parsed in-place to ensure properties match structured fields."""
    import re

    props = parsed.get("properties") or []
    has_ammo_prop = any(p.lower() in ("ammunition", "range") for p in props)
    desc = parsed.get("description") or ""

    # If weapon has ammunition/range property but no range object, extract from description
    if has_ammo_prop and not parsed.get("range"):
        match = re.search(r"射程[为是]?\s*(\d+)\s*[/／]\s*(\d+)", desc)
        if match:
            parsed["range"] = {"normal": int(match.group(1)), "long": int(match.group(2))}
        else:
            # Default range for ranged weapons
            parsed["range"] = {"normal": 80, "long": 320}

    # If weapon category but no damage, don't override (let AI decide)
    # If armor category but no armor_class, don't override

    # Ensure abilities is always a list
    if "abilities" not in parsed:
        parsed["abilities"] = []


async def _parse_custom_item_with_llm(db: AsyncSession, description: str, categories: list[str] | None = None) -> dict:
    """Use configurable model to parse custom item from natural language description"""
    try:
        config = await ai_model_service.get_config_for_usage(db, "custom_creation")
    except Exception as e:
        print(f"[Custom Item] Failed to get model config for custom_creation: {e}")
        raise HTTPException(status_code=500, detail="AI服务不可用，请先配置模型")

    prompt = CUSTOM_ITEM_PARSE_PROMPT.format(description=description)

    # 如果指定了种类，追加约束
    if categories:
        cat_labels = {
            "weapon": "武器", "armor": "护甲",
            "jewelry": "首饰（戒指、项链、护符等）",
            "adventuring": "冒险物品（工具、消耗品、杂物等）",
            "magical": "法术物品（法杖、魔杖、卷轴、奇物等）",
        }
        labels = [cat_labels.get(c, c) for c in categories if c in cat_labels]
        if labels:
            prompt += f"\n\n用户指定的物品种类：{', '.join(labels)}。请确保生成的物品属于这些种类，并在category字段中正确反映。"

    endpoint = config.api_url.rstrip('/')
    if not endpoint.endswith('/chat/completions'):
        endpoint = endpoint + '/chat/completions'

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                endpoint,
                json={
                    "model": config.model_name,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 2000,
                    "temperature": 0.1
                },
                headers={
                    "Authorization": f"Bearer {config.api_key}",
                    "Content-Type": "application/json",
                },
            )

        if resp.status_code != 200:
            print(f"[Custom Item] LLM API error: {resp.status_code} - {resp.text}")
            raise HTTPException(status_code=500, detail="AI分析失败，请稍后重试")

        data = resp.json()
        response_content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

        if not response_content:
            raise HTTPException(status_code=500, detail="AI返回空响应")

        # Parse JSON from response
        parsed = _parse_json_object(response_content)
        if not parsed:
            raise HTTPException(status_code=500, detail="无法解析AI返回的物品数据")

        # Post-parse validation: ensure consistency between properties and structured fields
        _validate_parsed_item(parsed)

        return parsed

    except HTTPException:
        raise
    except Exception as e:
        print(f"[Custom Item] LLM call failed: {e}")
        raise HTTPException(status_code=500, detail=f"AI调用失败: {str(e)}")
