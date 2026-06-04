"""Locale resolution for the English-canonical i18n migration.

This module is the single source of truth for which locales the backend
recognises and how it picks one for a given request. Precedence order is:

1. Validated ``user.preferences.locale``
2. ``Accept-Language`` request header (q-value aware)
3. ``DEFAULT_LOCALE`` (currently ``en-US``)

No public ``?locale=`` query parameter or ``X-Locale`` header is supported —
that would mirror the ``X-User-ID`` / ``?user_id=`` anti-pattern the
transport-contract CI guard already forbids.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Literal, Mapping, Optional, Tuple

LocaleSource = Literal["user_preference", "header", "default"]

# Canonical locale tags supported by the platform. Order is not significant.
SUPPORTED_LOCALES: Tuple[str, ...] = ("en-US", "zh-CN")
DEFAULT_LOCALE: str = "en-US"

# Map of normalized base/region forms to a canonical supported tag. Lookup keys
# are always lower-cased with ``_`` collapsed to ``-`` before matching.
_ALIAS_MAP: Mapping[str, str] = {
    "en": "en-US",
    "en-us": "en-US",
    "en-gb": "en-US",  # treat other English regions as en-US for now
    "zh": "zh-CN",
    "zh-cn": "zh-CN",
    "zh-hans": "zh-CN",
    "zh-hans-cn": "zh-CN",
}


def _canonicalize_tag(value: str) -> str:
    """Return the lower-cased ``-``-joined form of a BCP-47-ish tag."""
    return value.strip().replace("_", "-").lower()


def normalize_locale(value: Optional[str]) -> Optional[str]:
    """Normalize a raw locale string to a supported canonical tag.

    Returns ``None`` when the input is empty, malformed, or refers to a
    language the platform does not yet support. Callers decide whether
    ``None`` means "fall through to the next precedence step" or "reject".
    """
    if not value or not isinstance(value, str):
        return None
    key = _canonicalize_tag(value)
    if not key:
        return None
    if key in _ALIAS_MAP:
        return _ALIAS_MAP[key]
    # Fall back to the base-language alias when the region is unknown
    # (e.g. ``en-AU`` -> ``en`` -> ``en-US``).
    base = key.split("-", 1)[0]
    if base in _ALIAS_MAP:
        return _ALIAS_MAP[base]
    return None


def sanitize_preference_locale(value: Optional[str]) -> Optional[str]:
    """Return a supported canonical locale or ``None`` for invalid input.

    Used by the preferences endpoint to keep ``users.preferences.locale``
    well-formed regardless of what clients submit.
    """
    return normalize_locale(value)


def parse_accept_language(header: Optional[str]) -> List[Tuple[str, float]]:
    """Parse an ``Accept-Language`` header into ``(tag, q)`` pairs.

    Output is sorted by descending q-value, then by source order. Tags are
    canonicalized to lower-case but kept in their original language-region
    form so the caller can normalize them. Invalid q-values are dropped.
    Entries with ``q=0`` are dropped too: per RFC 9110, a zero quality
    value means "not acceptable" and must never be selected.
    The wildcard ``*`` is preserved as a literal so callers can decide how
    to treat it.
    """
    if not header:
        return []
    items: List[Tuple[int, float, str]] = []
    for index, part in enumerate(header.split(",")):
        token = part.strip()
        if not token:
            continue
        tag, _, params = token.partition(";")
        tag = _canonicalize_tag(tag)
        if not tag:
            continue
        q = 1.0
        for param in params.split(";"):
            param = param.strip()
            if not param.startswith("q="):
                continue
            try:
                q = float(param[2:])
            except ValueError:
                q = -1.0
                break
        if q <= 0 or q > 1:
            # q=0 explicitly means "not acceptable" (RFC 9110 §12.5.4).
            continue
        items.append((index, q, tag))
    items.sort(key=lambda row: (-row[1], row[0]))
    return [(tag, q) for _, q, tag in items]


def resolve_locale_from_accept_language(
    header: Optional[str],
    *,
    supported: Iterable[str] = SUPPORTED_LOCALES,
) -> Optional[str]:
    """Return the first supported canonical locale from an Accept-Language header."""
    supported_set = set(supported)
    for tag, _q in parse_accept_language(header):
        if tag == "*":
            continue
        candidate = normalize_locale(tag)
        if candidate and candidate in supported_set:
            return candidate
    return None


def resolve_locale(
    *,
    user_preference: Optional[str] = None,
    accept_language: Optional[str] = None,
    default: str = DEFAULT_LOCALE,
) -> str:
    """Pick a locale using the documented precedence chain.

    The fallback ``default`` must itself be a supported locale; otherwise
    ``DEFAULT_LOCALE`` is used so the function never returns an unsupported
    value.
    """
    return build_locale_context(
        user_preference=user_preference,
        accept_language=accept_language,
        default=default,
    ).locale


@dataclass(frozen=True, slots=True)
class LocaleContext:
    """Resolved locale plus enough provenance for downstream consumers.

    ``locale`` is always a member of :data:`SUPPORTED_LOCALES`. ``source``
    names which precedence step produced the selection. The remaining
    fields are kept for telemetry/debug and for handlers that want to know
    why a particular locale was chosen (e.g. for AI prompt routing).
    """

    locale: str
    source: LocaleSource
    user_preference_raw: Optional[str] = None
    user_preference_normalized: Optional[str] = None
    accept_language: Optional[str] = None
    header_pick: Optional[str] = None
    default: str = DEFAULT_LOCALE

    def to_dict(self) -> dict:
        """Serialize for inclusion in WebSocket payloads or HTTP responses."""
        return {
            "locale": self.locale,
            "source": self.source,
            "user_preference": self.user_preference_normalized,
            "accept_language": self.accept_language,
            "default": self.default,
        }


def build_locale_context(
    *,
    user_preference: Optional[str] = None,
    accept_language: Optional[str] = None,
    default: str = DEFAULT_LOCALE,
) -> LocaleContext:
    """Resolve a :class:`LocaleContext` using the documented precedence chain.

    Precedence: validated ``user_preference`` > ``Accept-Language`` header >
    ``default``. ``default`` is itself validated; an unsupported default is
    replaced with :data:`DEFAULT_LOCALE` so the result is always usable.
    """
    pref_normalized = normalize_locale(user_preference)
    pref_raw = user_preference if isinstance(user_preference, str) else None

    if pref_normalized and pref_normalized in SUPPORTED_LOCALES:
        return LocaleContext(
            locale=pref_normalized,
            source="user_preference",
            user_preference_raw=pref_raw,
            user_preference_normalized=pref_normalized,
            accept_language=accept_language,
            header_pick=None,
            default=default if default in SUPPORTED_LOCALES else DEFAULT_LOCALE,
        )

    header_pick = resolve_locale_from_accept_language(accept_language)
    if header_pick:
        return LocaleContext(
            locale=header_pick,
            source="header",
            user_preference_raw=pref_raw,
            user_preference_normalized=pref_normalized,
            accept_language=accept_language,
            header_pick=header_pick,
            default=default if default in SUPPORTED_LOCALES else DEFAULT_LOCALE,
        )

    safe_default = default if default in SUPPORTED_LOCALES else DEFAULT_LOCALE
    return LocaleContext(
        locale=safe_default,
        source="default",
        user_preference_raw=pref_raw,
        user_preference_normalized=pref_normalized,
        accept_language=accept_language,
        header_pick=None,
        default=safe_default,
    )


__all__ = [
    "DEFAULT_LOCALE",
    "LocaleContext",
    "LocaleSource",
    "SUPPORTED_LOCALES",
    "build_locale_context",
    "normalize_locale",
    "parse_accept_language",
    "resolve_locale",
    "resolve_locale_from_accept_language",
    "sanitize_preference_locale",
]
