"""
Unit tests for the new modular parser architecture
Run: pytest backend/tests/test_parsers.py -v
"""
import pytest
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

base_module = pytest.importorskip(
    "app.domain.parsing.parsers.base",
    reason="Legacy modular parser architecture is not present in the current backend",
)
ParseResult = base_module.ParseResult
ParseStage = base_module.ParseStage
BaseParser = base_module.BaseParser

TocParser = pytest.importorskip(
    "app.domain.parsing.parsers.toc",
    reason="Legacy modular parser architecture is not present in the current backend",
).TocParser
ContentParser = pytest.importorskip(
    "app.domain.parsing.parsers.content",
    reason="Legacy modular parser architecture is not present in the current backend",
).ContentParser
MonsterParser = pytest.importorskip(
    "app.domain.parsing.parsers.monster",
    reason="Legacy modular parser architecture is not present in the current backend",
).MonsterParser
ItemParser = pytest.importorskip(
    "app.domain.parsing.parsers.item",
    reason="Legacy modular parser architecture is not present in the current backend",
).ItemParser
MapParser = pytest.importorskip(
    "app.domain.parsing.parsers.map",
    reason="Legacy modular parser architecture is not present in the current backend",
).MapParser
ParseOrchestrator = pytest.importorskip(
    "app.domain.parsing.orchestrator",
    reason="Legacy modular parser architecture is not present in the current backend",
).ParseOrchestrator


# ========== Test Data ==========

SAMPLE_MARKDOWN = """
# Table of Contents

- Chapter 1: Introduction
- Chapter 2: The Town
- Appendix A: Monsters
- Appendix B: Magic Items

# Chapter 1: Introduction

Welcome to the adventure!

![Cover Image](cover.png)

## Section 1.1: Getting Started

This is the first section.

## Section 1.2: Overview

This is the second section.

# Chapter 2: The Town 城镇

![Town Map](maps/town_map.png)

The town is a small settlement.

## The Inn 旅店

The local inn is a cozy place.

## The Market 市场

The market sells various goods.

# Appendix A: Monsters 怪物

## Wolf 狼

Medium beast, unaligned

**Armor Class** 13
**Hit Points** 11 (2d8+2)
**Speed** 40 ft.

STR 12 (+1), DEX 15 (+2), CON 12 (+1), INT 3 (-4), WIS 12 (+1), CHA 6 (-2)

**Skills** Perception +3
**Senses** passive Perception 13
**Languages** —
**Challenge** 1/4 (50 XP)

**Traits:**
- Keen Hearing and Smell: Advantage on Perception checks.

**Actions:**
- Bite: Melee Weapon Attack: +4 to hit. Hit: 7 (2d4+2) piercing damage.

## Goblin 哥布林

Small humanoid, neutral evil

**Armor Class** 15
**Hit Points** 7 (2d6)
**Speed** 30 ft.

**Challenge** 1/4 (50 XP)

# Appendix B: Magic Items 魔法物品

## Potion of Healing 治疗药水

Potion, common

You regain 2d4+2 hit points when you drink this potion.

## Ring of Protection 防护戒指

Ring, rare (requires attunement)

You gain a +1 bonus to AC and saving throws while wearing this ring.
"""


# ========== Base Parser Tests ==========

class TestBaseParser:
    """Test BaseParser abstract class and ParseResult"""

    def test_parse_result_initialization(self):
        """Test ParseResult dataclass"""
        result = ParseResult()
        assert result.toc is None
        assert result.chapters == []
        assert result.monsters == []
        assert result.items == []
        assert result.maps == []
        assert result.metadata == {}
        assert result.errors == []

    def test_parse_result_with_data(self):
        """Test ParseResult with data"""
        result = ParseResult(
            toc={'title': 'TOC'},
            chapters=[{'title': 'Chapter 1'}],
            metadata={'total': 1}
        )
        assert result.toc == {'title': 'TOC'}
        assert len(result.chapters) == 1
        assert result.metadata['total'] == 1

    def test_parse_stage_enum(self):
        """Test ParseStage enum values"""
        assert ParseStage.TOC_EXTRACTION.value == "toc_extraction"
        assert ParseStage.CONTENT_EXTRACTION.value == "content_extraction"
        assert ParseStage.MONSTER_EXTRACTION.value == "monster_extraction"
        assert ParseStage.ITEM_EXTRACTION.value == "item_extraction"
        assert ParseStage.MAP_EXTRACTION.value == "map_extraction"


# ========== JSON Sanitization & Extraction Tests ==========

class DummyParser(BaseParser):
    async def parse(self, content: str, **kwargs):
        return ParseResult()
    def get_stage(self):
        return ParseStage.HEADING_EXTRACTION

