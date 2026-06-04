from __future__ import annotations

import copy
import json
import re
from datetime import datetime
from typing import Any
from uuid import uuid4

from app.models.parsed_module import ParsedModule
from app.models.raw_module_file import RawModuleFile


def can_access_module(
    *,
    created_by: str | None,
    requester_id: str | None,
    is_shared: bool,
    is_admin: bool = False,
) -> bool:
    return bool(is_admin or is_shared or (created_by and requester_id and created_by == requester_id))


def transform_module_images(raw_images: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    transformed_images: list[dict[str, Any]] = []
    for img in raw_images or []:
        image_id = img.get("image_id") or img.get("alt", "")
        transformed_images.append(
            {
                "image_id": image_id,
                "oss_url": img.get("oss_url", ""),
                "thumbnail_url": img.get("thumbnail_url", ""),
                "category": img.get("category") or img.get("type", "unknown"),
                "description": img.get("description") or img.get("alt", ""),
                "chapter": img.get("chapter_title", ""),
                "page_index": img.get("page_index") or img.get("line", 0),
                "confidence": img.get("confidence", 1.0),
                "related_entity": img.get("related_entity"),
                "bound_to": img.get("bound_to") or {"title": img.get("chapter_title", "")},
            }
        )
    return transformed_images


def build_tables_map(tables_list: list[dict[str, Any]] | None) -> dict[str, str]:
    return {
        table.get("table_id", ""): table.get("content", "")
        for table in tables_list or []
        if table.get("table_id") and table.get("content")
    }


def replace_table_placeholders(text: str, tables_map: dict[str, str]) -> str:
    if not text or "[tbl-" not in text:
        return text

    def replacer(match: re.Match[str]) -> str:
        table_ref = match.group(1)
        return tables_map.get(table_ref, "")

    return re.sub(r"\[?(tbl-\d+\.(?:md|html))\]?(?:\([^)]*\))?", replacer, text)


def normalize_entities_with_tables(
    entities: list[dict[str, Any]] | None,
    tables_map: dict[str, str],
) -> list[dict[str, Any]]:
    normalized_entities = copy.deepcopy(entities or [])
    for entity in normalized_entities:
        description = entity.get("description")
        if description:
            entity["description"] = replace_table_placeholders(description, tables_map)
    return normalized_entities


def build_db_module_detail_payload(
    *,
    db_module: ParsedModule,
    translation_info: dict[str, Any],
) -> dict[str, Any]:
    raw_images = db_module.images or []
    tables_list = copy.deepcopy(db_module.tables or [])
    tables_map = build_tables_map(tables_list)
    monsters = normalize_entities_with_tables(db_module.monsters or [], tables_map)
    items = normalize_entities_with_tables(db_module.items or [], tables_map)

    payload = {
        "id": db_module.module_id,
        "raw_file_id": db_module.source_file_id,
        "module": db_module.module_info or {"title": db_module.title},
        "chapters": copy.deepcopy(db_module.chapters or []),
        "monsters": monsters,
        "items": items,
        "images": transform_module_images(raw_images),
        "tables": tables_list,
        "toc": copy.deepcopy(db_module.toc or []),
        "created_by": db_module.created_by,
        "is_translated": translation_info["is_translated"],
        "source_language": translation_info["source_language"],
        "stats": {
            "chapters_count": db_module.chapters_count or 0,
            "monsters_count": db_module.monsters_count or 0,
            "items_count": db_module.items_count or 0,
            "images_count": db_module.images_count or 0,
            "tables_count": db_module.tables_count or 0,
        },
    }
    payload["chapter_tree"] = payload["chapters"] or payload["toc"]
    return payload


def normalize_legacy_module_payload(
    full_data: dict[str, Any],
    *,
    created_by: str | None,
) -> dict[str, Any]:
    normalized = copy.deepcopy(full_data)
    if "chapter_tree" not in normalized:
        if normalized.get("chapters"):
            normalized["chapter_tree"] = normalized["chapters"]
        elif "toc" in normalized:
            normalized["chapter_tree"] = normalized["toc"]

    for image in normalized.get("images", []) or []:
        if not image.get("bound_to") and image.get("chapter"):
            image["bound_to"] = {"title": image.get("chapter")}

    normalized.setdefault("created_by", created_by)
    return normalized


def build_export_payload(
    *,
    db_module: ParsedModule,
    markdown_content: str | None,
    exported_at: datetime | None = None,
) -> dict[str, Any]:
    timestamp = (exported_at or datetime.utcnow()).isoformat()
    return {
        "format": "deepwood-module-v1",
        "exported_at": timestamp,
        "module": {
            "title": db_module.title,
            "title_en": db_module.title_en,
            "description": db_module.description,
            "module_info": copy.deepcopy(db_module.module_info),
        },
        "toc": copy.deepcopy(db_module.toc or []),
        "chapters": copy.deepcopy(db_module.chapters or []),
        "monsters": copy.deepcopy(db_module.monsters or []),
        "items": copy.deepcopy(db_module.items or []),
        "images": copy.deepcopy(db_module.images or []),
        "tables": copy.deepcopy(db_module.tables or []),
        "markdown": markdown_content or "",
    }


def build_export_filename(title: str | None) -> str:
    safe_title = re.sub(r"[^\w\u4e00-\u9fff\-]", "_", title or "module")
    return f"{safe_title}.dw.json"


def deduplicate_import_title(base_title: str, existing_titles: set[str]) -> str:
    title = base_title
    if title not in existing_titles:
        return title

    suffix = 2
    while f"{base_title} {suffix}" in existing_titles:
        suffix += 1
    return f"{base_title} {suffix}"


def build_import_models(
    *,
    data: dict[str, Any],
    module_id: str | None,
    title: str,
    user_id: str,
    file_name: str,
    raw_bytes: bytes,
    imported_at: datetime | None = None,
) -> tuple[str, RawModuleFile, ParsedModule]:
    imported_timestamp = imported_at or datetime.utcnow()
    resolved_module_id = module_id or str(uuid4())
    module_info = data.get("module", {})
    markdown = data.get("markdown", "")
    monsters = copy.deepcopy(data.get("monsters", []))
    items = copy.deepcopy(data.get("items", []))
    images = copy.deepcopy(data.get("images", []))
    chapters = copy.deepcopy(data.get("chapters", []))
    tables = copy.deepcopy(data.get("tables", []))
    toc = copy.deepcopy(data.get("toc", []))

    raw_file = RawModuleFile(
        title=title,
        original_filename=file_name or "import.dw.json",
        file_type="markdown",
        file_size=len(raw_bytes),
        status="parsed",
        markdown_content=markdown if markdown else None,
        created_by=user_id,
        parsed_module_id=resolved_module_id,
        parsed_at=imported_timestamp,
    )

    parsed_module = ParsedModule(
        module_id=resolved_module_id,
        title=title,
        title_en=module_info.get("title_en", ""),
        description=module_info.get("description", ""),
        module_info=module_info.get("module_info"),
        chapters=chapters,
        monsters=monsters,
        items=items,
        images=images,
        tables=tables,
        toc=toc,
        chapters_count=len(chapters),
        monsters_count=len(monsters),
        items_count=len(items),
        images_count=len(images),
        tables_count=len(tables),
        created_by=user_id,
        is_shared=False,
        parsed_date=imported_timestamp,
    )
    return resolved_module_id, raw_file, parsed_module


def dump_export_json(export_payload: dict[str, Any]) -> str:
    return json.dumps(export_payload, ensure_ascii=False, indent=2)
