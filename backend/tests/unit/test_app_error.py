"""Unit tests for :mod:`app.core.errors`."""

from __future__ import annotations

import json

import pytest
from fastapi import FastAPI, status
from fastapi.testclient import TestClient

from app.core.errors import AppError, app_error_handler


def test_app_error_basic_fields() -> None:
    err = AppError(
        "character.equipment.slot_occupied",
        message="Slot is already occupied",
        params={"slot": "main_hand", "item_id": 42},
        status_code=409,
    )
    assert err.code == "character.equipment.slot_occupied"
    assert err.params == {"slot": "main_hand", "item_id": 42}
    assert err.status_code == 409
    assert err.message == "Slot is already occupied"
    # Aliases
    assert err.default_message == "Slot is already occupied"
    assert err.detail == "Slot is already occupied"


def test_app_error_defaults_status_and_params() -> None:
    err = AppError("auth.forbidden", message="Forbidden")
    assert err.status_code == status.HTTP_400_BAD_REQUEST
    assert err.params == {}


def test_app_error_params_are_copied() -> None:
    raw = {"slot": "main_hand"}
    err = AppError("x.y", message="m", params=raw)
    raw["slot"] = "off_hand"
    assert err.params == {"slot": "main_hand"}


def test_app_error_rejects_empty_code() -> None:
    with pytest.raises(ValueError):
        AppError("", message="oops")


def test_app_error_rejects_empty_message() -> None:
    with pytest.raises(ValueError):
        AppError("a.b", message="")


def test_app_error_envelope_shape() -> None:
    err = AppError(
        "combat.not_in_combat",
        message="Not currently in combat",
        params={"campaign_id": 7},
        status_code=409,
    )
    assert err.to_envelope() == {
        "error": {
            "code": "combat.not_in_combat",
            "params": {"campaign_id": 7},
            "message": "Not currently in combat",
        }
    }


def test_app_error_handler_returns_envelope_with_status() -> None:
    app = FastAPI()
    app.add_exception_handler(AppError, app_error_handler)

    @app.get("/boom")
    async def _boom() -> dict:
        raise AppError(
            "rules_chat.campaign_not_found",
            message="Campaign not found",
            params={"campaign_id": 99},
            status_code=404,
        )

    client = TestClient(app, raise_server_exceptions=False)
    response = client.get("/boom")
    assert response.status_code == 404
    body = json.loads(response.text)
    assert body == {
        "error": {
            "code": "rules_chat.campaign_not_found",
            "params": {"campaign_id": 99},
            "message": "Campaign not found",
        }
    }
