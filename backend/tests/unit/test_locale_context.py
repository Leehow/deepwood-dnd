"""Unit tests for ``app.core.locale``.

These tests are intentionally dependency-free so they can run under
``pytest --noconftest`` without booting the FastAPI app or touching the
database.
"""

from __future__ import annotations

import pytest

from app.core.locale import (
    DEFAULT_LOCALE,
    LocaleContext,
    SUPPORTED_LOCALES,
    build_locale_context,
    normalize_locale,
    parse_accept_language,
    resolve_locale,
    resolve_locale_from_accept_language,
    sanitize_preference_locale,
)


class TestNormalizeLocale:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("en", "en-US"),
            ("en-US", "en-US"),
            ("en-us", "en-US"),
            ("en_US", "en-US"),
            ("EN", "en-US"),
            ("en-GB", "en-US"),
            ("en-AU", "en-US"),  # falls back via base language alias
            ("zh", "zh-CN"),
            ("zh-CN", "zh-CN"),
            ("zh_cn", "zh-CN"),
            ("zh-Hans", "zh-CN"),
            ("zh-Hans-CN", "zh-CN"),
            ("  zh-CN  ", "zh-CN"),
        ],
    )
    def test_known_aliases_map_to_canonical(self, raw, expected):
        assert normalize_locale(raw) == expected

    @pytest.mark.parametrize("raw", [None, "", "   ", "xx", "klingon", "fr-FR", "ja-JP"])
    def test_unknown_or_empty_returns_none(self, raw):
        assert normalize_locale(raw) is None

    def test_non_string_input_returns_none(self):
        # Defensive: callers occasionally pass dict/list when preferences JSON
        # is malformed; we must not raise.
        assert normalize_locale(123) is None  # type: ignore[arg-type]
        assert normalize_locale(["en-US"]) is None  # type: ignore[arg-type]


class TestParseAcceptLanguage:
    def test_empty_header_returns_empty_list(self):
        assert parse_accept_language(None) == []
        assert parse_accept_language("") == []

    def test_single_tag_default_q(self):
        assert parse_accept_language("en-US") == [("en-us", 1.0)]

    def test_orders_by_descending_q(self):
        header = "fr-FR;q=0.7, en-US;q=0.9, zh-CN;q=0.8"
        result = parse_accept_language(header)
        assert [tag for tag, _ in result] == ["en-us", "zh-cn", "fr-fr"]

    def test_preserves_source_order_on_tied_q(self):
        # When q-values tie, the earlier tag wins.
        header = "zh-CN, en-US"
        result = parse_accept_language(header)
        assert [tag for tag, _ in result] == ["zh-cn", "en-us"]

    def test_drops_invalid_q_values(self):
        header = "en-US;q=abc, zh-CN;q=0.5"
        result = parse_accept_language(header)
        assert [tag for tag, _ in result] == ["zh-cn"]

    def test_drops_out_of_range_q(self):
        header = "en-US;q=2.0, zh-CN;q=0.3"
        result = parse_accept_language(header)
        assert [tag for tag, _ in result] == ["zh-cn"]

    def test_wildcard_preserved_as_literal(self):
        result = parse_accept_language("*;q=0.1, en-US;q=0.9")
        assert ("*", 0.1) in result

    def test_drops_q_zero_entries(self):
        # Per RFC 9110, ``q=0`` signals "not acceptable" and must be ignored
        # rather than treated as a low-priority candidate.
        result = parse_accept_language("zh-CN;q=0, en-US;q=0.5")
        tags = [tag for tag, _ in result]
        assert "zh-cn" not in tags
        assert tags == ["en-us"]

    def test_q_zero_only_yields_empty(self):
        assert parse_accept_language("en-US;q=0") == []


class TestResolveLocaleFromAcceptLanguage:
    def test_picks_first_supported(self):
        header = "fr-FR;q=0.9, zh-CN;q=0.8, en-US;q=0.7"
        # fr-FR is unsupported, so zh-CN wins (next in q-order).
        assert resolve_locale_from_accept_language(header) == "zh-CN"

    def test_alias_resolution(self):
        # ``en`` alone normalizes to en-US.
        assert resolve_locale_from_accept_language("en;q=0.9") == "en-US"

    def test_wildcard_ignored(self):
        assert resolve_locale_from_accept_language("*") is None

    def test_no_supported_returns_none(self):
        assert resolve_locale_from_accept_language("fr-FR, ja-JP") is None

    def test_empty_returns_none(self):
        assert resolve_locale_from_accept_language(None) is None


