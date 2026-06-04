from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import AsyncIterator
from typing import Any

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.db.session import async_session_maker
from app.models.parsed_module import ParsedModule
from app.services.module_task_flow_service import ensure_module_creator, get_required_module
from app.services.translation_service import TranslationService

logger = logging.getLogger(__name__)

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _encode_event(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def collect_translation_nodes(tree: list[dict[str, Any]]) -> list[dict[str, Any]]:
    nodes: list[dict[str, Any]] = []

    def collect(node: dict[str, Any]) -> None:
        nodes.append(node)
        for child in node.get("children", []):
            collect(child)

    for chapter in tree:
        collect(chapter)
    return nodes


def has_chinese(text: str | None) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text or ""))


def is_english_only(text: str | None) -> bool:
    return bool(text and text.strip()) and not has_chinese(text)


def split_bilingual_title(title: str) -> tuple[str | None, str | None]:
    if not has_chinese(title) or not re.search(r"[A-Za-z]{2,}", title):
        return None, None

    pattern = re.compile(
        r"([\u4e00-\u9fff\uff00-\uffef？！。，）\)\]】])\s*"
        r"([A-Za-z][a-zA-Z'\"]*(?:[\s/]+(?:[\w'\"()\-&,:;][\w'\"()\-&,:;/]*|of|the|and|in|on|at|for|to|a|an|is|A))*)"
    )

    best_cn: str | None = None
    best_en: str | None = None
    for match in pattern.finditer(title):
        english_start = match.start(2)
        chinese_part = title[:english_start].strip()
        english_part = match.group(2).strip()
        english_part = re.sub(r"[。！？，][\u4e00-\u9fff].*$", "", english_part).strip()
        english_part = re.sub(r"[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+", " ", english_part)
        english_part = re.sub(r"\s{2,}", " ", english_part).strip()
        english_part = re.sub(r"[。，！？；：]$", "", english_part).strip()
        if chinese_part and english_part and len(english_part) >= 2:
            if not best_en or len(english_part) > len(best_en):
                best_cn = chinese_part
                best_en = english_part
    return best_cn, best_en


def prepare_translation_tree(
    original_toc: list[dict[str, Any]],
) -> dict[str, Any]:
    toc_copy = json.loads(json.dumps(original_toc))
    all_nodes = collect_translation_nodes(toc_copy)

    split_count = 0
    for node in all_nodes:
        title = node.get("title", "")
        title_en = node.get("title_en")
        if title.strip() and not title_en:
            if is_english_only(title):
                node["title_en"] = title
            elif has_chinese(title) and re.search(r"[A-Za-z]{2,}", title):
                chinese, english = split_bilingual_title(title)
                if chinese and english:
                    node["title"] = chinese
                    node["title_en"] = english
                    split_count += 1

        content = node.get("content", "")
        content_en = node.get("content_en")
        if content and content.strip() and not content_en:
            if is_english_only(content) or (len(content) > 50 and not has_chinese(content[:200])):
                node["content_en"] = content

    titles_to_translate = [
        (index, node["title_en"])
        for index, node in enumerate(all_nodes)
        if node.get("title_en") and node.get("title") == node.get("title_en")
    ]
    contents_to_translate = [
        (index, node["content_en"])
        for index, node in enumerate(all_nodes)
        if node.get("content_en")
        and len(node["content_en"].strip()) > 20
        and node.get("content") == node.get("content_en")
    ]
    skipped_title_count = len(all_nodes) - len(titles_to_translate) - split_count
    skipped_content_count = sum(
        1
        for node in all_nodes
        if node.get("content_en") and node.get("content") != node.get("content_en")
    )

    return {
        "toc_copy": toc_copy,
        "all_nodes": all_nodes,
        "titles_to_translate": titles_to_translate,
        "contents_to_translate": contents_to_translate,
        "split_count": split_count,
        "skipped_title_count": skipped_title_count,
        "skipped_content_count": skipped_content_count,
    }


def build_content_batches(
    contents_to_translate: list[tuple[int, str]],
    *,
    max_batch_chars: int = 4000,
) -> list[list[tuple[int, str]]]:
    batches: list[list[tuple[int, str]]] = []
    current_batch: list[tuple[int, str]] = []
    current_chars = 0

    for index, content in contents_to_translate:
        if current_chars + len(content) > max_batch_chars and current_batch:
            batches.append(current_batch)
            current_batch = []
            current_chars = 0

        current_batch.append((index, content))
        current_chars += len(content)

        if len(content) > max_batch_chars:
            batches.append(current_batch)
            current_batch = []
            current_chars = 0

    if current_batch:
        batches.append(current_batch)
    return batches


