"""
Resource Chat API routes for AI-powered campaign resource Q&A (monsters, items)
"""
import asyncio
import base64
import httpx
import re
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
import json
import os
import math

from app.db.session import get_db, async_session_maker
from app.models.resource_chat import ResourceChatMessage
from app.models.monster_instance import MonsterInstance
from app.models.item import Item
from app.services.entity_creation_service import (
    EntityCreationService,
    MonsterDataNormalizer,
    size_cn_to_token_size,
)
from app.models.shop import Shop
from app.models.shop_inventory import ShopInventory
from app.models.campaign import Campaign
from app.models.token import Token
from app.models.ai_settings import AIModelConfig
from app.models.chest import Chest
from app.models.chest_inventory import ChestInventory
from app.schemas.resource_chat import (
    ResourceChatMessageCreate,
    ResourceChatMessageResponse,
    ResourceChatHistoryResponse,
    EncounterMonsterSpec,
    EncounterConfirmRequest,
    EncounterCreateResult,
    ShopCreateSpec,
    ShopCreateResult,
    ItemCreateSpec,
    ItemCreateResult,
    SceneGenerationRequest,
    ScenePlan,
    SceneCreateResult,
    ChestCreateSpec,
    ChestCreateResult,
    ChestItemSpec,
)
from app.schemas.chest import TRAP_PRESETS
from app.services.ai_service import AIService
from app.services.avatar_service import avatar_service
from app.services.ai_model_service import ai_model_service
from app.services.realtime_publisher import realtime_publisher
from app.utils.json_recovery import extract_json_from_text
from app.core.dependencies import resolve_campaign_member_context
from app.core.security import require_auth

router = APIRouter(prefix="/api/campaigns/{campaign_id}/resource-chat", tags=["Resource Chat"])

# ===== 怪物预设数据缓存 =====
_monsters_cache: List[Dict[str, Any]] = []


def load_monsters_preset() -> List[Dict[str, Any]]:
    """加载预设怪物数据"""
    global _monsters_cache
    if _monsters_cache:
        return _monsters_cache

    from app.utils.rules_cache import get_all_monsters
    _monsters_cache = get_all_monsters()
    return _monsters_cache


# ===== 装备预设数据缓存 =====
_equipment_cache: Dict[str, Any] = {}


def load_equipment_preset() -> Dict[str, Any]:
    """加载预设装备数据，返回分类后的装备字典"""
    global _equipment_cache
    if _equipment_cache:
        return _equipment_cache

    from app.utils.rules_cache import get_equipment_data
    _equipment_cache = get_equipment_data()
    return _equipment_cache


def _cost_to_gp(cost: Dict) -> float:
    """Convert cost dict to gold pieces (gp)"""
    if not cost or not isinstance(cost, dict):
        return 0
    # Conversion rates: 1 gp = 10 sp = 100 cp, 1 pp = 10 gp
    gp = cost.get('gp', 0) or 0
    sp = cost.get('sp', 0) or 0
    cp = cost.get('cp', 0) or 0
    pp = cost.get('pp', 0) or 0
    return pp * 10 + gp + sp / 10 + cp / 100


def get_equipment_summary_for_llm() -> str:
    """
    生成装备摘要供LLM参考，格式化为紧凑但可读的列表。
    按商店类型分类，便于LLM根据商店类型选择合适物品。
    """
    equipment = load_equipment_preset()
    if not equipment:
        return "无法加载预设装备数据"

    lines = []

    def format_item(item: Dict) -> str:
        """Format single item for display"""
        name = item.get('name', '')
        name_en = item.get('nameEn', item.get('id', ''))
        cost = _cost_to_gp(item.get('cost', {}))
        cost_str = f"{cost:.0f}gp" if cost >= 1 else f"{cost*10:.0f}sp"
        return f"{name}({name_en},{cost_str})"

    # 武器 - 分类列出
    if "weapons" in equipment:
        weapons = equipment["weapons"]
        lines.append("## 武器")
        for category in ["simple", "martial"]:
            if category in weapons:
                for subcat in ["melee", "ranged"]:
                    if subcat in weapons[category]:
                        items = weapons[category][subcat]
                        item_strs = [format_item(i) for i in items if isinstance(i, dict)]
                        if item_strs:
                            lines.append(f"- {category}_{subcat}: {', '.join(item_strs)}")

    # 护甲
    if "armor" in equipment:
        armor = equipment["armor"]
        lines.append("## 护甲")
        for category in ["light", "medium", "heavy", "shield"]:
            if category in armor:
                items = armor[category]
                item_strs = [format_item(i) for i in items if isinstance(i, dict)]
                if item_strs:
                    lines.append(f"- {category}: {', '.join(item_strs)}")

    # 冒险装备 - 只列出常用类别
    if "adventuringGear" in equipment:
        gear = equipment["adventuringGear"]
        lines.append("## 冒险装备")
        for category in ["general", "containers", "kits", "ammunition"]:
            if category in gear:
                items = gear[category]
                # 只取前15个以控制长度
                item_strs = [format_item(i) for i in items[:15] if isinstance(i, dict)]
                if item_strs:
                    lines.append(f"- {category}: {', '.join(item_strs)}")

    # 工具
    if "tools" in equipment:
        tools = equipment["tools"]
        lines.append("## 工具")
        for category in ["artisanTools", "gamingSets", "musicalInstruments"]:
            if category in tools:
                items = tools[category]
                item_strs = [format_item(i) for i in items[:10] if isinstance(i, dict)]
                if item_strs:
                    lines.append(f"- {category}: {', '.join(item_strs)}")

    return "\n".join(lines)


def find_preset_item(preset_id: str, name: str = None) -> Optional[Dict[str, Any]]:
    """
    根据preset_id或名称查找预设物品。
    返回物品数据或None。
    """
    equipment = load_equipment_preset()
    if not equipment:
        return None

    def search_in_category(items: List[Dict], target_id: str, target_name: str) -> Optional[Dict]:
        for item in items:
            if isinstance(item, dict):
                if target_id and item.get('id') == target_id:
                    return item
                if target_name and (item.get('name') == target_name or item.get('nameEn', '').lower() == target_name.lower()):
                    return item
        return None

    # 搜索武器
    if "weapons" in equipment:
        for cat in equipment["weapons"].values():
            if isinstance(cat, dict):
                for subcat in cat.values():
                    if isinstance(subcat, list):
                        result = search_in_category(subcat, preset_id, name)
                        if result:
                            return result

    # 搜索护甲
    if "armor" in equipment:
        for items in equipment["armor"].values():
            if isinstance(items, list):
                result = search_in_category(items, preset_id, name)
                if result:
                    return result

    # 搜索冒险装备
    if "adventuringGear" in equipment:
        for items in equipment["adventuringGear"].values():
            if isinstance(items, list):
                result = search_in_category(items, preset_id, name)
                if result:
                    return result

    # 搜索工具
    if "tools" in equipment:
        for items in equipment["tools"].values():
            if isinstance(items, list):
                result = search_in_category(items, preset_id, name)
                if result:
                    return result

    return None


# ===== 后台图标生成函数 =====
async def _generate_shop_avatar_background(
    shop_id: int,
    campaign_id: int,
    name: str,
    description: str,
    appearance: str
):
    """Background task to generate shop avatar after creation.
    First checks for existing avatars from same-name shops to avoid redundant AI generation.
    """
    print(f"[ResourceChat] Starting avatar lookup/generation for shop {shop_id}: {name}", flush=True)
    try:
        async with async_session_maker() as db:
            # First, try to find existing avatar from same-name shop
            existing_result = await db.execute(
                select(Shop)
                .where(Shop.name == name)
                .where(Shop.has_avatar == True)
                .where(Shop.avatar_url.isnot(None))
                .where(Shop.id != shop_id)
                .limit(1)
            )
            existing_shop = existing_result.scalar_one_or_none()

            if existing_shop and existing_shop.avatar_url:
                # Reuse existing avatar
                print(f"[ResourceChat] Found existing avatar for shop '{name}' from shop {existing_shop.id}", flush=True)
                small_url = existing_shop.avatar_url
                large_url = existing_shop.avatar_url_large

                # Update current shop with reused avatar
                shop = await db.get(Shop, shop_id)
                if shop:
                    shop.avatar_url = small_url
                    shop.avatar_url_large = large_url
                    shop.has_avatar = True
                    await db.commit()

                # Broadcast avatar update
                await realtime_publisher.publish_shop_avatar_updated(
                    campaign_id,
                    shop_id=shop_id,
                    avatar_url=small_url,
                    avatar_url_large=large_url,
                )
                print(f"[ResourceChat] Shop {shop_id} reused existing avatar: {small_url}", flush=True)
                return

            # No existing avatar found, generate new one
            print(f"[ResourceChat] No existing avatar for shop '{name}', generating new one", flush=True)

            small_url, large_url = await avatar_service.generate_avatar(
                db=db,
                entity_type='shop',
                entity_id=shop_id,
                name=name,
                description=description,
                appearance=appearance
            )
            # Update shop with avatar URLs
            shop = await db.get(Shop, shop_id)
            if shop:
                shop.avatar_url = small_url
                shop.avatar_url_large = large_url
                shop.has_avatar = True
                await db.commit()

            # Broadcast avatar update via WebSocket
            await realtime_publisher.publish_shop_avatar_updated(
                campaign_id,
                shop_id=shop_id,
                avatar_url=small_url,
                avatar_url_large=large_url,
            )
            print(f"[ResourceChat] Shop {shop_id} avatar generated: {small_url}", flush=True)
    except Exception as e:
        print(f"[ResourceChat] Failed to generate avatar for shop {shop_id}: {e}", flush=True)


