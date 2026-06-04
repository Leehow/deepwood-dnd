"""
Tests for monster extraction pipeline fixes:
- _collect_appendix_monster_entries: no pre-filtering, sends all entries to LLM
- reparse_single_monster: smart merge (don't overwrite with null/empty)
- _reconstruct_text_from_structured: supplements incomplete descriptions
- MONSTER_EXTRACT_PROMPT: instructs LLM to merge action sections
"""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from app.services.monster_item_extractor import MonsterItemExtractor, MONSTER_EXTRACT_PROMPT


class TestCollectAppendixMonsterEntries:
    """Test that _collect_appendix_monster_entries sends all entries without filtering."""

    def setup_method(self):
        self.extractor = MonsterItemExtractor()

    def test_no_filtering_of_action_sections(self):
        """Action/Legendary sections (without AC/HP) must NOT be filtered out."""
        chapter = {
            "title": "附录D：怪物 Appendix D: Monsters",
            "children": [
                {
                    "title": "阿瑟瑞克 Acererak",
                    "content": "中型亡灵，中立邪恶\nAC: 21（天生护甲）\nHP: 285（30d8+150）\n力量 13 敏捷 16 体质 20 智力 27 感知 21 魅力 20",
                    "children": []
                },
                {
                    "title": "动作 Actions",
                    "content": "**权杖** 近战武器攻击：命中+11，触及5尺，一个目标。命中：10（1d6+7）钝击伤害加10（3d6）黯蚀伤害。",
                    "children": []
                },
                {
                    "title": "传奇动作 Legendary Actions",
                    "content": "阿瑟瑞克可以在每轮进行3次传奇动作...\n**法术施放（消耗1-3动作）** 阿瑟瑞克施放一个法术...",
                    "children": []
                },
                {
                    "title": "腐化毒蛇 Decayed Serpent",
                    "content": "小型亡灵，中立邪恶\nAC: 14\nHP: 22（5d6+5）\n力量 8 敏捷 15 体质 12 智力 3 感知 10 魅力 4",
                    "children": []
                }
            ]
        }

        entries = self.extractor._collect_appendix_monster_entries(chapter)

        # All 4 entries should be collected (no filtering)
        assert len(entries) == 4

        # Verify action/legendary sections are included
        entry_text = "\n".join(entries)
        assert "动作 Actions" in entry_text
        assert "传奇动作 Legendary Actions" in entry_text
        assert "阿瑟瑞克 Acererak" in entry_text
        assert "腐化毒蛇" in entry_text

    def test_empty_chapter(self):
        """Empty chapter returns empty list."""
        chapter = {"title": "Empty", "children": []}
        entries = self.extractor._collect_appendix_monster_entries(chapter)
        assert entries == []

    def test_monster_descriptions_subsection(self):
        """Should detect and use '怪物详述' sub-section."""
        chapter = {
            "title": "附录D：怪物",
            "children": [
                {
                    "title": "怪物列表",
                    "content": "这是怪物索引表格...",
                    "children": []
                },
                {
                    "title": "怪物详述 Monster Descriptions",
                    "content": "",
                    "children": [
                        {
                            "title": "死亡暴龙兽 Death Tyrant",
                            "content": "大型亡灵，守序邪恶\nAC: 19（天生护甲）\nHP: 187（25d10+50）",
                            "children": []
                        },
                        {
                            "title": "传奇动作",
                            "content": "死亡暴龙兽可以在每轮进行3次传奇动作。它可以在另一个生物的回合结束时选择使用一个传奇动作。\n**眼球射线** 死亡暴龙兽使用一条随机眼球射线。",
                            "children": []
                        }
                    ]
                }
            ]
        }

        entries = self.extractor._collect_appendix_monster_entries(chapter)

        # Should use the "怪物详述" sub-section's children (2 entries)
        assert len(entries) == 2
        entry_text = "\n".join(entries)
        assert "死亡暴龙兽" in entry_text
        assert "传奇动作" in entry_text

    def test_short_entries_filtered(self):
        """Entries with less than 50 chars should be filtered."""
        chapter = {
            "title": "附录",
            "children": [
                {"title": "Short", "content": "Too short", "children": []},
                {
                    "title": "怪物A",
                    "content": "中型人形生物，中立\nAC: 12\nHP: 22（5d8）\n力量 10 敏捷 14 体质 11 智力 10 感知 12 魅力 10",
                    "children": []
                }
            ]
        }

        entries = self.extractor._collect_appendix_monster_entries(chapter)
        # Only the one with sufficient content
        assert len(entries) == 1
        assert "怪物A" in entries[0]