async def save_translated_tree(
    *,
    parsed_module_id: int,
    toc_copy: list[dict[str, Any]],
    session_factory=async_session_maker,
) -> None:
    async with session_factory() as save_db:
        result = await save_db.execute(
            select(ParsedModule).where(ParsedModule.id == parsed_module_id)
        )
        parsed_module = result.scalar_one()
        parsed_module.toc = toc_copy
        parsed_module.chapters = toc_copy
        flag_modified(parsed_module, "toc")
        flag_modified(parsed_module, "chapters")
        await save_db.commit()


async def stream_module_translation(
    *,
    parsed_module_id: int,
    original_toc: list[dict[str, Any]],
    translation_service_factory=TranslationService,
    session_factory=async_session_maker,
) -> AsyncIterator[str]:
    try:
        translation_service = translation_service_factory()
        translation_plan = prepare_translation_tree(original_toc)
        toc_copy = translation_plan["toc_copy"]
        all_nodes = translation_plan["all_nodes"]
        titles_to_translate = translation_plan["titles_to_translate"]
        contents_to_translate = translation_plan["contents_to_translate"]

        yield _encode_event(
            {
                "step": "start",
                "message": f"检查 {len(all_nodes)} 个节点...",
                "progress": 5,
            }
        )

        yield _encode_event(
            {
                "step": "titles",
                "message": (
                    f"翻译 {len(titles_to_translate)} 个英文标题，"
                    f"拆分 {translation_plan['split_count']} 个双语标题，"
                    f"跳过 {translation_plan['skipped_title_count']} 个中文标题"
                ),
                "progress": 10,
            }
        )

        title_batch_size = 25
        title_batches = [
            titles_to_translate[i:i + title_batch_size]
            for i in range(0, len(titles_to_translate), title_batch_size)
        ]
        title_done = [0]
        title_progress_queue: asyncio.Queue[tuple[str, int]] = asyncio.Queue()
        title_semaphore = asyncio.Semaphore(5)

        async def translate_title_batch(batch: list[tuple[int, str]]) -> None:
            async with title_semaphore:
                indices = [idx for idx, _ in batch]
                titles = [title for _, title in batch]
                try:
                    translated = await asyncio.wait_for(
                        translation_service.translate_titles_batch(titles),
                        timeout=120,
                    )
                    for offset, node_index in enumerate(indices):
                        if offset < len(translated) and translated[offset] != titles[offset]:
                            all_nodes[node_index]["title"] = translated[offset]
                except Exception as exc:
                    logger.warning("Title batch failed: %s", exc)
                title_done[0] += len(batch)

        async def run_titles() -> None:
            await asyncio.gather(*[translate_title_batch(batch) for batch in title_batches])
            await title_progress_queue.put(("titles_done", 0))

        asyncio.create_task(run_titles())

        while True:
            try:
                item = await asyncio.wait_for(title_progress_queue.get(), timeout=3)
                if item and item[0] == "titles_done":
                    break
            except asyncio.TimeoutError:
                progress = 10 + int(35 * title_done[0] / max(len(titles_to_translate), 1))
                yield _encode_event(
                    {
                        "step": "titles",
                        "message": f"翻译标题 {title_done[0]}/{len(titles_to_translate)}",
                        "progress": progress,
                    }
                )

        yield _encode_event({"step": "titles", "message": "标题翻译完成", "progress": 45})

        yield _encode_event(
            {
                "step": "content",
                "message": (
                    f"翻译 {len(contents_to_translate)} 个内容块"
                    f"（跳过 {translation_plan['skipped_content_count']} 个已翻译）..."
                ),
                "progress": 48,
            }
        )

        content_batches = build_content_batches(contents_to_translate)
        content_done = [0]
        content_progress_queue: asyncio.Queue[None] = asyncio.Queue()
        content_semaphore = asyncio.Semaphore(5)

        async def translate_content_batch(batch: list[tuple[int, str]]) -> None:
            async with content_semaphore:
                indices = [idx for idx, _ in batch]
                texts = [content for _, content in batch]
                try:
                    if len(texts) == 1:
                        translated = await asyncio.wait_for(
                            translation_service._translate_batch(texts[0]),
                            timeout=120,
                        )
                        all_nodes[indices[0]]["content"] = translated
                    else:
                        translated_list = await asyncio.wait_for(
                            translation_service.translate_contents_batch(texts),
                            timeout=120,
                        )
                        for offset, node_index in enumerate(indices):
                            if offset < len(translated_list):
                                all_nodes[node_index]["content"] = translated_list[offset]
                except Exception as exc:
                    logger.warning("Content batch failed (%s items): %s", len(batch), exc)
                content_done[0] += len(batch)

        async def run_contents() -> None:
            await asyncio.gather(*[translate_content_batch(batch) for batch in content_batches])
            await content_progress_queue.put(None)

        asyncio.create_task(run_contents())

        while True:
            try:
                item = await asyncio.wait_for(content_progress_queue.get(), timeout=5)
                if item is None:
                    break
            except asyncio.TimeoutError:
                progress = 48 + int(42 * content_done[0] / max(len(contents_to_translate), 1))
                yield _encode_event(
                    {
                        "step": "content",
                        "message": f"翻译内容 {content_done[0]}/{len(contents_to_translate)}",
                        "progress": progress,
                    }
                )

        yield _encode_event({"step": "save", "message": "保存中...", "progress": 95})
        await save_translated_tree(
            parsed_module_id=parsed_module_id,
            toc_copy=toc_copy,
            session_factory=session_factory,
        )

        yield _encode_event(
            {
                "step": "done",
                "message": (
                    f"翻译完成：{len(titles_to_translate)}个标题，"
                    f"{len(contents_to_translate)}个内容"
                ),
                "chapters_count": len(toc_copy),
            }
        )
    except Exception as exc:
        logger.error("翻译失败: %s", exc)
        yield _encode_event({"step": "error", "message": str(exc)})