async def _generate_item_avatar_background(
    item_id: int,
    campaign_id: int,
    name: str,
    category: str,
    rarity: str,
    description: str
):
    """Background task to generate item avatar after creation"""
    print(f"[ResourceChat] Starting background avatar generation for item {item_id}", flush=True)
    try:
        async with async_session_maker() as db:
            small_url, large_url = await avatar_service.generate_avatar(
                db=db,
                entity_type='item',
                entity_id=item_id,
                name=name,
                description=description,
                category=category,
                subcategory=rarity
            )
            # Update item with avatar URLs
            item = await db.get(Item, item_id)
            if item:
                item.avatar_url = small_url
                item.avatar_url_large = large_url
                item.has_avatar = True
                await db.commit()

            # Broadcast avatar update via WebSocket
            await realtime_publisher.publish_item_avatar_updated(
                campaign_id,
                item_id=item_id,
                avatar_url=small_url,
                avatar_url_large=large_url,
            )
            print(f"[ResourceChat] Item {item_id} avatar generated: {small_url}", flush=True)
    except Exception as e:
        print(f"[ResourceChat] Failed to generate avatar for item {item_id}: {e}", flush=True)

def match_monster_by_name(name: str) -> Optional[Dict[str, Any]]:
    """根据名称匹配怪物，优先精确匹配，包含匹配需要足够相似"""
    monsters = load_monsters_preset()
    name_lower = name.lower().strip()
    name_len = len(name_lower)

    # 1. 精确匹配
    for m in monsters:
        m_name = m.get('name', '').lower()
        m_name_en = m.get('nameEn', '').lower()
        if m_name == name_lower or m_name_en == name_lower:
            return m

    # 2. 高相似度包含匹配（被搜索名必须包含预设名的大部分内容）
    best_match = None
    best_score = 0

    for m in monsters:
        m_name = m.get('name', '').lower()
        m_name_en = m.get('nameEn', '').lower()
        m_name_len = len(m_name)

        # 跳过太短的预设名称（单字如"龙"容易误匹配）
        if m_name_len <= 1:
            continue

        # 搜索名完全包含预设名，且预设名长度占搜索名的较大比例
        if m_name in name_lower and m_name_len >= name_len * 0.6:
            score = m_name_len / name_len
            if score > best_score:
                best_score = score
                best_match = m

        # 预设名完全包含搜索名，且搜索名长度占预设名的较大比例
        if name_lower in m_name and name_len >= m_name_len * 0.6:
            score = name_len / m_name_len
            if score > best_score:
                best_score = score
                best_match = m

        # 英文名匹配
        if m_name_en:
            m_en_len = len(m_name_en)
            if m_name_en in name_lower and m_en_len >= name_len * 0.6:
                score = m_en_len / name_len
                if score > best_score:
                    best_score = score
                    best_match = m
            if name_lower in m_name_en and name_len >= m_en_len * 0.6:
                score = name_len / m_en_len
                if score > best_score:
                    best_score = score
                    best_match = m

    # 只有相似度足够高时才返回
    if best_match and best_score >= 0.5:
        return best_match

    return None


def extract_entities_from_response(text: str) -> Dict[str, List[Dict]]:
    """从AI回复中提取 '中文名(English Name)' 格式的实体，匹配预设数据库"""
    # 匹配 "中文名(English Name)" 或 "中文名（English Name）" 格式
    pattern = r'([\u4e00-\u9fff\w·]+)\s*[（(]([A-Za-z][\w\s\'-]*)[）)]'
    matches = re.findall(pattern, text)

    seen_monsters = set()
    seen_items = set()
    monsters = []
    items = []

    for cn_name, en_name in matches:
        cn_name = cn_name.strip()
        en_name = en_name.strip()

        # 尝试匹配怪物
        matched_monster = match_monster_by_name(cn_name) or match_monster_by_name(en_name)
        if matched_monster:
            key = matched_monster.get("id", cn_name)
            if key not in seen_monsters:
                seen_monsters.add(key)
                monsters.append({
                    "name": matched_monster.get("name", cn_name),
                    "name_en": matched_monster.get("nameEn", en_name),
                    "cr": matched_monster.get("cr"),
                    "type": matched_monster.get("type"),
                    "size": matched_monster.get("size"),
                    "hp": matched_monster.get("hp"),
                    "ac": matched_monster.get("ac"),
                    "monster_id": matched_monster.get("id"),
                    "matched": True,
                    "avatar_url": matched_monster.get("defaultAvatarSmall"),
                })
            continue

        # 尝试匹配物品
        matched_item = find_preset_item(en_name, cn_name)
        if matched_item:
            key = matched_item.get("id", cn_name)
            if key not in seen_items:
                seen_items.add(key)
                items.append({
                    "name": matched_item.get("name", cn_name),
                    "name_en": matched_item.get("nameEn", en_name),
                    "preset_id": matched_item.get("id"),
                    "category": "gear",
                    "cost_gp": _cost_to_gp(matched_item.get("cost", {})),
                    "matched": True,
                    "avatar_url": matched_item.get("iconPath"),
                })

    result = {}
    if monsters:
        result["monsters"] = monsters
    if items:
        result["items"] = items
    return result


def calculate_spiral_positions(center: Dict[str, int], count: int, spacing: int = 2) -> List[Dict[str, int]]:
    """计算螺旋散开的位置"""
    positions = []
    if count == 0:
        return positions

    cx, cy = center['x'], center['y']
    positions.append({'x': cx, 'y': cy})

    if count == 1:
        return positions

    # 螺旋方向: 右、下、左、上
    directions = [(1, 0), (0, 1), (-1, 0), (0, -1)]
    x, y = cx, cy
    steps_in_direction = 1
    direction_index = 0
    steps_taken = 0
    direction_changes = 0

    for _ in range(count - 1):
        dx, dy = directions[direction_index]
        x += dx * spacing
        y += dy * spacing
        positions.append({'x': x, 'y': y})

        steps_taken += 1
        if steps_taken == steps_in_direction:
            steps_taken = 0
            direction_index = (direction_index + 1) % 4
            direction_changes += 1
            if direction_changes % 2 == 0:
                steps_in_direction += 1

    return positions


async def get_chat_params(db: AsyncSession):
    """Get model configuration and params for resource chat via usage config"""
    return await ai_model_service.get_usage_params(db, "resource_chat")


def build_monster_context(monsters: list[MonsterInstance]) -> str:
    """Build context string from monster instances"""
    if not monsters:
        return ""

    context_parts = []
    for m in monsters:
        parts = [f"**{m.name_cn or m.name}** (CR {m.challenge_rating or '?'})"]
        if m.type:
            parts.append(f"类型: {m.type}")
        if m.size:
            parts.append(f"体型: {m.size}")
        if m.armor_class:
            parts.append(f"AC: {m.armor_class}")
        if m.hit_points:
            parts.append(f"HP: {m.hit_points}")
        if m.current_hp is not None:
            parts.append(f"当前HP: {m.current_hp}")

        # Include ability scores if available
        if m.ability_scores:
            scores = m.ability_scores
            score_str = f"力{scores.get('str', '-')} 敏{scores.get('dex', '-')} 体{scores.get('con', '-')} 智{scores.get('int', '-')} 感{scores.get('wis', '-')} 魅{scores.get('cha', '-')}"
            parts.append(f"属性: {score_str}")

        # Include special abilities from monster_data if available
        if m.monster_data:
            data = m.monster_data
            if data.get('special_abilities'):
                abilities = []
                for a in data['special_abilities'][:5]:
                    if isinstance(a, dict):
                        abilities.append(a.get('name', ''))
                    elif isinstance(a, str):
                        abilities.append(a)
                if abilities:
                    parts.append(f"特殊能力: {', '.join(abilities)}")
            if data.get('actions'):
                actions = []
                for a in data['actions'][:5]:
                    if isinstance(a, dict):
                        actions.append(a.get('name', ''))
                    elif isinstance(a, str):
                        actions.append(a)
                if actions:
                    parts.append(f"动作: {', '.join(actions)}")

        if m.notes:
            parts.append(f"DM备注: {m.notes}")

        context_parts.append(" | ".join(parts))

    return "\n".join(context_parts)


