"""Character rule registry for campaign-scoped option assembly."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from app.utils.rules_cache import get_backgrounds_data, get_classes_data, get_gods_data, get_races_data


BASE_RULE_PACKAGE_ID = "official.phb"
BASE_RULE_PACKAGE_NAME = "Official PHB Base Rules"
BASE_RULE_PACKAGE_VERSION = "phase0"


def _pick_name_en(payload: dict[str, Any]) -> str | None:
    return payload.get("nameEn") or payload.get("name_en")


def _normalize_reference_option(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": payload.get("id"),
        "name": payload.get("name"),
        "name_en": _pick_name_en(payload),
    }


def _normalize_class_option(payload: dict[str, Any]) -> dict[str, Any]:
    subclasses = [_normalize_reference_option(item) for item in payload.get("subclasses", [])]
    return {
        "id": payload.get("id"),
        "name": payload.get("name"),
        "name_en": _pick_name_en(payload),
        "source_package_id": BASE_RULE_PACKAGE_ID,
        "subclass_count": len(subclasses),
        "subclasses": subclasses,
    }


def _normalize_race_option(payload: dict[str, Any]) -> dict[str, Any]:
    subraces = [_normalize_reference_option(item) for item in payload.get("subraces", [])]
    return {
        "id": payload.get("id"),
        "name": payload.get("name"),
        "name_en": _pick_name_en(payload),
        "source_package_id": BASE_RULE_PACKAGE_ID,
        "subrace_count": len(subraces),
        "subraces": subraces,
    }


def _normalize_background_option(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": payload.get("id"),
        "name": payload.get("name"),
        "name_en": _pick_name_en(payload),
        "source_package_id": BASE_RULE_PACKAGE_ID,
    }


def _normalize_deity_option(
    pantheon: dict[str, Any], deity_payload: dict[str, Any]
) -> dict[str, Any]:
    return {
        "id": deity_payload.get("id"),
        "name": deity_payload.get("name"),
        "name_en": _pick_name_en(deity_payload),
        "pantheon_id": pantheon.get("id"),
        "pantheon_name": pantheon.get("name"),
        "domains": deity_payload.get("domains", []),
        "source_package_id": BASE_RULE_PACKAGE_ID,
    }


@lru_cache(maxsize=1)
def _build_base_package() -> dict[str, Any]:
    classes = [_normalize_class_option(item) for item in get_classes_data().get("classes", [])]
    races = [_normalize_race_option(item) for item in get_races_data().get("races", [])]
    backgrounds = [_normalize_background_option(item) for item in get_backgrounds_data().get("backgrounds", [])]

    deities: list[dict[str, Any]] = []
    for pantheon in get_gods_data().get("pantheons", []):
        for deity_payload in pantheon.get("deities", []):
            deities.append(_normalize_deity_option(pantheon, deity_payload))

    return {
        "package": {
            "package_id": BASE_RULE_PACKAGE_ID,
            "name": BASE_RULE_PACKAGE_NAME,
            "version": BASE_RULE_PACKAGE_VERSION,
            "source": "builtin",
            "layer": "base",
            "implemented": True,
            "resource_counts": {
                "classes": len(classes),
                "races": len(races),
                "backgrounds": len(backgrounds),
                "deities": len(deities),
            },
        },
        "catalog": {
            "classes": classes,
            "races": races,
            "backgrounds": backgrounds,
            "deities": deities,
        },
    }


class CharacterRuleRegistry:
    """Registry that exposes normalized rule packages for character options."""

    base_package_id = BASE_RULE_PACKAGE_ID

    def get_base_package(self) -> dict[str, Any]:
        """Return the normalized built-in PHB package."""
        return _build_base_package()

    def get_supported_package_ids(self) -> list[str]:
        """Return package ids supported by the current phase."""
        return [self.base_package_id]
