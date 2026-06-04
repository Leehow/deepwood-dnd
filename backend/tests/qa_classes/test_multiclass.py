"""Representative multiclass tests + the multiclass HP seed bug.

Seed bug #1 (calculate_max_hp gives max hit die to EVERY class's first level instead
of only the very first character level) is pinned with a direct unit call, because it
is not surfaced by the sheet or any HTTP response. Tests assert CORRECT 5e behavior;
the one that currently fails is xfail(strict=True)."""
from types import SimpleNamespace

import pytest

from app.services.character_progression_service import calculate_max_hp
from tests.qa_classes import drivers, oracles, reference_tables as ref

pytestmark = [pytest.mark.asyncio]


# ---- API-level multiclass smoke + slot stacking ----

async def test_multiclass_adds_second_class_entry(qa_client, qa_headers, qa_user_id):
    created = await drivers.build_at_level(qa_client, qa_headers, qa_user_id, "fighter", level=1)
    oracles.assert_status_ok(created, "create fighter L1")
    resp = await drivers.level_up_once(qa_client, qa_headers, created.json()["id"], "wizard", {})
    oracles.assert_status_ok(resp, "fighter -> wizard multiclass")
    char = resp.json()
    ids = {c.get("class_id") for c in (char.get("multiclass_data") or {}).get("classes", [])}
    assert ids == {"fighter", "wizard"}, f"expected fighter+wizard, got {ids}"
    assert char["level"] == 2


async def test_multiclass_full_full_slot_stacking(qa_client, qa_headers, qa_user_id):
    # wizard 1 / cleric 1 -> combined caster level 2 -> FULL_CASTER_SLOTS[2]
    created = await drivers.build_at_level(qa_client, qa_headers, qa_user_id, "wizard", level=1)
    oracles.assert_status_ok(created, "create wizard L1")
    resp = await drivers.level_up_once(qa_client, qa_headers, created.json()["id"], "cleric", {})
    oracles.assert_status_ok(resp, "wizard -> cleric multiclass")
    slots = resp.json().get("spell_slots_state")
    # spell_slots_state may be a plain list or a dict {slots: [...], ...} when a pact class
    # is involved; here neither is a warlock, so expect the plain list form.
    expected = ref.FULL_CASTER_SLOTS[2]  # [0,3,0,0,0,0,0,0,0,0]
    actual = slots.get("slots") if isinstance(slots, dict) else slots
    assert list(actual or []) == expected, f"wizard1/cleric1 slots {actual} != {expected}"


# ---- seed bug #1: multiclass first-level HP (direct unit call) ----

def test_calculate_max_hp_multiclass_uses_5e_rule():
    # Regression guard for FIXED seed bug #1: calculate_max_hp now gives the max hit die
    # only to the very first character level; a multiclassed class's first level uses the
    # average. Fighter 1 / Wizard 1, con 10 (mod 0) → fighter1 max(10) + wizard1 avg(4) = 14.
    char = SimpleNamespace(
        ability_scores={"constitution": 10},
        multiclass_data={"classes": [{"class_id": "fighter", "level": 1},
                                       {"class_id": "wizard", "level": 1}]},
        level=2, class_id="fighter",
    )
    expected = ref.multiclass_max_hp([("fighter", 1), ("wizard", 1)], con_mod=0)  # 14
    assert calculate_max_hp(char) == expected


async def test_sheet_multiclass_hp_matches_5e(qa_client, qa_headers, qa_user_id):
    # Regression guard (FIXED): _compute_max_hp now delegates class HP to calculate_max_hp,
    # so the sheet reports correct multiclass HP. fighter 1 / wizard 1, con 0 → 14.
    created = await drivers.build_at_level(qa_client, qa_headers, qa_user_id, "fighter", level=1)
    oracles.assert_status_ok(created, "create fighter L1")
    mc = await drivers.level_up_once(qa_client, qa_headers, created.json()["id"], "wizard", {})
    oracles.assert_status_ok(mc, "fighter -> wizard multiclass")
    sheet = await drivers.get_sheet(qa_client, qa_headers, created.json()["id"])
    oracles.assert_status_ok(sheet, "sheet fighter1/wizard1")
    expected = ref.multiclass_max_hp([("fighter", 1), ("wizard", 1)], con_mod=0)  # 14
    actual = sheet.json()["character"]["hit_points_max"]
    assert actual == expected, f"sheet hit_points_max {actual} != multiclass 5e {expected}"