def build_item_context(items: list[Item]) -> str:
    """Build context string from items"""
    if not items:
        return ""

    context_parts = []
    for item in items:
        parts = [f"**{item.name_cn or item.name}**"]
        if item.rarity:
            parts.append(f"稀有度: {item.rarity}")
        if item.category:
            parts.append(f"类型: {item.category}")
        if item.requires_attunement:
            attn = "需要调谐"
            if item.attunement_by:
                attn += f" ({item.attunement_by})"
            parts.append(attn)
        if item.magic_bonus:
            parts.append(f"+{item.magic_bonus}魔法加值")
        if item.damage:
            dmg = item.damage
            parts.append(f"伤害: {dmg.get('dice', '')} {dmg.get('type', '')}")
        if item.armor_class:
            ac = item.armor_class
            parts.append(f"AC: {ac.get('base', '')}")
        if item.description_cn:
            # Truncate long descriptions
            desc = item.description_cn[:200] + "..." if len(item.description_cn) > 200 else item.description_cn
            parts.append(f"描述: {desc}")
        elif item.description:
            desc = item.description[:200] + "..." if len(item.description) > 200 else item.description
            parts.append(f"描述: {desc}")

        # Include abilities
        if item.abilities:
            ability_names = [a.get('name', '') for a in item.abilities[:3] if a.get('name')]
            if ability_names:
                parts.append(f"能力: {', '.join(ability_names)}")

        # Include spells
        if item.item_spells:
            spell_names = [s.get('name', '') for s in item.item_spells[:3] if s.get('name')]
            if spell_names:
                parts.append(f"法术: {', '.join(spell_names)}")

        if item.notes:
            parts.append(f"DM备注: {item.notes}")

        context_parts.append(" | ".join(parts))

    return "\n".join(context_parts)


def build_chest_context(chests: list[Chest]) -> str:
    """Build context string from chests"""
    if not chests:
        return ""

    context_parts = []
    for chest in chests:
        parts = [f"**{chest.name}** (ID:{chest.id})"]
        parts.append(f"状态: {chest.state}")
        if chest.is_locked:
            lock_info = f"上锁(DC{chest.lock_dc})"
            if chest.requires_key:
                lock_info += f", 需要钥匙: {chest.key_name or '未知'}"
            parts.append(lock_info)
        if chest.is_trapped:
            trap_info = f"有陷阱: {chest.trap_type or '未知类型'}"
            if chest.trap_detected:
                trap_info += " (已发现)"
            if chest.trap_disarmed:
                trap_info += " (已解除)"
            parts.append(trap_info)
        # Currency
        currency_parts = []
        if chest.gp:
            currency_parts.append(f"{chest.gp}gp")
        if chest.sp:
            currency_parts.append(f"{chest.sp}sp")
        if chest.cp:
            currency_parts.append(f"{chest.cp}cp")
        if chest.pp:
            currency_parts.append(f"{chest.pp}pp")
        if currency_parts:
            parts.append(f"货币: {', '.join(currency_parts)}")
        if chest.description:
            desc = chest.description[:100] + "..." if len(chest.description) > 100 else chest.description
            parts.append(f"描述: {desc}")

        context_parts.append(" | ".join(parts))

    return "\n".join(context_parts)


