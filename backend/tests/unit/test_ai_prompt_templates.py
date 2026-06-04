"""Unit tests for :mod:`app.services.ai_prompts`."""

from __future__ import annotations

import pytest

from app.services.ai_prompts import (
    build_chat_system_prompt,
    build_rules_chat_system_prompt,
    language_directive,
    resolve_prompt_locale,
)


# ---------------------------------------------------------------------------
# base helpers
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("en-US", "en-US"),
        ("en", "en-US"),
        ("zh-CN", "zh-CN"),
        ("zh", "zh-CN"),
        ("zh_CN", "zh-CN"),
        ("fr-FR", "en-US"),  # unsupported -> default
        (None, "en-US"),
        ("", "en-US"),
        ("   ", "en-US"),
    ],
)
def test_resolve_prompt_locale(raw, expected) -> None:
    assert resolve_prompt_locale(raw) == expected


def test_language_directive_en() -> None:
    directive = language_directive("en-US")
    assert "English" in directive
    assert "D&D" in directive
    assert "中文" not in directive


def test_language_directive_zh() -> None:
    directive = language_directive("zh-CN")
    assert "中文" in directive


def test_language_directive_unsupported_falls_back_to_default() -> None:
    assert language_directive("ja-JP") == language_directive("en-US")


# ---------------------------------------------------------------------------
# rules-chat prompt
# ---------------------------------------------------------------------------


def test_rules_chat_prompt_en_has_english_directive() -> None:
    prompt = build_rules_chat_system_prompt("en-US")
    assert "English" in prompt
    assert "D&D" in prompt or "Dungeons & Dragons" in prompt
    # Must not retain the old hard-coded Chinese mandate.
    assert "使用中文回答" not in prompt
    assert "请用简洁中文回答" not in prompt


def test_rules_chat_prompt_zh_has_chinese_directive() -> None:
    prompt = build_rules_chat_system_prompt("zh-CN")
    assert "中文" in prompt
    assert "D&D" in prompt


def test_rules_chat_prompt_includes_context_when_provided() -> None:
    en = build_rules_chat_system_prompt("en-US", rules_context="Page 42: foo")
    assert "Page 42: foo" in en
    assert "Reference material" in en

    zh = build_rules_chat_system_prompt("zh-CN", rules_context="第42页：foo")
    assert "第42页：foo" in zh
    assert "参考资料" in zh


def test_rules_chat_prompt_omits_context_when_empty() -> None:
    prompt = build_rules_chat_system_prompt("en-US", rules_context="")
    assert "Reference material" not in prompt


def test_rules_chat_prompt_unknown_locale_falls_back_to_english() -> None:
    prompt = build_rules_chat_system_prompt("xx-YY")
    assert "English" in prompt
    assert "使用中文回答" not in prompt


# ---------------------------------------------------------------------------
# websocket chat prompt
# ---------------------------------------------------------------------------


def test_chat_prompt_en_has_english_directive() -> None:
    prompt = build_chat_system_prompt("en-US")
    assert "English" in prompt
    # Must not retain the old hard-coded Chinese mandate.
    assert "请用简洁中文回答" not in prompt
    assert "使用中文回答" not in prompt


def test_chat_prompt_zh_has_chinese_directive() -> None:
    prompt = build_chat_system_prompt("zh-CN")
    assert "请用简洁中文回答" in prompt


def test_chat_prompt_includes_character_context_en() -> None:
    prompt = build_chat_system_prompt(
        "en-US",
        character_context="Aragorn, Human Fighter L5",
    )
    assert "Aragorn, Human Fighter L5" in prompt
    assert "[Player character]" in prompt


def test_chat_prompt_includes_character_context_zh() -> None:
    prompt = build_chat_system_prompt(
        "zh-CN",
        character_context="阿拉贡，人类 战士 5级",
    )
    assert "阿拉贡" in prompt
    assert "【玩家角色信息】" in prompt


def test_chat_prompt_includes_ui_context_with_hint_en() -> None:
    prompt = build_chat_system_prompt(
        "en-US",
        ui_context="Opening equipment picker",
    )
    assert "Opening equipment picker" in prompt
    assert "[Player's current UI action]" in prompt
    # The English hint ends with class-proficiency / ability-score advice
    assert "class proficiencies" in prompt


def test_chat_prompt_includes_ui_context_with_hint_zh() -> None:
    prompt = build_chat_system_prompt(
        "zh-CN",
        ui_context="正在选装备",
    )
    assert "正在选装备" in prompt
    assert "【玩家当前操作】" in prompt
    assert "推荐装备" in prompt


def test_chat_prompt_unsupported_locale_falls_back_to_english() -> None:
    prompt = build_chat_system_prompt(None)
    assert "English" in prompt
    assert "请用简洁中文回答" not in prompt
