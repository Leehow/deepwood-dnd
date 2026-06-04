from datetime import datetime
from types import SimpleNamespace

from app.services.module_snapshot_service import (
    build_db_module_detail_payload,
    build_export_filename,
    build_export_payload,
    build_import_models,
    can_access_module,
    deduplicate_import_title,
    normalize_legacy_module_payload,
    replace_table_placeholders,
    transform_module_images,
)


def test_can_access_module_respects_owner_shared_and_admin() -> None:
    assert can_access_module(created_by="u1", requester_id="u1", is_shared=False) is True
    assert can_access_module(created_by="u1", requester_id="u2", is_shared=True) is True
    assert can_access_module(created_by="u1", requester_id="u2", is_shared=False, is_admin=True) is True
    assert can_access_module(created_by="u1", requester_id="u2", is_shared=False) is False


def test_transform_module_images_and_placeholder_replacement_preserve_frontend_contract() -> None:
    images = [
        {
            "image_id": "img-1",
            "oss_url": "https://oss/a.png",
            "thumbnail_url": "https://oss/a-thumb.png",
            "type": "map",
            "alt": "大厅地图",
            "chapter_title": "第一章",
            "line": 12,
        }
    ]

    transformed = transform_module_images(images)
    replaced = replace_table_placeholders("见 [tbl-1.md](#tbl-1) 与 [tbl-2.html]", {"tbl-1.md": "表格内容"})

    assert transformed == [
        {
            "image_id": "img-1",
            "oss_url": "https://oss/a.png",
            "thumbnail_url": "https://oss/a-thumb.png",
            "category": "map",
            "description": "大厅地图",
            "chapter": "第一章",
            "page_index": 12,
            "confidence": 1.0,
            "related_entity": None,
            "bound_to": {"title": "第一章"},
        }
    ]
    assert replaced == "见 表格内容 与 "


def test_build_db_module_detail_payload_rewrites_tables_and_sets_chapter_tree() -> None:
    module = SimpleNamespace(
        module_id="module-1",
        source_file_id="12",
        module_info={"title": "失落矿坑"},
        chapters=[{"title": "第一章"}],
        monsters=[{"name": "骷髅", "description": "详见 [tbl-1.md]"}],
        items=[{"name": "钥匙", "description": "无"}],
        images=[{"alt": "地图", "chapter_title": "第一章"}],
        tables=[{"table_id": "tbl-1.md", "content": "骷髅数据表"}],
        toc=[{"title": "目录"}],
        created_by="user-1",
        chapters_count=1,
        monsters_count=1,
        items_count=1,
        images_count=1,
        tables_count=1,
        title="失落矿坑",
    )

    payload = build_db_module_detail_payload(
        db_module=module,
        translation_info={"is_translated": "yes", "source_language": "en"},
    )

    assert payload["monsters"][0]["description"] == "详见 骷髅数据表"
    assert payload["chapter_tree"] == [{"title": "第一章"}]
    assert payload["is_translated"] == "yes"
    assert payload["images"][0]["bound_to"] == {"title": "第一章"}


def test_normalize_legacy_module_payload_backfills_chapter_tree_and_bound_to() -> None:
    payload = normalize_legacy_module_payload(
        {
            "toc": [{"title": "目录"}],
            "images": [{"chapter": "第二章"}],
        },
        created_by="legacy-user",
    )

    assert payload["chapter_tree"] == [{"title": "目录"}]
    assert payload["images"][0]["bound_to"] == {"title": "第二章"}
    assert payload["created_by"] == "legacy-user"


def test_build_export_payload_and_filename_are_deterministic() -> None:
    exported_at = datetime(2026, 3, 21, 10, 0, 0)
    module = SimpleNamespace(
        title="失落矿坑/Alpha",
        title_en="Lost Mine",
        description="desc",
        module_info={"tier": 1},
        toc=[{"title": "toc"}],
        chapters=[{"title": "chapter"}],
        monsters=[{"name": "骷髅"}],
        items=[{"name": "药水"}],
        images=[{"image_id": "img"}],
        tables=[{"table_id": "tbl-1.md", "content": "table"}],
    )

    payload = build_export_payload(
        db_module=module,
        markdown_content="# markdown",
        exported_at=exported_at,
    )

    assert payload["exported_at"] == exported_at.isoformat()
    assert payload["markdown"] == "# markdown"
    assert build_export_filename("失落矿坑/Alpha") == "失落矿坑_Alpha.dw.json"


def test_deduplicate_import_title_and_build_import_models_construct_records() -> None:
    title = deduplicate_import_title("冒险模组", {"冒险模组", "冒险模组 2"})
    imported_at = datetime(2026, 3, 21, 11, 0, 0)

    module_id, raw_file, parsed_module = build_import_models(
        data={
            "module": {
                "title_en": "Adventure Module",
                "description": "描述",
                "module_info": {"theme": "dungeon"},
            },
            "markdown": "# source",
            "chapters": [{"title": "第一章"}],
            "monsters": [{"name": "骷髅"}],
            "items": [{"name": "火把"}],
            "images": [{"image_id": "img-1"}],
            "tables": [{"table_id": "tbl-1.md", "content": "table"}],
            "toc": [{"title": "目录"}],
        },
        module_id="imported-1",
        title=title,
        user_id="user-9",
        file_name="module.dw.json",
        raw_bytes=b"{}",
        imported_at=imported_at,
    )

    assert title == "冒险模组 3"
    assert module_id == "imported-1"
    assert raw_file.title == "冒险模组 3"
    assert raw_file.parsed_module_id == "imported-1"
    assert parsed_module.title == "冒险模组 3"
    assert parsed_module.chapters_count == 1
    assert parsed_module.monsters_count == 1
    assert parsed_module.items_count == 1
    assert parsed_module.images_count == 1
    assert parsed_module.tables_count == 1
