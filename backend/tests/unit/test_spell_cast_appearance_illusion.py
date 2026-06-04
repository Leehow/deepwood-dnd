"""Regression coverage for `_apply_cast_appearance_illusion`.

Chrome QA 2026-05-28 reported that selecting a generated/gallery image for
易容术 (Disguise Self) crashed the backend with
`NameError: name 'normalize_token_disguise_data' is not defined`, so the
chosen image never reached `token.disguise_data`. The fix imports
`normalize_token_disguise_data` from `runtime_schema_service`; this test
pins the happy path so a future drop of that import fails loudly.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import app.api.routes.spell_cast as spell_cast
from app.api.routes.spell_cast import SpellCastRequest, _apply_cast_appearance_illusion


DISGUISE_SELF_SPELL_DATA = {
    "id": "disguise_self",
    "name": "易容术",
    "level": 1,
    "school": "illusion",
    # `spell_has_illusion_subtype` reads `illusion.subtype` on the spell
    # payload — keep this in sync with rules data shape.
    "illusion": {"subtype": "appearance"},
}


def _make_req(target_token_ids: list[int], image_url: str | None) -> SpellCastRequest:
    return SpellCastRequest(
        spell_id="disguise_self",
        slot_level=1,
        caster_token_id=527,
        target_token_ids=target_token_ids,
        campaign_id=8,
        illusion_data={"image_url": image_url, "description": "A hooded traveller"},
    )


@pytest.mark.asyncio
async def test_apply_cast_appearance_illusion_persists_disguise_data(monkeypatch):
    target_token = SimpleNamespace(id=527, disguise_data=None)

    async def fake_db_get(model, key):
        if key == 527:
            return target_token
        raise AssertionError(f"Unexpected db.get for {model} {key}")

    db = SimpleNamespace(get=fake_db_get)
    # `flag_modified` requires a real SQLAlchemy instance state; stub it out
    # so the pure logic can be exercised against a SimpleNamespace target.
    monkeypatch.setattr(spell_cast, "flag_modified", lambda *_a, **_k: None)

    image_url = "https://oss.example.com/generated/disguise-1234.png"
    touched = await _apply_cast_appearance_illusion(
        db,
        spell_data=DISGUISE_SELF_SPELL_DATA,
        req=_make_req([527], image_url),
        caster_name="艾尔莎",
        caster_character_id=42,
        target_token_ids=[527],
    )

    assert touched == [527]
    assert target_token.disguise_data is not None
    assert target_token.disguise_data["disguise_avatar"] == image_url
    assert target_token.disguise_data["spell_id"] == "disguise_self"
    assert target_token.disguise_data["spell_name"] == "易容术"
    assert target_token.disguise_data["caster_character_id"] == 42
    assert target_token.disguise_data["caster_name"] == "艾尔莎"
    assert target_token.disguise_data["description"] == "A hooded traveller"
    assert "started_at" in target_token.disguise_data


@pytest.mark.asyncio
async def test_apply_cast_appearance_illusion_skips_without_image_url():
    db = SimpleNamespace(get=AsyncMock(side_effect=AssertionError("db.get should not be reached")))

    touched = await _apply_cast_appearance_illusion(
        db,
        spell_data=DISGUISE_SELF_SPELL_DATA,
        req=_make_req([527], image_url=None),
        caster_name="艾尔莎",
        caster_character_id=42,
        target_token_ids=[527],
    )

    assert touched == []


@pytest.mark.asyncio
async def test_apply_cast_appearance_illusion_skips_non_appearance_spell():
    db = SimpleNamespace(get=AsyncMock(side_effect=AssertionError("db.get should not be reached")))

    touched = await _apply_cast_appearance_illusion(
        db,
        spell_data={"id": "fireball", "name": "火球术", "level": 3, "school": "evocation"},
        req=_make_req([527], image_url="https://oss.example.com/x.png"),
        caster_name="艾尔莎",
        caster_character_id=42,
        target_token_ids=[527],
    )

    assert touched == []
