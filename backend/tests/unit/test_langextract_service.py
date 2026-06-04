"""
Tests for langextract_service (bbox + LLM heading inference)
and MinerUOCRService.extract_title_blocks().
"""
import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.services.langextract_service import (
    _build_height_distribution,
    _build_repeated_info,
    _parse_json_response,
    infer_heading_levels,
    rewrite_markdown_headings,
)
from app.services.mineru_ocr_service import MinerUOCRService
from app.domain.parsing.toc_extractor import TocExtractor
from app.domain.parsing.schemas import TocEntry


# ---------------------------------------------------------------------------
# extract_title_blocks
# ---------------------------------------------------------------------------

class TestExtractTitleBlocks:
    def test_basic_extraction(self):
        content_list = [
            {"type": "text", "text_level": 1, "text": "Chapter 1", "page_idx": 0, "bbox": [0, 0, 500, 60]},
            {"type": "text", "text_level": 1, "text": "Background", "page_idx": 0, "bbox": [0, 100, 300, 133]},
        ]
        blocks = MinerUOCRService.extract_title_blocks(content_list)
        assert len(blocks) == 2
        assert blocks[0]["text"] == "Chapter 1"
        assert blocks[0]["bbox_height"] == 60.0
        assert blocks[1]["bbox_height"] == 33.0

    def test_skips_non_title_items(self):
        content_list = [
            {"type": "text", "text": "Normal paragraph", "page_idx": 0},  # no text_level
            {"type": "image", "text_level": 1, "text": "img", "page_idx": 0},  # type=image
            {"type": "text", "text_level": 1, "text": "A", "page_idx": 0},  # too short
        ]
        blocks = MinerUOCRService.extract_title_blocks(content_list)
        assert len(blocks) == 0

    def test_repeat_count(self):
        content_list = [
            {"type": "text", "text_level": 1, "text": "Trigger", "page_idx": i, "bbox": [0, 0, 100, 17]}
            for i in range(5)
        ]
        blocks = MinerUOCRService.extract_title_blocks(content_list)
        assert len(blocks) == 5
        assert all(b["repeat_count"] == 5 for b in blocks)

    def test_no_bbox(self):
        content_list = [
            {"type": "text", "text_level": 1, "text": "No BBox Title", "page_idx": 0},
        ]
        blocks = MinerUOCRService.extract_title_blocks(content_list)
        assert len(blocks) == 1
        assert blocks[0]["bbox_height"] == 0.0

    def test_empty_content_list(self):
        assert MinerUOCRService.extract_title_blocks([]) == []


# ---------------------------------------------------------------------------
# rewrite_markdown_headings
# ---------------------------------------------------------------------------

class TestRewriteMarkdownHeadings:
    def test_basic_rewrite(self):
        md = "# Title A\ntext\n# Title B\ntext\n# Title C\ntext"
        title_blocks = [
            {"text": "Title A", "_global_idx": 0},
            {"text": "Title B", "_global_idx": 1},
            {"text": "Title C", "_global_idx": 2},
        ]
        levels = [
            {"i": 0, "level": 1},
            {"i": 1, "level": 2},
            {"i": 2, "level": 3},
        ]
        result = rewrite_markdown_headings(md, title_blocks, levels)
        lines = result.split("\n")
        assert lines[0] == "# Title A"
        assert lines[2] == "## Title B"
        assert lines[4] == "### Title C"

    def test_level_zero_becomes_bold(self):
        md = "# FakeHeader\ntext"
        title_blocks = [{"text": "FakeHeader", "_global_idx": 0}]
        levels = [{"i": 0, "level": 0}]
        result = rewrite_markdown_headings(md, title_blocks, levels)
        assert result.startswith("**FakeHeader**")

    def test_preserves_non_heading_lines(self):
        md = "# Heading\nParagraph text\n\nAnother paragraph"
        title_blocks = [{"text": "Heading", "_global_idx": 0}]
        levels = [{"i": 0, "level": 2}]
        result = rewrite_markdown_headings(md, title_blocks, levels)
        lines = result.split("\n")
        assert lines[0] == "## Heading"
        assert lines[1] == "Paragraph text"

    def test_duplicate_titles_matched_in_order(self):
        md = "# Trigger\nfoo\n# Trigger\nbar"
        title_blocks = [
            {"text": "Trigger", "_global_idx": 0},
            {"text": "Trigger", "_global_idx": 1},
        ]
        levels = [
            {"i": 0, "level": 0},
            {"i": 1, "level": 3},
        ]
        result = rewrite_markdown_headings(md, title_blocks, levels)
        lines = result.split("\n")
        assert lines[0] == "**Trigger**"  # first → level 0
        assert lines[2] == "### Trigger"  # second → level 3

    def test_no_matching_levels(self):
        md = "# Unchanged\ntext"
        title_blocks = [{"text": "Unchanged", "_global_idx": 0}]
        levels = []  # empty
        result = rewrite_markdown_headings(md, title_blocks, levels)
        assert result == md  # unchanged


# ---------------------------------------------------------------------------
# helper functions
# ---------------------------------------------------------------------------

