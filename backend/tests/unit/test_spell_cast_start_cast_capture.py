"""Unit coverage for /api/spells/start-cast target/area capture.

Chrome QA 2026-05-28 confirmed that ritual long casts like Identify and Alarm
started `casting_in_progress` with `target_token_ids=[]` and no area metadata,
because the frontend short-circuited every long cast straight into
`startSpellCastViaAPI` before the picker ran. The frontend fix routes the
user through the normal target/area picker first; this test pins down the
backend half: `_build_casting_state` must keep both fields on the persisted
state when present, and the request schema must accept them.
"""
from app.api.routes.spell_cast import StartSpellCastRequest, _build_casting_state


def _make_req(**overrides):
    base = dict(
        spell_id="alarm",
        slot_level=1,
        caster_token_id=527,
        campaign_id=8,
        target_token_ids=[],
        freecast=False,
        ritual_cast=True,
        selected_option=None,
        material_id="component_pouch",
        confirm_break_concentration=False,
        area_effect=None,
    )
    base.update(overrides)
    return StartSpellCastRequest(**base)


def test_build_casting_state_persists_target_token_ids_for_ritual_touch_spell():
    req = _make_req(
        spell_id="identify",
        ritual_cast=True,
        material_id="pearl_100gp",
        target_token_ids=[534],
    )
    state = _build_casting_state(
        spell_data={"name": "鉴定术", "castingTime": "1 minute", "ritual": True},
        req=req,
        current_time={"day": 0, "hour": 0, "minute": 0, "second": 0},
        started_by_user_id="user-1",
    )

    assert state["spell_id"] == "identify"
    assert state["cast_mode"] == "ritual"
    assert state["target_token_ids"] == [534]
    assert state["material_id"] == "pearl_100gp"
    # Ritual spells should not store a stray empty area block when none was
    # supplied — keeps current ready-cast release semantics intact.
    assert "area_effect" not in state


def test_build_casting_state_persists_area_effect_for_ritual_area_spell():
    area_effect = {
        "shape": "cube",
        "center_x": 36,
        "center_y": 40,
        "radius": 20,
        "map_url": "/maps/test.png",
    }
    req = _make_req(area_effect=area_effect)
    state = _build_casting_state(
        spell_data={"name": "警报术", "castingTime": "1 minute", "ritual": True},
        req=req,
        current_time={"day": 0, "hour": 0, "minute": 0, "second": 0},
        started_by_user_id="user-1",
    )

    assert state["area_effect"] == area_effect
    assert state["cast_mode"] == "ritual"
    assert state["material_id"] == "component_pouch"
    assert state["target_token_ids"] == []


def test_start_spell_cast_request_defaults_area_effect_to_none():
    req = StartSpellCastRequest(
        spell_id="identify",
        slot_level=1,
        caster_token_id=527,
        campaign_id=8,
    )
    assert req.area_effect is None
    assert req.target_token_ids == []