class TestReconstructTextFromStructured:
    """Test _reconstruct_text_from_structured supplements incomplete descriptions."""

    def setup_method(self):
        self.extractor = MonsterItemExtractor()

    def test_reconstruct_missing_traits(self):
        """Should reconstruct traits when description lacks them."""
        monster = {
            "description": "中型亡灵，中立邪恶\nAC: 21\nHP: 285",
            "specialAbilities": [
                {"name": "魔法抗性", "description": "对法术和其他魔法效果的豁免检定具有优势。"},
                {"name": "传奇抗性（3/日）", "description": "如果阿瑟瑞克未能通过一次豁免，他可以选择通过。"}
            ],
            "actions": [],
            "legendaryActions": []
        }

        result = self.extractor._reconstruct_text_from_structured(monster)
        assert "魔法抗性" in result
        assert "传奇抗性" in result

    def test_no_reconstruct_when_present(self):
        """Should not reconstruct if description already has the keywords."""
        monster = {
            "description": "AC: 21\nHP: 285\n施法 Spellcasting\n近战武器攻击：命中+11\n传奇动作：3次",
            "specialAbilities": [{"name": "魔法抗性", "description": "优势"}],
            "actions": [{"name": "权杖", "description": "近战武器攻击：命中+11"}],
            "legendaryActions": {"description": "3次", "actions": []}
        }

        result = self.extractor._reconstruct_text_from_structured(monster)
        # All keywords present in description, so nothing to reconstruct
        assert result == ""

    def test_reconstruct_legendary_actions_dict(self):
        """Should reconstruct legendary actions from dict format."""
        monster = {
            "description": "AC: 21\nHP: 285\n施法 Spellcasting\n近战武器攻击：命中+11",
            "specialAbilities": [],
            "actions": [],
            "legendaryActions": {
                "description": "可以进行3次传奇动作",
                "actions": [
                    {"name": "法术施放", "description": "施放一个法术", "cost": 3},
                    {"name": "侦测", "description": "进行一次感知检定", "cost": 1}
                ]
            }
        }

        result = self.extractor._reconstruct_text_from_structured(monster)
        assert "传奇动作" in result
        assert "法术施放" in result
        assert "消耗3动作" in result
        assert "侦测" in result

    def test_reconstruct_legendary_actions_list(self):
        """Should reconstruct legendary actions from list format."""
        monster = {
            "description": "AC: 20\nHP: 80",
            "specialAbilities": [],
            "actions": [],
            "legendaryActions": [
                {"name": "攻击", "description": "进行一次攻击", "cost": 1},
                {"name": "能量吸收", "description": "吸收生命能量", "cost": 2}
            ]
        }

        result = self.extractor._reconstruct_text_from_structured(monster)
        assert "传奇动作" in result
        assert "攻击" in result
        assert "能量吸收" in result
        assert "消耗2动作" in result