class TestJsonExtraction:
    def test_sanitize_invalid_backslash(self):
        p = DummyParser()
        ai_resp = '```json\n{"text": "Line 1\\Line 2 \\x not valid \\d digit"}\n```'
        # _extract_json_from_response_common should sanitize and parse
        data = p._extract_json_from_response_common(ai_resp)
        assert isinstance(data, dict)
        assert 'text' in data
        # Ensure backslashes preserved as valid JSON string
        assert '\\' in data['text']

    def test_extract_from_fenced_block(self):
        p = DummyParser()
        ai_resp = 'Note: below is the JSON```json\n{"ok": true, "items": [1,2,3],}\n```Thanks.'
        data = p._extract_json_from_response_common(ai_resp)
        assert isinstance(data, dict)
        assert data['ok'] is True
        assert data['items'] == [1,2,3]

    def test_extract_balanced_segment(self):
        p = DummyParser()
        ai_resp = 'prefix {"a":1, "b": [2,3,], "c": true} suffix'
        data = p._extract_json_from_response_common(ai_resp)
        assert isinstance(data, dict)
        assert data['a'] == 1
        assert data['b'] == [2,3]
        assert data['c'] is True


# ========== TOC Parser Tests ==========

@pytest.mark.asyncio
class TestTocParser:
    """Test TocParser"""

    async def test_toc_parser_initialization(self):
        """Test TocParser can be initialized"""
        parser = TocParser()
        assert parser is not None
        assert parser.get_stage() == ParseStage.TOC_EXTRACTION

    async def test_toc_extraction(self):
        """Test TOC extraction from sample markdown"""
        parser = TocParser()
        result = await parser.parse(SAMPLE_MARKDOWN)

        assert result is not None
        assert isinstance(result, ParseResult)
        assert len(result.errors) == 0

        # Check TOC was extracted
        if result.toc:
            assert isinstance(result.toc, (dict, list))

    async def test_toc_with_no_content(self):
        """Test TOC parser with empty content"""
        parser = TocParser()
        result = await parser.parse("")

        assert result is not None
        assert isinstance(result, ParseResult)


# ========== Content Parser Tests ==========

@pytest.mark.asyncio
class TestContentParser:
    """Test ContentParser"""

    async def test_content_parser_initialization(self):
        """Test ContentParser can be initialized"""
        parser = ContentParser()
        assert parser is not None
        assert parser.get_stage() == ParseStage.CONTENT_EXTRACTION

    async def test_heading_extraction(self):
        """Test extracting headings from markdown"""
        parser = ContentParser()
        md_lines = SAMPLE_MARKDOWN.split('\n')
        headings = parser._extract_all_headings(md_lines)

        assert len(headings) > 0
        # Should have multiple headings
        assert any(h['level'] == 1 for h in headings)
        assert any(h['level'] == 2 for h in headings)

    async def test_content_extraction(self):
        """Test chapter content extraction"""
        parser = ContentParser()

        # Need a simple TOC structure
        toc_structure = [
            {
                'level': 1,
                'type': 'chapter',
                'title_cn': 'Chapter 1',
                'title_en': 'Chapter 1: Introduction',
                'children': []
            }
        ]

        result = await parser.parse(SAMPLE_MARKDOWN, toc_structure=toc_structure)

        assert result is not None
        assert isinstance(result, ParseResult)


# ========== Monster Parser Tests ==========

@pytest.mark.asyncio
class TestMonsterParser:
    """Test MonsterParser"""

    async def test_monster_parser_initialization(self):
        """Test MonsterParser can be initialized"""
        ai_settings = {
            'api_url': 'https://api.example.com',
            'api_key': 'test_key',
            'model': 'test-model'
        }
        parser = MonsterParser(ai_settings)
        assert parser is not None
        assert parser.get_stage() == ParseStage.MONSTER_EXTRACTION

    async def test_heading_extraction(self):
        """Test extracting headings from monster appendix"""
        ai_settings = {'api_key': 'test'}
        parser = MonsterParser(ai_settings)

        md_lines = SAMPLE_MARKDOWN.split('\n')

        # Find appendix range manually
        start_line = next(i for i, line in enumerate(md_lines) if '# Appendix A: Monsters' in line)
        end_line = next((i for i, line in enumerate(md_lines[start_line+1:], start_line+1)
                        if line.startswith('# Appendix B:')), len(md_lines))

        headings = parser._extract_headings(md_lines, start_line, end_line)

        assert len(headings) > 0
        # Should find Wolf and Goblin
        assert any('Wolf' in h['title'] for h in headings)
        assert any('Goblin' in h['title'] for h in headings)


# ========== Item Parser Tests ==========