class TestResolveLocalePrecedence:
    def test_user_preference_wins_over_header(self):
        result = resolve_locale(
            user_preference="zh-CN",
            accept_language="en-US;q=0.9",
        )
        assert result == "zh-CN"

    def test_invalid_user_preference_falls_through_to_header(self):
        result = resolve_locale(
            user_preference="klingon",
            accept_language="zh-CN;q=0.9, en-US;q=0.8",
        )
        assert result == "zh-CN"

    def test_falls_back_to_default_when_no_signals(self):
        assert resolve_locale() == DEFAULT_LOCALE
        assert resolve_locale(user_preference=None, accept_language=None) == DEFAULT_LOCALE

    def test_default_is_supported(self):
        assert DEFAULT_LOCALE in SUPPORTED_LOCALES

    def test_unsupported_default_is_replaced(self):
        # If someone tampers with the default, we must still return a
        # supported value rather than echoing garbage to callers.
        result = resolve_locale(default="fr-FR")
        assert result == DEFAULT_LOCALE

    def test_header_aliasing(self):
        result = resolve_locale(accept_language="zh, en-US;q=0.1")
        assert result == "zh-CN"

    def test_user_preference_alias_canonicalized(self):
        result = resolve_locale(user_preference="zh_cn")
        assert result == "zh-CN"

    def test_q_zero_header_falls_back_to_default(self):
        # ``zh-CN;q=0`` says "do not give me zh-CN"; with no other signal we
        # must land on the default locale, not zh-CN.
        assert resolve_locale(accept_language="zh-CN;q=0") == DEFAULT_LOCALE

    def test_q_zero_excluded_from_supported_pick(self):
        # zh-CN is explicitly refused; en-US is the only acceptable choice.
        result = resolve_locale(accept_language="zh-CN;q=0, en-US;q=0.5")
        assert result == "en-US"


class TestSanitizePreferenceLocale:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("en-US", "en-US"),
            ("zh_CN", "zh-CN"),
            ("EN", "en-US"),
            ("zh-Hans", "zh-CN"),
        ],
    )
    def test_returns_canonical_for_valid_input(self, raw, expected):
        assert sanitize_preference_locale(raw) == expected

    @pytest.mark.parametrize("raw", [None, "", "fr-FR", "ja-JP", "not-a-locale", 42])
    def test_returns_none_for_invalid_input(self, raw):
        assert sanitize_preference_locale(raw) is None  # type: ignore[arg-type]


class TestBuildLocaleContext:
    def test_user_preference_source(self):
        ctx = build_locale_context(
            user_preference="zh_CN",
            accept_language="en-US;q=0.9",
        )
        assert isinstance(ctx, LocaleContext)
        assert ctx.locale == "zh-CN"
        assert ctx.source == "user_preference"
        assert ctx.user_preference_raw == "zh_CN"
        assert ctx.user_preference_normalized == "zh-CN"
        assert ctx.accept_language == "en-US;q=0.9"
        # header pick is not consulted when preference wins
        assert ctx.header_pick is None
        assert ctx.default == DEFAULT_LOCALE

    def test_header_source(self):
        ctx = build_locale_context(accept_language="zh-CN;q=0.9, en-US;q=0.5")
        assert ctx.locale == "zh-CN"
        assert ctx.source == "header"
        assert ctx.user_preference_normalized is None
        assert ctx.header_pick == "zh-CN"

    def test_default_source_when_no_signals(self):
        ctx = build_locale_context()
        assert ctx.locale == DEFAULT_LOCALE
        assert ctx.source == "default"
        assert ctx.header_pick is None
        assert ctx.accept_language is None

    def test_invalid_preference_falls_through_to_header(self):
        ctx = build_locale_context(
            user_preference="klingon",
            accept_language="zh-CN;q=0.9",
        )
        assert ctx.locale == "zh-CN"
        assert ctx.source == "header"
        # Provenance still records what was tried even though it failed.
        assert ctx.user_preference_raw == "klingon"
        assert ctx.user_preference_normalized is None

    def test_q_zero_skips_header(self):
        ctx = build_locale_context(accept_language="zh-CN;q=0")
        assert ctx.locale == DEFAULT_LOCALE
        assert ctx.source == "default"
        assert ctx.header_pick is None

    def test_unsupported_default_is_replaced(self):
        ctx = build_locale_context(default="fr-FR")
        assert ctx.locale == DEFAULT_LOCALE
        assert ctx.source == "default"
        assert ctx.default == DEFAULT_LOCALE

    def test_to_dict_shape(self):
        ctx = build_locale_context(
            user_preference="zh-CN",
            accept_language="zh-CN,en;q=0.5",
        )
        payload = ctx.to_dict()
        assert payload == {
            "locale": "zh-CN",
            "source": "user_preference",
            "user_preference": "zh-CN",
            "accept_language": "zh-CN,en;q=0.5",
            "default": DEFAULT_LOCALE,
        }

    def test_locale_context_is_frozen(self):
        ctx = build_locale_context()
        with pytest.raises((AttributeError, Exception)):
            ctx.locale = "zh-CN"  # type: ignore[misc]

    def test_resolve_locale_matches_context_locale(self):
        # The thin wrapper must agree with the context for every meaningful
        # combination we care about in this slice.
        cases = [
            {"user_preference": "zh-CN", "accept_language": None},
            {"user_preference": None, "accept_language": "en-US"},
            {"user_preference": "klingon", "accept_language": "zh-CN;q=0.9"},
            {"user_preference": None, "accept_language": None},
            {"user_preference": None, "accept_language": "zh-CN;q=0"},
        ]
        for kwargs in cases:
            assert resolve_locale(**kwargs) == build_locale_context(**kwargs).locale