class TestFindMonsterTextInToc:
    """Test _find_monster_text_in_toc finds full text including actions/legendary."""

    def setup_method(self):
        self.extractor = MonsterItemExtractor()

    def _make_toc(self):
        """Create a realistic TOC with monsters and adjacent action sections."""
        return [
            {
                "title": "附录D：怪物与NPC Appendix D: Monsters",
                "content": "",
                "children": [
                    {
                        "title": "阿瑟瑞克 Acererak",
                        "content": "中型亡灵，中立邪恶\nAC: 21（天生护甲）\nHP: 285（30d8+150）\n力量 13(+1) 敏捷 16(+3) 体质 20(+5) 智力 27(+8) 感知 21(+5) 魅力 20(+5)\n施法：20级施法者，法术豁免DC 23",
                        "children": []
                    },
                    {
                        "title": "动作 Actions",
                        "content": "**权杖** 近战武器攻击：命中+11，触及5尺，一个目标。命中：10（1d6+7）钝击伤害加10（3d6）黯蚀伤害。\n**诅咒之触** 近战法术攻击：命中+17，触及5尺。命中：36（8d8）黯蚀伤害。",
                        "children": []
                    },
                    {
                        "title": "传奇动作 Legendary Actions",
                        "content": "阿瑟瑞克可以在每轮进行3次传奇动作。\n**法术施放（消耗1-3动作）** 阿瑟瑞克施放一个法术。\n**诅咒之触（消耗2动作）** 阿瑟瑞克使用诅咒之触。",
                        "children": []
                    },
                    {
                        "title": "腐化毒蛇 Decayed Serpent",
                        "content": "小型亡灵\nAC: 14\nHP: 22（5d6+5）\n力量 8 敏捷 15 体质 12 智力 3 感知 10 魅力 4",
                        "children": []
                    }
                ]
            }
        ]

    def test_finds_monster_with_actions_and_legendary(self):
        """Should find the monster text AND include adjacent action/legendary sections."""
        toc = self._make_toc()
        result = self.extractor._find_monster_text_in_toc(toc, "阿瑟瑞克", "Acererak")

        assert result is not None
        assert "AC: 21" in result
        assert "HP: 285" in result
        # Action section should be merged in
        assert "权杖" in result
        assert "诅咒之触" in result
        # Legendary section should be merged in
        assert "传奇动作" in result
        assert "法术施放" in result
        # Should NOT include the next monster
        assert "腐化毒蛇" not in result

    def test_stops_at_next_monster(self):
        """Should stop merging siblings when hitting the next monster (has AC/HP)."""
        toc = self._make_toc()
        result = self.extractor._find_monster_text_in_toc(toc, "阿瑟瑞克", "Acererak")
        assert "腐化毒蛇" not in result
        assert "小型亡灵" not in result

    def test_finds_by_chinese_name(self):
        """Should find monster by Chinese name alone."""
        toc = self._make_toc()
        result = self.extractor._find_monster_text_in_toc(toc, "阿瑟瑞克")
        assert result is not None
        assert "AC: 21" in result

    def test_finds_by_english_name(self):
        """Should find monster by English name alone."""
        toc = self._make_toc()
        result = self.extractor._find_monster_text_in_toc(toc, "", "Acererak")
        assert result is not None
        assert "AC: 21" in result

    def test_returns_none_for_unknown_monster(self):
        """Should return None when monster is not in TOC."""
        toc = self._make_toc()
        result = self.extractor._find_monster_text_in_toc(toc, "不存在的怪物")
        assert result is None

    def test_finds_second_monster(self):
        """Should find the second monster without actions from previous."""
        toc = self._make_toc()
        result = self.extractor._find_monster_text_in_toc(toc, "腐化毒蛇", "Decayed Serpent")
        assert result is not None
        assert "AC: 14" in result
        # Should NOT include Acererak's data
        assert "AC: 21" not in result


