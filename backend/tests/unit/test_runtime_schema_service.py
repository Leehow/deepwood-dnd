from __future__ import annotations

import pytest

from app.services.runtime_schema_service import (
    RuntimeSchemaValidationError,
    normalize_campaign_storage_data,
    normalize_character_class_feature_uses,
    normalize_token_active_effects,
)


def test_normalize_token_active_effects_keeps_known_shape():
    payload = [
        {
            "id": "grappled:22",
            "condition": "grappled",
            "duration": 10,
            "tokenFilter": {"scope": "self"},
        }
    ]

    normalized = normalize_token_active_effects(payload, strict=True)

    assert normalized == [
        {
            "id": "grappled:22",
            "condition": "grappled",
            "duration": 10,
            "tokenFilter": {"scope": "self"},
        }
    ]


def test_normalize_character_feature_uses_serializes_model_values():
    payload = {
        "channel_divinity_cleric": {
            "current": 1,
            "max": 2,
        }
    }

    normalized = normalize_character_class_feature_uses(payload, strict=True)

    assert normalized == {
        "channel_divinity_cleric": {
            "current": 1,
            "max": 2,
        }
    }


def test_normalize_campaign_storage_data_supports_existing_combat_payload_shape():
    payload = {
        "status": "in_progress",
        "order": [11, 22],
        "current_index": 0,
        "participants": [
            {"token_id": 11, "name": "战士", "initiative": 17},
            {"token_id": 22, "name": "食尸鬼", "initiative": 9},
        ],
        "round": 1,
    }

    normalized = normalize_campaign_storage_data(
        object_type="combat",
        data=payload,
        strict=True,
    )

    assert normalized["status"] == "in_progress"
    assert normalized["order"] == [11, 22]
    assert normalized["participants"][0]["token_id"] == 11


def test_normalize_token_active_effects_raises_in_strict_mode_for_bad_shape():
    with pytest.raises(RuntimeSchemaValidationError):
        normalize_token_active_effects({"id": "not-a-list"}, strict=True)
