"""Unit tests for `_materialize_grant_sense_for_concentration`.

Detect Magic and similar self-centered area concentration spells reach the
backend via `POST /api/tokens/{id}/concentration` only — never through
`/api/spells/cast` — so `GrantSenseHandler` never fires. This helper must
persist a caster-side `grant_sense` active_effect that mirrors the handler's
output shape (id `<spell_id>_sense`, effect_type `grant_sense`, sense_type,
range, source_token_id, spell_id, is_concentration). It must be idempotent
across repeated calls for the same spell, must do nothing for spells without
a grant_sense leaf, and must leave `active_effects` untouched in that case.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

from app.api.routes.tokens import (
    _find_grant_sense_leaves,
    _materialize_grant_sense_for_concentration,
)


def _run(coro):
    # asyncio.run() creates a fresh loop per call — robust under Python 3.13, where
    # asyncio.get_event_loop() raises once an earlier suite test closes the main loop.
    return asyncio.run(coro)


def _patch_flag_modified():
    return patch("app.api.routes.tokens.flag_modified")


def _make_caster(**overrides: Any):
    base = dict(
        id=527,
        campaign_id=42,
        map_url="maps/battle.png",
        user_id="alice",
        active_effects=None,
        concentration_spell=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


_DETECT_MAGIC = {
    "name": "侦测魔法",
    "effects": [
        {
            "trigger": "on_cast",
            "target": {"type": "self"},
            "effects": [
                {"type": "narrative", "description": "..."},
                {"type": "create_zone_visual", "zoneType": "other"},
            ],
        },
        {
            "trigger": "on_cast",
            "target": {"type": "single"},
            "effects": [
                {"type": "grant_sense", "senseType": "detect_magic", "range": 30},
            ],
        },
    ],
}

_HEALING_WORD = {
    "name": "治疗术",
    "effects": [
        {"trigger": "on_cast", "target": {"type": "single"},
         "effects": [{"type": "heal", "formula": "1d4"}]},
    ],
}


# ── pure helper tests ───────────────────────────────────────────────


def test_find_grant_sense_leaves_finds_nested_leaf():
    leaves = _find_grant_sense_leaves(_DETECT_MAGIC)
    assert len(leaves) == 1
    assert leaves[0]["senseType"] == "detect_magic"
    assert leaves[0]["range"] == 30


def test_find_grant_sense_leaves_handles_missing_and_bad_input():
    assert _find_grant_sense_leaves(None) == []
    assert _find_grant_sense_leaves({}) == []
    assert _find_grant_sense_leaves({"effects": [None, 1, "x"]}) == []
    # Non-on_cast triggers are skipped — handler is on-cast only.
    spell = {
        "effects": [
            {"trigger": "on_turn_start", "effects": [
                {"type": "grant_sense", "senseType": "truesight"}]},
        ]
    }
    assert _find_grant_sense_leaves(spell) == []
    # Untriggered phases (no trigger key) are still searched for backwards
    # compatibility with rules entries that omit it.
    spell2 = {"effects": [{"effects": [{"type": "grant_sense", "senseType": "blindsight"}]}]}
    assert len(_find_grant_sense_leaves(spell2)) == 1


# ── integration tests ──


def test_materialize_writes_grant_sense_entry_on_caster():
    caster = _make_caster()

    with patch("app.api.routes.tokens.get_spell_by_id", return_value=_DETECT_MAGIC), \
         _patch_flag_modified():
        written = _run(
            _materialize_grant_sense_for_concentration(
                db=None,
                caster_token=caster,
                conc_data={"spell_id": "detect_magic", "spell_name": "侦测魔法"},
            )
        )

    assert len(written) == 1
    entry = written[0]
    assert entry["id"] == "detect_magic_sense"
    assert entry["effect_type"] == "grant_sense"
    assert entry["sense_type"] == "detect_magic"
    assert entry["range"] == 30
    assert entry["source_token_id"] == 527
    assert entry["spell_id"] == "detect_magic"
    assert entry["is_concentration"] is True
    assert entry["source"] == "侦测魔法"
    assert entry["name"] == "侦测魔法"

    assert caster.active_effects == [entry]


def test_materialize_idempotent_for_repeated_calls():
    caster = _make_caster()
    conc_data = {"spell_id": "detect_magic"}

    with patch("app.api.routes.tokens.get_spell_by_id", return_value=_DETECT_MAGIC), \
         _patch_flag_modified():
        _run(_materialize_grant_sense_for_concentration(
            db=None, caster_token=caster, conc_data=conc_data,
        ))
        _run(_materialize_grant_sense_for_concentration(
            db=None, caster_token=caster, conc_data=conc_data,
        ))

    sense_entries = [
        e for e in (caster.active_effects or [])
        if e.get("id") == "detect_magic_sense"
    ]
    assert len(sense_entries) == 1


def test_materialize_preserves_unrelated_active_effects():
    caster = _make_caster(active_effects=[
        {"id": "blessing", "effect_type": "modifier"},
    ])

    with patch("app.api.routes.tokens.get_spell_by_id", return_value=_DETECT_MAGIC), \
         _patch_flag_modified():
        _run(_materialize_grant_sense_for_concentration(
            db=None,
            caster_token=caster,
            conc_data={"spell_id": "detect_magic"},
        ))

    ids = {e["id"] for e in caster.active_effects}
    assert ids == {"blessing", "detect_magic_sense"}


def test_materialize_noop_for_spell_without_grant_sense():
    caster = _make_caster(active_effects=[{"id": "x", "effect_type": "modifier"}])

    with patch("app.api.routes.tokens.get_spell_by_id", return_value=_HEALING_WORD), \
         _patch_flag_modified():
        written = _run(_materialize_grant_sense_for_concentration(
            db=None,
            caster_token=caster,
            conc_data={"spell_id": "healing_word"},
        ))

    assert written == []
    assert caster.active_effects == [{"id": "x", "effect_type": "modifier"}]


def test_materialize_noop_without_spell_id():
    caster = _make_caster()
    written = _run(_materialize_grant_sense_for_concentration(
        db=None, caster_token=caster, conc_data={},
    ))
    assert written == []
    assert caster.active_effects is None


def test_materialize_skips_leaf_without_sense_type():
    caster = _make_caster()
    spell = {
        "name": "Broken Sense",
        "effects": [
            {"trigger": "on_cast", "target": {"type": "self"}, "effects": [
                {"type": "grant_sense"},  # missing senseType
            ]},
        ],
    }

    with patch("app.api.routes.tokens.get_spell_by_id", return_value=spell), \
         _patch_flag_modified():
        written = _run(_materialize_grant_sense_for_concentration(
            db=None,
            caster_token=caster,
            conc_data={"spell_id": "broken_sense"},
        ))

    assert written == []
    assert caster.active_effects is None


def test_materialize_omits_range_when_missing():
    caster = _make_caster()
    spell = {
        "name": "Truesight Self",
        "effects": [
            {"trigger": "on_cast", "target": {"type": "self"}, "effects": [
                {"type": "grant_sense", "senseType": "truesight"},
            ]},
        ],
    }

    with patch("app.api.routes.tokens.get_spell_by_id", return_value=spell), \
         _patch_flag_modified():
        written = _run(_materialize_grant_sense_for_concentration(
            db=None,
            caster_token=caster,
            conc_data={"spell_id": "truesight_self"},
        ))

    assert len(written) == 1
    assert "range" not in written[0]
    assert written[0]["sense_type"] == "truesight"
    assert written[0]["name"] == "真实视觉"
