"""
Module Chat API routes - Simple streaming LLM version
Supports basic Q&A with optional NPC/Monster creation suggestions
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func
import json
import re
import asyncio
import httpx
from pathlib import Path
from typing import Optional, Dict, Any, List

from app.db.session import get_db
from app.models.module_chat import ModuleChatMessage
from app.models.module_chat_session import ModuleChatSession
from app.models.parsed_module import ParsedModule
from app.models.custom_module import CustomModule
from app.models.ai_settings import AIModelConfig
from app.utils.json_recovery import extract_json_from_text
from app.models.campaign import Campaign
from app.models.module_maps import ModuleMaps
from app.schemas.module_chat import (
    ModuleChatMessageCreate,
    ModuleChatMessageResponse,
    ModuleChatHistoryResponse,
    ChapterChatRequest,
)
from app.services.ai_service import AIService
from app.services.ai_model_service import ai_model_service
from app.services.module_chat_usecase_service import create_direct_module_entity
from app.services.module_encounter_usecase_service import (
    create_module_encounter,
    execute_structured_map_encounter,
)
from app.services.module_encounter_planning_service import (
    build_modify_assistant_content,
    build_modify_system_prompt,
    build_plan_assistant_content,
    build_plan_system_prompt,
    collect_module_encounters,
    persist_encounter_plan_message,
)
from app.services.realtime_publisher import realtime_publisher
from app.core.dependencies import resolve_campaign_member_context
from app.core.security import require_auth

router = APIRouter(prefix="/api/modules/{module_id}/chat", tags=["Module Chat"])
logger = logging.getLogger(__name__)

SESSION_MESSAGE_LIMIT = 100
SESSION_SUMMARY_SOURCE_LIMIT = 20
SESSION_CONTEXT_HISTORY_LIMIT = 100
SESSION_SUMMARY_MARKER = "[[SESSION_SUMMARY_V1]]"
SESSION_SUMMARY_PROMPT_CHAR_LIMIT = 9000
SESSION_SUMMARY_MESSAGE_CHAR_LIMIT = 600


def _is_session_summary_message(content: str) -> bool:
    return bool(content) and content.startswith(SESSION_SUMMARY_MARKER)


def _strip_session_summary_marker(content: str) -> str:
    if not _is_session_summary_message(content):
        return content
    return content[len(SESSION_SUMMARY_MARKER):].lstrip()


def _build_rollover_session_title(title: Optional[str]) -> str:
    base = (title or "新对话").strip() or "新对话"
    if base.endswith("（续）"):
        return base
    return f"{base}（续）"


def _build_fallback_rollover_summary(recent_messages: List[ModuleChatMessage]) -> str:
    if not recent_messages:
        return "暂无可用历史消息。"

    lines: List[str] = []
    for msg in recent_messages[-SESSION_SUMMARY_SOURCE_LIMIT:]:
        role_label = "用户" if msg.role == "user" else "助手"
        text = _strip_session_summary_marker((msg.content or "").strip()).replace("\n", " ")
        if not text:
            continue
        if len(text) > 120:
            text = text[:120] + "..."
        lines.append(f"- {role_label}：{text}")

    if not lines:
        return "暂无可用历史消息。"
    return "以下为上一窗口最近对话要点：\n" + "\n".join(lines)


async def _generate_rollover_summary(
    recent_messages: List[ModuleChatMessage],
    chat_config: AIModelConfig,
    temperature: Optional[float],
    max_tokens: int,
) -> str:
    if not recent_messages:
        return _build_fallback_rollover_summary(recent_messages)

    transcript_lines: List[str] = []
    total_chars = 0
    for msg in recent_messages[-SESSION_SUMMARY_SOURCE_LIMIT:]:
        role_label = "用户" if msg.role == "user" else "助手"
        text = _strip_session_summary_marker((msg.content or "").strip()).replace("\n", " ")
        if not text:
            continue
        if len(text) > SESSION_SUMMARY_MESSAGE_CHAR_LIMIT:
            text = text[:SESSION_SUMMARY_MESSAGE_CHAR_LIMIT] + "..."
        line = f"{role_label}: {text}"
        if total_chars + len(line) > SESSION_SUMMARY_PROMPT_CHAR_LIMIT:
            break
        transcript_lines.append(line)
        total_chars += len(line) + 1

    if not transcript_lines:
        return _build_fallback_rollover_summary(recent_messages)

    prompt = (
        "请将以下D&D模组问答对话压缩成“续聊上下文摘要”，用于新会话继承。\n"
        "要求：\n"
        "1. 仅保留关键事实、用户偏好、已完成步骤、未完成事项。\n"
        "2. 不要编造信息。\n"
        "3. 使用中文，控制在220-420字，可分段。\n"
        "4. 如涉及地图分析、实体创建、遭遇规划，写清当前状态。\n\n"
        "对话：\n"
        f"{chr(10).join(transcript_lines)}"
    )

    try:
        summary = await AIService.generate_completion(
            api_url=chat_config.api_url,
            api_key=chat_config.api_key,
            model=chat_config.model_name,
            messages=[
                {"role": "system", "content": "你是一个准确、克制的对话压缩助手。"},
                {"role": "user", "content": prompt},
            ],
            temperature=temperature,
            max_tokens=min(max_tokens, 700),
            timeout=45.0,
        )
        cleaned = (summary or "").strip()
        if cleaned:
            return cleaned
    except Exception as exc:
        logger.warning("[module_chat] rollover summary generation failed: %s", exc)

    return _build_fallback_rollover_summary(recent_messages)


async def _get_session_message_count(
    db: AsyncSession,
    module_id: str,
    user_id: str,
    session_id: int,
) -> int:
    result = await db.execute(
        select(func.count(ModuleChatMessage.id)).where(
            ModuleChatMessage.module_id == module_id,
            ModuleChatMessage.user_id == user_id,
            ModuleChatMessage.session_id == session_id,
        )
    )
    return int(result.scalar() or 0)


async def _load_recent_session_messages(
    db: AsyncSession,
    module_id: str,
    user_id: str,
    session_id: int,
    limit: int,
    exclude_message_id: Optional[int] = None,
) -> List[ModuleChatMessage]:
    filters = [
        ModuleChatMessage.module_id == module_id,
        ModuleChatMessage.user_id == user_id,
        ModuleChatMessage.session_id == session_id,
    ]
    if exclude_message_id is not None:
        filters.append(ModuleChatMessage.id != exclude_message_id)

    result = await db.execute(
        select(ModuleChatMessage)
        .where(*filters)
        .order_by(ModuleChatMessage.created_at.desc())
        .limit(limit)
    )
    rows = list(result.scalars().all())
    rows.reverse()
    return rows


def _build_session_sse_meta(
    session_id: Optional[int],
    session_switched: bool,
    previous_session_id: Optional[int],
    session_title: Optional[str],
    session_message_count: Optional[int],
    session_updated_at: Optional[str],
) -> Dict[str, Any]:
    return {
        "session_id": session_id,
        "session_switched": session_switched,
        "previous_session_id": previous_session_id,
        "session_title": session_title,
        "session_message_count": session_message_count,
        "session_updated_at": session_updated_at,
    }


# ===== Custom Module Adapter =====

class CustomModuleAdapter:
    """Wraps CustomModule to expose ParsedModule-compatible attributes."""

    def __init__(self, cm: CustomModule):
        self.module_id = cm.module_id
        self.title = cm.title
        self.description = cm.description
        self.module_info = {"title": cm.title, "description": cm.description}
        # CustomModule chapters are flat lists; compatible with keyword search
        self.chapters = cm.chapters or []
        self.toc = cm.chapters or []
        self.monsters = cm.npcs or []
        self.items = cm.treasures or []


async def resolve_module(db: AsyncSession, module_id: str):
    """Look up ParsedModule first, fall back to CustomModule (wrapped)."""
    result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == module_id)
    )
    module = result.scalar_one_or_none()
    if module:
        return module

    result = await db.execute(
        select(CustomModule).where(CustomModule.module_id == module_id)
    )
    cm = result.scalar_one_or_none()
    if cm:
        return CustomModuleAdapter(cm)

    return None


# ===== Preset Monster Matching =====

_monsters_cache: Optional[List[Dict[str, Any]]] = None

def load_monsters_preset() -> List[Dict[str, Any]]:
    """Load preset monsters with caching"""
    global _monsters_cache
    if _monsters_cache is not None:
        return _monsters_cache

    from app.utils.rules_cache import get_all_monsters
    _monsters_cache = get_all_monsters()
    return _monsters_cache


async def parse_module_monster_description(
    description: str,
    name: str,
    db: AsyncSession,
    actions_text: str = "",
    all_module_monsters: List[Dict] = None
) -> Dict[str, Any]:
    """
    Parse monster description text into structured data using FAST model.
    Similar to /api/ai-settings/parse-monster-stats endpoint.

    Args:
        description: Monster stat block text (AC, HP, abilities, etc.)
        name: Monster name
        db: Database session
        actions_text: Optional actions/abilities text from module
        all_module_monsters: All monsters in the module (for variant lookup)
    """
    if not description and not actions_text:
        return {}

    # Get model config via usage config (module_analyze_entities for parsing)
    try:
        config = await ai_model_service.get_config_for_usage(db, "module_analyze_entities")
        if not config or not config.api_url or not config.api_key:
            print(f"[parse_monster] Model not configured")
            return {}
    except Exception as e:
        print(f"[parse_monster] Failed to get model config: {e}")
        return {}

    # Check if this is a variant monster (e.g., "以龙爪为基础，HP翻倍")
    base_monster_data = None
    variant_info = ""
    if description and all_module_monsters:
        import re
        variant_pattern = r'以[「""\']?(.+?)[」""\']?(?:的)?(?:资料卡|数据|属性)?为基础'
        match = re.search(variant_pattern, description)
        if match:
            base_name = match.group(1).strip()
            print(f"[parse_monster] Detected variant: {name} is based on {base_name}")
            # Find base monster in module
            for m in all_module_monsters:
                m_name = m.get('name', '')
                if base_name in m_name or m_name in base_name:
                    base_monster_data = m
                    print(f"[parse_monster] Found base monster: {m_name}")
                    break

            if base_monster_data:
                # Build base monster info for LLM
                base_desc = base_monster_data.get('description', '')
                base_actions = base_monster_data.get('actions', '')
                variant_info = f"""
## 变体怪物说明
这是一个变体怪物。请根据以下基础怪物数据和修改规则，计算并输出完整的属性数据。

## 基础怪物: {base_monster_data.get('name', base_name)}
{base_desc}
{base_actions if isinstance(base_actions, str) else ''}

## 变体修改规则
{description}

请应用上述修改规则到基础怪物，计算出完整的属性（如"HP翻倍"则将基础HP乘以2，"CR改为2"则挑战等级改为2等）。
"""

    # Build input text sections
    if variant_info:
        input_sections = variant_info
    else:
        input_sections = f"## 基础属性\n{description}" if description else ""
        if actions_text:
            input_sections += f"\n\n## 能力与动作\n{actions_text}"

    prompt = f"""从以下D&D 5E怪物描述中提取完整的结构化数据。怪物名称：{name}

{input_sections}

请提取以下信息并以JSON格式返回（如果信息不存在则返回null）：
{{
  "ac": <护甲等级数字>,
  "acDesc": "<护甲类型描述，如天生护甲、皮甲>",
  "hp": <生命值数字>,
  "hp_formula": "<HP骰子公式，如2d8+4>",
  "cr": "<挑战等级，如1/4, 1, 5>",
  "xp": <经验值数字>,
  "size": "<体型：微型/小型/中型/大型/超大型/巨型>",
  "type": "<生物类型，如人形生物、野兽、亡灵>",
  "alignment": "<阵营，如守序邪恶、中立>",
  "speed": {{
    "walk": <步行速度数字>,
    "fly": <飞行速度数字或null>,
    "swim": <游泳速度数字或null>,
    "climb": <攀爬速度数字或null>,
    "burrow": <掘地速度数字或null>
  }},
  "abilityScores": {{
    "str": <力量>, "strMod": <力量调整值>,
    "dex": <敏捷>, "dexMod": <敏捷调整值>,
    "con": <体质>, "conMod": <体质调整值>,
    "int": <智力>, "intMod": <智力调整值>,
    "wis": <感知>, "wisMod": <感知调整值>,
    "cha": <魅力>, "chaMod": <魅力调整值>
  }},
  "savingThrows": {{"str": <数值>, "dex": <数值>, ...}} 或 null,
  "skills": {{"perception": <数值>, ...}} 或 null,
  "senses": "<感官描述>",
  "languages": "<语言>",
  "damageImmunities": "<伤害免疫>",
  "damageResistances": "<伤害抗性>",
  "conditionImmunities": "<状态免疫>",
  "specialAbilities": [
    {{"name": "<能力名>", "description": "<描述>"}}
  ],
  "spellcasting": {{
    "level": <施法者等级>,
    "ability": "<施法关键属性>",
    "dc": <法术豁免DC>,
    "attackBonus": <法术攻击加值>,
    "spells": {{
      "cantrips": ["<戏法名>"],
      "1st": {{"slots": <法术位数>, "spells": ["<法术名>"]}},
      "2nd": {{"slots": <法术位数>, "spells": ["<法术名>"]}},
      "3rd": {{"slots": <法术位数>, "spells": ["<法术名>"]}},
      "4th": {{"slots": <法术位数>, "spells": ["<法术名>"]}},
      "5th": {{"slots": <法术位数>, "spells": ["<法术名>"]}}
    }}
  }} 或 null,
  "actions": [
    {{"name": "<动作名>", "description": "<描述>", "attack_bonus": <攻击加值或null>, "damage": "<伤害骰或null>"}}
  ],
  "reactions": [
    {{"name": "<反应名>", "description": "<描述>"}}
  ] 或 null,
  "legendaryActions": [
    {{"name": "<传奇动作名>", "description": "<描述>"}}
  ] 或 null
}}

