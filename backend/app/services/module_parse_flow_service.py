from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.parsed_module import ParsedModule


def _resolve_translation_service(translation_service=None):
    if translation_service is not None:
        return translation_service

    from app.services.translation_service import TranslationService

    return TranslationService()


async def _noop_progress(_message: str, _progress: int) -> None:
    return None


async def detect_markdown_language(
    markdown_content: str,
    *,
    report_progress=None,
    translation_service=None,
) -> str:
    progress = report_progress or _noop_progress
    await progress("🔍 检测文档语言...", 41)
    service = _resolve_translation_service(translation_service)
    return await service.detect_language(markdown_content)


async def translate_markdown_by_language(
    markdown_content: str,
    source_language: str,
    *,
    report_progress=None,
    translation_service=None,
) -> dict[str, str]:
    progress = report_progress or _noop_progress
    service = _resolve_translation_service(translation_service)

    if source_language == "en":
        await progress("📝 检测到英文文档，开始翻译...", 42)

        async def translate_progress(message: str, prog: int) -> None:
            await progress(message, 42 + int(prog * 0.25))

        translated = await service.translate_markdown(
            markdown_content,
            progress_callback=translate_progress,
            skip_language_check=True,
        )
        return {
            "markdown_content": translated,
            "is_translated": "yes",
        }

    if source_language == "bilingual":
        await progress("📝 检测到双语文档，跳过翻译", 67)

    return {
        "markdown_content": markdown_content,
        "is_translated": "no",
    }


async def persist_ocr_snapshot(
    db: AsyncSession,
    raw_file,
    *,
    markdown_content: str,
    source_language: str,
    ocr_provider: str | None = None,
) -> None:
    raw_file.markdown_content = markdown_content
    raw_file.status = "ocr_complete"
    raw_file.source_language = source_language
    raw_file.ocr_provider = ocr_provider
    await db.commit()


def resolve_ocr_provider(ocr_payload: dict[str, Any] | None) -> str | None:
    if not ocr_payload:
        return None

    provider = ocr_payload.get("ocr_provider")
    if provider:
        return provider

    raw_ocr = ocr_payload.get("ocr_result")
    if isinstance(raw_ocr, dict):
        provider = raw_ocr.get("provider")
        if provider:
            return provider

    provider = ocr_payload.get("provider")
    return provider or None


def normalize_ocr_conversion_result(ocr_payload: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(ocr_payload)

    markdown_content = normalized.get("markdown_content")
    markdown_path = normalized.get("markdown_path")
    if markdown_content is None and markdown_path:
        normalized["markdown_content"] = Path(markdown_path).read_text(encoding="utf-8")

    provider = resolve_ocr_provider(normalized)
    normalized["ocr_provider"] = provider

    raw_ocr = normalized.get("ocr_result")
    if isinstance(raw_ocr, dict) and provider and not raw_ocr.get("provider"):
        normalized["ocr_result"] = {
            **raw_ocr,
            "provider": provider,
        }

    normalized.setdefault("images_dir", None)
    normalized.setdefault("pages_count", None)
    normalized.setdefault("ocr_result", None)
    normalized.setdefault("markdown_content", "")
    return normalized


async def persist_translated_markdown(
    db: AsyncSession,
    raw_file,
    *,
    markdown_content: str,
    is_translated: str,
    converted_at: datetime | None = None,
) -> None:
    raw_file.markdown_content = markdown_content
    raw_file.status = "converted"
    raw_file.converted_at = converted_at or datetime.now()
    raw_file.is_translated = is_translated
    await db.commit()


def merge_image_classifications(
    parse_result: dict[str, Any],
    image_classifications: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    merged_result = dict(parse_result)
    if image_classifications:
        merged_result["images"] = image_classifications
    return merged_result


def _assign_parsed_module_fields(
    parsed_module,
    *,
    raw_file,
    file_id: str,
    parse_result: dict[str, Any],
    parsed_at: datetime,
) -> None:
    module_info = parse_result.get("module", {})
    parsed_module.title = module_info.get("title", raw_file.title)
    parsed_module.title_en = module_info.get("title_en", "")
    parsed_module.description = module_info.get("description", "")
    parsed_module.chapters_count = len(parse_result.get("chapters", []))
    parsed_module.monsters_count = len(parse_result.get("monsters", []))
    parsed_module.items_count = len(parse_result.get("items", []))
    parsed_module.images_count = len(parse_result.get("images", []))
    parsed_module.tables_count = len(parse_result.get("tables", []))
    parsed_module.module_info = parse_result.get("module")
    parsed_module.chapters = parse_result.get("chapters")
    parsed_module.monsters = parse_result.get("monsters")
    parsed_module.items = parse_result.get("items")
    parsed_module.images = parse_result.get("images")
    parsed_module.tables = parse_result.get("tables")
    parsed_module.toc = parse_result.get("toc")
    parsed_module.source_file_id = str(file_id)
    parsed_module.created_by = raw_file.created_by
    parsed_module.is_shared = False
    parsed_module.parsed_date = parsed_at


async def persist_parsed_module_output(
    db: AsyncSession,
    raw_file,
    *,
    file_id: str,
    parse_result: dict[str, Any],
    image_classifications: list[dict[str, Any]] | None = None,
    parsed_module_factory=ParsedModule,
    parsed_at: datetime | None = None,
) -> dict[str, Any]:
    merged_result = merge_image_classifications(parse_result, image_classifications)
    module_id = f"module_{file_id}"
    timestamp = parsed_at or datetime.now()

    existing_result = await db.execute(
        select(ParsedModule).where(ParsedModule.module_id == module_id)
    )
    existing_module = existing_result.scalar_one_or_none()

    if existing_module:
        _assign_parsed_module_fields(
            existing_module,
            raw_file=raw_file,
            file_id=file_id,
            parse_result=merged_result,
            parsed_at=timestamp,
        )
    else:
        parsed_module = parsed_module_factory(
            module_id=module_id,
            title="",
            title_en="",
            description="",
            chapters_count=0,
            monsters_count=0,
            items_count=0,
            images_count=0,
            tables_count=0,
            source_file_id=str(file_id),
            created_by=raw_file.created_by,
            is_shared=False,
            parsed_date=timestamp,
        )
        _assign_parsed_module_fields(
            parsed_module,
            raw_file=raw_file,
            file_id=file_id,
            parse_result=merged_result,
            parsed_at=timestamp,
        )
        db.add(parsed_module)

    raw_file.status = "parsed"
    raw_file.parsed_module_id = module_id
    raw_file.parsed_at = timestamp
    await db.commit()

    return {"module_id": module_id, "result": merged_result}