class TestHelpers:
    def test_build_height_distribution(self):
        titles = [
            {"bbox_height": 60},
            {"bbox_height": 60},
            {"bbox_height": 33},
            {"bbox_height": 0},  # skipped
        ]
        dist = _build_height_distribution(titles)
        assert "h=60" in dist
        assert "h=33" in dist

    def test_build_height_distribution_empty(self):
        assert "无" in _build_height_distribution([])

    def test_build_repeated_info_with_repeats(self):
        titles = [
            {"text": "Trigger", "repeat_count": 5},
            {"text": "Trigger", "repeat_count": 5},
        ]
        info = _build_repeated_info(titles)
        assert "Trigger" in info
        assert "5x" in info

    def test_build_repeated_info_none(self):
        titles = [{"text": "Unique", "repeat_count": 1}]
        assert "无" in _build_repeated_info(titles)

    def test_parse_json_response_direct(self):
        data = [{"i": 0, "level": 1}]
        assert _parse_json_response(json.dumps(data)) == data

    def test_parse_json_response_code_block(self):
        text = "```json\n[{\"i\": 0, \"level\": 2}]\n```"
        result = _parse_json_response(text)
        assert result == [{"i": 0, "level": 2}]

    def test_parse_json_response_with_preamble(self):
        text = "Here is the result:\n[{\"i\": 0, \"level\": 3}]\nDone."
        result = _parse_json_response(text)
        assert result == [{"i": 0, "level": 3}]

    def test_parse_json_response_invalid(self):
        assert _parse_json_response("not json at all") == []


# ---------------------------------------------------------------------------
# infer_heading_levels (integration with mocked LLM)
# ---------------------------------------------------------------------------