重要分类说明：
- specialAbilities: 被动能力，如"精美血统"、"鱼群战术"、"魔法抗性"等不需要消耗动作的能力
- spellcasting: 施法能力和法术列表
- actions: 需要消耗动作的攻击或能力，如"多重攻击"、"喷吐武器"、近战/远程攻击等

只返回JSON，不要其他内容。"""

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{config.api_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {config.api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": config.model_name,
                    "messages": [
                        {"role": "system", "content": "你是一个D&D 5E怪物数据解析专家。请从描述文本中提取结构化数据。"},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0,
                    "max_tokens": 4000
                }
            )
            response.raise_for_status()
            data = response.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

            # Extract JSON from response - use recovery utility for malformed AI responses
            content = content.strip()
            if content.startswith("```json"):
                content = content[7:]
            if content.startswith("```"):
                content = content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()

            # Use JSON recovery utility for robust parsing
            result = extract_json_from_text(content, fallback_to_repair=True)
            if result and isinstance(result, dict):
                print(f"[parse_monster] Successfully parsed {name}: CR={result.get('cr')}, HP={result.get('hp')}, AC={result.get('ac')}")
                return result
            else:
                print(f"[parse_monster] JSON recovery failed for {name}, content: {content[:200]}...")
                return {}

    except httpx.HTTPError as e:
        print(f"[parse_monster] AI request failed for {name}: {e}")
        return {}
    except json.JSONDecodeError as e:
        print(f"[parse_monster] Failed to parse AI response for {name}: {e}")
        return {}
    except Exception as e:
        print(f"[parse_monster] Error parsing {name}: {e}")
        return {}


# ===== Helper Functions =====

import random

def generate_pre_rolled_dice() -> str:
    """
    Generate pre-rolled dice results to include in system prompt.

    This allows AI to use true random results in a single LLM call,
    rather than needing to call back for random selection.

    Returns a formatted string like:
    "d4: 3, 2, 4, 1 | d6: 5, 2, 6 | d8: 7, 3 | d10: 9, 4 | d12: 11, 5 | d20: 17, 8, 3, 14, 6 | d100: 73, 28"
    """
    rolls = {
        'd4': [random.randint(1, 4) for _ in range(4)],
        'd6': [random.randint(1, 6) for _ in range(4)],
        'd8': [random.randint(1, 8) for _ in range(3)],
        'd10': [random.randint(1, 10) for _ in range(3)],
        'd12': [random.randint(1, 12) for _ in range(3)],
        'd20': [random.randint(1, 20) for _ in range(5)],
        'd100': [random.randint(1, 100) for _ in range(3)],
    }

    parts = []
    for dice, values in rolls.items():
        parts.append(f"{dice}: {', '.join(map(str, values))}")

    return " | ".join(parts)


def process_random_tags(text: str) -> str:
    """
    Process [[RANDOM:option1|option2|option3]] tags in AI response.

    AI uses these tags when it wants the system to make a true random choice
    from a filtered list of options. This enables "smart filtering + random selection"
    for random tables in the creator knowledge base.

    Example:
        Input:  "这个废墟的建造者是 [[RANDOM:矮人|地精|自然形成]]"
        Output: "这个废墟的建造者是 矮人"  (randomly selected)
    """
    pattern = r'\[\[RANDOM:([^\]]+)\]\]'

    def replace_random(match):
        options_str = match.group(1)
        options = [opt.strip() for opt in options_str.split('|') if opt.strip()]
        if options:
            return random.choice(options)
        return match.group(0)  # Return original if no valid options

    return re.sub(pattern, replace_random, text)


async def get_chat_model(db: AsyncSession) -> AIModelConfig:
    """Get model configuration for module chat via usage config"""
    return await ai_model_service.get_config_for_usage(db, "module_chat_query")


async def get_fast_model(db: AsyncSession) -> AIModelConfig:
    """Get model configuration for simple tasks via usage config"""
    return await ai_model_service.get_config_for_usage(db, "module_title_generation")


def extract_keywords(question: str) -> list[str]:
    """Extract keywords from question for content matching"""
    stop_words = {'的', '是', '在', '有', '和', '了', '我', '这', '那', '什么',
                  '怎么', '如何', '哪些', '可以', '能', '吗', '呢', '吧', '啊',
                  '帮', '给', '创建', '生成', '属性', '参数',
                  'the', 'a', 'an', 'is', 'are', 'what', 'how', 'which', 'can'}
    words = re.split(r'[\s,，。？！?!、：:;；""\'\'""（）()\[\]【】]+', question)
    keywords = [w.lower() for w in words if len(w) > 1 and w.lower() not in stop_words]
    return keywords


def find_relevant_chapters(chapters: list, keywords: list, max_results: int = 5) -> list:
    """Recursively search chapter tree for keyword matches"""
    results = []

    def search_recursive(items: list, depth: int = 0):
        for ch in items:
            title = ((ch.get('title') or '') + ' ' + (ch.get('title_en') or '')).lower()
            content = (ch.get('content') or '')[:1000].lower()
            score = sum(1 for kw in keywords if kw in title or kw in content)
            if score > 0:
                results.append({
                    'title': ch.get('title') or '',
                    'title_en': ch.get('title_en') or '',
                    'content': ch.get('content') or '',
                    '_score': score + (3 - min(depth, 3))
                })
            if ch.get('children'):
                search_recursive(ch['children'], depth + 1)

    search_recursive(chapters)
    results.sort(key=lambda x: x.get('_score', 0), reverse=True)
    return results[:max_results]


def get_module_text_size(toc: List[Dict[str, Any]]) -> int:
    """计算模组TOC中的总文字量"""
    total = 0
    for item in toc:
        content = item.get('content') or ''
        total += len(content)
        children = item.get('children') or []
        if children:
            total += get_module_text_size(children)
    return total


def get_full_chapter_content(chapter: Dict[str, Any], depth: int = 0) -> str:
    """递归获取章节及所有子节点的完整内容"""
    title = chapter.get('title', '')
    content = chapter.get('content') or ''

    # 添加标题层级
    prefix = '#' * min(depth + 3, 6)  # ###, ####, #####, ######
    result = f"{prefix} {title}\n{content}" if content else f"{prefix} {title}"

    for child in chapter.get('children') or []:
        child_content = get_full_chapter_content(child, depth + 1)
        if child_content:
            result += '\n\n' + child_content

    return result


def find_top_chapter_by_path(toc: List[Dict[str, Any]], chapter_path: str) -> Optional[Dict[str, Any]]:
    """根据章节路径找到顶层章节"""
    if not chapter_path:
        return None

    # 路径格式: "第1章：xxx/子章节/孙章节"
    top_title = chapter_path.split('/')[0]

    for chapter in toc:
        ch_title = chapter.get('title', '')
        # 模糊匹配顶层章节
        if top_title in ch_title or ch_title in top_title:
            return chapter

    return None


def build_chapter_context_by_titles(module: Any, titles: List[str]) -> Optional[str]:
    """Build context string from user-selected chapter titles.

    Traverses the module's chapter tree, collects content for matching titles,
    and concatenates with section headers, capped at ~15KB total.
    """
    chapters = module.chapters or module.toc or []
    if not chapters or not titles:
        return None

    title_set = set(titles)
    context_parts = []
    total_len = 0
    max_len = 15000

    def collect(nodes: List[Dict[str, Any]], depth: int = 0):
        nonlocal total_len
        for ch in nodes:
            if total_len >= max_len:
                return
            ch_title = ch.get('title') or ''
            if ch_title in title_set:
                content = ch.get('content') or ''
                prefix = '#' * min(depth + 3, 6)
                part = f"{prefix} {ch_title}\n{content}" if content else f"{prefix} {ch_title}"
                if total_len + len(part) > max_len:
                    part = part[:max_len - total_len] + '...(内容已截断)'
                context_parts.append(part)
                total_len += len(part)
            children = ch.get('children') or []
            if children:
                collect(children, depth + 1)

    collect(chapters)
    if not context_parts:
        return None

    module_title = module.title or "未知模组"
    header = f"## 模组: {module_title}\n### 用户指定章节上下文 ({len(context_parts)} 章)"
    return header + '\n\n' + '\n\n'.join(context_parts)


async def build_module_context_with_vector(
    db: AsyncSession,
    module: Any,
    question: str,
    current_chapter: Optional[str] = None
) -> str:
    """Build context using vector search (RAG) with fallback to keyword search.

    对于小模组（<500KB），使用混合方案：向量搜索定位 + 完整章节内容
    对于大模组，使用标准向量搜索返回 chunks

    Args:
        db: Database session
        module: The parsed module
        question: User's question
        current_chapter: Current chapter name (from current map)

    Returns:
        Context string for LLM
    """
    from app.services.module_embedding_service import ModuleEmbeddingService

    context_parts = []
    question_lower = question.lower()
    keywords = extract_keywords(question)

    # 1. Module overview
    module_info = module.module_info or {}
    title = module.title or module_info.get('title', 'Unknown')
    context_parts.append(f"## 模组: {title}")
    if module.description:
        context_parts.append(f"简介: {module.description[:800]}")

    # 计算模组文字量，决定使用哪种策略
    toc = module.toc or module.chapters or []
    text_size = get_module_text_size(toc)
    use_hybrid = text_size < 500_000  # 小于500KB用混合方案
    logger.info(f"[模组搜索] 模组: {module.title}, 文字量: {text_size//1000}KB, 使用混合方案: {use_hybrid}")

    # 2. Try vector search first
    embedding_service = ModuleEmbeddingService(db)
    is_embedded = await embedding_service.is_module_embedded(module.module_id)
    vector_search_ok = False

    if is_embedded:
        try:
            # Use vector search
            search_results = await embedding_service.search_module_content(
                module.module_id,
                question,
                top_k=20 if not use_hybrid else 5,  # 混合方案只需定位少量章节
                similarity_threshold=0.25,
                use_rerank=True
            )

            if search_results:
                vector_search_ok = True
                if use_hybrid and toc:
                    # 混合方案：向量搜索定位 + 完整章节内容
                    context_parts.append(f"### 相关章节（混合检索，模组文字量: {text_size//1000}KB）")

                    # 找到相关的顶层章节（去重）
                    seen_chapters = set()
                    full_chapters = []

                    for result in search_results:
                        chapter_path = result.get('chapter_path') or result.get('chapter_title', '')
                        top_chapter = find_top_chapter_by_path(toc, chapter_path)

                        if top_chapter:
                            ch_title = top_chapter.get('title', '')
                            if ch_title not in seen_chapters:
                                seen_chapters.add(ch_title)
                                similarity = result.get('similarity', 0)
                                full_content = get_full_chapter_content(top_chapter)
                                full_chapters.append((ch_title, full_content, similarity))

                    # 限制总内容量（最多3个完整章节，或总计100KB）
                    total_content = 0
                    max_content = 100_000  # 100KB
                    logger.info(f"[混合搜索] 找到 {len(full_chapters)} 个相关章节: {[c[0] for c in full_chapters]}")
                    for i, (ch_title, content, sim) in enumerate(full_chapters[:3]):
                        if total_content + len(content) > max_content and i > 0:
                            break
                        context_parts.append(f"**【完整章节】{ch_title}** (相关度: {sim:.2f})\n{content}")
                        total_content += len(content)
                else:
                    # 大模组：标准向量搜索返回 chunks
                    context_parts.append("### 相关内容（向量搜索）")
                    for i, result in enumerate(search_results, 1):
                        chapter_info = result.get('chapter_path') or result.get('chapter_title', '')
                        content = result.get('content', '')
                        similarity = result.get('similarity', 0)
                        context_parts.append(
                            f"**[{i}] {chapter_info}** (相关度: {similarity:.2f})\n{content}"
                        )
        except Exception as e:
            logger.warning(f"[模组搜索] 向量搜索失败，回退到关键字搜索: {e}")
            vector_search_ok = False

    if not vector_search_ok:
        # Fallback: keyword search on chapters
        chapters = module.chapters or module.toc or []

        # Current chapter from map
        if current_chapter and chapters:
            def find_chapter_by_name(chapters_list, target_name):
                for ch in chapters_list:
                    ch_title = ch.get('title', '')
                    if target_name in ch_title or ch_title in target_name:
                        return ch
                    children = ch.get('children', [])
                    if children:
                        found = find_chapter_by_name(children, target_name)
                        if found:
                            return found
                return None

            current_chapter_content = find_chapter_by_name(chapters, current_chapter)
            if current_chapter_content:
                content = current_chapter_content.get('content', '')
                if len(content) > 3000:
                    content = content[:3000] + '...(内容已截断)'
                context_parts.append(
                    f"### 【当前章节】: {current_chapter_content['title']}\n{content}"
                )

        # Keyword search
        if chapters and keywords:
            relevant_chapters = find_relevant_chapters(chapters, keywords, max_results=5)
            for ch in relevant_chapters:
                content = ch.get('content', '')
                if len(content) > 2500:
                    content = content[:2500] + '...(内容已截断)'
                context_parts.append(f"### 章节: {ch['title']}\n{content}")

    # 3. Search monsters/NPCs by keyword (check both directions for Chinese text)
    monsters = module.monsters or []
    matched_monsters = []
    for m in monsters:
        m_name = m.get('name', '')
        m_name_en = m.get('name_en', '')
        name_str = (m_name + ' ' + m_name_en).lower()
        if any(kw in name_str or (len(m_name) > 1 and m_name in kw) for kw in keywords):
            matched_monsters.append(m)

    if matched_monsters:
        for m in matched_monsters[:3]:
            context_parts.append(
                f"### 怪物/NPC: {m.get('name', '')}\n{json.dumps(m, ensure_ascii=False)[:1500]}"
            )
    elif monsters:
        # Always include monster summary so AI knows what's in the module
        monster_list = '\n'.join([
            f"- {m.get('name', '')} ({m.get('name_en', '')})" for m in monsters[:20]
        ])
        extra = f"\n...及其他 {len(monsters) - 20} 个" if len(monsters) > 20 else ""
        context_parts.append(f"### 模组中的怪物/NPC ({len(monsters)}个)\n{monster_list}{extra}")

    # 4. Search items by keyword (check both directions)
    items = module.items or []
    matched_items = []
    for item in items:
        i_name = item.get('name', '')
        i_name_en = item.get('name_en', '')
        name_str = (i_name + ' ' + i_name_en).lower()
        if any(kw in name_str or (len(i_name) > 1 and i_name in kw) for kw in keywords):
            matched_items.append(item)

    if matched_items:
        for item in matched_items[:3]:
            context_parts.append(
                f"### 物品: {item.get('name', '')}\n{json.dumps(item, ensure_ascii=False)[:1000]}"
            )
    elif items:
        # Always include item summary so AI knows what's in the module
        item_list = '\n'.join([
            f"- {item.get('name', '')} ({item.get('name_en', '')})" for item in items[:15]
        ])
        context_parts.append(f"### 模组中的物品 ({len(items)}个)\n{item_list}")

    # 5. If no content found, add TOC
    if len(context_parts) <= 2:
        toc = module.toc or []
        if toc:
            toc_text = '\n'.join([f"- {t.get('title', '')}" for t in toc[:25]])
            context_parts.append(f"### 目录结构\n{toc_text}")

    full_context = '\n\n'.join(context_parts)
    if len(full_context) > 12000:
        full_context = full_context[:12000] + '\n\n...(上下文已截断)'

    return full_context


def build_module_context(module: Any, question: str, current_chapter: Optional[str] = None) -> str:
    """Build context from module JSONB content based on question

    Args:
        module: The parsed module
        question: User's question
        current_chapter: Current chapter name (from current map), prioritized in context
    """
    context_parts = []
    question_lower = question.lower()
    keywords = extract_keywords(question)

    # 1. Module overview
    module_info = module.module_info or {}
    title = module.title or module_info.get('title', 'Unknown')
    context_parts.append(f"## 模组: {title}")
    if module.description:
        context_parts.append(f"简介: {module.description[:800]}")

    # 2. If current chapter is specified (from current map), add it first
    # Note: 数据可能存在 chapters 或 toc 字段，优先使用 chapters，fallback 到 toc
    chapters = module.chapters or module.toc or []
    current_chapter_content = None
    if current_chapter and chapters:
        def find_chapter_by_name(chapters_list, target_name):
            """Recursively find chapter by name"""
            for ch in chapters_list:
                ch_title = ch.get('title') or ''
                # Fuzzy match: check if target is in title or title is in target
                if target_name in ch_title or ch_title in target_name:
                    return ch
                children = ch.get('children') or []
                if children:
                    found = find_chapter_by_name(children, target_name)
                    if found:
                        return found
            return None

        current_chapter_content = find_chapter_by_name(chapters, current_chapter)
        if current_chapter_content:
            content = current_chapter_content.get('content') or ''
            if len(content) > 3000:
                content = content[:3000] + '...(内容已截断)'
            context_parts.append(f"### 【当前章节 - 基于地图位置】: {current_chapter_content.get('title') or ''}\n{content}")

    # 3. Search relevant chapters by keywords
    if chapters and keywords:
        relevant_chapters = find_relevant_chapters(chapters, keywords, max_results=5)
        for ch in relevant_chapters:
            # Skip if this is already added as current chapter
            if current_chapter_content and ch.get('title') == current_chapter_content.get('title'):
                continue
            content = ch.get('content') or ''
            if len(content) > 2500:
                content = content[:2500] + '...(内容已截断)'
            context_parts.append(f"### 章节: {ch.get('title') or ''}\n{content}")

    # 3. Search monsters/NPCs by keyword matching (both directions for Chinese)
    monsters = module.monsters or []
    matched_monsters = []
    for m in monsters:
        m_name = m.get('name', '')
        name = (m_name + ' ' + m.get('name_en', '')).lower()
        if any(kw in name or (len(m_name) > 1 and m_name in kw) for kw in keywords):
            matched_monsters.append(m)

    if matched_monsters:
        for m in matched_monsters[:3]:
            context_parts.append(f"### 怪物/NPC: {m.get('name', '')}\n{json.dumps(m, ensure_ascii=False)[:1500]}")
    elif monsters:
        monster_list = '\n'.join([f"- {m.get('name', '')} ({m.get('name_en', '')})" for m in monsters[:20]])
        extra = f"\n...及其他 {len(monsters) - 20} 个" if len(monsters) > 20 else ""
        context_parts.append(f"### 模组中的怪物/NPC ({len(monsters)}个)\n{monster_list}{extra}")

    # 4. Search items by keyword (both directions)
    items = module.items or []
    matched_items = []
    for item in items:
        i_name = item.get('name', '')
        name = (i_name + ' ' + item.get('name_en', '')).lower()
        if any(kw in name or (len(i_name) > 1 and i_name in kw) for kw in keywords):
            matched_items.append(item)

    if matched_items:
        for item in matched_items[:3]:
            context_parts.append(f"### 物品: {item.get('name', '')}\n{json.dumps(item, ensure_ascii=False)[:1000]}")
    elif items:
        item_list = '\n'.join([f"- {item.get('name', '')} ({item.get('name_en', '')})" for item in items[:15]])
        context_parts.append(f"### 模组中的物品 ({len(items)}个)\n{item_list}")

    # 5. If no specific content found, add TOC
    if len(context_parts) <= 2:
        toc = module.toc or []
        if toc:
            toc_text = '\n'.join([f"- {t.get('title', '')}" for t in toc[:25]])
            context_parts.append(f"### 目录结构\n{toc_text}")

    full_context = '\n\n'.join(context_parts)
    if len(full_context) > 10000:
        full_context = full_context[:10000] + '\n\n...(上下文已截断)'

    return full_context


def size_cn_to_token_size(size_cn: str) -> str:
    """Convert Chinese size to token size string"""
    size_map = {
        '大型': '2x2', 'Large': '2x2',
        '超大型': '3x3', 'Huge': '3x3',
        '巨型': '4x4', 'Gargantuan': '4x4',
    }
    return size_map.get(size_cn, '1x1')


# ===== API Endpoints =====

@router.get("", response_model=ModuleChatHistoryResponse)
async def get_chat_history(
    module_id: str,
    session_id: Optional[int] = Query(None, description="Filter by session ID"),
    chapter_title: Optional[str] = Query(None, description="Filter by chapter title"),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Get chat history for a user in a module, optionally filtered by chapter"""
    user_id = str(current_user["user_id"])
    module = await resolve_module(db, module_id)
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    filters = [
        ModuleChatMessage.module_id == module_id,
        ModuleChatMessage.user_id == user_id
    ]
    if session_id is not None:
        filters.append(ModuleChatMessage.session_id == session_id)
    if chapter_title is not None:
        filters.append(ModuleChatMessage.chapter_title == chapter_title)
    else:
        filters.append(ModuleChatMessage.chapter_title.is_(None))

    query = (
        select(ModuleChatMessage)
        .where(*filters)
        .order_by(ModuleChatMessage.created_at.asc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(query)
    messages = result.scalars().all()

    count_result = await db.execute(
        select(ModuleChatMessage).where(*filters)
    )
    total = len(count_result.scalars().all())

    return ModuleChatHistoryResponse(
        messages=[ModuleChatMessageResponse.model_validate(m) for m in messages],
        total=total
    )


@router.post("/query")
async def query_module_stream(
    module_id: str,
    request: ModuleChatMessageCreate,
    campaign_id: int = Query(None, description="Campaign ID to get current map context"),
    session_id: Optional[int] = Query(None, description="Chat session ID"),
    analyze_map: bool = Query(False, description="Whether to use multimodal vision to analyze current map"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Query AI about module content with SSE streaming"""
    user_id = str(current_user["user_id"])

    if campaign_id:
        await resolve_campaign_member_context(db, campaign_id, current_user)

    # Verify module exists (supports both ParsedModule and CustomModule)
    module = await resolve_module(db, module_id)
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    # Get current chapter and map URL from current map if campaign_id is provided
    current_chapter = None
    current_map_url = None
    if campaign_id:
        # Get campaign's current_map_url
        campaign_result = await db.execute(
            select(Campaign).where(Campaign.id == campaign_id)
        )
        campaign = campaign_result.scalar_one_or_none()
        if campaign and campaign.current_map_url:
            current_map_url = campaign.current_map_url
            # Find the map in module_maps
            maps_result = await db.execute(
                select(ModuleMaps).where(
                    ModuleMaps.campaign_id == campaign_id,
                    ModuleMaps.module_id == module_id
                )
            )
            module_maps = maps_result.scalars().first()
            if module_maps and module_maps.maps:
                for map_item in module_maps.maps:
                    if map_item.get('url') == campaign.current_map_url:
                        current_chapter = map_item.get('chapter')
                        break

    # Decide which model config to use based on analyze_map flag
    use_multimodal = analyze_map and current_map_url
    if use_multimodal:
        # Use ADVANCED multimodal model for map analysis
        usage_params = await ai_model_service.get_usage_params(db, "module_map_analysis")
    else:
        # Use regular CHAT model
        usage_params = await ai_model_service.get_usage_params(db, "module_chat_query")

    chat_config = usage_params.config
    temperature = usage_params.temperature
    max_tokens = usage_params.max_tokens
    if not chat_config:
        raise HTTPException(status_code=500, detail="No AI config for module chat")

    active_session_id = session_id
    previous_session_id: Optional[int] = None
    session_switched = False
    session_title: Optional[str] = None
    session_message_count: Optional[int] = None
    session_updated_at: Optional[str] = None

    # Session rollover: if current session is about to exceed message limit, create a continuation session
    if active_session_id is not None:
        current_session = await db.get(ModuleChatSession, active_session_id)
        if (
            not current_session
            or current_session.module_id != module_id
            or current_session.user_id != user_id
        ):
            raise HTTPException(status_code=404, detail="Session not found")

        current_count = await _get_session_message_count(db, module_id, user_id, active_session_id)
        if current_count + 2 > SESSION_MESSAGE_LIMIT:
            previous_session_id = active_session_id
            session_switched = True

            summary_source_messages = await _load_recent_session_messages(
                db=db,
                module_id=module_id,
                user_id=user_id,
                session_id=active_session_id,
                limit=SESSION_SUMMARY_SOURCE_LIMIT,
            )
            summary_text = await _generate_rollover_summary(
                recent_messages=summary_source_messages,
                chat_config=chat_config,
                temperature=temperature,
                max_tokens=max_tokens,
            )

            continuation_session = ModuleChatSession(
                module_id=module_id,
                user_id=user_id,
                campaign_id=current_session.campaign_id,
                title=_build_rollover_session_title(current_session.title),
            )
            db.add(continuation_session)
            await db.flush()
            await db.refresh(continuation_session)

            summary_message = ModuleChatMessage(
                module_id=module_id,
                user_id=user_id,
                role="assistant",
                content=f"{SESSION_SUMMARY_MARKER}\n{summary_text}",
                session_id=continuation_session.id,
            )
            db.add(summary_message)

            active_session_id = continuation_session.id
            session_title = continuation_session.title or "新对话"
        else:
            session_title = current_session.title or "新对话"

    # Save user's question (possibly into a rollover session)
    user_message = ModuleChatMessage(
        module_id=module_id,
        user_id=user_id,
        role="user",
        content=request.content,
        session_id=active_session_id,
    )
    db.add(user_message)

    # Keep session ordering fresh after user sends a message
    if active_session_id is not None:
        session_for_touch = await db.get(ModuleChatSession, active_session_id)
        if session_for_touch:
            session_for_touch.updated_at = func.now()

    await db.commit()
    await db.refresh(user_message)

    if active_session_id is not None:
        session_message_count = await _get_session_message_count(
            db=db,
            module_id=module_id,
            user_id=user_id,
            session_id=active_session_id,
        )
        session_row = await db.get(ModuleChatSession, active_session_id)
        if session_row:
            await db.refresh(session_row)
            session_title = session_row.title or session_title or "新对话"
            if session_row.updated_at:
                session_updated_at = session_row.updated_at.isoformat()

    # Load conversation history for context
    history_messages = []
    if active_session_id:
        recent_history = await _load_recent_session_messages(
            db=db,
            module_id=module_id,
            user_id=user_id,
            session_id=active_session_id,
            limit=SESSION_CONTEXT_HISTORY_LIMIT,
            exclude_message_id=user_message.id,
        )
        for msg in recent_history:
            if _is_session_summary_message(msg.content or ""):
                history_messages.append(
                    {
                        "role": "system",
                        "content": _strip_session_summary_marker(msg.content or ""),
                    }
                )
            else:
                history_messages.append({"role": msg.role, "content": msg.content})

    # Build context from module using vector search (with fallback to keyword search)
    context = await build_module_context_with_vector(db, module, request.content, current_chapter)

    # Override context if user selected specific chapters
    if request.chapter_titles:
        chapter_context = build_chapter_context_by_titles(module, request.chapter_titles)
        if chapter_context:
            context = chapter_context

    module_title = module.title or "未知模组"

    # Build system prompt based on mode
    if use_multimodal:
        # Multimodal map analysis prompt
        current_chapter_hint = ""
        if current_chapter:
            current_chapter_hint = f"\n\n**当前地图章节**: {current_chapter}"

        system_prompt = f"""你是一位专业的DM助手，正在帮助DM分析D&D冒险模组《{module_title}》的地图。{current_chapter_hint}

用户正在查看一张模组地图，请结合地图图像和模组内容回答用户的问题。

## 回答要求
1. 仔细观察地图图像，识别其中的区域、房间、通道、地标等
2. 结合模组文本内容，说明每个区域的功能、NPC、怪物、物品等信息
3. 使用Markdown格式，结构清晰
4. 回答要详细且有帮助

## 地图位置标记（重要！）

在回答**最后**，请添加地图标记数据，用于在地图上显示标注点。

格式（务必严格遵守）：
```
<!--MAP_MARKERS-->
[
  {{"x": "25%", "y": "30%", "label": "入口", "content": "主入口，有两名守卫"}},
  {{"x": "50%", "y": "45%", "label": "大厅", "content": "中央大厅，可能有4-6只地精"}},
  {{"x": "75%", "y": "60%", "label": "Boss房", "content": "黑蜘蛛的巢穴，最终BOSS所在地"}}
]
<!--/MAP_MARKERS-->
```

标记规则：
- x: 水平位置百分比（0%=最左边，100%=最右边）
- y: 垂直位置百分比（0%=最上边，100%=最下边）
- label: 简短标签（2-4个字）
- content: 详细描述（可以包含NPC、怪物、物品等信息）
- 根据地图实际内容标注5-15个重要位置
- 如果无法从图像中确定某个区域的具体位置，可以省略该标记

## 当前模组上下文

{context}"""
    else:
        # Regular text-only prompt
        current_chapter_hint = ""
        if current_chapter:
            current_chapter_hint = f"\n\n**当前地图上下文**: 用户正在查看与「{current_chapter}」相关的地图。当用户说\"这一章\"、\"这里\"、\"当前位置\"时，请优先参考该章节内容。"

        # Generate pre-rolled dice for AI to use
        pre_rolled_dice = generate_pre_rolled_dice()

        system_prompt = f"""你是一位专业的DM助手，正在帮助DM准备和理解D&D冒险模组《{module_title}》。{current_chapter_hint}

请根据模组内容回答用户的问题。如果用户问到某个NPC或怪物，除了介绍背景外，如果模组中没有完整的D&D 5E属性，你可以建议用户创建该角色的属性卡。

回答要求：
1. 准确引用模组内容
2. 使用Markdown格式，结构清晰
3. 如果涉及NPC/怪物，说明其在故事中的角色
4. 回答要简洁有用

## 实体标记（重要！）

如果你的回答中提到了以下类型的实体，请在回答**开头第一行**添加简单的HTML注释标记：
- NPC: 角色、怪物、敌人等
- SHOP: 商店、军械库、铁匠铺等
- ITEM: 武器、防具、魔法物品等
- ENCOUNTER: 普通战斗遭遇（多个小怪）
- BOSS: BOSS战遭遇（有明确的BOSS角色+可能的小兵）
- MAP: 地点、场景、战斗场地

格式：在回答开头添加（每种类型一个标记）
<!--NPC--><!--SHOP-->

示例：
- 提到NPC：回答开头写 <!--NPC-->
- 提到NPC和商店：回答开头写 <!--NPC--><!--SHOP-->
- 普通小怪遭遇：回答开头写 <!--ENCOUNTER-->
- BOSS战（如"黑蜘蛛的巢穴"）：回答开头写 <!--BOSS-->

如果没有上述实体则不需要标记。

## 预掷骰子结果（用于随机表）

当你需要从随机表中选择时，请使用以下预先掷好的骰子结果（按顺序使用，用完后循环）：
{pre_rolled_dice}

使用方法：
- 需要 d20 时，使用 d20 列表中的下一个数字
- 根据模组上下文，先筛选出合适的选项，再用骰子结果决定
- 例如：地下城建造者表需要 d20，你的 d20 结果是 17，对应"巫妖"

## 当前模组上下文

{context}"""

    # Build messages based on mode
    if use_multimodal:
        # Multimodal message with image
        messages = [
            {"role": "system", "content": system_prompt},
            *history_messages,
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": current_map_url}
                    },
                    {
                        "type": "text",
                        "text": request.content
                    }
                ]
            }
        ]
    else:
        # Regular text-only message
        messages = [
            {"role": "system", "content": system_prompt},
            *history_messages,
            {"role": "user", "content": request.content}
        ]

    initial_session_meta = _build_session_sse_meta(
        session_id=active_session_id,
        session_switched=session_switched,
        previous_session_id=previous_session_id,
        session_title=session_title,
        session_message_count=session_message_count,
        session_updated_at=session_updated_at,
    )

    async def generate_stream():
        full_response = ""
        try:
            # Initial metadata packet so frontend can update session state before content arrives
            yield f"data: {json.dumps({'user_message_id': user_message.id, **initial_session_meta}, ensure_ascii=False)}\n\n"

            async for chunk in AIService.generate_completion_stream(
                api_url=chat_config.api_url,
                api_key=chat_config.api_key,
                model=chat_config.model_name,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens
            ):
                full_response += chunk
                payload: dict = {"content": chunk}
                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

            # Process [[RANDOM:...]] tags - AI's smart filter + true random selection
            # This allows AI to provide filtered options and system makes the random choice
            processed_response = process_random_tags(full_response)
            has_random_tags = processed_response != full_response

            # Save processed response after streaming completes
            # Use a new session because the original db session from Depends(get_db)
            # is already closed by the time the generator executes
            from app.db.session import async_session_maker
            final_session_meta = initial_session_meta
            async with async_session_maker() as gen_db:
                assistant_message = ModuleChatMessage(
                    module_id=module_id,
                    user_id=user_id,
                    role="assistant",
                    content=processed_response,  # Save the processed version
                    session_id=active_session_id,
                )
                gen_db.add(assistant_message)
                await gen_db.flush()
                message_id = assistant_message.id

                # Update session's updated_at timestamp
                if active_session_id:
                    sess = await gen_db.get(ModuleChatSession, active_session_id)
                    if sess:
                        sess.updated_at = func.now()
                await gen_db.commit()

                if active_session_id:
                    final_count = await _get_session_message_count(
                        db=gen_db,
                        module_id=module_id,
                        user_id=user_id,
                        session_id=active_session_id,
                    )
                    final_session = await gen_db.get(ModuleChatSession, active_session_id)
                    if final_session:
                        await gen_db.refresh(final_session)
                    final_title = session_title
                    final_updated = session_updated_at
                    if final_session:
                        final_title = final_session.title or final_title
                        if final_session.updated_at:
                            final_updated = final_session.updated_at.isoformat()
                    final_session_meta = _build_session_sse_meta(
                        session_id=active_session_id,
                        session_switched=session_switched,
                        previous_session_id=previous_session_id,
                        session_title=final_title,
                        session_message_count=final_count,
                        session_updated_at=final_updated,
                    )

            done_payload: Dict[str, Any] = {
                "done": True,
                "message_id": message_id,
                **final_session_meta,
            }
            if has_random_tags:
                done_payload["processed_content"] = processed_response
            yield f"data: {json.dumps(done_payload, ensure_ascii=False)}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


# ===== Creator Knowledge Base =====

_creator_cache: Dict[str, str] = {}

_CREATOR_KEYWORD_MAP: Dict[str, List[str]] = {
    "villains-npcs.json": ["npc", "角色", "反派", "villain", "敌人", "boss", "人物"],
    "npc-traits.json": ["npc", "角色", "特征", "trait", "性格", "人物"],
    "dungeons.json": ["地下城", "dungeon", "地点", "洞穴", "迷宫", "房间"],
    "encounters.json": ["遭遇", "encounter", "战斗", "combat", "敌人", "怪物"],
    "wilderness.json": ["荒野", "wilderness", "旅行", "travel", "野外", "天气"],
    "settlements.json": ["城镇", "settlement", "村庄", "聚落", "酒馆", "城市"],
    "treasure-rewards.json": ["宝藏", "treasure", "奖励", "reward", "战利品", "金币", "魔法物品"],
    "templates.json": ["模板", "template", "结构", "format"],
    "adventure-structure.json": ["结构", "structure", "章节", "流程", "开头", "高潮"],
    "adventure-goals.json": ["目标", "goal", "动机", "motivation", "任务"],
    "complications.json": ["反转", "complication", "支线", "困境", "道德"],
    "planes.json": ["位面", "plane", "异界", "深渊", "九狱"],
}


def _load_creator_file(filename: str) -> str:
    """Load a creator knowledge base file with caching."""
    if filename in _creator_cache:
        return _creator_cache[filename]

    from app.utils.rules_cache import CREATOR_KB_PATH
    creator_dir = CREATOR_KB_PATH
    filepath = creator_dir / filename
    if not filepath.exists():
        _creator_cache[filename] = ""
        return ""

    try:
        text = filepath.read_text(encoding="utf-8")
        _creator_cache[filename] = text
        return text
    except Exception:
        _creator_cache[filename] = ""
        return ""


def _select_creator_knowledge(question: str, max_files: int = 2) -> str:
    """Select relevant creator knowledge files based on user question keywords."""
    q_lower = question.lower()
    scored: list[tuple[str, int]] = []

    for filename, keywords in _CREATOR_KEYWORD_MAP.items():
        hits = sum(1 for kw in keywords if kw in q_lower)
        if hits > 0:
            scored.append((filename, hits))

    scored.sort(key=lambda x: x[1], reverse=True)
    selected = [f for f, _ in scored[:max_files]]

    parts: list[str] = []
    for fname in selected:
        content = _load_creator_file(fname)
        if content:
            # Truncate to 4000 chars per file
            if len(content) > 4000:
                content = content[:4000] + "\n...(已截断)"
            label = fname.replace(".json", "").replace("-", " ").title()
            parts.append(f"### 创作参考: {label}\n{content}")

    # Always include core principles from AI_GUIDE.md
    guide = _load_creator_file("AI_GUIDE.md")
    if guide:
        # Extract key sections (first ~1500 chars covers role + file descriptions)
        guide_excerpt = guide[:1500]
        if len(guide) > 1500:
            guide_excerpt += "\n...(指南已截断)"
        parts.insert(0, f"### 模组创作指南\n{guide_excerpt}")

    return "\n\n".join(parts)




@router.delete("")
async def clear_chat_history(
    module_id: str,
    session_id: Optional[int] = Query(None, description="Scope deletion to a session"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Clear chat history for a user in a module, optionally scoped to a session"""
    user_id = str(current_user["user_id"])
    module = await resolve_module(db, module_id)
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    filters = [
        ModuleChatMessage.module_id == module_id,
        ModuleChatMessage.user_id == user_id,
    ]
    if session_id is not None:
        filters.append(ModuleChatMessage.session_id == session_id)

    await db.execute(delete(ModuleChatMessage).where(*filters))
    await db.commit()

    return {"status": "success", "message": "Chat history cleared"}


@router.delete("/{message_id}")
async def delete_chat_message(
    module_id: str,
    message_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Delete a single chat message"""
    user_id = str(current_user["user_id"])
    message = await db.get(ModuleChatMessage, message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    if message.module_id != module_id or message.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not allowed to delete this message")

    await db.delete(message)
    await db.commit()

    return {"status": "success", "message": "Message deleted"}


# ===== Entity Analysis API (Optimized - generates full data in one call) =====

from pydantic import BaseModel as PydanticBaseModel
from pathlib import Path

# Load preset monsters data for reference
_preset_monsters_cache = None

def _load_preset_monsters() -> dict:
    """Load preset monsters data from JSON file"""
    global _preset_monsters_cache
    if _preset_monsters_cache is not None:
        return _preset_monsters_cache

    from app.utils.rules_cache import get_all_monsters
    monsters = get_all_monsters()
    _preset_monsters_cache = {m.get('name', ''): m for m in monsters}
    _preset_monsters_cache.update({m.get('nameEn', '').lower(): m for m in monsters if m.get('nameEn')})
    return _preset_monsters_cache


# === Equipment Preset Data ===
_preset_equipment_cache = None


def _load_preset_equipment() -> dict:
    """Load preset equipment data from JSON file (armor, weapons, adventuring gear)"""
    global _preset_equipment_cache
    if _preset_equipment_cache is not None:
        return _preset_equipment_cache

    from app.utils.rules_cache import get_equipment_data
    data = get_equipment_data()
    if not data:
        _preset_equipment_cache = {}
        return _preset_equipment_cache

    _preset_equipment_cache = {}

    # Extract armor
    for armor_type in ['light', 'medium', 'heavy', 'shield']:
        for item in data.get('armor', {}).get(armor_type, []):
            _preset_equipment_cache[item.get('name', '')] = {**item, 'category': 'armor', 'subcategory': armor_type}
            if item.get('nameEn'):
                _preset_equipment_cache[item['nameEn'].lower()] = {**item, 'category': 'armor', 'subcategory': armor_type}

    # Extract weapons
    for weapon_class in ['simple', 'martial']:
        for weapon_type in ['melee', 'ranged']:
            for item in data.get('weapons', {}).get(weapon_class, {}).get(weapon_type, []):
                _preset_equipment_cache[item.get('name', '')] = {**item, 'category': 'weapon', 'subcategory': f'{weapon_class}_{weapon_type}'}
                if item.get('nameEn'):
                    _preset_equipment_cache[item['nameEn'].lower()] = {**item, 'category': 'weapon', 'subcategory': f'{weapon_class}_{weapon_type}'}

    # Extract adventuring gear
    for gear_type, gear_list in data.get('adventuringGear', {}).items():
        if isinstance(gear_list, list):
            for item in gear_list:
                _preset_equipment_cache[item.get('name', '')] = {**item, 'category': 'gear', 'subcategory': gear_type}
                if item.get('nameEn'):
                    _preset_equipment_cache[item['nameEn'].lower()] = {**item, 'category': 'gear', 'subcategory': gear_type}

    # Extract tools
    for tool_type, tool_list in data.get('tools', {}).items():
        if isinstance(tool_list, list):
            for item in tool_list:
                _preset_equipment_cache[item.get('name', '')] = {**item, 'category': 'tool', 'subcategory': tool_type}
                if item.get('nameEn'):
                    _preset_equipment_cache[item['nameEn'].lower()] = {**item, 'category': 'tool', 'subcategory': tool_type}

    # Add common aliases (LLM often simplifies names)
    _EQUIPMENT_ALIASES = {
        '箭矢': '箭(20支)',
        '箭': '箭(20支)',
        '弩矢': '弩矢(20支)',
        '弹丸': '投石索弹(20颗)',
        '吹矢': '吹矢(50支)',
        '背包': '背包',
        '绳索': '绳索(麻，50尺)',
        '火把': '火把',
        '口粮': '口粮(1天)',
    }
    for alias, original in _EQUIPMENT_ALIASES.items():
        if original in _preset_equipment_cache and alias not in _preset_equipment_cache:
            _preset_equipment_cache[alias] = _preset_equipment_cache[original]

    return _preset_equipment_cache
async def _generate_item_with_llm(
    item_name: str,
    db: AsyncSession,
    context: str = ""
) -> dict:
    """
    使用 LLM 生成符合 D&D 规则的物品数据

    对于武器、防具、魔法物品，会生成完整的规则数据格式
    """
    try:
        usage_params = await ai_model_service.get_usage_params(db, "custom_creation")
        config = usage_params.config

        prompt = f"""你是一个D&D 5E规则专家。请为以下物品生成符合D&D 5E规则的完整数据。

物品名称: {item_name}
{f"上下文信息: {context}" if context else ""}

请判断物品类型并输出对应格式的JSON:

如果是**武器**，输出格式:
{{
  "name": "中文名",
  "name_en": "English Name",
  "category": "weapon",
  "subcategory": "simple_melee|simple_ranged|martial_melee|martial_ranged",
  "damage": {{"dice": "1d8", "type": "挥砍|穿刺|钝击"}},
  "properties": ["双手", "长柄", "灵巧", "投掷", "多用", "特殊"],
  "range": {{"normal": 20, "long": 60}},  // 仅远程/投掷武器
  "weight": 3,
  "cost": {{"amount": 15, "unit": "gp"}},
  "description": "武器描述"
}}

如果是**防具**，输出格式:
{{
  "name": "中文名",
  "name_en": "English Name",
  "category": "armor",
  "subcategory": "light|medium|heavy|shield",
  "armor_class": {{"base": 14, "dex_bonus": true, "max_dex_bonus": 2}},
  "strength_requirement": 13,  // 如果有
  "stealth_disadvantage": true,  // 如果有
  "weight": 20,
  "cost": {{"amount": 50, "unit": "gp"}},
  "description": "防具描述"
}}

如果是**魔法物品**，输出格式:
{{
  "name": "中文名",
  "name_en": "English Name",
  "category": "magic_item",
  "subcategory": "wondrous|potion|scroll|ring|rod|staff|wand|weapon|armor",
  "rarity": "common|uncommon|rare|very_rare|legendary",
  "requires_attunement": true,
  "attunement_requirements": "需要由某职业调谐",  // 如果有特殊要求
  "properties": [],
  "cost": {{"amount": 500, "unit": "gp"}},
  "description": "物品效果的完整描述，包括使用方法、充能等"
}}

如果是**普通物品/冒险装备**，输出格式:
{{
  "name": "中文名",
  "name_en": "English Name",
  "category": "gear",
  "subcategory": "standard|container|kit|focus|instrument",
  "weight": 1,
  "cost": {{"amount": 2, "unit": "gp"}},
  "description": "物品描述和用途"
}}

重要规则:
1. 武器伤害骰要符合D&D规则（匕首1d4，长剑1d8，巨剑2d6等）
2. 防具AC要符合规则（皮甲11+敏捷，锁甲16无敏捷等）
3. 魔法物品稀有度影响价格（普通50-100gp，罕见500-5000gp等）
4. 重量单位是磅(lb)

只输出JSON，不要其他内容。"""

        messages = [{"role": "user", "content": prompt}]

        response = await AIService.generate_completion(
            api_url=config.api_url,
            api_key=config.api_key,
            model=config.model_name,
            messages=messages,
            temperature=usage_params.temperature,
            max_tokens=usage_params.max_tokens,
        )

        # 解析 JSON
        item_data = extract_json_from_text(response)
        if item_data:
            print(f"[_generate_item_with_llm] Generated item: {item_name} -> {item_data.get('category')}")
            return item_data

    except Exception as e:
        print(f"[_generate_item_with_llm] Failed to generate item {item_name}: {e}")

    # 返回基础物品结构
    return {
        "name": item_name,
        "category": "gear",
        "rarity": "common",
        "cost": {"amount": 10, "unit": "gp"},
        "description": item_name,
    }


def _find_matching_items(content: str, module_items: list, preset_equipment: dict) -> list:
    """Find items mentioned in content from module or preset data"""
    matches = []
    content_lower = content.lower()

    # Extract potential item names from content (Chinese and English)
    item_patterns = re.findall(r'[【「]([^】」]+)[】」]', content)
    potential_names = set(item_patterns)

    # Common item keywords in Chinese
    cn_item_keywords = re.findall(r'[\u4e00-\u9fa5]{2,8}(?:剑|刀|弓|斧|锤|杖|矛|盾|甲|袍|药水|卷轴|戒指|项链|护符|工具|火把|绳索|背包|帐篷)', content)
    potential_names.update(cn_item_keywords)

    # Search in module items first
    for item in module_items:
        i_name = item.get('name', '')
        i_name_en = item.get('name_en', '').lower()
        if i_name in content or i_name_en in content_lower:
            matches.append(('module', item))
        elif any(name in i_name for name in potential_names):
            matches.append(('module', item))

    # Search in preset equipment
    for name in potential_names:
        if name in preset_equipment:
            matches.append(('preset', preset_equipment[name]))
        elif name.lower() in preset_equipment:
            matches.append(('preset', preset_equipment[name.lower()]))

    # Also do direct substring matching for common items in preset
    common_items = ['匕首', '长剑', '短弓', '长弓', '皮甲', '链甲', '盾牌', '火把', '背包', '绳索', '治疗药水']
    for item_name in common_items:
        if item_name in content and item_name in preset_equipment:
            if not any(m[1].get('name') == item_name for m in matches):
                matches.append(('preset', preset_equipment[item_name]))

    return matches[:15]  # Limit matches


def _find_matching_monsters(content: str, module_monsters: list, preset_monsters: dict) -> list:
    """Find monsters mentioned in content from module or preset data"""
    matches = []
    content_lower = content.lower()

    # Extract potential entity names from content
    name_patterns = re.findall(r'[【「]([^】」]+)[】」]|(?:^|\s)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)', content)
    potential_names = set()
    for match in name_patterns:
        for name in match:
            if name and len(name) > 1:
                potential_names.add(name.strip())

    # Also extract Chinese names
    cn_names = re.findall(r'[\u4e00-\u9fa5]{2,10}(?:教徒|龙兽|战士|法师|祭司|守卫|骑士|刺客|盗贼|怪物|巨人|恶魔|不死|元素|精灵|矮人|兽人|妖精|龙|蛇|狼|熊|蜘蛛)', content)
    potential_names.update(cn_names)

    # Search in module monsters
    for monster in module_monsters:
        m_name = monster.get('name', '')
        m_name_en = monster.get('name_en', '').lower()
        if m_name in content or m_name_en in content_lower:
            matches.append(('module', monster))
        elif any(name in m_name or name.lower() in m_name_en for name in potential_names):
            matches.append(('module', monster))

    # Search in preset monsters
    for name in potential_names:
        if name in preset_monsters:
            matches.append(('preset', preset_monsters[name]))
        elif name.lower() in preset_monsters:
            matches.append(('preset', preset_monsters[name.lower()]))

    return matches[:10]  # Limit matches


def _get_monsters_by_cr_range(preset_monsters: dict, cr_min: float = 0, cr_max: float = 5) -> list:
    """
    Get preset monsters within a CR range for encounter generation.
    Returns monsters grouped by CR for AI reference.
    """
    # CR string to float conversion
    cr_to_float = {
        '0': 0, '1/8': 0.125, '1/4': 0.25, '1/2': 0.5,
        '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10
    }

    # Group monsters by CR
    cr_groups = {}
    seen_names = set()  # Avoid duplicates (same monster indexed by cn/en name)

    for name, monster in preset_monsters.items():
        m_name = monster.get('name', '')
        if m_name in seen_names:
            continue
        seen_names.add(m_name)

        cr_str = str(monster.get('cr', '0'))
        cr_val = cr_to_float.get(cr_str, 0)

        if cr_min <= cr_val <= cr_max:
            if cr_str not in cr_groups:
                cr_groups[cr_str] = []
            cr_groups[cr_str].append({
                'name': m_name,
                'type': monster.get('type', ''),
                'cr': cr_str,
                'ac': monster.get('ac', 10),
                'hp': monster.get('hp', 10),
            })

    # Sort and limit each group
    result = []
    cr_order = ['0', '1/8', '1/4', '1/2', '1', '2', '3', '4', '5']
    for cr in cr_order:
        if cr in cr_groups:
            monsters = cr_groups[cr][:8]  # Max 8 per CR
            result.append((cr, monsters))

    return result


def _detect_encounter_cr_needs(content: str) -> tuple[float, float]:
    """
    Analyze content to detect what CR range might be needed for encounters.
    Returns (cr_min, cr_max) based on context clues.
    """
    content_lower = content.lower()

    # Check for explicit CR mentions
    cr_patterns = re.findall(r'cr\s*(\d+(?:/\d+)?)', content_lower)
    if cr_patterns:
        cr_to_float = {'0': 0, '1/8': 0.125, '1/4': 0.25, '1/2': 0.5}
        max_cr = 0
        for cr in cr_patterns:
            val = cr_to_float.get(cr, float(cr) if cr.isdigit() else 0)
            max_cr = max(max_cr, val)
        return (0, min(max_cr + 2, 10))

    # Check for difficulty keywords
    if any(w in content for w in ['致命', 'deadly', '困难', 'hard', 'BOSS', 'boss', '强大']):
        return (2, 8)
    elif any(w in content for w in ['中等', 'medium', '普通']):
        return (0.5, 3)
    elif any(w in content for w in ['简单', 'easy', '初级', '低级']):
        return (0, 1)

    # Check for creature type hints
    if any(w in content for w in ['龙', 'dragon', '恶魔', 'demon', '巨人']):
        return (2, 10)
    elif any(w in content for w in ['地精', 'goblin', '狗头人', 'kobold', '强盗']):
        return (0, 2)
    elif any(w in content for w in ['僵尸', 'zombie', '骷髅', 'skeleton', '不死']):
        return (0, 3)
    elif any(w in content for w in ['野兽', 'beast', '狼', '熊', '蜘蛛']):
        return (0, 3)

    # Default: low-mid range for typical encounters
    return (0, 4)


class AnalyzeEntitiesRequest(PydanticBaseModel):
    content: str
    entity_types: list[str]  # ["NPC", "SHOP", "ITEM", "ENCOUNTER", "BOSS"]
    message_id: int  # Message ID to update with analysis results
    campaign_id: Optional[int] = None  # For searching campaign's monster instances


@router.post("/analyze-entities")
async def analyze_entities(
    module_id: str,
    request: AnalyzeEntitiesRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Analyze AI response content and generate complete entity data in ONE call.
    Uses RAG to find matching entities from module and preset data.
    Saves results to database for persistence across tab switches.
    """
    module = await resolve_module(db, module_id)
    module_title = module.title if module else "未知模组"
    module_description = module.description if module else ""

    try:
        usage_params = await ai_model_service.get_usage_params(db, "module_analyze_entities")
        fast_config = usage_params.config
        analyze_temperature = usage_params.temperature
        analyze_max_tokens = usage_params.max_tokens
    except HTTPException:
        raise HTTPException(status_code=500, detail="未配置FAST模型")

    # === Enhanced: RAG retrieval ===
    # 1. Get module monsters/items
    module_monsters = module.monsters if module and module.monsters else []
    module_items = module.items if module and module.items else []

    # 2. Load preset data
    preset_monsters = _load_preset_monsters()
    preset_equipment = _load_preset_equipment()

    # 3. Search campaign's monster instances (resource library) for BOSS
    campaign_monsters = []
    if request.campaign_id and "BOSS" in request.entity_types:
        from app.models.monster_instance import MonsterInstance
        result = await db.execute(
            select(MonsterInstance).where(MonsterInstance.campaign_id == request.campaign_id)
        )
        instances = result.scalars().all()
        for inst in instances:
            campaign_monsters.append({
                'name': inst.name,
                'name_cn': inst.name_cn,
                'cr': inst.challenge_rating,
                'ac': inst.armor_class,
                'hp': inst.hit_points,
                'type': inst.type,
                'size': inst.size,
                'source': 'campaign',
                'monster_data': inst.monster_data,
            })

    # 4. Find matching entities from content
    matched_monsters = _find_matching_monsters(request.content, module_monsters, preset_monsters)
    matched_items = _find_matching_items(request.content, module_items, preset_equipment)

    # Build reference data section
    reference_data = []
    if matched_monsters:
        reference_data.append("### 怪物/NPC参考数据（优先使用）")
        for source, monster in matched_monsters[:5]:
            if source == 'module':
                # 模组怪物：包含描述（可能有小兵配置信息）
                desc = monster.get('description', '')
                desc_preview = desc[:300] + '...' if len(desc) > 300 else desc
                reference_data.append(f"【模组BOSS】{monster.get('name', '')}: CR {monster.get('cr', '?')}, AC {monster.get('ac', '?')}, HP {monster.get('hp', '?')}")
                if desc_preview:
                    reference_data.append(f"  描述: {desc_preview}")
            else:
                reference_data.append(f"【预设】{monster.get('name', '')}: CR {monster.get('cr', '?')}, AC {monster.get('ac', '?')}, HP {monster.get('hp', '?')}, 类型: {monster.get('type', '?')}")

    if matched_items:
        reference_data.append("\n### 物品/装备参考数据（优先使用）")
        for source, item in matched_items[:10]:
            cost_str = ""
            if item.get('costCopper'):
                gp = item['costCopper'] // 100
                cost_str = f", 价格: {gp}gp" if gp > 0 else f", 价格: {item['costCopper']}cp"
            elif item.get('cost'):
                cost = item['cost']
                if 'gp' in cost:
                    cost_str = f", 价格: {cost['gp']}gp"
                elif 'sp' in cost:
                    cost_str = f", 价格: {cost['sp']}sp"
            reference_data.append(f"【预设】{item.get('name', '')}: 类型 {item.get('category', '?')}{cost_str}")

    # 5. For BOSS: show campaign's existing monsters (resource library)
    if campaign_monsters and "BOSS" in request.entity_types:
        # Find monsters mentioned in content
        content_lower = request.content.lower()
        matched_campaign = []
        for m in campaign_monsters:
            if m['name'] in request.content or (m.get('name_cn') and m['name_cn'] in request.content):
                matched_campaign.append(m)
        if matched_campaign:
            reference_data.append("\n### 资源库已有怪物（可直接用于BOSS战）")
            for m in matched_campaign[:3]:
                reference_data.append(f"【资源库】{m['name']}: CR {m.get('cr', '?')}, AC {m.get('ac', '?')}, HP {m.get('hp', '?')}, 类型: {m.get('type', '?')}")

    # 6. For ENCOUNTER/BOSS: search preset monsters by CR range
    if "ENCOUNTER" in request.entity_types or "BOSS" in request.entity_types:
        cr_min, cr_max = _detect_encounter_cr_needs(request.content)
        encounter_monsters = _get_monsters_by_cr_range(preset_monsters, cr_min, cr_max)
        if encounter_monsters:
            reference_data.append(f"\n### 可用预设怪物（CR {cr_min}-{cr_max}，优先使用这些怪物名）")
            for cr, monsters in encounter_monsters:
                names = [m['name'] for m in monsters]
                reference_data.append(f"CR {cr}: {', '.join(names)}")

    reference_section = '\n'.join(reference_data) if reference_data else ""

    # Build comprehensive extraction prompt with full data schemas
    entity_schemas = []

    if "NPC" in request.entity_types:
        entity_schemas.append('''"npcs": [
    {
      "name": "角色名",
      "type": "类人生物/怪物类型",
      "challenge_rating": "0/0.125/0.25/0.5/1/2/3等",
      "armor_class": 数字,
      "hit_points": 数字,
      "size": "中型/大型等",
      "alignment": "阵营",
      "ability_scores": {"str": 10, "dex": 10, "con": 10, "int": 10, "wis": 10, "cha": 10},
      "speeds": {"walk": 30},
      "appearance": "详细外貌描述(至少30字)",
      "background": "背景简述",
      "actions": [
        {
          "name": "攻击名称",
          "name_en": "Attack Name",
          "description": "近战武器攻击：+X命中，距离5尺，单一目标。命中时造成XdY+Z点伤害类型。",
          "action_category": "weapon_attack",
          "attack_type": "melee或ranged",
          "attack_bonus": 攻击加值数字,
          "reach": "5尺(近战)",
          "range": "80/320尺(远程)",
          "damage": {"dice": "1d6", "bonus": 2, "type": "挥砍/穿刺/钝击"}
        }
      ]
    }
  ]''')

    if "SHOP" in request.entity_types:
        entity_schemas.append('''"shops": [
    {
      "name": "商店名",
      "description": "商店描述(经营范围、特色)",
      "appearance_description": "店铺外观描述(用于生成头像)",
      "gold_gp": 500,
      "accepts_selling": true,
      "discount_rate": 0.5,
      "items": [
        {
          "name": "物品名(优先用预设数据中的名称)",
          "price_gp": 价格,
          "quantity": 数量,
          "category": "weapon/armor/gear/ammunition",
          "damage": {"dice": "1d8", "type": "slashing"} 或 null,
          "armor_class": {"base": 14, "dex_bonus": true, "max_dex_bonus": 2} 或 null,
          "properties": ["finesse", "light", "两手"] 或 [],
          "range": {"normal": 80, "long": 320} 或 null
        }
      ]
    }
  ]''')

    if "ITEM" in request.entity_types:
        entity_schemas.append('''"items": [
    {
      "name": "物品名",
      "name_cn": "中文名",
      "category": "weapon/armor/gear/ammunition/treasure/consumable/magic_item",
      "rarity": "common/uncommon/rare/very_rare/legendary",
      "cost": {"amount": 100, "unit": "gp"},
      "weight": 5,
      "description": "物品描述",
      "damage": {"dice": "1d8", "bonus": 0, "type": "slashing"} 或 null,
      "armor_class": {"base": 14, "dex_bonus": true, "max_dex_bonus": 2} 或 null,
      "properties": ["finesse", "light", "两手", "投掷"] 或 [],
      "range": {"normal": 80, "long": 320} 或 null,
      "strength_requirement": 13 或 null,
      "stealth_disadvantage": false,
      "requires_attunement": false
    }
  ]''')

    if "ENCOUNTER" in request.entity_types:
        entity_schemas.append('''"encounters": [
    {
      "title": "遭遇名称",
      "difficulty": "easy/medium/hard/deadly",
      "description": "遭遇描述（战术提示、环境因素）",
      "encounter_type": "combat/social/exploration/trap（遭遇类型）",
      "objective": "make_peace/protect/retrieve/gauntlet/sneak/stop_ritual/single_target（可选-遭遇目标）",
      "objective_description": "具体目标描述（如：保护村长女儿直到援军到达）",
      "terrain_features": ["地形特征1", "地形特征2"],
      "tactics": "敌人战术建议",
      "outcomes": {
        "success": "成功时的结果描述",
        "partial": "部分成功时的结果描述",
        "failure": "失败时的结果描述"
      },
      "monsters": [
        {
          "name": "怪物名",
          "count": 数量,
          "type": "怪物类型",
          "challenge_rating": "CR值",
          "armor_class": 数字,
          "hit_points": 数字,
          "size": "中型",
          "ability_scores": {"str": 10, "dex": 10, "con": 10, "int": 10, "wis": 10, "cha": 10},
          "speeds": {"walk": 30},
          "appearance": "外貌描述",
          "actions": [
            {
              "name": "攻击名称",
              "name_en": "Attack Name",
              "description": "近战武器攻击：+X命中，距离5尺。命中造成XdY+Z伤害。",
              "action_category": "weapon_attack",
              "attack_type": "melee",
              "attack_bonus": 攻击加值,
              "reach": "5尺",
              "damage": {"dice": "1d6", "bonus": 2, "type": "挥砍"}
            }
          ],
          "loot": {
            "currency": {"cp": 0, "sp": 0, "gp": 0, "pp": 0},
            "items": [{"name": "物品名(优先用预设名)", "quantity": 1}]
          }
        }
      ]
    }
  ]''')

    if "BOSS" in request.entity_types:
        entity_schemas.append('''"bosses": [
    {
      "title": "BOSS战名称（如：兰德卓萨的巢穴）",
      "difficulty": "hard/deadly",
      "description": "BOSS战描述（战术提示、地形优势）",
      "encounter_type": "combat（BOSS战通常是战斗遭遇）",
      "objective": "single_target/stop_ritual（可选-遭遇目标）",
      "terrain_features": ["地形特征1如高台", "地形特征2如掩体"],
      "tactics": "BOSS战术建议（如何使用地形、何时召唤小兵）",
      "outcomes": {
        "success": "击败BOSS后的结果",
        "partial": "BOSS逃跑或代价胜利",
        "failure": "失败的后果"
      },
      "boss": {
        "name": "BOSS名称（从模组/资源库获取）",
        "type": "怪物类型",
        "challenge_rating": "CR值（通常3+）",
        "armor_class": 数字,
        "hit_points": 数字,
        "size": "中型/大型/巨型",
        "ability_scores": {"str": 10, "dex": 10, "con": 10, "int": 10, "wis": 10, "cha": 10},
        "speeds": {"walk": 30},
        "appearance": "BOSS详细外貌描述(至少50字)",
        "actions": [{"name": "主要攻击", "description": "...", "action_category": "weapon_attack", "attack_type": "melee", "attack_bonus": 数字, "reach": "5尺", "damage": {"dice": "2d6", "bonus": 3, "type": "挥砍"}}],
        "loot": {
          "currency": {"cp": 0, "sp": 0, "gp": 50, "pp": 0},
          "items": [{"name": "物品名(BOSS掉落更好的装备)", "quantity": 1}]
        }
      },
      "minions": [
        {
          "name": "小兵名(优先使用预设怪物名)",
          "count": 数量,
          "loot": {
            "currency": {"cp": 5, "sp": 2, "gp": 0, "pp": 0},
            "items": []
          }
        }
      ]
    }
  ]''')

    if "MAP" in request.entity_types:
        entity_schemas.append('''"maps": [
    {
      "name": "地点/场景名称",
      "name_en": "英文名称",
      "description": "详细场景描述(至少50字，包含环境氛围、关键地物、视觉特征)",
      "environment": "forest/dungeon/town/cave/castle/battlefield/tavern/temple/ruins/swamp/desert/mountain/jungle/arctic/coast/grassland/lair/mine/tomb/maze/stronghold/vault/village/city/port/outpost",
      "lighting": "bright/dim/dark/magical/firelight",
      "features": ["特征1如熊熊燃烧的篝火", "特征2如倒塌的石柱", "特征3"],
      "creator": "dwarf/elf/human/giant/mindflayer/undead/cult/natural（可选-建造者风格）",
      "weather": "clear/rain/storm/snow/fog（可选-户外天气）",
      "purpose": "lair/mine/tomb/maze/stronghold/vault（可选-地下城用途）"
    }
  ]''')

    prompt = f"""分析以下D&D模组《{module_title}》相关的AI回复，提取并生成完整的实体数据。

## 模组背景
{module_description[:500] if module_description else "无详细背景"}

{reference_section}

## AI回复内容（需要从中提取实体）
{request.content[:4000]}

## 要求
1. 从回复中提取所有提到的NPC、怪物、商店、物品、遭遇、地点/场景
2. **即使回复只是描述性文字**，也要识别出提到的实体名称并生成数据
3. 如果上面有"已找到的参考数据"，优先使用这些数据的属性值和价格
4. **如果没有参考数据，根据CR按D&D 5E规则推算属性**：
   | CR | AC | HP范围 | 攻击加值 | 伤害骰/轮 |
   |----|----|----|----|----|
   | 0 | 10-12 | 1-6 | +2 | 1d4 |
   | 1/8 | 11-13 | 7-15 | +3 | 1d6 |
   | 1/4 | 11-13 | 15-25 | +3 | 1d6+2 |
   | 1/2 | 12-14 | 25-40 | +3 | 1d8+2 |
   | 1 | 13-15 | 40-55 | +4 | 2d6+2 |
   | 2 | 13-15 | 55-70 | +4 | 2d8+3 |
   | 3 | 14-16 | 70-90 | +5 | 2d10+3 |
   | 4 | 14-16 | 90-115 | +5 | 3d8+4 |
   | 5 | 15-17 | 115-140 | +6 | 3d10+4 |
5. **NPC和遭遇中的怪物必须有actions数组**，至少包含一个武器攻击：
   - 近战攻击示例：{{"name": "挥砍", "name_en": "Slash", "description": "近战武器攻击：+4命中，距离5尺。命中造成1d8+2挥砍伤害。", "action_category": "weapon_attack", "attack_type": "melee", "attack_bonus": 4, "reach": "5尺", "damage": {{"dice": "1d8", "bonus": 2, "type": "挥砍"}}}}
   - 如果没有明确武器，使用"徒手攻击"：{{"name": "徒手攻击", "name_en": "Unarmed Strike", "description": "近战武器攻击：+2命中，距离5尺。命中造成1+力量调整值钝击伤害。", "action_category": "weapon_attack", "attack_type": "melee", "attack_bonus": 2, "reach": "5尺", "damage": {{"dice": "1", "bonus": 0, "type": "钝击"}}}}
6. appearance描述要详细（至少30字），用于AI生成头像
7. **商店必须包含items数组**，**优先使用以下D&D 5E标准物品名称**（系统有预设数据）：
   - **武器店**：匕首、手斧、标枪、轻锤、硬头锤、短棍、镰刀、矛、轻弩、飞镖、短弓、投石索、战斧、链枷、长柄刀、巨斧、巨剑、戟、长枪、长矛、双头锤、钉头锤、长柄武器、细剑、弯刀、短剑、三叉戟、战锤、战镐、长剑、长弓、重弩、手弩、吹箭筒
   - **护甲店**：布甲、皮甲、镶嵌皮甲、链甲衫、鳞甲、胸甲、半身板甲、环甲、链甲、夹板甲、板甲、盾牌
   - **杂货店**：背包、火把、绳索(麻，50尺)、口粮(1天)、水袋、帐篷(两人)、床铺、睡袋、铁壶、餐具、燧石盒、蜡烛、灯油、提灯、粉笔、箭(20支)、弩矢(20支)
   - **药水店**：治疗药水、抗毒剂(小瓶)、强酸(小瓶)、炽火胶(烧瓶)、圣水(烧瓶)
   - **工具店**：盗贼工具、制草药工具、炼金术士用具、铁匠工具、木匠工具、制图工具、厨师用具、制革工具
   - **重要**：远程武器和弹药必须分开列出（如"长弓"和"箭(20支)"是两个物品）
   - 每个商店5-10种物品，使用上述标准名称，价格系统会自动匹配预设数据
   - **仅当用户明确要求特殊/魔法物品时**，才创建自定义物品（需补充完整属性）
8. **地点/场景(maps)**：**必须提取**回复中描述的可作为战斗场景的地点，包括：
   - 具体建筑（酒馆大厅、地牢房间、城堡大厅、神殿、磨坊等）
   - 户外区域（城镇街道、森林空地、战场、码头等）
   - 地下空间（洞穴、矿坑、下水道等）
   - 只要回复描述了某个地点的环境特征（地形、光线、障碍物等），就应提取为map实体
   - description要详细描述场景的视觉特征、地形布局、氛围（至少50字）
9. **物品(items)如果没有参考数据，按D&D 5E常见物品属性生成**：
   - 武器类必须有damage字段：简单武器1d4-1d8，军用武器1d8-1d12
   | 武器 | 伤害 | 类型 | 属性 | 价格 |
   |------|------|------|------|------|
   | 匕首 | 1d4 | 穿刺 | 精巧,轻型,投掷 | 2gp |
   | 短剑 | 1d6 | 穿刺 | 精巧,轻型 | 10gp |
   | 长剑 | 1d8 | 挥砍 | 多功能(1d10) | 15gp |
   | 巨剑 | 2d6 | 挥砍 | 重型,两手 | 50gp |
   | 短弓 | 1d6 | 穿刺 | 弹药,两手 | 25gp |
   | 长弓 | 1d8 | 穿刺 | 弹药,重型,两手 | 50gp |
   - 护甲类必须有armor_class字段：
   | 护甲 | AC | 敏捷加值 | 价格 |
   |------|-----|---------|------|
   | 皮甲 | 11 | 全额 | 10gp |
   | 链甲衫 | 13 | 最高+2 | 50gp |
   | 胸甲 | 14 | 最高+2 | 400gp |
   | 板甲 | 18 | 无 | 1500gp |
   - 消耗品需有description说明效果（如"治疗药水：恢复2d4+2HP"）
10. **遭遇(encounters)生成规则**：
    - **小兵优先使用预设怪物**：参考上面"可用预设怪物"列表，系统会自动填充完整数据
    - **BOSS战配置**：如果上面有【模组BOSS】数据，分析其描述提取小兵配置：
      * 描述中提到的随从/手下/守卫等，使用预设怪物名（如"4个地精"、"2个狗头人"）
      * 如果描述没有明确小兵，根据BOSS类型配置合适小兵：
        - 亡灵BOSS：配骷髅、僵尸
        - 地精/兽人BOSS：配地精、狗头人、兽人
        - 龙类BOSS：配狗头人、蜥蜴人
        - 法师BOSS：配活化盔甲、飞剑
      * BOSS本身使用模组数据（如有CR/AC/HP则用，否则按第4、5条规则生成）
    - 多个同类怪物只需定义一次，用count表示数量
    - difficulty：单BOSS为Hard，BOSS+小兵根据总CR判断
    - **仅当预设中没有合适怪物时**（如模组特有怪物），才按第4、5条的CR规则自定义
11. **战利品(loot)生成规则**：
    - 每个怪物都应该有loot字段，包含currency(金钱)和items(物品)
    - **根据CR配置合理的战利品**：
      | CR | 金钱范围 | 典型物品 |
      |----|----------|----------|
      | 0-1/4 | 1-10cp | 无或简单物品(火把、绳索) |
      | 1/2-1 | 5-20sp | 简单武器(匕首、短剑)、少量药水 |
      | 2-4 | 10-50gp | 普通武器/护甲、治疗药水 |
      | 5-10 | 50-200gp | 精良武器/护甲、魔法卷轴 |
      | 11+ | 200-1000gp | 魔法物品、稀有装备 |
    - **物品名优先使用预设名称**（匕首、长剑、治疗药水等）
    - BOSS的loot应该比普通怪物丰富（更多金币+更好的装备）
    - 如果模组内容提到特定宝藏或装备，优先使用模组描述的物品

返回JSON：
```json
{{
  {','.join(entity_schemas)}
}}
```

只返回JSON，不要其他内容。"""

    try:
        response = await AIService.generate_completion(
            api_url=fast_config.api_url,
            api_key=fast_config.api_key,
            model=fast_config.model_name,
            messages=[{"role": "user", "content": prompt}],
            temperature=analyze_temperature,
            max_tokens=analyze_max_tokens,
            timeout=180.0  # Entity analysis needs longer timeout (3 min)
        )

        json_match = re.search(r'\{[\s\S]*\}', response)
        if not json_match:
            empty_result = {"npcs": [], "shops": [], "items": [], "encounters": [], "bosses": [], "maps": []}
            # Update message with empty result
            msg = await db.get(ModuleChatMessage, request.message_id)
            if msg:
                msg.analyzed_entities = empty_result
                await db.commit()
            return empty_result

        entities = json.loads(json_match.group())

        # Build result with proper limits
        result_data = {
            "npcs": entities.get("npcs", [])[:6],
            "shops": entities.get("shops", [])[:4],
            "items": entities.get("items", [])[:6],
            "encounters": entities.get("encounters", [])[:2],
            "bosses": entities.get("bosses", [])[:2],
            "maps": entities.get("maps", [])[:4],
        }

        # Save to database for persistence
        msg = await db.get(ModuleChatMessage, request.message_id)
        if msg:
            msg.analyzed_entities = result_data
            await db.commit()

        return result_data

    except Exception as e:
        import traceback
        print(f"Entity analysis failed: {e}")
        print(f"Exception type: {type(e).__name__}")
        traceback.print_exc()
        return {"npcs": [], "shops": [], "items": [], "encounters": [], "bosses": [], "maps": []}


# ===== Direct Entity Creation (using pre-generated data) =====

class CreateEntityRequest(PydanticBaseModel):
    entity_type: str  # "npc", "shop", "item"
    data: dict


@router.post("/create-entity")
async def create_entity_from_data(
    module_id: str,
    request: CreateEntityRequest,
    campaign_id: int = Query(..., description="Campaign ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    Create entity directly from pre-generated data (no LLM call needed).
    Used with analyze-entities which now returns complete entity data.
    """
    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    entity_type = request.entity_type.lower()
    data = request.data

    module = await resolve_module(db, module_id)

    if entity_type in ("npc", "monster", "shop", "item"):
        return await create_direct_module_entity(
            db=db,
            campaign=campaign,
            campaign_id=campaign_id,
            module_id=module_id,
            module=module,
            entity_type=entity_type,
            data=data,
            preset_monsters=load_monsters_preset(),
            preset_equipment=_load_preset_equipment(),
            parse_module_monster_description=parse_module_monster_description,
            generate_item_with_llm=_generate_item_with_llm,
        )

    elif entity_type == "encounter":
        return await create_module_encounter(
            db=db,
            campaign=campaign,
            campaign_id=campaign_id,
            module_id=module_id,
            module=module,
            data=data,
            preset_monsters=load_monsters_preset(),
            parse_module_monster_description=parse_module_monster_description,
        )

    else:
        raise HTTPException(status_code=400, detail=f"Unsupported entity type: {entity_type}")


# ===== Map Generation API =====

class GenerateMapRequest(PydanticBaseModel):
    map_data: dict  # {name, name_en, description, environment, lighting, features}
    reference_map_url: Optional[str] = None


@router.post("/generate-map")
async def generate_tactical_map(
    module_id: str,
    request: GenerateMapRequest,
    campaign_id: int = Query(..., description="Campaign ID"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Generate a tactical battle map using AI image generation.
    The generated map is saved to campaign's module maps and user's map library.
    """
    from app.services.map_generation_service import map_generation_service

    context = await resolve_campaign_member_context(db, campaign_id, current_user)

    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    try:
        result = await map_generation_service.generate_map(
            db=db,
            campaign_id=campaign_id,
            module_id=module_id,
            map_data=request.map_data,
            reference_map_url=request.reference_map_url,
            user_id=context.user_id
        )

        # Broadcast map creation
        await realtime_publisher.publish_map_generated(
            campaign_id,
            map_id=result["map_id"],
            map_url=result["map_url"],
            map_name=result["map_name"],
            module_id=module_id,
        )

        return result

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Map generation failed: {str(e)}")


# ===== Map Points Extraction =====

class ExtractMapPointsRequest(PydanticBaseModel):
    """Request for extracting map points"""
    map_url: str


async def analyze_map_and_generate_markers(
    module_id: str,
    map_url: str,
    campaign_id: int,
    db: AsyncSession
) -> list:
    """
    Use AI multimodal vision to analyze a map and generate location markers.
    Returns a list of marker dictionaries.
    """
    from app.models.ai_map_marker import AIMapMarker

    # Get module for context
    result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == module_id)
    )
    module = result.scalar_one_or_none()
    if not module:
        return []

    module_title = module.title or "未知模组"

    # Get current chapter context from map
    current_chapter = None
    maps_result = await db.execute(
        select(ModuleMaps).where(ModuleMaps.module_id == module_id)
    )
    module_maps = maps_result.scalars().first()
    if module_maps and module_maps.maps:
        for map_item in module_maps.maps:
            if map_item.get('url') == map_url:
                current_chapter = map_item.get('chapter')
                break

    # Build context
    context = build_module_context(module, "分析地图上的关键位置", current_chapter)

    current_chapter_hint = ""
    if current_chapter:
        current_chapter_hint = f"\n\n**当前地图章节**: {current_chapter}"

    system_prompt = f"""你是一位专业的DM助手，正在帮助DM分析D&D冒险模组《{module_title}》的地图。{current_chapter_hint}

请仔细分析这张地图，识别并标注所有重要位置。

## 任务
分析地图图像，结合模组内容，标注地图上的所有重要位置点。

## 地图位置标记（重要！）

请直接输出地图标记数据（不需要其他解释），格式如下：

```
<!--MAP_MARKERS-->
[
  {{"x": "25%", "y": "30%", "label": "入口", "content": "主入口，有两名守卫"}},
  {{"x": "50%", "y": "45%", "label": "大厅", "content": "中央大厅，可能有4-6只地精"}},
  {{"x": "75%", "y": "60%", "label": "Boss房", "content": "最终BOSS所在地"}}
]
<!--/MAP_MARKERS-->
```

标记规则：
- x: 水平位置百分比（0%=最左边，100%=最右边）
- y: 垂直位置百分比（0%=最上边，100%=最下边）
- label: 简短标签（2-4个字）
- content: 详细描述（包含NPC、怪物、物品等信息）
- 根据地图实际内容标注8-20个重要位置
- 仔细观察地图图像中的文字、标记、房间编号等

## 当前模组上下文

{context}"""

    # Get AI config for map analysis
    usage_params = await ai_model_service.get_usage_params(db, "module_map_analysis")
    chat_config = usage_params.config

    # Build messages with image
    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "请分析这张地图，标注所有重要位置点。"},
                {"type": "image_url", "image_url": {"url": map_url}}
            ]
        }
    ]

    # Call AI using static method
    try:
        content = await AIService.chat_completion(
            api_url=chat_config.api_url,
            api_key=chat_config.api_key,
            model=chat_config.model_name,
            messages=messages,
            temperature=usage_params.temperature,
            max_tokens=usage_params.max_tokens
        )

        if not content:
            return []

        # Parse markers from response
        markers = []
        marker_match = re.search(r'<!--MAP_MARKERS-->\s*([\s\S]*?)\s*<!--/MAP_MARKERS-->', content)
        if marker_match:
            try:
                markers_json = marker_match.group(1).strip()
                markers = json.loads(markers_json)
            except json.JSONDecodeError:
                # Try to recover JSON
                try:
                    markers = extract_json_from_text(markers_json)
                except:
                    pass

        # Save markers to database
        if markers:
            existing_result = await db.execute(
                select(AIMapMarker).where(
                    AIMapMarker.campaign_id == campaign_id,
                    AIMapMarker.map_url == map_url
                )
            )
            existing = existing_result.scalar_one_or_none()

            if existing:
                existing.markers = markers
            else:
                marker_record = AIMapMarker(
                    campaign_id=campaign_id,
                    map_url=map_url,
                    markers=markers
                )
                db.add(marker_record)

            await db.commit()

        return markers

    except Exception as e:
        print(f"[extract_map_points] AI analysis error: {e}")
        return []


@router.post("/extract-map-points")
async def extract_map_points(
    module_id: str,
    request: ExtractMapPointsRequest,
    campaign_id: int = Query(..., description="Campaign ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    Load existing map points from database, or generate new ones using AI if none exist.
    """
    from app.models.ai_map_marker import AIMapMarker

    # Check for existing AI map markers
    result = await db.execute(
        select(AIMapMarker).where(
            AIMapMarker.campaign_id == campaign_id,
            AIMapMarker.map_url == request.map_url
        )
    )
    marker_record = result.scalar_one_or_none()

    if marker_record and marker_record.markers:
        return {
            "markers": marker_record.markers,
            "map_url": request.map_url,
            "source": "database"
        }

    # No existing markers - generate using AI
    markers = await analyze_map_and_generate_markers(
        module_id=module_id,
        map_url=request.map_url,
        campaign_id=campaign_id,
        db=db
    )

    if markers:
        return {
            "markers": markers,
            "map_url": request.map_url,
            "source": "ai_generated"
        }

    # AI generation failed
    return {
        "markers": [],
        "map_url": request.map_url,
        "source": "none",
        "message": "AI分析地图失败，请稍后重试。"
    }


# ===== Map Encounter Planning =====

class PlanMapEncounterRequest(PydanticBaseModel):
    """Request for planning map encounters"""
    map_url: str
    density: str = "normal"  # sparse, normal, dense
    source_mode: str = "module_extend"  # module_only, ai_free, module_extend


class ModifyPlanRequest(PydanticBaseModel):
    """Request for modifying encounter plan"""
    map_url: str
    current_plan: str
    modification: str  # User's text describing changes


async def get_campaign_player_info(db: AsyncSession, campaign_id: int) -> dict:
    """Get player character info from campaign for encounter difficulty calculation"""
    from app.models.campaign import CampaignMember
    from app.models.character import Character

    # Get all members with selected characters (both players and DM if playing a character)
    result = await db.execute(
        select(CampaignMember, Character)
        .outerjoin(Character, CampaignMember.selected_character_id == Character.id)
        .where(
            CampaignMember.campaign_id == campaign_id,
            CampaignMember.selected_character_id.isnot(None)
        )
    )
    rows = result.all()

    players = []
    total_level = 0
    for member, character in rows:
        if character:
            players.append({
                "name": character.name,
                "level": character.level,
                "class": character.class_id
            })
            total_level += character.level

    player_count = len(players) if players else 4  # Default 4 players
    avg_level = total_level // player_count if player_count > 0 else 1

    return {
        "players": players,
        "count": player_count,
        "average_level": avg_level,
        "total_level": total_level
    }


@router.post("/plan-map-encounter")
async def plan_map_encounter(
    module_id: str,
    request: PlanMapEncounterRequest,
    campaign_id: int = Query(..., description="Campaign ID"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Step 1: AI analyzes the map and generates a text-based encounter plan.
    Takes into account player levels and requested density.
    Messages are saved to the database for persistence.
    """
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    user_id = context.user_id

    module = await resolve_module(db, module_id)
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    # Get player info for CR calculation
    player_info = await get_campaign_player_info(db, campaign_id)

    # Get campaign and map context
    campaign_result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id)
    )
    campaign = campaign_result.scalar_one_or_none()

    current_chapter = None
    if campaign:
        maps_result = await db.execute(
            select(ModuleMaps).where(
                ModuleMaps.campaign_id == campaign_id,
                ModuleMaps.module_id == module_id
            )
        )
        module_maps = maps_result.scalars().first()
        if module_maps and module_maps.maps:
            for map_item in module_maps.maps:
                if map_item.get('url') == request.map_url:
                    current_chapter = map_item.get('chapter', map_item.get('title'))
                    break

    # Build context
    context = build_module_context(module, "规划地图遭遇", current_chapter)
    module_title = module.title or "未知模组"

    # Load preset monsters for reference
    preset_monsters = load_monsters_preset()
    preset_names = [m.get('name', '') for m in preset_monsters[:50]]
    module_monsters = module.monsters or []
    module_monster_names = [m.get('name', '') for m in module_monsters[:30]]

    # Get model configuration
    usage_params = await ai_model_service.get_usage_params(db, "module_encounter_plan")
    model = usage_params.config.model_name

    chapters_data = module.chapters or module.toc or []
    system_prompt = build_plan_system_prompt(
        module_title=module_title,
        current_chapter=current_chapter,
        context=context,
        player_info=player_info,
        density=request.density,
        source_mode=request.source_mode,
        module_encounters=collect_module_encounters(chapters_data),
        preset_names=preset_names,
        module_monster_names=module_monster_names,
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": request.map_url}
                },
                {
                    "type": "text",
                    "text": "请分析这张地图并规划遭遇配置。"
                }
            ]
        }
    ]

    try:
        content = await AIService.chat_completion(
            api_url=usage_params.config.api_url,
            api_key=usage_params.config.api_key,
            model=model,
            messages=messages,
            temperature=0.4,
            max_tokens=3000
        )

        assistant_message = await persist_encounter_plan_message(
            db=db,
            module_id=module_id,
            user_id=user_id,
            content=build_plan_assistant_content(content, player_info),
            plan_text=content,
            map_url=request.map_url,
        )

        return {
            "plan_text": content,
            "map_url": request.map_url,
            "chapter": current_chapter,
            "module_id": module_id,
            "campaign_id": campaign_id,
            "player_info": player_info,
            "density": request.density,
            "message_id": assistant_message.id
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to plan map encounter: {str(e)}")


@router.post("/modify-encounter-plan")
async def modify_encounter_plan(
    module_id: str,
    request: ModifyPlanRequest,
    campaign_id: int = Query(..., description="Campaign ID"),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Modify an existing encounter plan based on user's text instructions.
    Messages are saved to the database for persistence.
    """
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    user_id = context.user_id

    # Verify module exists
    result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == module_id)
    )
    module = result.scalar_one_or_none()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    # Load preset monsters for reference
    preset_monsters = load_monsters_preset()
    preset_names = [m.get('name', '') for m in preset_monsters[:50]]
    module_monsters = module.monsters or []
    module_monster_names = [m.get('name', '') for m in module_monsters[:30]]

    # Get model configuration
    usage_params = await ai_model_service.get_usage_params(db, "module_encounter_plan")
    model = usage_params.config.model_name

    system_prompt = build_modify_system_prompt(
        current_plan=request.current_plan,
        modification=request.modification,
        preset_names=preset_names,
        module_monster_names=module_monster_names,
    )

    try:
        content = await AIService.chat_completion(
            api_url=usage_params.config.api_url,
            api_key=usage_params.config.api_key,
            model=model,
            messages=[{"role": "user", "content": system_prompt}],
            temperature=0.3,
            max_tokens=3000
        )

        assistant_message = await persist_encounter_plan_message(
            db=db,
            module_id=module_id,
            user_id=user_id,
            content=build_modify_assistant_content(content, request.modification),
            plan_text=content,
            map_url=request.map_url,
        )

        return {
            "plan_text": content,
            "map_url": request.map_url,
            "modification_applied": request.modification,
            "message_id": assistant_message.id
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to modify plan: {str(e)}")


class ExecuteMapEncounterRequest(PydanticBaseModel):
    """Request for executing map encounter plan"""
    map_url: str
    plan_text: str
    viewport_center_x: int = 500  # Center of current viewport for positioning
    viewport_center_y: int = 500


@router.post("/execute-map-encounter")
async def execute_map_encounter(
    module_id: str,
    request: ExecuteMapEncounterRequest,
    campaign_id: int = Query(..., description="Campaign ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    Step 2: Parse the plan text and create monsters/NPCs with tokens on the map.
    """
    # Verify module exists
    result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == module_id)
    )
    module = result.scalar_one_or_none()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    # Get model to parse the plan
    usage_params = await ai_model_service.get_usage_params(db, "module_analyze_entities")
    model = usage_params.config.model_name

    # Parse plan text into structured data using AI
    parse_prompt = f"""请将以下地图遭遇规划文本解析为JSON格式。

规划文本：
{request.plan_text}

## 输出格式（严格JSON）

```json
{{
  "areas": [
    {{
      "name": "区域名称",
      "x_percent": 25,
      "y_percent": 30,
      "monsters": [
        {{"name": "地精", "count": 3}}
      ],
      "npcs": [
        {{"name": "NPC名称", "role": "商人/任务NPC等"}}
      ],
      "loot": {{
        "currency": {{"gp": 10, "sp": 20}},
        "items": ["治疗药水", "短剑"]
      }},
      "environment": "昏暗，有火把"
    }}
  ]
}}
```

只输出JSON，不要其他文字。"""

    try:
        parse_content = await AIService.chat_completion(
            api_url=usage_params.config.api_url,
            api_key=usage_params.config.api_key,
            model=model,
            messages=[{"role": "user", "content": parse_prompt}],
            temperature=0.1,
            max_tokens=10000  # Large enough for complex plans with many areas
        )

        # Extract JSON from response
        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"[execute_map_encounter] AI parse response (first 500 chars): {parse_content[:500] if parse_content else 'EMPTY'}")

        parsed_data = extract_json_from_text(parse_content)
        logger.info(f"[execute_map_encounter] Parsed data type: {type(parsed_data)}, has 'areas': {'areas' in parsed_data if parsed_data else 'N/A'}")

        if not parsed_data:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to extract JSON from AI response. Response preview: {parse_content[:200] if parse_content else 'EMPTY'}"
            )
        if 'areas' not in parsed_data:
            raise HTTPException(
                status_code=400,
                detail=f"AI returned JSON without 'areas' key. Keys found: {list(parsed_data.keys()) if isinstance(parsed_data, dict) else 'Not a dict'}"
            )

        areas = parsed_data.get('areas', [])

        # Try to load AI map markers for this map to get actual room positions
        from app.models.ai_map_marker import AIMapMarker
        marker_result = await db.execute(
            select(AIMapMarker).where(
                AIMapMarker.campaign_id == campaign_id,
                AIMapMarker.map_url == request.map_url
            )
        )
        ai_marker_record = marker_result.scalar_one_or_none()
        return await execute_structured_map_encounter(
            db=db,
            campaign_id=campaign_id,
            module_id=module_id,
            module=module,
            map_url=request.map_url,
            areas=areas,
            viewport_center_x=request.viewport_center_x,
            viewport_center_y=request.viewport_center_y,
            preset_monsters=load_monsters_preset(),
            markers=ai_marker_record.markers if ai_marker_record and ai_marker_record.markers else None,
        )

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to execute map encounter: {str(e)}")
