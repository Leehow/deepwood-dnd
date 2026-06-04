"""Search and edit tools for the chapter agent."""
import logging
from pydantic_ai import RunContext

from .deps import AgentDeps
from .schemas import RangeEdit

logger = logging.getLogger(__name__)


# --------------- Search tools (results fed back to the LLM) ---------------

async def search_module_content(ctx: RunContext[AgentDeps], query: str) -> str:
    """Search related chapters in this module via RAG embeddings.

    Use this when you need context from OTHER chapters of the same module
    (e.g., cross-referencing NPCs, locations, plot threads).
    """
    await ctx.deps.tool_event_queue.put({"name": "search_module_content", "summary": query})
    try:
        from app.services.module_embedding_service import ModuleEmbeddingService
        svc = ModuleEmbeddingService(ctx.deps.db)
        if not await svc.is_module_embedded(ctx.deps.module_id):
            return "该模组尚未建立向量索引，无法搜索其他章节。"
        results = await svc.search_module_content(
            ctx.deps.module_id, query,
            top_k=5, similarity_threshold=0.3, use_rerank=True,
        )
        if not results:
            return "未找到相关章节内容。"
        parts: list[str] = []
        for i, r in enumerate(results, 1):
            ch = r.get("chapter_path") or r.get("chapter_title", "")
            text = r.get("content", "")[:1500]
            parts.append(f"[{i}] {ch}\n{text}")
        return "\n\n".join(parts)
    except Exception as e:
        logger.warning("search_module_content failed: %s", e)
        return f"搜索失败: {e}"


async def search_rules(ctx: RunContext[AgentDeps], query: str) -> str:
    """Search D&D 5E rules (PHB, DMG, etc.) via RAG embeddings.

    Use this when you need official rules references — spells, abilities,
    creature traits, encounter design guidelines, etc.
    """
    await ctx.deps.tool_event_queue.put({"name": "search_rules", "summary": query})
    try:
        from app.services.rules_embedding_service import RulesEmbeddingService
        svc = RulesEmbeddingService(ctx.deps.db)
        results = await svc.search_similar_rules(
            query, top_k=5, similarity_threshold=0.3, use_rerank=True,
        )
        if not results:
            return "未找到相关规则内容。"
        parts: list[str] = []
        for i, r in enumerate(results, 1):
            src = r.get("source", "")
            text = r.get("content", "")[:1500]
            parts.append(f"[{i}] 来源: {src}\n{text}")
        return "\n\n".join(parts)
    except Exception as e:
        logger.warning("search_rules failed: %s", e)
        return f"规则搜索失败: {e}"


async def get_creator_guide(ctx: RunContext[AgentDeps], topic: str) -> str:
    """Retrieve module-creation best-practice guides.

    Use this when you need writing advice on: encounters, NPCs, dungeons,
    wilderness, settlements, treasure, adventure structure, etc.
    """
    await ctx.deps.tool_event_queue.put({"name": "get_creator_guide", "summary": topic})
    try:
        from app.api.routes.module_chat import _select_creator_knowledge
        knowledge = _select_creator_knowledge(topic)
        return knowledge if knowledge else "未找到相关创作指南。"
    except Exception as e:
        logger.warning("get_creator_guide failed: %s", e)
        return f"获取创作指南失败: {e}"


# --------------- Edit tool (collect into pending_edits) ---------------

async def edit_content(
    ctx: RunContext[AgentDeps],
    edits: list[dict],
) -> str:
    """Apply precise line-range edits to the chapter content.

    Each edit is a dict with:
        start_line: int — 1-indexed first line to replace (inclusive)
        end_line: int   — 1-indexed last line to replace (inclusive)
        content: str    — replacement Markdown content

    To insert new lines without removing existing ones, set start_line
    to the line AFTER which to insert and end_line to start_line - 1
    (i.e. end_line < start_line means pure insertion before start_line).

    Args:
        edits: List of line-range edit dicts.
    """
    summary = f"编辑 {len(edits)} 处内容"
    await ctx.deps.tool_event_queue.put({"name": "edit_content", "summary": summary})
    for e in edits:
        ctx.deps.pending_edits.append(RangeEdit(
            start_line=e["start_line"],
            end_line=e["end_line"],
            content=e["content"],
        ))
    return f"已准备 {len(edits)} 项修改，等待用户确认。"


ALL_TOOLS = [
    search_module_content,
    search_rules,
    get_creator_guide,
    edit_content,
]