class TestInferHeadingLevels:
    @pytest.mark.asyncio
    async def test_single_batch_success(self, monkeypatch):
        title_blocks = [
            {"text": "Chapter 1", "page_idx": 0, "bbox_height": 60, "repeat_count": 1},
            {"text": "Section A", "page_idx": 0, "bbox_height": 33, "repeat_count": 1},
        ]

        llm_response = json.dumps([{"i": 0, "level": 1}, {"i": 1, "level": 2}])

        async def mock_post(self, url, **kwargs):
            return httpx.Response(
                200,
                json={
                    "choices": [{"message": {"content": llm_response}}]
                },
                request=httpx.Request("POST", url),
            )

        monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

        result = await infer_heading_levels(
            title_blocks,
            api_url="https://fake.api/v1",
            api_key="test-key",
            model="test-model",
        )
        assert result is not None
        assert len(result) == 2
        assert result[0]["level"] == 1
        assert result[1]["level"] == 2

    @pytest.mark.asyncio
    async def test_empty_input(self):
        result = await infer_heading_levels([], "url", "key", "model")
        assert result is None

    @pytest.mark.asyncio
    async def test_all_batches_fail_returns_none(self, monkeypatch):
        title_blocks = [
            {"text": f"Title {i}", "page_idx": 0, "bbox_height": 30, "repeat_count": 1}
            for i in range(3)
        ]

        async def mock_post(self, url, **kwargs):
            raise httpx.ConnectError("connection refused")

        monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

        result = await infer_heading_levels(
            title_blocks,
            api_url="https://fake.api/v1",
            api_key="test-key",
            model="test-model",
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_multiple_batches(self, monkeypatch):
        """Test that titles > BATCH_SIZE are split into multiple batches."""
        from app.services import langextract_service
        monkeypatch.setattr(langextract_service, "BATCH_SIZE", 2)

        title_blocks = [
            {"text": f"Title {i}", "page_idx": 0, "bbox_height": 30, "repeat_count": 1}
            for i in range(5)
        ]

        call_count = 0

        async def mock_post(self, url, **kwargs):
            nonlocal call_count
            call_count += 1
            body = kwargs.get("json", {})
            prompt = body["messages"][1]["content"]
            # Extract indices from the prompt to return matching levels
            import re
            indices = [int(m) for m in re.findall(r'"i":\s*(\d+)', prompt)]
            levels = [{"i": idx, "level": 2} for idx in indices]
            return httpx.Response(
                200,
                json={"choices": [{"message": {"content": json.dumps(levels)}}]},
                request=httpx.Request("POST", url),
            )

        monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

        result = await infer_heading_levels(
            title_blocks,
            api_url="https://fake.api/v1",
            api_key="test-key",
            model="test-model",
        )
        assert result is not None
        assert call_count == 3  # 5 titles / batch_size 2 = 3 batches
        assert len(result) == 5


# ---------------------------------------------------------------------------
# refine_numbered_hierarchy
# ---------------------------------------------------------------------------

def _make_headings(specs):
    """Helper: specs = [(title, level), ...]"""
    return [TocEntry(title=t, level=l, line_number=i + 1) for i, (t, l) in enumerate(specs)]


class TestRefineNumberedHierarchy:
    def test_sub_letter_deeper_than_parent(self):
        """5. → L3, then 5A./5B./5C./5D. should become L4."""
        headings = _make_headings([
            ("5. 致幻植物 Hallucinogenic Plants", 3),
            ("5A. 西南花园 Southwest Garden", 3),
            ("5B. 东南花园 Southeast Garden", 3),
            ("5C. 西北花园 Northwest Garden", 3),
            ("5D. 东北花园 Northeast Garden", 3),
            ("6. 宝塔 Pagoda", 3),
        ])
        ext = TocExtractor(None)
        ext.refine_numbered_hierarchy(headings)

        assert headings[0].level == 3  # 5. stays L3
        assert headings[1].level == 4  # 5A. → L4
        assert headings[2].level == 4  # 5B. → L4
        assert headings[3].level == 4  # 5C. → L4
        assert headings[4].level == 4  # 5D. → L4
        assert headings[5].level == 3  # 6. stays L3

    def test_named_title_followed_by_numbered_sequence(self):
        """'贾哈卡锚地' L3 followed by 1./2./3. should push numbers to L4."""
        headings = _make_headings([
            ("贾哈卡锚地 Jahaka Anchorage", 3),
            ("1. 丛林大门 Jungle Gate", 3),
            ("2. 码头 Pier", 3),
            ("3. 岸上军官宿舍 Officers' Quarters", 3),
            ("4. 仓库 Warehouse", 3),
        ])
        ext = TocExtractor(None)
        ext.refine_numbered_hierarchy(headings)

        assert headings[0].level == 3  # parent stays L3
        assert headings[1].level == 4  # 1. → L4
        assert headings[2].level == 4  # 2. → L4
        assert headings[3].level == 4  # 3. → L4
        assert headings[4].level == 4  # 4. → L4

    def test_non_numbered_between_consecutive_numbers(self):
        """Non-numbered title between 9 and 10 should match numbered level."""
        headings = _make_headings([
            ("8. 烟雾洞穴 Smoke-Filled Caverns", 3),
            ("9. 牢房与通往巨龙之心矿井之路", 3),
            ("Cells and Passage to Wyrmheart Mine", 2),  # wrong level
            ("10. 矿车间 Mine Cart Bay", 3),
        ])
        ext = TocExtractor(None)
        ext.refine_numbered_hierarchy(headings)

        assert headings[1].level == 3  # 9. stays L3
        assert headings[2].level == 3  # sandwiched → L3 (same as numbers)
        assert headings[3].level == 3  # 10. stays L3

    def test_no_change_when_already_correct(self):
        """Nothing should change if hierarchy is already correct."""
        headings = _make_headings([
            ("5. 致幻植物", 3),
            ("5A. 西南花园", 4),
            ("5B. 东南花园", 4),
            ("6. 宝塔", 3),
        ])
        ext = TocExtractor(None)
        ext.refine_numbered_hierarchy(headings)

        assert headings[0].level == 3
        assert headings[1].level == 4
        assert headings[2].level == 4
        assert headings[3].level == 3

    def test_mixed_scenario(self):
        """Combined: parent title + numbered seq + sub-letters."""
        headings = _make_headings([
            ("废墟区 Ruins", 2),
            ("1. 入口 Entrance", 2),
            ("2. 大厅 Hall", 2),
            ("3. 花园 Garden", 2),
            ("3A. 西花园 West Garden", 3),
            ("3B. 东花园 East Garden", 3),
            ("4. 地下室 Basement", 2),
        ])
        ext = TocExtractor(None)
        ext.refine_numbered_hierarchy(headings)

        assert headings[0].level == 2  # parent
        assert headings[1].level == 3  # 1. → L3
        assert headings[2].level == 3  # 2. → L3
        assert headings[3].level == 3  # 3. → L3
        assert headings[4].level == 4  # 3A. → L4
        assert headings[5].level == 4  # 3B. → L4
        assert headings[6].level == 3  # 4. → L3

    def test_stat_block_titles_nest_under_creature(self):
        """Actions / Legendary Actions should nest under the preceding creature."""
        headings = _make_headings([
            ("附录 D：怪物和非玩家角色", 1),
            ("阿瑟瑞克 Acererak", 2),
            ("动作 Actions", 2),
            ("传奇动作 Legendary Actions", 2),
            ("白矮人 Albino Dwarves", 2),
            ("动作 Actions", 2),
        ])
        ext = TocExtractor(None)
        ext.refine_numbered_hierarchy(headings)

        assert headings[0].level == 1  # 附录
        assert headings[1].level == 2  # 阿瑟瑞克
        assert headings[2].level == 3  # 动作 → L3
        assert headings[3].level == 3  # 传奇动作 → L3 (same as 动作)
        assert headings[4].level == 2  # 白矮人
        assert headings[5].level == 3  # 动作 → L3

    def test_stat_block_already_correct(self):
        """No change if stat block titles are already deeper."""
        headings = _make_headings([
            ("龙虾人 Aldani", 2),
            ("动作 Actions", 3),
        ])
        ext = TocExtractor(None)
        ext.refine_numbered_hierarchy(headings)

        assert headings[0].level == 2
        assert headings[1].level == 3  # unchanged