@router.get("", response_model=ResourceChatHistoryResponse)
async def get_chat_history(
    campaign_id: int,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Get chat history for a user in a campaign"""
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    user_id = context.user_id
    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    query = (
        select(ResourceChatMessage)
        .where(
            ResourceChatMessage.campaign_id == campaign_id,
            ResourceChatMessage.user_id == user_id
        )
        .order_by(ResourceChatMessage.created_at.asc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(query)
    messages = result.scalars().all()

    count_query = (
        select(ResourceChatMessage)
        .where(
            ResourceChatMessage.campaign_id == campaign_id,
            ResourceChatMessage.user_id == user_id
        )
    )
    count_result = await db.execute(count_query)
    total = len(count_result.scalars().all())

    return ResourceChatHistoryResponse(
        messages=[ResourceChatMessageResponse.model_validate(m) for m in messages],
        total=total
    )


@router.post("/query")
async def query_resources(
    campaign_id: int,
    request: ResourceChatMessageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Query AI about campaign resources with function calling support.
    AI can decide to: 1) answer questions, or 2) create encounters
    """
    from app.schemas.resource_chat import RESOURCE_TOOLS

    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    user_id = context.user_id

    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    usage_params = await get_chat_params(db)
    chat_config = usage_params.config
    temperature = usage_params.temperature
    max_tokens = usage_params.max_tokens

    # Save user's question
    user_message = ResourceChatMessage(
        campaign_id=campaign_id,
        user_id=user_id,
        role="user",
        content=request.content
    )
    db.add(user_message)
    await db.commit()

    # Fetch campaign resources for context
    monsters_result = await db.execute(
        select(MonsterInstance).where(MonsterInstance.campaign_id == campaign_id)
    )
    monsters = monsters_result.scalars().all()

    items_result = await db.execute(
        select(Item).where(Item.campaign_id == campaign_id)
    )
    items = items_result.scalars().all()

    chests_result = await db.execute(
        select(Chest).where(Chest.campaign_id == campaign_id)
    )
    chests = chests_result.scalars().all()

    # Build context
    monster_context = build_monster_context(list(monsters))
    item_context = build_item_context(list(items))
    chest_context = build_chest_context(list(chests))

    # Build system prompt based on mode
    if request.mode == 'query':
        # Query mode: stream response + extract entities from text
        system_prompt = f"""你是一位专业的DM助手，帮助DM查询和了解D&D 5E的资源信息。

你的任务是：
- 回答关于怪物、物品、宝箱、法术的问题
- 搜索预设数据库中的怪物和物品信息
- 提供战术建议和规则解释
- 描述战役中已有资源的详细信息

重要格式要求：
- 当提到怪物时，使用格式"中文名(English Name)"，例如"地精(Goblin)"
- 当提到物品时，同样使用"中文名(English Name)"格式
- 详细介绍一个怪物时，使用markdown二级标题，例如："## 狗头人(Kobold)"
- 提供怪物信息时包含CR、HP、AC等关键数据
- 使用markdown格式组织回答

常用怪物示例：
- 地精(Goblin) CR 1/4, 狗头人(Kobold) CR 1/8, 兽人(Orc) CR 1/2
- 食尸鬼(Ghoul) CR 1, 骷髅(Skeleton) CR 1/4, 僵尸(Zombie) CR 1/4
- 熊地精(Bugbear) CR 1, 豺狼人(Gnoll) CR 1/2, 大地精(Hobgoblin) CR 1/2
- 巨狼(Dire Wolf) CR 1, 巨蜘蛛(Giant Spider) CR 1, 巨蝎(Giant Scorpion) CR 3

战役名称：{campaign.name}

当前战役中的怪物 ({len(monsters)}个)：
{monster_context if monster_context else "（暂无怪物）"}

当前战役中的物品 ({len(items)}个)：
{item_context if item_context else "（暂无物品）"}

当前战役中的宝箱 ({len(chests)}个)：
{chest_context if chest_context else "（暂无宝箱）"}"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": request.content}
        ]

        async def generate_query_stream():
            full_response = ""
            try:
                async for chunk in AIService.generate_completion_stream(
                    api_url=chat_config.api_url,
                    api_key=chat_config.api_key,
                    model=chat_config.model_name,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens
                ):
                    full_response += chunk
                    yield f"data: {json.dumps({'content': chunk}, ensure_ascii=False)}\n\n"

                # Extract entities from response text
                search_results = extract_entities_from_response(full_response)

                # Save messages to DB with a new session (generator outlives request)
                async with async_session_maker() as gen_db:
                    # Build stored response data
                    response_data = {
                        "type": "agent_response",
                        "content": full_response,
                        "tool_calls": [],
                        "monsters_count": len(monsters),
                        "items_count": len(items),
                    }
                    if search_results:
                        response_data["search_results"] = search_results

                    assistant_msg = ResourceChatMessage(
                        campaign_id=campaign_id,
                        user_id=user_id,
                        role="assistant",
                        content=json.dumps(response_data, ensure_ascii=False)
                    )
                    gen_db.add(assistant_msg)
                    await gen_db.flush()
                    message_id = assistant_msg.id
                    await gen_db.commit()

                # Send done event with search results
                done_data: Dict[str, Any] = {"done": True, "message_id": message_id}
                if search_results:
                    done_data["search_results"] = search_results
                yield f"data: {json.dumps(done_data, ensure_ascii=False)}\n\n"

            except Exception as e:
                yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"

        return StreamingResponse(
            generate_query_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            }
        )

    # Create mode: focus on creating resources
    system_prompt = f"""你是一位专业的DM助手，帮助DM创建战役资源（遭遇、商店、物品、宝箱）。

你有以下工具可用：
1. create_encounter - 创建遭遇/设置怪物/准备战斗
2. create_shop - 创建商店（武器店、药水店、杂货店等）
3. create_item - 创建自定义物品（武器、护甲、魔法物品等）
4. create_chest - 创建宝箱（可含锁、陷阱、货币和物品）

重要规则：
- 当用户请求创建遭遇或提到怪物数量时，使用create_encounter工具
- 当用户请求创建商店时，必须使用create_shop工具
- 当用户请求创建物品时，必须使用create_item工具
- 当用户请求创建宝箱、宝藏箱、陷阱箱时，必须使用create_chest工具
- 尽量理解用户意图，即使描述不完整也要生成合理的内容

版权限制（必须遵守）：
- 禁止使用以下怪物：眼魔(beholder)、夺心魔(mind flayer)、吉斯(githyanki/githzerai)、蛇人(yuan-ti)、移位兽(displacer beast)、腐尸虫(carrion crawler)、钩爪魔(umber hulk)、凝视魔(gauth/gazer)
- 如果用户请求上述怪物，建议使用类似的开放内容替代品（如：眼魔→凝视者，夺心魔→深渊魔鱼）

战役名称：{campaign.name}

当前战役中的宝箱 ({len(chests)}个)：
{chest_context if chest_context else "（暂无宝箱）"}

请根据用户的请求使用合适的工具创建资源。"""

    tools_to_use = RESOURCE_TOOLS

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": request.content}
    ]

    try:
        # Call AI with tools (create mode uses tools)
        result = await AIService.generate_with_tools(
            api_url=chat_config.api_url,
            api_key=chat_config.api_key,
            model=chat_config.model_name,
            messages=messages,
            tools=tools_to_use,
            temperature=temperature,
            max_tokens=max_tokens
        )

        response_data = {
            "type": "agent_response",
            "content": result.get("content", ""),
            "tool_calls": [],
            "monsters_count": len(monsters),
            "items_count": len(items)
        }

        # Process tool calls
        for tc in result.get("tool_calls", []):
            tool_name = tc.get("name")
            tool_args = tc.get("arguments", {})

            if tool_name == "create_encounter":
                # Process encounter creation - match monsters
                encounter_monsters = []
                for m in tool_args.get("monsters", []):
                    name = m.get("name", "")
                    quantity = m.get("quantity", 1)
                    matched_monster = match_monster_by_name(name)

                    if matched_monster:
                        # 匹配到预设怪物，使用预设数据
                        encounter_monsters.append({
                            "name": matched_monster.get("name", name),
                            "name_en": matched_monster.get("nameEn", ""),
                            "quantity": quantity,
                            "monster_id": matched_monster.get("id"),
                            "matched": True,
                            "cr": matched_monster.get("cr"),
                            "hp": matched_monster.get("hp"),
                            "ac": matched_monster.get("ac"),
                            "size": matched_monster.get("size"),
                            "type": matched_monster.get("type"),
                        })
                    else:
                        # 未匹配到预设，保存AI生成的完整属性
                        generated_stats = {
                            "cr": m.get("cr", "1"),
                            "hp": m.get("hp", 10),
                            "hpFormula": m.get("hpFormula"),
                            "ac": m.get("ac", 10),
                            "size": m.get("size", "中型"),
                            "type": m.get("type", "人形生物"),
                            "alignment": m.get("alignment"),
                            "speed": m.get("speed", {"walk": 30}),
                            "abilityScores": m.get("abilityScores"),
                            "specialAbilities": m.get("specialAbilities", []),
                            "actions": m.get("actions", []),
                            "description": m.get("description", ""),
                        }
                        encounter_monsters.append({
                            "name": name,
                            "name_cn": name,
                            "quantity": quantity,
                            "matched": False,
                            "cr": generated_stats["cr"],
                            "hp": generated_stats["hp"],
                            "ac": generated_stats["ac"],
                            "size": generated_stats["size"],
                            "type": generated_stats["type"],
                            "generated_stats": generated_stats,
                        })

                response_data["tool_calls"].append({
                    "tool": "create_encounter",
                    "encounter_plan": {
                        "monsters": encounter_monsters,
                        "difficulty": tool_args.get("difficulty"),
                        "notes": tool_args.get("notes"),
                    }
                })

            elif tool_name == "create_shop":
                # Return shop creation plan for confirmation
                response_data["tool_calls"].append({
                    "tool": "create_shop",
                    "shop_plan": {
                        "name": tool_args.get("name", ""),
                        "description": tool_args.get("description", ""),
                        "appearance": tool_args.get("appearance", ""),
                        "gold_gp": tool_args.get("gold_gp", 1000),
                        "discount_rate": tool_args.get("discount_rate", 0.5),
                    }
                })

            elif tool_name == "create_item":
                # Return item creation plan for confirmation
                response_data["tool_calls"].append({
                    "tool": "create_item",
                    "item_plan": {
                        "name": tool_args.get("name", ""),
                        "name_cn": tool_args.get("name_cn", tool_args.get("name", "")),
                        "category": tool_args.get("category", "wondrous_item"),
                        "rarity": tool_args.get("rarity", "common"),
                        "description": tool_args.get("description", ""),
                        "cost": tool_args.get("cost"),
                        "weight": tool_args.get("weight"),
                        "damage": tool_args.get("damage"),
                        "armor_class": tool_args.get("armor_class"),
                        "properties": tool_args.get("properties"),
                        "range": tool_args.get("range"),
                        "strength_requirement": tool_args.get("strength_requirement"),
                        "stealth_disadvantage": tool_args.get("stealth_disadvantage"),
                        "magic_bonus": tool_args.get("magic_bonus"),
                        "requires_attunement": tool_args.get("requires_attunement", False),
                        "attunement_by": tool_args.get("attunement_by"),
                        "abilities": tool_args.get("abilities"),
                        "charges": tool_args.get("charges"),
                    }
                })

            elif tool_name == "create_chest":
                # Return chest creation plan for confirmation
                chest_plan = {
                    "name": tool_args.get("name", "宝箱"),
                    "description": tool_args.get("description", ""),
                    "appearance": tool_args.get("appearance", ""),
                    "is_locked": tool_args.get("is_locked", True),
                    "lock_dc": tool_args.get("lock_dc", 15),
                    "requires_key": tool_args.get("requires_key", False),
                    "key_name": tool_args.get("key_name"),
                    "is_trapped": tool_args.get("is_trapped", False),
                    "trap_type": tool_args.get("trap_type"),
                    "currency": tool_args.get("currency", {}),
                    "items": tool_args.get("items", []),
                }
                response_data["tool_calls"].append({
                    "tool": "create_chest",
                    "chest_plan": chest_plan,
                })

        # Generate default content if tool_calls exist but content is empty
        if response_data["tool_calls"] and not response_data["content"]:
            tool_names = [tc["tool"] for tc in response_data["tool_calls"]]
            if "create_encounter" in tool_names:
                response_data["content"] = "已为您生成遭遇计划，请确认是否创建："
            elif "create_shop" in tool_names:
                response_data["content"] = "已为您设计商店方案，请确认是否创建："
            elif "create_item" in tool_names:
                response_data["content"] = "已为您设计物品属性，请确认是否创建："
            elif "create_chest" in tool_names:
                response_data["content"] = "已为您设计宝箱，请确认是否创建："

        # Save assistant response
        assistant_message = ResourceChatMessage(
            campaign_id=campaign_id,
            user_id=user_id,
            role="assistant",
            content=json.dumps(response_data, ensure_ascii=False)
        )
        db.add(assistant_message)
        await db.commit()

        response_data["message_id"] = assistant_message.id
        return response_data

    except Exception as e:
        return {"type": "error", "error": str(e)}


@router.delete("")
async def clear_chat_history(
    campaign_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Clear all chat history for a user in a campaign"""
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    user_id = context.user_id
    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    await db.execute(
        delete(ResourceChatMessage).where(
            ResourceChatMessage.campaign_id == campaign_id,
            ResourceChatMessage.user_id == user_id
        )
    )
    await db.commit()

    return {"status": "success", "message": "Chat history cleared"}


@router.delete("/{message_id}")
async def delete_chat_message(
    campaign_id: int,
    message_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Delete a single chat message"""
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    user_id = context.user_id
    message = await db.get(ResourceChatMessage, message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    if message.campaign_id != campaign_id or message.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not allowed to delete this message")

    await db.delete(message)
    await db.commit()

    return {"status": "success", "message": "Message deleted"}


@router.post("/create-encounter", response_model=EncounterCreateResult)
async def create_encounter(
    campaign_id: int,
    request: EncounterConfirmRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Execute encounter creation - create monster instances and tokens on the map.
    Called after user confirms the encounter plan from AI.
    """
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    user_id = context.user_id

    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    # Get current map URL from campaign
    map_url = campaign.current_map_url
    if not map_url:
        raise HTTPException(status_code=400, detail="No map set for this campaign")

    # Calculate positions for tokens
    total_monsters = sum(m.quantity for m in request.monsters)
    positions = calculate_spiral_positions(request.viewport_center, total_monsters)

    created_monster_ids = []
    created_token_ids = []
    position_index = 0

    for monster_spec in request.monsters:
        # Load preset monster data if matched
        monster_data = None
        generated_stats = None
        if monster_spec.matched and monster_spec.monster_id:
            matched = match_monster_by_name(monster_spec.name)
            if matched:
                monster_data = matched
        elif monster_spec.generated_stats:
            # 使用AI生成的属性
            generated_stats = monster_spec.generated_stats

        # Create ONE MonsterInstance for this monster type (not per quantity)
        base_name = monster_spec.name_cn or monster_spec.name

        # Generate monster_id from preset or create a unique one
        monster_id = monster_data.get("id") if monster_data else f"custom_{monster_spec.name}"

        # 使用统一服务创建怪物实例 - 只创建一个
        if monster_data:
            # 预设怪物数据
            monster_instance = await EntityCreationService.create_from_raw_data(
                db=db,
                campaign_id=campaign_id,
                raw_data=monster_data,
                source="preset",
                instance_name=base_name,
                monster_id=monster_id,
                source_id=monster_data.get("id"),
            )
        elif generated_stats:
            # AI生成的数据
            monster_instance = await EntityCreationService.create_from_raw_data(
                db=db,
                campaign_id=campaign_id,
                raw_data=generated_stats,
                source="ai",
                instance_name=base_name,
                monster_id=monster_id,
            )
        else:
            # 默认值
            monster_instance = await EntityCreationService.create_monster_instance(
                db=db,
                campaign_id=campaign_id,
                name=base_name,
                monster_id=monster_id,
                name_cn=monster_spec.name_cn,
            )
        created_monster_ids.append(monster_instance.id)

        # Create multiple Tokens pointing to the SAME MonsterInstance
        # Store token data for WebSocket broadcast after commit
        for i in range(monster_spec.quantity):
            # Token instance name includes number if quantity > 1
            token_name = base_name
            if monster_spec.quantity > 1:
                token_name += f" #{i+1}"

            pos = positions[position_index] if position_index < len(positions) else positions[-1]
            position_index += 1

            token = Token(
                campaign_id=campaign_id,
                map_url=map_url,
                monster_instance_id=monster_instance.id,
                user_id=user_id,
                instance_name=token_name,
                position_x=pos['x'],
                position_y=pos['y'],
                token_size=monster_instance.token_size,
                current_hp=monster_instance.current_hp,
            )
            db.add(token)
            await db.flush()
            created_token_ids.append({
                "token": token,
                "monster_instance": monster_instance
            })

    await db.commit()

    # Broadcast token_placed for each token so frontend updates immediately
    for token_info in created_token_ids:
        token = token_info["token"]
        monster = token_info["monster_instance"]
        token_data = {
            "id": token.id,
            "campaign_id": token.campaign_id,
            "character_id": None,
            "monster_instance_id": token.monster_instance_id,
            "item_data": None,
            "item_quantity": None,
            "shop_id": None,
            "user_id": token.user_id,
            "map_url": token.map_url,
            "position_x": token.position_x,
            "position_y": token.position_y,
            "token_size": token.token_size,
            "instance_name": token.instance_name,
            "current_hp": token.current_hp,
            "monster_name": monster.name,
            "monster_name_cn": monster.name_cn,
            "monster_type": monster.type,
            "monster_size": monster.size,
            "avatar": monster.avatar_url,
            "avatar_large": monster.avatar_url_large,
            "max_hp": monster.hit_points,
        }
        await realtime_publisher.publish_token_placed(campaign_id, token=token_data)

    return EncounterCreateResult(
        created_monsters=len(created_monster_ids),
        created_tokens=len(created_token_ids),
        monster_ids=created_monster_ids,
        token_ids=[t["token"].id for t in created_token_ids]
    )


@router.post("/create-shop", response_model=ShopCreateResult)
async def create_shop(
    campaign_id: int,
    request: ShopCreateSpec,
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new shop in the campaign.
    Called after user confirms the shop creation plan from AI.
    Automatically generates avatar icon in background.
    """
    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    shop = Shop(
        campaign_id=campaign_id,
        name=request.name,
        description=request.description,
        appearance_description=request.appearance,
        gold_gp=request.gold_gp,
        discount_rate=request.discount_rate,
    )
    db.add(shop)
    await db.commit()
    await db.refresh(shop)

    # Broadcast via WebSocket
    await realtime_publisher.publish_shop_created(
        campaign_id,
        shop_id=shop.id,
        name=shop.name,
    )

    # Trigger background avatar generation
    asyncio.create_task(_generate_shop_avatar_background(
        shop_id=shop.id,
        campaign_id=campaign_id,
        name=shop.name,
        description=request.description or "",
        appearance=request.appearance or ""
    ))

    return ShopCreateResult(shop_id=shop.id, name=shop.name)


# ===== 添加怪物到资源库（不创建Token）=====

class AddMonsterRequest(BaseModel):
    """Request to add a single monster to resource library"""
    name: str
    name_en: Optional[str] = None
    monster_id: Optional[str] = None
    matched: bool = False
    cr: Optional[str] = None
    hp: Optional[int] = None
    ac: Optional[int] = None
    size: Optional[str] = None
    type: Optional[str] = None


class AddMonsterResult(BaseModel):
    """Result of adding monster to library"""
    monster_instance_id: int
    name: str


@router.post("/add-monster", response_model=AddMonsterResult)
async def add_monster_to_library(
    campaign_id: int,
    request: AddMonsterRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Add a monster to the resource library without creating a token on the map.
    This is for when users want to save a monster for later use.
    """
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    user_id = context.user_id

    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    # Try to match with preset monster data
    monster_data = None
    if request.matched and request.name:
        monster_data = match_monster_by_name(request.name)

    base_name = request.name
    monster_id = request.monster_id or (monster_data.get("id") if monster_data else f"custom_{request.name}")

    # Create MonsterInstance using EntityCreationService
    if monster_data:
        # Preset monster
        monster_instance = await EntityCreationService.create_from_raw_data(
            db=db,
            campaign_id=campaign_id,
            raw_data=monster_data,
            source="preset",
            instance_name=base_name,
            monster_id=monster_id,
            source_id=monster_data.get("id"),
        )
    else:
        # Custom/AI-generated monster - use provided stats
        custom_data = {
            "name": base_name,
            "nameEn": request.name_en or "",
            "cr": request.cr or "0",
            "hp": request.hp or 10,
            "ac": request.ac or 10,
            "size": request.size or "中型",
            "type": request.type or "人形生物",
        }
        monster_instance = await EntityCreationService.create_from_raw_data(
            db=db,
            campaign_id=campaign_id,
            raw_data=custom_data,
            source="ai",
            instance_name=base_name,
            monster_id=monster_id,
        )

    await db.commit()

    # Broadcast via WebSocket
    await realtime_publisher.publish_monster_added(
        campaign_id,
        monster_instance_id=monster_instance.id,
        name=monster_instance.name,
    )

    return AddMonsterResult(
        monster_instance_id=monster_instance.id,
        name=monster_instance.name
    )


@router.post("/create-item", response_model=ItemCreateResult)
async def create_item(
    campaign_id: int,
    request: ItemCreateSpec,
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new custom item in the campaign.
    Called after user confirms the item creation plan from AI.
    Automatically generates avatar icon in background.
    """
    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    item = Item(
        campaign_id=campaign_id,
        name=request.name,
        name_cn=request.name_cn or request.name,
        category=request.category,
        rarity=request.rarity,
        description=request.description,
        description_cn=request.description,
        cost=request.cost,
        weight=request.weight,
        damage=request.damage,
        armor_class=request.armor_class,
        properties=request.properties,
        range=request.range,
        strength_requirement=request.strength_requirement,
        stealth_disadvantage=request.stealth_disadvantage or False,
        magic_bonus=request.magic_bonus,
        requires_attunement=request.requires_attunement,
        attunement_by=request.attunement_by,
        abilities=request.abilities,
        charges=request.charges,
        is_custom=True,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)

    # Broadcast via WebSocket
    await realtime_publisher.publish_item_created(
        campaign_id,
        item_id=item.id,
        name=item.name,
    )

    # Trigger background avatar generation
    asyncio.create_task(_generate_item_avatar_background(
        item_id=item.id,
        campaign_id=campaign_id,
        name=request.name,
        category=request.category,
        rarity=request.rarity,
        description=request.description
    ))

    return ItemCreateResult(item_id=item.id, name=item.name)


# ===== 宝箱创建端点 =====

@router.post("/create-chest", response_model=ChestCreateResult)
async def create_chest(
    campaign_id: int,
    request: ChestCreateSpec,
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new chest in the campaign.
    Called after user confirms the chest creation plan from AI.
    Automatically generates avatar icon in background.
    """
    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    # Apply trap preset if trap_type is specified
    trap_effect = None
    trap_detection_dc = 15
    trap_disarm_dc = 15
    if request.is_trapped and request.trap_type:
        preset = TRAP_PRESETS.get(request.trap_type)
        if preset:
            trap_effect = preset.get("trap_effect")
            trap_detection_dc = preset.get("trap_detection_dc", 15)
            trap_disarm_dc = preset.get("trap_disarm_dc", 15)

    # Create chest
    chest = Chest(
        campaign_id=campaign_id,
        name=request.name,
        description=request.description,
        appearance_description=request.appearance,
        state="locked" if request.is_locked else "unlocked",
        is_locked=request.is_locked,
        lock_dc=request.lock_dc,
        requires_key=request.requires_key,
        key_name=request.key_name,
        is_trapped=request.is_trapped,
        trap_type=request.trap_type,
        trap_detection_dc=trap_detection_dc,
        trap_disarm_dc=trap_disarm_dc,
        trap_effect=trap_effect,
        cp=request.currency.get("cp", 0) if request.currency else 0,
        sp=request.currency.get("sp", 0) if request.currency else 0,
        ep=request.currency.get("ep", 0) if request.currency else 0,
        gp=request.currency.get("gp", 0) if request.currency else 0,
        pp=request.currency.get("pp", 0) if request.currency else 0,
    )
    db.add(chest)
    await db.commit()
    await db.refresh(chest)

    items_added = 0
    # Create items and add to chest inventory
    if request.items:
        for item_spec in request.items:
            # Create item
            item = Item(
                campaign_id=campaign_id,
                name=item_spec.name,
                name_cn=item_spec.name,
                category=item_spec.category or "gear",
                rarity=item_spec.rarity or "common",
                description=item_spec.description,
                description_cn=item_spec.description,
                is_custom=True,
            )
            db.add(item)
            await db.commit()
            await db.refresh(item)

            # Add to chest inventory
            chest_inv = ChestInventory(
                chest_id=chest.id,
                item_id=item.id,
                quantity=item_spec.quantity or 1,
            )
            db.add(chest_inv)
            items_added += 1

        await db.commit()

    # Broadcast via WebSocket
    await realtime_publisher.publish_chest_created(
        campaign_id,
        chest_id=chest.id,
        name=chest.name,
    )

    # Trigger background avatar generation if appearance is provided
    if request.appearance:
        asyncio.create_task(_generate_chest_avatar_background(
            chest_id=chest.id,
            campaign_id=campaign_id,
            name=request.name,
            appearance=request.appearance
        ))

    return ChestCreateResult(
        chest_id=chest.id,
        name=chest.name,
        items_added=items_added
    )


async def _generate_chest_avatar_background(
    chest_id: int,
    campaign_id: int,
    name: str,
    appearance: str
):
    """Background task to generate chest avatar after creation."""
    print(f"[ResourceChat] Starting avatar generation for chest {chest_id}: {name}", flush=True)
    try:
        async with async_session_maker() as db:
            # Generate avatar using avatar service
            prompt = f"A treasure chest: {appearance}. Fantasy RPG style, detailed, dramatic lighting."
            result = await avatar_service.generate_avatar(
                prompt=prompt,
                size="256x256",
                entity_type="chest"
            )

            if result and result.get("small_url"):
                # Update chest with avatar URL
                chest = await db.get(Chest, chest_id)
                if chest:
                    chest.avatar_url = result.get("small_url")
                    chest.avatar_url_large = result.get("large_url")
                    chest.has_avatar = True
                    await db.commit()

                    # Broadcast avatar update
                    await realtime_publisher.publish_chest_avatar_updated(
                        campaign_id,
                        chest_id=chest_id,
                        avatar_url=result.get("small_url"),
                    )
                    print(f"[ResourceChat] Avatar generated for chest {chest_id}", flush=True)
    except Exception as e:
        print(f"[ResourceChat] Error generating avatar for chest {chest_id}: {e}", flush=True)


# ===== 场景生成相关端点 =====

async def _generate_npc_avatar_background(
    monster_instance_id: int,
    campaign_id: int,
    name: str,
    description: str,
    role: str
):
    """Background task to generate NPC avatar after creation.
    First checks for existing avatars from same-name entities to avoid redundant AI generation.
    """
    print(f"[ResourceChat] Starting avatar lookup/generation for NPC {monster_instance_id}: {name}", flush=True)
    try:
        async with async_session_maker() as db:
            # First, try to find existing avatar from same-name monster_instance
            existing_result = await db.execute(
                select(MonsterInstance)
                .where(MonsterInstance.name_cn == name)
                .where(MonsterInstance.has_avatar == True)
                .where(MonsterInstance.avatar_url.isnot(None))
                .where(MonsterInstance.id != monster_instance_id)
                .limit(1)
            )
            existing_instance = existing_result.scalar_one_or_none()

            if existing_instance and existing_instance.avatar_url:
                # Reuse existing avatar
                print(f"[ResourceChat] Found existing avatar for '{name}' from instance {existing_instance.id}", flush=True)
                small_url = existing_instance.avatar_url
                large_url = existing_instance.avatar_url_large

                # Update current instance with reused avatar
                instance = await db.get(MonsterInstance, monster_instance_id)
                if instance:
                    instance.avatar_url = small_url
                    instance.avatar_url_large = large_url
                    instance.has_avatar = True
                    await db.commit()

                # Broadcast avatar update
                await realtime_publisher.publish_npc_avatar_updated(
                    campaign_id,
                    monster_instance_id=monster_instance_id,
                    avatar_url=small_url,
                    avatar_url_large=large_url,
                )
                print(f"[ResourceChat] NPC {monster_instance_id} reused existing avatar: {small_url}", flush=True)
                return

            # No existing avatar found, generate new one
            print(f"[ResourceChat] No existing avatar for '{name}', generating new one", flush=True)

            # Build NPC-specific prompt (character portrait, not monster)
            npc_prompt = f"A detailed D&D fantasy character portrait of {name}, a {role}. "
            if description:
                npc_prompt += f"Appearance: {description[:250]}. "
            npc_prompt += "Professional digital character art, fantasy RPG style, warm lighting, friendly or neutral expression, detailed face and clothing, high quality portrait, centered composition, NO TEXT, NO STATS, NO NUMBERS, NO LABELS, pure artwork only"

            small_url, large_url = await avatar_service.generate_avatar(
                db=db,
                entity_type='monster',  # Use 'monster' with is_npc=True for NPC avatars
                entity_id=monster_instance_id,
                name=name,
                description=description,
                appearance=f"{role}: {description}",
                is_npc=True,  # This ensures it uses avatar_npc config
                prompt_override=npc_prompt  # Use custom NPC portrait prompt
            )
            # Update monster instance with avatar URLs
            instance = await db.get(MonsterInstance, monster_instance_id)
            if instance:
                instance.avatar_url = small_url
                instance.avatar_url_large = large_url
                instance.has_avatar = True
                await db.commit()

            # Broadcast avatar update via WebSocket
            await realtime_publisher.publish_npc_avatar_updated(
                campaign_id,
                monster_instance_id=monster_instance_id,
                avatar_url=small_url,
                avatar_url_large=large_url,
            )
            print(f"[ResourceChat] NPC {monster_instance_id} avatar generated: {small_url}", flush=True)
    except Exception as e:
        print(f"[ResourceChat] Failed to generate avatar for NPC {monster_instance_id}: {e}", flush=True)


@router.post("/generate-scene")
async def generate_scene(
    campaign_id: int,
    request: SceneGenerationRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Generate scene based on map image and chapter content.
    Uses multi-modal LLM to analyze the map and generate NPCs, shops, quests.
    """

    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    user_id = context.user_id

    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    # Get model configuration for scene generation (uses VISION model)
    usage_params = await ai_model_service.get_usage_params(db, "scene_generation")
    vision_config = usage_params.config
    temperature = usage_params.temperature
    max_tokens = usage_params.max_tokens

    # Build system prompt for scene generation
    # Get equipment summary for LLM reference
    equipment_summary = get_equipment_summary_for_llm()

    # Query existing NPCs and shops in this campaign to avoid duplicates
    existing_npcs_result = await db.execute(
        select(MonsterInstance.name_cn, MonsterInstance.monster_data)
        .where(MonsterInstance.campaign_id == campaign_id)
        .where(MonsterInstance.entity_type == "npc")
    )
    existing_npcs = existing_npcs_result.all()

    existing_shops_result = await db.execute(
        select(Shop.name, Shop.description)
        .where(Shop.campaign_id == campaign_id)
    )
    existing_shops = existing_shops_result.all()

    existing_items_result = await db.execute(
        select(Item.name_cn, Item.name, Item.category)
        .where(Item.campaign_id == campaign_id)
        .limit(50)  # Limit to avoid too long prompt
    )
    existing_items = existing_items_result.all()

    # Build existing entities summary for LLM
    existing_entities_info = ""
    if existing_npcs or existing_shops or existing_items:
        existing_entities_info = "\n\n## 已存在的资源（请勿重复生成！）\n"
        if existing_npcs:
            existing_entities_info += "### 已有NPC:\n"
            for npc_name, npc_data in existing_npcs:
                role = npc_data.get("role", "") if npc_data else ""
                existing_entities_info += f"- {npc_name}"
                if role:
                    existing_entities_info += f" ({role})"
                existing_entities_info += "\n"
        if existing_shops:
            existing_entities_info += "### 已有商店:\n"
            for shop_name, shop_desc in existing_shops:
                existing_entities_info += f"- {shop_name}\n"
        if existing_items:
            existing_entities_info += "### 已有物品（商店库存优先使用这些！）:\n"
            for item_cn, item_en, item_cat in existing_items:
                item_name = item_cn or item_en
                existing_entities_info += f"- {item_name}\n"
        existing_entities_info += "\n**重要：以上NPC/商店已存在，请不要生成同名的！商店库存必须优先使用已有物品，只有已有物品不满足需求时才添加新物品！**\n"

    system_prompt = f"""你是D&D场景设计专家。根据地图图片和章节描述，分析场景并生成NPC、商店和任务。

## 重要：所有输出必须使用中文！
- NPC名称用中文（如"红发埃斯科伯特"而不是"Escobert the Red"）
- 商店名称用中文（如"铁匠铺"而不是"Blacksmith"）
- 物品名称用中文（如"长剑"而不是"Longsword"）
- 描述、任务内容全部用中文

## 分析要点
1. 分析地图布局：识别建筑、道路、地形特征
2. 根据章节内容确定场景氛围和角色类型
3. NPC数量适中（2-5个），商店数量视场景而定（0-2个）
4. 位置使用百分比坐标（0-100），表示在地图上的相对位置
5. 商店必须包含5-10个物品，优先从下方预设物品中选择

## 预设物品列表（优先使用这些物品）
{equipment_summary}

## 输出要求
返回纯JSON格式（不要markdown代码块）：
{{
  "summary": "场景总结描述（2-3句话，中文）",
  "npcs": [
    {{
      "name": "中文名称",
      "name_cn": "中文名称（与name相同）",
      "role": "角色定位（中文）",
      "description": "外貌和性格描述（中文）",
      "position_percent": {{"x": 50, "y": 30}},
      "quest": {{
        "name": "任务名（中文）",
        "description": "任务描述（中文）",
        "reward": "奖励描述（中文）"
      }}
    }}
  ],
  "shops": [
    {{
      "name": "商店中文名称",
      "type": "类型(武器店/护甲店/杂货店/酒馆等)",
      "description": "商店描述（中文）",
      "position_percent": {{"x": 70, "y": 60}},
      "items": [
        {{
          "preset_id": "longsword",
          "name": "长剑",
          "price_gp": 15,
          "quantity": 3,
          "category": "weapon"
        }},
        {{
          "name": "自定义物品名称（中文）",
          "price_gp": 50,
          "quantity": 1,
          "category": "gear"
        }}
      ]
    }}
  ]
}}

注意：
- quest字段是可选的，只有任务NPC才需要
- 商店items字段必填，每个商店5-10个物品
- 物品优先使用preset_id引用预设物品，name使用中文名
- 自定义物品不需要preset_id，但必须提供完整中文信息
- category可选值：weapon, armor, gear, tool, ammunition
- 重要：武器和弹药必须分开列出！如"长弓（含20箭）"应拆分为两个物品：
  1. 长弓 (preset_id: longbow, category: weapon)
  2. 箭矢 (preset_id: arrows, quantity: 20, category: ammunition)
- 常见弹药preset_id: arrows(箭矢), crossbow_bolts(弩矢), sling_bullets(投石索弹丸)
{existing_entities_info}"""

    user_message = f"章节: {request.chapter_title}\n\n内容:\n{request.chapter_content[:8000]}"

    try:
        # Download the map image and convert to base64
        print(f"[ResourceChat] Downloading map image from: {request.map_url}", flush=True)
        async with httpx.AsyncClient(timeout=30.0) as client:
            img_response = await client.get(request.map_url)
            if img_response.status_code != 200:
                raise HTTPException(
                    status_code=400,
                    detail=f"无法下载地图图片: HTTP {img_response.status_code}"
                )
            image_data = img_response.content
            content_type = img_response.headers.get("content-type", "image/jpeg")
            # Convert to base64 with data URL prefix
            image_base64 = f"data:{content_type};base64,{base64.b64encode(image_data).decode('utf-8')}"
            print(f"[ResourceChat] Map image downloaded, size: {len(image_data)} bytes", flush=True)

        # Call multi-modal LLM with image
        result = await AIService.generate_with_image(
            api_url=vision_config.api_url,
            api_key=vision_config.api_key,
            model=vision_config.model_name,
            system_prompt=system_prompt,
            user_message=user_message,
            image_base64=image_base64,
            temperature=temperature,
            max_tokens=max_tokens
        )

        # Parse JSON response with robust recovery
        print(f"[ResourceChat] Raw scene response length: {len(result)}", flush=True)
        print(f"[ResourceChat] Raw scene response (first 2000 chars): {result[:2000]}", flush=True)

        # First try direct JSON parse
        try:
            scene_data = json.loads(result)
            print(f"[ResourceChat] Direct JSON parse succeeded", flush=True)
        except json.JSONDecodeError as e:
            print(f"[ResourceChat] Direct JSON parse failed: {e}", flush=True)
            # Fall back to recovery
            scene_data = extract_json_from_text(result, fallback_to_repair=True)
            if scene_data:
                print(f"[ResourceChat] JSON recovery succeeded", flush=True)

        if not scene_data or not isinstance(scene_data, dict):
            # Log the raw response for debugging
            print(f"[ResourceChat] Failed to parse scene response: {result[:500]}...", flush=True)
            raise HTTPException(
                status_code=500,
                detail="无法解析AI响应，请重试或检查模型配置"
            )

        # Validate and normalize the response
        scene_plan = {
            "summary": scene_data.get("summary", "场景已生成"),
            "npcs": scene_data.get("npcs", []),
            "shops": scene_data.get("shops", [])
        }

        # Save chat messages to database
        # 1. Save user request message
        user_msg = ResourceChatMessage(
            campaign_id=campaign_id,
            user_id=user_id,
            role="user",
            content=f"🎭 生成场景: {request.chapter_title}"
        )
        db.add(user_msg)

        # 2. Build scene description text for display
        scene_description = f"## 🎭 场景分析\n\n{scene_plan['summary']}\n\n"
        if scene_plan['npcs']:
            scene_description += f"### 👤 NPC ({len(scene_plan['npcs'])})\n"
            for npc in scene_plan['npcs']:
                scene_description += f"- **{npc.get('name_cn', npc.get('name'))}** ({npc.get('role')}): {npc.get('description')}"
                if npc.get('quest'):
                    scene_description += f"\n  - 📜 任务: {npc['quest'].get('name')}"
                scene_description += '\n'
            scene_description += '\n'
        if scene_plan['shops']:
            scene_description += f"### 🏪 商店 ({len(scene_plan['shops'])})\n"
            for shop in scene_plan['shops']:
                items_count = len(shop.get('items', []))
                scene_description += f"- **{shop.get('name')}** ({shop.get('type')}): {shop.get('description')}"
                if items_count > 0:
                    scene_description += f" [{items_count}件商品]"
                scene_description += '\n'

        # 3. Save assistant response with scene plan
        assistant_response = {
            "type": "scene_plan",
            "content": scene_description,
            "plan": scene_plan
        }
        assistant_msg = ResourceChatMessage(
            campaign_id=campaign_id,
            user_id=user_id,
            role="assistant",
            content=json.dumps(assistant_response, ensure_ascii=False)
        )
        db.add(assistant_msg)
        await db.commit()

        return {
            "plan": scene_plan,
            "chapter_title": request.chapter_title
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Scene generation failed: {str(e)}")


@router.post("/create-scene", response_model=SceneCreateResult)
async def create_scene(
    campaign_id: int,
    request: ScenePlan,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Create scene resources (NPCs, shops, tokens) based on the generated plan.
    NPCs are created as MonsterInstance with entity_type='npc'.
    Quests are stored in monster_data.
    """
    import uuid

    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    user_id = context.user_id

    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    map_url = campaign.current_map_url
    if not map_url:
        raise HTTPException(status_code=400, detail="No map set for this campaign")

    # Get map dimensions for percentage to pixel conversion
    # Default to 1000x1000 if we can't determine
    map_width = 1000
    map_height = 1000

    # Try to get actual map dimensions from campaign data or use defaults
    # Grid unit is typically 40px
    grid_unit = 40  # Default grid unit size

    created_npc_ids = []
    created_shop_ids = []
    created_token_ids = []

    # 1. Create NPCs (as MonsterInstance with entity_type='npc')
    for npc in request.npcs:
        npc_name = npc.name_cn or npc.name

        # Check if NPC with same name already exists in this campaign
        existing_npc_result = await db.execute(
            select(MonsterInstance)
            .where(MonsterInstance.campaign_id == campaign_id)
            .where(MonsterInstance.entity_type == "npc")
            .where(
                (MonsterInstance.name_cn == npc_name) |
                (MonsterInstance.name == npc_name)
            )
            .limit(1)
        )
        existing_npc = existing_npc_result.scalar_one_or_none()

        if existing_npc:
            # Reuse existing NPC
            print(f"[ResourceChat] Reusing existing NPC '{npc_name}' (id={existing_npc.id})", flush=True)
            monster_instance = existing_npc
            created_npc_ids.append(monster_instance.id)
        else:
            # Create new NPC
            # Generate unique monster_id for NPC
            npc_monster_id = f"npc_{uuid.uuid4().hex[:8]}"

            # Build monster_data with role, description, and optional quest
            # NOTE: is_npc=True is required for frontend filtering
            monster_data = {
                "is_npc": True,  # Required for frontend NPC tab filtering
                "role": npc.role,
                "description": npc.description
            }

            # If NPC has a quest, store it in monster_data
            if npc.quest:
                monster_data["quest"] = {
                    "name": npc.quest.name,
                    "description": npc.quest.description,
                    "reward": npc.quest.reward,
                    "status": "pending"
                }

            monster_instance = MonsterInstance(
                campaign_id=campaign_id,
                monster_id=npc_monster_id,
                name=npc.name,
                name_cn=npc.name_cn,
                type="humanoid",  # D&D creature type
                entity_type="npc",  # Distinguish from monsters
                hit_points=10,
                current_hp=10,
                armor_class=10,
                size="Medium",
                token_size="1x1",
                monster_data=monster_data
            )
            db.add(monster_instance)
            await db.flush()
            created_npc_ids.append(monster_instance.id)

            # Trigger background avatar generation for new NPC only
            asyncio.create_task(_generate_npc_avatar_background(
                monster_instance_id=monster_instance.id,
                campaign_id=campaign_id,
                name=npc_name,
                description=npc.description,
                role=npc.role
            ))

        # Convert percentage position to grid coordinates
        # position_percent.x and position_percent.y are 0-100
        pos_x_pct = npc.position_percent.get("x", 50)
        pos_y_pct = npc.position_percent.get("y", 50)

        # Convert to pixel coordinates then to grid units
        pixel_x = (pos_x_pct / 100.0) * map_width
        pixel_y = (pos_y_pct / 100.0) * map_height
        grid_x = int(pixel_x / grid_unit)
        grid_y = int(pixel_y / grid_unit)

        # Create Token for NPC - store for WebSocket broadcast
        token = Token(
            campaign_id=campaign_id,
            map_url=map_url,
            monster_instance_id=monster_instance.id,
            user_id=user_id,
            instance_name=npc.name_cn or npc.name,
            position_x=grid_x,
            position_y=grid_y,
            token_size="1x1",
            current_hp=10,
        )
        db.add(token)
        await db.flush()
        created_token_ids.append({
            "token": token,
            "type": "npc",
            "monster_instance": monster_instance
        })

    # 2. Create Shops
    for shop in request.shops:
        # Check if shop with same name already exists in this campaign
        existing_shop_result = await db.execute(
            select(Shop)
            .where(Shop.campaign_id == campaign_id)
            .where(Shop.name == shop.name)
            .limit(1)
        )
        existing_shop = existing_shop_result.scalar_one_or_none()

        if existing_shop:
            # Reuse existing shop
            print(f"[ResourceChat] Reusing existing shop '{shop.name}' (id={existing_shop.id})", flush=True)
            shop_record = existing_shop
            created_shop_ids.append(shop_record.id)
        else:
            # Create new shop
            shop_record = Shop(
                campaign_id=campaign_id,
                name=shop.name,
                description=shop.description,
                gold_gp=100,
                discount_rate=0.5,
            )
            db.add(shop_record)
            await db.flush()
            created_shop_ids.append(shop_record.id)

            # Trigger background avatar generation for new shop only
            asyncio.create_task(_generate_shop_avatar_background(
                shop_id=shop_record.id,
                campaign_id=campaign_id,
                name=shop.name,
                description=shop.description,
                appearance=f"{shop.type}: {shop.description}"
            ))

        # Create items and add to shop inventory
        if shop.items:
            for shop_item in shop.items:
                # Try to find preset item data to enrich the item
                preset_data = None
                if shop_item.preset_id:
                    preset_data = find_preset_item(shop_item.preset_id, shop_item.name)

                # Determine the item name (Chinese preferred)
                item_name_cn = shop_item.name
                item_name_en = None
                if preset_data:
                    item_name_cn = preset_data.get("name", shop_item.name)
                    item_name_en = preset_data.get("nameEn")

                # First, try to find existing item in campaign by name
                existing_item = None
                existing_result = await db.execute(
                    select(Item)
                    .where(Item.campaign_id == campaign_id)
                    .where(
                        (Item.name_cn == item_name_cn) |
                        (Item.name == item_name_cn) |
                        (Item.name == item_name_en if item_name_en else False)
                    )
                    .limit(1)
                )
                existing_item = existing_result.scalar_one_or_none()

                if existing_item:
                    # Reuse existing item
                    print(f"[ResourceChat] Reusing existing item '{item_name_cn}' (id={existing_item.id})", flush=True)
                    item_record = existing_item
                else:
                    # Create new item
                    # Determine category for Item model
                    category_map = {
                        "weapon": "weapon",
                        "armor": "armor",
                        "gear": "adventuring_gear",
                        "tool": "tool",
                        "ammunition": "adventuring_gear"
                    }
                    item_category = category_map.get(shop_item.category, "adventuring_gear")

                    # Build item data from preset or custom data
                    item_data = {
                        "campaign_id": campaign_id,
                        "name": item_name_cn,  # Use Chinese name as primary
                        "name_cn": item_name_cn,
                        "category": item_category,
                        "cost": {"gp": shop_item.price_gp},
                        "quantity": shop_item.quantity,
                        "is_custom": preset_data is None,
                    }

                    # If we have preset data, enrich the item
                    if preset_data:
                        # Convert damage format: preset uses "damage" + "damageType"
                        # but Item model expects {"dice": "1d4", "type": "piercing"}
                        if preset_data.get("damage"):
                            damage_dice = preset_data["damage"]
                            damage_type = preset_data.get("damageType", "bludgeoning")
                            item_data["damage"] = {"dice": damage_dice, "type": damage_type}
                        if preset_data.get("armorClass"):
                            item_data["armor_class"] = preset_data["armorClass"]
                        if preset_data.get("properties"):
                            item_data["properties"] = preset_data["properties"]
                        if preset_data.get("weight"):
                            item_data["weight"] = preset_data["weight"]
                        if preset_data.get("description"):
                            item_data["description"] = preset_data["description"]

                    # Create Item record
                    item_record = Item(**item_data)
                    db.add(item_record)
                    await db.flush()
                    print(f"[ResourceChat] Created new item '{item_name_cn}' (id={item_record.id})", flush=True)

                # Create ShopInventory record
                inventory = ShopInventory(
                    shop_id=shop_record.id,
                    item_id=item_record.id,
                    quantity=shop_item.quantity,
                    price_gp=shop_item.price_gp
                )
                db.add(inventory)

        # Convert percentage position to grid coordinates
        pos_x_pct = shop.position_percent.get("x", 50)
        pos_y_pct = shop.position_percent.get("y", 50)
        pixel_x = (pos_x_pct / 100.0) * map_width
        pixel_y = (pos_y_pct / 100.0) * map_height
        grid_x = int(pixel_x / grid_unit)
        grid_y = int(pixel_y / grid_unit)

        # Create Token for Shop (as item_data) - store for WebSocket broadcast
        shop_token = Token(
            campaign_id=campaign_id,
            map_url=map_url,
            user_id=user_id,
            instance_name=shop.name,
            item_data={
                "type": "shop",
                "shop_id": shop_record.id,
                "name": shop.name,
                "shop_type": shop.type
            },
            position_x=grid_x,
            position_y=grid_y,
            token_size="1x1",
        )
        db.add(shop_token)
        await db.flush()
        created_token_ids.append({
            "token": shop_token,
            "type": "shop",
            "shop_record": shop_record
        })

    await db.commit()

    # Broadcast token_placed for each token so frontend updates immediately
    for token_info in created_token_ids:
        token = token_info["token"]
        token_data = {
            "id": token.id,
            "campaign_id": token.campaign_id,
            "character_id": None,
            "monster_instance_id": token.monster_instance_id,
            "item_data": token.item_data,
            "item_quantity": None,
            "shop_id": None,
            "user_id": token.user_id,
            "map_url": token.map_url,
            "position_x": token.position_x,
            "position_y": token.position_y,
            "token_size": token.token_size,
            "instance_name": token.instance_name,
            "current_hp": token.current_hp,
        }

        if token_info["type"] == "npc":
            monster = token_info["monster_instance"]
            token_data["monster_name"] = monster.name
            token_data["monster_name_cn"] = monster.name_cn
            token_data["monster_type"] = monster.type
            token_data["monster_size"] = monster.size
            token_data["avatar"] = monster.avatar_url
            token_data["avatar_large"] = monster.avatar_url_large
            token_data["max_hp"] = monster.hit_points
        elif token_info["type"] == "shop":
            shop_rec = token_info["shop_record"]
            token_data["shop_name"] = shop_rec.name
            token_data["avatar"] = shop_rec.avatar_url
            token_data["avatar_large"] = shop_rec.avatar_url_large

        await realtime_publisher.publish_token_placed(campaign_id, token=token_data)

    # 3. Save "scene created" message to chat history
    token_id_list = [t["token"].id for t in created_token_ids]
    created_msg = ResourceChatMessage(
        campaign_id=campaign_id,
        user_id=user_id,
        role="assistant",
        content=json.dumps({
            "type": "scene_created",
            "content": f"✅ 场景创建成功！\n- NPC: {len(created_npc_ids)} 个\n- 商店: {len(created_shop_ids)} 个\n- Token: {len(token_id_list)} 个"
        }, ensure_ascii=False)
    )
    db.add(created_msg)
    await db.commit()

    # 4. Broadcast scene_created summary (individual token_placed already sent above)
    await realtime_publisher.publish_scene_created(
        campaign_id,
        npc_count=len(created_npc_ids),
        shop_count=len(created_shop_ids),
        token_count=len(token_id_list),
        npc_ids=created_npc_ids,
        shop_ids=created_shop_ids,
        token_ids=token_id_list,
    )

    return {
        "created_npcs": len(created_npc_ids),
        "created_shops": len(created_shop_ids),
        "created_tokens": len(token_id_list),
        "npc_ids": created_npc_ids,
        "shop_ids": created_shop_ids,
        "token_ids": token_id_list
    }
