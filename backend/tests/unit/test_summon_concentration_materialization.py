"""Unit tests for `_materialize_summon_for_concentration`.

The non-combat empty-ground area path goes through
`set_token_concentration` only — never through `/api/spells/cast` — so
this helper must (a) read spawn_summon leaves from the spell rules,
(b) drop a spawn_summon active_effect on the caster, (c) create
linked summon item tokens at the chosen area point, and (d) populate
`linked_token_ids` so cleanup works. It must also be idempotent for
duration edits that already carry linked_token_ids.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import pytest

from app.api.routes.tokens import (
    _find_spawn_summon_leaves,
    _materialize_summon_for_concentration,
    _resolve_summon_hp,
)


class _FakeDB:
    """Minimal AsyncSession stand-in that records added Tokens."""

    def __init__(self) -> None:
        self.added: list[Any] = []
        self._next_id = 100

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    async def flush(self) -> None:  # noqa: D401 - matches AsyncSession.flush
        for obj in self.added:
            if getattr(obj, "id", None) is None:
                obj.id = self._next_id
                self._next_id += 1


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


def _patch_flag_modified():
    return patch("app.api.routes.tokens.flag_modified")


def _run(coro):
    # asyncio.run() creates a fresh loop per call — robust under Python 3.13, where
    # asyncio.get_event_loop() raises once an earlier suite test closes the main loop.
    return asyncio.run(coro)


# ── pure helper tests ───────────────────────────────────────────────


def test_find_spawn_summon_leaves_finds_nested_leaf():
    spell = {
        "effects": [
            {"trigger": "on_cast", "target": {"type": "multiple"},
             "effects": [{"type": "narrative"}]},
            {"trigger": "on_cast", "target": {"type": "self"},
             "effects": [{"type": "spawn_summon", "instanceName": "野兽",
                          "faction": "player"}]},
        ]
    }
    leaves = _find_spawn_summon_leaves(spell)
    assert len(leaves) == 1
    assert leaves[0]["instanceName"] == "野兽"


def test_find_spawn_summon_leaves_handles_missing_and_bad_input():
    assert _find_spawn_summon_leaves(None) == []
    assert _find_spawn_summon_leaves({}) == []
    assert _find_spawn_summon_leaves({"effects": [None, 1, "x"]}) == []
    spell = {"effects": [{"effects": [{"type": "damage"}, {"type": "spawn_summon"}]}]}
    assert len(_find_spawn_summon_leaves(spell)) == 1


def test_resolve_summon_hp_only_pure_numeric():
    assert _resolve_summon_hp(None) is None
    assert _resolve_summon_hp(13) == 13
    assert _resolve_summon_hp("13") == 13
    assert _resolve_summon_hp("2d8+4") is None
    assert _resolve_summon_hp("  42 ") == 42


# ── integration tests around `set_token_concentration` core helper ──


_CONJURE_ANIMALS = {
    "name": "召唤动物",
    "effects": [
        {"trigger": "on_cast", "target": {"type": "self"},
         "effects": [{"type": "spawn_summon", "instanceName": "野兽",
                      "faction": "player"}]},
    ],
}

_HEALING_WORD = {  # control: no spawn_summon
    "name": "治疗术",
    "effects": [
        {"trigger": "on_cast", "target": {"type": "single"},
         "effects": [{"type": "heal", "formula": "1d4"}]},
    ],
}


def test_materialize_creates_token_and_self_effect():
    caster = _make_caster()
    db = _FakeDB()
    conc_data: dict[str, Any] = {
        "spell_id": "conjure_animals",
        "spell_name": "召唤动物",
        "area_effect": {
            "shape": "sphere", "center_x": 24, "center_y": 40,
            "radius": 5, "map_url": "maps/battle.png",
        },
    }

    with patch("app.api.routes.tokens.get_spell_by_id", return_value=_CONJURE_ANIMALS), \
         _patch_flag_modified():
        created = _run(
            _materialize_summon_for_concentration(
                db, caster_token=caster, conc_data=conc_data,
            )
        )

    assert len(created) == 1
    new_token = created[0]
    assert new_token.id is not None
    assert new_token.campaign_id == 42
    assert new_token.map_url == "maps/battle.png"
    assert new_token.position_x == 24 and new_token.position_y == 40
    assert new_token.faction == "player"
    assert new_token.item_data["type"] == "summon"
    assert new_token.item_data["caster_token_id"] == 527
    assert new_token.item_data["spell_id"] == "conjure_animals"

    assert conc_data["linked_token_ids"] == [new_token.id]
    assert caster.active_effects is not None
    summon_effects = [e for e in caster.active_effects if e.get("effect_type") == "spawn_summon"]
    assert len(summon_effects) == 1
    summon = summon_effects[0]
    assert summon["id"] == "conjure_animals_summon"
    assert summon["spell_id"] == "conjure_animals"
    assert summon["is_concentration"] is True
    assert summon["source_token_id"] == 527


def test_materialize_idempotent_when_linked_token_ids_present():
    caster = _make_caster(active_effects=[{"id": "x", "effect_type": "modifier"}])
    db = _FakeDB()
    conc_data = {
        "spell_id": "conjure_animals",
        "area_effect": {
            "shape": "sphere", "center_x": 1, "center_y": 1, "radius": 5,
            "map_url": "maps/battle.png",
        },
        "linked_token_ids": [555],
    }

    with patch("app.api.routes.tokens.get_spell_by_id", return_value=_CONJURE_ANIMALS), \
         _patch_flag_modified():
        created = _run(
            _materialize_summon_for_concentration(
                db, caster_token=caster, conc_data=conc_data,
            )
        )

    assert created == []
    assert db.added == []
    assert conc_data["linked_token_ids"] == [555]
    assert caster.active_effects == [{"id": "x", "effect_type": "modifier"}]


def test_materialize_noop_for_non_summon_spell():
    caster = _make_caster()
    db = _FakeDB()
    conc_data = {
        "spell_id": "healing_word",
        "area_effect": {
            "shape": "sphere", "center_x": 1, "center_y": 1, "radius": 5,
            "map_url": "maps/battle.png",
        },
    }
    with patch("app.api.routes.tokens.get_spell_by_id", return_value=_HEALING_WORD), \
         _patch_flag_modified():
        created = _run(
            _materialize_summon_for_concentration(
                db, caster_token=caster, conc_data=conc_data,
            )
        )
    assert created == []
    assert db.added == []
    assert "linked_token_ids" not in conc_data
    assert caster.active_effects is None


def test_materialize_noop_without_area_effect():
    caster = _make_caster()
    db = _FakeDB()
    conc_data = {"spell_id": "conjure_animals"}
    with patch("app.api.routes.tokens.get_spell_by_id", return_value=_CONJURE_ANIMALS), \
         _patch_flag_modified():
        created = _run(
            _materialize_summon_for_concentration(
                db, caster_token=caster, conc_data=conc_data,
            )
        )
    assert created == []
    assert "linked_token_ids" not in conc_data


def test_materialize_respects_count_and_offsets_around_center():
    caster = _make_caster()
    db = _FakeDB()
    spell = {
        "name": "召唤大军",
        "effects": [
            {"trigger": "on_cast", "target": {"type": "self"}, "effects": [
                {"type": "spawn_summon", "instanceName": "骷髅", "count": 3,
                 "hpFormula": "13", "monsterId": "skeleton",
                 "tokenSize": "1x1", "faction": "neutral"},
            ]},
        ],
    }
    conc_data = {
        "spell_id": "animate_skeletons",
        "area_effect": {
            "shape": "sphere", "center_x": 10, "center_y": 10, "radius": 5,
            "map_url": "maps/battle.png",
        },
    }
    with patch("app.api.routes.tokens.get_spell_by_id", return_value=spell), \
         _patch_flag_modified():
        created = _run(
            _materialize_summon_for_concentration(
                db, caster_token=caster, conc_data=conc_data,
            )
        )

    assert len(created) == 3
    assert {t.faction for t in created} == {"neutral"}
    # Distinct cells
    positions = {(t.position_x, t.position_y) for t in created}
    assert (10, 10) in positions
    assert len(positions) == 3
    # HP from numeric formula
    assert {t.current_hp for t in created} == {13}
    # Linked ids match created ids in order
    assert conc_data["linked_token_ids"] == [t.id for t in created]
    # Single caster-side spawn_summon entry regardless of count
    summon_effects = [e for e in caster.active_effects if e.get("effect_type") == "spawn_summon"]
    assert len(summon_effects) == 1
    assert summon_effects[0]["count"] == 3
    assert summon_effects[0]["monster_id"] == "skeleton"
    assert summon_effects[0]["faction"] == "neutral"


def test_materialize_falls_back_to_caster_map_url():
    caster = _make_caster(map_url="maps/cavern.png")
    db = _FakeDB()
    conc_data = {
        "spell_id": "conjure_animals",
        # area_effect without map_url
        "area_effect": {"shape": "sphere", "center_x": 5, "center_y": 6, "radius": 5},
    }
    with patch("app.api.routes.tokens.get_spell_by_id", return_value=_CONJURE_ANIMALS), \
         _patch_flag_modified():
        created = _run(
            _materialize_summon_for_concentration(
                db, caster_token=caster, conc_data=conc_data,
            )
        )
    assert len(created) == 1
    assert created[0].map_url == "maps/cavern.png"