@pytest.mark.asyncio
class TestItemParser:
    """Test ItemParser"""

    async def test_item_parser_initialization(self):
        """Test ItemParser can be initialized"""
        ai_settings = {
            'api_url': 'https://api.example.com',
            'api_key': 'test_key',
            'model': 'test-model'
        }
        parser = ItemParser(ai_settings)
        assert parser is not None
        assert parser.get_stage() == ParseStage.ITEM_EXTRACTION

    async def test_heading_extraction(self):
        """Test extracting headings from item appendix"""
        ai_settings = {'api_key': 'test'}
        parser = ItemParser(ai_settings)

        md_lines = SAMPLE_MARKDOWN.split('\n')

        # Find appendix range
        start_line = next(i for i, line in enumerate(md_lines) if '# Appendix B: Magic Items' in line)
        end_line = len(md_lines)

        headings = parser._extract_headings(md_lines, start_line, end_line)

        assert len(headings) > 0
        # Should find items
        assert any('Potion' in h['title'] or 'Ring' in h['title'] for h in headings)


# ========== Map Parser Tests ==========

@pytest.mark.asyncio
class TestMapParser:
    """Test MapParser"""

    async def test_map_parser_initialization(self):
        """Test MapParser can be initialized"""
        parser = MapParser()
        assert parser is not None
        assert parser.get_stage() == ParseStage.MAP_EXTRACTION

    async def test_image_extraction(self):
        """Test extracting images from markdown"""
        parser = MapParser()
        md_lines = SAMPLE_MARKDOWN.split('\n')
        images = parser._extract_images(md_lines)

        assert len(images) > 0
        # Should find cover.png and town_map.png
        assert any('cover.png' in img['path'] for img in images)
        assert any('town_map.png' in img['path'] for img in images)

    async def test_map_extraction(self):
        """Test complete map extraction"""
        parser = MapParser()
        result = await parser.parse(SAMPLE_MARKDOWN)

        assert result is not None
        assert isinstance(result, ParseResult)
        assert len(result.maps) > 0
        assert result.metadata['total_images'] > 0

    async def test_image_classification(self):
        """Test image type classification"""
        parser = MapParser()
        test_maps = [
            {'path': 'maps/dungeon_map.png', 'alt': 'Dungeon Layout'},
            {'path': 'images/portrait.png', 'alt': 'Character Portrait'}
        ]

        classified = parser._classify_images(test_maps)

        # Dungeon map should be classified as 'map'
        assert classified[0]['type'] == 'map'
        # Portrait should be 'illustration'
        assert classified[1]['type'] == 'illustration'


# ========== Orchestrator Tests ==========

@pytest.mark.asyncio
class TestParseOrchestrator:
    """Test ParseOrchestrator"""

    async def test_orchestrator_initialization(self):
        """Test orchestrator can be initialized"""
        ai_settings = {'api_key': 'test'}
        output_dir = Path('debug/test_output')
        orchestrator = ParseOrchestrator(ai_settings, output_dir)

        assert orchestrator is not None
        assert orchestrator.toc_parser is not None
        assert orchestrator.content_parser is not None
        assert orchestrator.monster_parser is not None
        assert orchestrator.item_parser is not None
        assert orchestrator.map_parser is not None

    async def test_appendix_identification(self):
        """Test identifying appendices"""
        ai_settings = {'api_key': 'test'}
        output_dir = Path('debug/test_output')
        orchestrator = ParseOrchestrator(ai_settings, output_dir)

        md_lines = SAMPLE_MARKDOWN.split('\n')
        appendices = await orchestrator._identify_appendices(md_lines)

        assert 'monsters' in appendices
        assert 'items' in appendices

    async def test_parse_module_toc_only(self):
        """Test parsing with all stages skipped except TOC"""
        ai_settings = {'api_key': 'test'}
        output_dir = Path('debug/test_output')
        orchestrator = ParseOrchestrator(ai_settings, output_dir)

        result = await orchestrator.parse_module(
            SAMPLE_MARKDOWN,
            skip_content=True,
            skip_monsters=True,
            skip_items=True,
            skip_maps=True
        )

        assert result is not None
        assert 'toc' in result
        assert 'metadata' in result


# ========== Integration Tests ==========

@pytest.mark.asyncio
class TestIntegration:
    """Integration tests for full parsing pipeline"""

    async def test_full_pipeline_structure(self):
        """Test that full pipeline returns correct structure"""
        ai_settings = {'api_key': 'test'}
        output_dir = Path('debug/test_output')
        orchestrator = ParseOrchestrator(ai_settings, output_dir)

        # Run with skips to avoid AI calls
        result = await orchestrator.parse_module(
            SAMPLE_MARKDOWN,
            skip_monsters=True,
            skip_items=True
        )

        assert 'toc' in result
        assert 'chapters' in result
        assert 'monsters' in result
        assert 'items' in result
        assert 'maps' in result
        assert 'metadata' in result
        assert 'errors' in result


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
