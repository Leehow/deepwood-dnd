from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services.module_translation_service import (
    SSE_HEADERS,
    build_content_batches,
    build_module_translation_response,
    prepare_translation_tree,
    translate_single_module_chapter,
)


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeDb:
    def __init__(self, execute_results):
        self._execute_results = iter(execute_results)
        self.commit = AsyncMock()

    async def execute(self, _stmt):
        return _ScalarResult(next(self._execute_results))


def test_prepare_translation_tree_splits_bilingual_titles_and_collects_worklists() -> None:
    plan = prepare_translation_tree(
        [
            {
                "title": "FOREWORD",
                "content": "This is a long English paragraph used for translation.",
                "children": [
                    {
                        "title": "前言 FOREWORD",
                        "content": "这是中文内容",
                        "children": [],
                    }
                ],
            },
            {"title": "纯中文标题", "content": "纯中文内容", "children": []},
        ]
    )

    root = plan["all_nodes"][0]
    child = plan["all_nodes"][1]

    assert root["title_en"] == "FOREWORD"
    assert root["content_en"] == "This is a long English paragraph used for translation."
    assert child["title"] == "前言"
    assert child["title_en"] == "FOREWORD"
    assert plan["split_count"] == 1
    assert plan["titles_to_translate"] == [(0, "FOREWORD")]
    assert plan["contents_to_translate"] == [
        (0, "This is a long English paragraph used for translation.")
    ]


def test_build_content_batches_groups_by_total_char_count() -> None:
    batches = build_content_batches(
        [
            (0, "a" * 3000),
            (1, "b" * 1500),
            (2, "c" * 5000),
            (3, "d" * 300),
        ],
        max_batch_chars=4000,
    )

    assert batches == [
        [(0, "a" * 3000)],
        [(1, "b" * 1500)],
        [(2, "c" * 5000)],
        [(3, "d" * 300)],
    ]


def test_build_module_translation_response_preserves_sse_headers() -> None:
    response = build_module_translation_response(
        parsed_module_id=1,
        original_toc=[],
        translation_service_factory=lambda: SimpleNamespace(),
    )

    assert response.media_type == "text/event-stream"
    for key, value in SSE_HEADERS.items():
        assert response.headers[key] == value


@pytest.mark.asyncio
async def test_translate_single_module_chapter_translates_recursively_and_commits(monkeypatch) -> None:
    fake_flag_modified = []
    monkeypatch.setattr(
        "app.services.module_translation_service.flag_modified",
        lambda obj, field: fake_flag_modified.append((obj, field)),
    )

    parsed_module = SimpleNamespace(
        module_id="module-1",
        created_by="owner",
        toc=[
            {
                "title": "FOREWORD",
                "content": "Long English content",
                "children": [
                    {
                        "title": "SECTION",
                        "content": "Nested English content",
                        "children": [],
                    }
                ],
            }
        ],
        chapters=[],
    )
    db = _FakeDb([parsed_module])
    translation_service = SimpleNamespace(
        translate_text=AsyncMock(side_effect=lambda text: f"中:{text}"),
        _translate_batch=AsyncMock(side_effect=lambda text: f"译:{text}"),
    )

    result = await translate_single_module_chapter(
        module_id="module-1",
        chapter_idx=0,
        requester_id="owner",
        db=db,
        translation_service_factory=lambda: translation_service,
    )

    chapter = parsed_module.toc[0]
    child = chapter["children"][0]

    assert result == {"message": "翻译成功", "chapter_idx": 0, "title": "中:FOREWORD"}
    assert chapter["title"] == "中:FOREWORD"
    assert chapter["title_en"] == "FOREWORD"
    assert chapter["content"] == "译:Long English content"
    assert chapter["content_en"] == "Long English content"
    assert child["title"] == "中:SECTION"
    assert child["title_en"] == "SECTION"
    assert child["content"] == "译:Nested English content"
    assert child["content_en"] == "Nested English content"
    assert fake_flag_modified == [(parsed_module, "toc"), (parsed_module, "chapters")]
    db.commit.assert_awaited_once()