class TestSmartMergeInReparse:
    """Test that reparse_single_monster uses smart merge logic."""

    def setup_method(self):
        self.extractor = MonsterItemExtractor()

    @pytest.mark.asyncio
    async def test_smart_merge_preserves_existing_data(self):
        """Null/empty parsed values should NOT overwrite existing data."""
        monster = {
            "name": "阿瑟瑞克",
            "description": "AC: 21\nHP: 285\n力量 13...",
            "ac": 21,
            "hp": 285,
            "specialAbilities": [
                {"name": "魔法抗性", "description": "优势"}
            ],
            "actions": [
                {"name": "权杖", "description": "近战武器攻击"}
            ],
            "legendaryActions": [
                {"name": "侦测", "description": "感知检定", "cost": 1}
            ]
        }

        # Simulate LLM returning partial data (null/empty for some fields)
        parsed_response = {
            "ac": 21,
            "hp": 285,
            "specialAbilities": None,  # LLM returned null
            "actions": [],  # LLM returned empty
            "legendaryActions": None,  # LLM returned null
            "cr": "23"  # New field
        }

        # Mock the LLM call
        mock_config = MagicMock()
        mock_config.api_url = "https://fake-api.com/v1"
        mock_config.api_key = "fake-key"
        mock_config.model_name = "test-model"

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "choices": [{"message": {"content": str(parsed_response).replace("'", '"').replace("None", "null")}}]
        }

        mock_db = AsyncMock()

        with patch.object(
            self.extractor, '_parse_json_object', return_value=parsed_response
        ), patch(
            'app.services.monster_item_extractor.ai_model_service.get_config_for_usage',
            new_callable=AsyncMock, return_value=mock_config
        ), patch(
            'httpx.AsyncClient.__aenter__', return_value=MagicMock(post=AsyncMock(return_value=mock_response))
        ):
            result = await self.extractor.reparse_single_monster(mock_db, monster)

        assert result is not None
        # Existing data should be preserved (not overwritten by null/empty)
        assert result["specialAbilities"] == [{"name": "魔法抗性", "description": "优势"}]
        assert result["actions"] == [{"name": "权杖", "description": "近战武器攻击"}]
        assert result["legendaryActions"] == [{"name": "侦测", "description": "感知检定", "cost": 1}]
        # New fields should be added
        assert result["cr"] == "23"


class TestMonsterExtractPrompt:
    """Test that MONSTER_EXTRACT_PROMPT contains merge instructions."""

    def test_prompt_has_merge_instructions(self):
        """Prompt should instruct LLM to merge action sections into preceding monster."""
        assert "合并相关内容" in MONSTER_EXTRACT_PROMPT
        assert "传奇动作" in MONSTER_EXTRACT_PROMPT
        assert "动作 Actions" in MONSTER_EXTRACT_PROMPT

    def test_prompt_has_content_placeholder(self):
        """Prompt should have {content} placeholder."""
        assert "{content}" in MONSTER_EXTRACT_PROMPT


class TestFormatEntry:
    """Test _format_entry handles action sections correctly."""

    def setup_method(self):
        self.extractor = MonsterItemExtractor()

    def test_entry_with_stats_includes_action_children(self):
        """When main content has stats, action children should be included."""
        toc_item = {
            "title": "阿瑟瑞克 Acererak",
            "content": "中型亡灵\nAC: 21\nHP: 285（30d8+150）",
            "children": [
                {
                    "title": "动作 Actions",
                    "content": "**权杖** 近战武器攻击：命中+11",
                    "children": []
                },
                {
                    "title": "传奇动作 Legendary Actions",
                    "content": "阿瑟瑞克可以进行3次传奇动作",
                    "children": []
                }
            ]
        }

        result = self.extractor._format_entry(toc_item)
        assert "阿瑟瑞克" in result
        assert "AC: 21" in result
        assert "权杖" in result
        assert "传奇动作" in result

    def test_entry_without_stats_no_children(self):
        """Plain action section without stats should still produce output."""
        toc_item = {
            "title": "传奇动作 Legendary Actions",
            "content": "阿瑟瑞克可以在每轮进行3次传奇动作。\n**法术施放** 施放一个法术。",
            "children": []
        }

        result = self.extractor._format_entry(toc_item)
        # Should return something (not filtered out)
        assert "传奇动作" in result
        assert "法术施放" in result