def build_module_translation_response(
    *,
    parsed_module_id: int,
    original_toc: list[dict[str, Any]],
    translation_service_factory=TranslationService,
    session_factory=async_session_maker,
) -> StreamingResponse:
    return StreamingResponse(
        stream_module_translation(
            parsed_module_id=parsed_module_id,
            original_toc=original_toc,
            translation_service_factory=translation_service_factory,
            session_factory=session_factory,
        ),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


async def get_owned_module_with_toc(
    *,
    module_id: str,
    requester_id: str,
    db: AsyncSession,
) -> ParsedModule:
    parsed_module = await get_required_module(db, module_id)
    ensure_module_creator(parsed_module, requester_id, action="translate this module")
    toc = parsed_module.toc or []
    if not toc:
        raise HTTPException(400, "TOC为空，请先解析模组")
    return parsed_module


async def translate_chapter_tree(
    node: dict[str, Any],
    *,
    translation_service: TranslationService,
) -> None:
    title = node.get("title", "")
    if title.strip() and not node.get("title_en"):
        node["title_en"] = title
        try:
            node["title"] = await translation_service.translate_text(title)
        except Exception:
            pass

    content = node.get("content", "")
    if content and content.strip() and not node.get("content_en"):
        node["content_en"] = content
        try:
            node["content"] = await translation_service._translate_batch(content)
        except Exception:
            pass

    for child in node.get("children", []):
        await translate_chapter_tree(child, translation_service=translation_service)


async def translate_single_module_chapter(
    *,
    module_id: str,
    chapter_idx: int,
    requester_id: str,
    db: AsyncSession,
    translation_service_factory=TranslationService,
) -> dict[str, Any]:
    parsed_module = await get_owned_module_with_toc(
        module_id=module_id,
        requester_id=requester_id,
        db=db,
    )
    toc = parsed_module.toc or []
    if chapter_idx < 0 or chapter_idx >= len(toc):
        raise HTTPException(400, f"章节索引越界: {chapter_idx}")

    chapter = toc[chapter_idx]
    translation_service = translation_service_factory()
    await translate_chapter_tree(chapter, translation_service=translation_service)

    parsed_module.toc = toc
    parsed_module.chapters = toc
    flag_modified(parsed_module, "toc")
    flag_modified(parsed_module, "chapters")
    await db.commit()

    return {
        "message": "翻译成功",
        "chapter_idx": chapter_idx,
        "title": chapter.get("title", ""),
    }
