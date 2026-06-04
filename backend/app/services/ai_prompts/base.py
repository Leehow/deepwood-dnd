"""Shared helpers for locale-aware AI prompt builders."""

from __future__ import annotations

from typing import Optional

from app.core.locale import DEFAULT_LOCALE, SUPPORTED_LOCALES, normalize_locale


def resolve_prompt_locale(locale: Optional[str]) -> str:
    """Return a canonical supported locale, falling back to the backend default.

    Unsupported / unknown / missing values resolve to :data:`DEFAULT_LOCALE`
    (currently ``en-US``). This is intentionally permissive: prompt builders
    should never raise just because the upstream layer forgot to plumb a
    locale through. The cost of a fallback is mildly off-locale output; the
    cost of raising would be a dropped AI request.
    """
    normalized = normalize_locale(locale)
    if normalized and normalized in SUPPORTED_LOCALES:
        return normalized
    return DEFAULT_LOCALE


_LANGUAGE_DIRECTIVES: dict[str, str] = {
    "en-US": (
        "Respond in English. Use canonical D&D 5E English terminology for "
        "spells, classes, races, skills, equipment, and conditions."
    ),
    "zh-CN": (
        "请用简洁中文回答。所有D&D术语（法术名、职业、种族、技能、装备、状态等）"
        "统一使用中文名称。"
    ),
}


def language_directive(locale: Optional[str]) -> str:
    """Return the output-language directive line for ``locale``."""
    return _LANGUAGE_DIRECTIVES[resolve_prompt_locale(locale)]


__all__ = ["language_directive", "resolve_prompt_locale"]
