"""Unit tests for ``app.services.combat_legacy_ongoing_effect_service``.

The legacy ongoing executor closes the gap left by the v2 SpellRuntimeInstance
dispatcher: it runs ``Token.active_effects`` entries that carry an
``ongoing_trigger`` such as Heroism's ``start_of_target_turn`` +
``grant_temp_hp``. The tests below pin down the matcher rules and the
end-to-end behaviour for the Heroism case using lightweight in-memory fakes —
no real SQLAlchemy session or websocket manager is required.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

import pytest

from app.services import combat_legacy_ongoing_effect_service as legacy


# ── _matching_effects ────────────────────────────────────────────────────────


def test_matching_effects_filters_by_trigger():
    entries = [
        {"ongoing_trigger": "start_of_target_turn", "ongoing_effects": [{"type": "x"}]},
        {"ongoing_trigger": "end_of_target_turn", "ongoing_effects": [{"type": "x"}]},
    ]
    starts = legacy._matching_effects(entries, legacy._START_TRIGGERS)
    ends = legacy._matching_effects(entries, legacy._END_TRIGGERS)
    assert [e["ongoing_trigger"] for e in starts] == ["start_of_target_turn"]
    assert [e["ongoing_trigger"] for e in ends] == ["end_of_target_turn"]


def test_matching_effects_skips_save_gated_entries():
    """Entries with ``ongoing_save`` are owned by /combat/batch-ongoing-saves;
    re-running them here would double-fire and bypass the save roll."""
    entries = [
        {
            "ongoing_trigger": "start_of_target_turn",
            "ongoing_effects": [{"type": "deal_damage", "formula": "1d6"}],
            "ongoing_save": {"ability": "con", "dc": 10, "timing": "start_of_target_turn"},
        }
    ]
    assert legacy._matching_effects(entries, legacy._START_TRIGGERS) == []


def test_matching_effects_skips_empty_or_missing_effect_arrays():
    entries = [
        {"ongoing_trigger": "start_of_target_turn"},
        {"ongoing_trigger": "start_of_target_turn", "ongoing_effects": []},
        {"ongoing_trigger": "start_of_target_turn", "ongoing_effects": None},
        "not a dict",
    ]
    assert legacy._matching_effects(entries, legacy._START_TRIGGERS) == []


def test_matching_effects_handles_none_and_non_list():
    assert legacy._matching_effects(None, legacy._START_TRIGGERS) == []
    assert legacy._matching_effects({"x": 1}, legacy._START_TRIGGERS) == []


# ── End-to-end: Heroism grant_temp_hp ────────────────────────────────────────


class _FakeToken:
    """Just enough of app.models.token.Token for the service + handler."""

    def __init__(
        self,
        token_id: int,
        *,
        campaign_id: int,
        instance_name: str = "",
        character_id: Optional[int] = None,
        monster_instance_id: Optional[int] = None,
        current_hp: Optional[int] = None,
        temp_hp: Optional[int] = None,
        active_effects: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        self.id = token_id
        self.campaign_id = campaign_id
        self.instance_name = instance_name
        self.character_id = character_id
        self.monster_instance_id = monster_instance_id
        self.current_hp = current_hp
        # Intentionally NOT defining max_hp — the real Token model
        # (backend/app/models/token.py) has no max_hp column, and the service
        # must cope via getattr(token, "max_hp", None). Adding it here would
        # mask a regression that would crash in Chrome but not in tests.
        self.temp_hp = temp_hp
        self.active_effects = active_effects or []


class _FakeCharacter:
    def __init__(
        self,
        char_id: int,
        *,
        name: str,
        level: int,
        class_id: str,
        ability_scores: Dict[str, int],
    ) -> None:
        self.id = char_id
        self.name = name
        self.level = level
        self.class_id = class_id
        self.subclass_id = None
        self.ability_scores = ability_scores


class _FakeDB:
    """Routes db.get(Model, id) lookups to in-memory dicts."""

    def __init__(self, tokens: Dict[int, _FakeToken], characters: Dict[int, _FakeCharacter]):
        self._tokens = tokens
        self._characters = characters
        self.commits = 0
        self.flushes = 0

    async def get(self, model, pk):
        from app.models.character import Character
        from app.models.token import Token

        if model is Token:
            return self._tokens.get(int(pk))
        if model is Character:
            return self._characters.get(int(pk))
        return None

    async def flush(self):
        self.flushes += 1

    async def commit(self):
        self.commits += 1


@pytest.fixture(autouse=True)
def _stub_publisher_and_flag_modified(monkeypatch):
    """Replace flag_modified + realtime_publisher so tests don't touch
    SQLAlchemy internals or open WebSocket connections."""

    monkeypatch.setattr(legacy, "flag_modified", lambda *a, **kw: None)

    published: list[tuple[str, dict]] = []

    class _Pub:
        async def publish_token_hp_updated(self, campaign_id, **payload):
            published.append(("hp", {"campaign_id": campaign_id, **payload}))

        async def publish_token_active_effects_updated(self, campaign_id, **payload):
            published.append(("effects", {"campaign_id": campaign_id, **payload}))

    import app.services.realtime_publisher as rp

    monkeypatch.setattr(rp, "realtime_publisher", _Pub())
    return published


def _build_heroism_world():
    """Return (db, caster_token, target_token) with Heroism's ongoing entry
    already attached to the target — mimicking the QA scenario."""
    caster_char = _FakeCharacter(
        char_id=1,
        name="Aelar",
        level=5,  # PB +3
        class_id="paladin",  # CHA caster
        ability_scores={"charisma": 18},  # MOD +4
    )
    caster_token = _FakeToken(
        token_id=527,
        campaign_id=8,
        instance_name="Aelar",
        character_id=caster_char.id,
    )
    target_token = _FakeToken(
        token_id=533,
        campaign_id=8,
        instance_name="Bertha",
        current_hp=20,
        temp_hp=0,
        active_effects=[
            {
                "id": "heroism_ongoing",
                "name": "英雄气概",
                "source": "英雄气概",
                "spell_id": "heroism",
                "sourceSpell": "heroism",
                "is_concentration": True,
                "ongoing_trigger": "start_of_target_turn",
                "ongoing_effects": [{"type": "grant_temp_hp", "formula": "MOD"}],
                "source_token_id": caster_token.id,
                "sourceTokenId": caster_token.id,
                "cast_level": 1,
            }
        ],
    )
    db = _FakeDB(
        tokens={caster_token.id: caster_token, target_token.id: target_token},
        characters={caster_char.id: caster_char},
    )
    return db, caster_token, target_token


def test_fake_token_matches_real_token_shape():
    """Regression guard: the real Token model has no ``max_hp`` column. If a
    future test author adds it to the fake, the Heroism path would silently
    keep passing here while crashing in Chrome with AttributeError. Pin the
    contract by asserting the fake lacks the attribute."""
    tok = _FakeToken(token_id=1, campaign_id=1)
    assert not hasattr(tok, "max_hp")


def test_heroism_grants_temp_hp_when_target_turn_starts(_stub_publisher_and_flag_modified):
    db, caster_token, target_token = _build_heroism_world()

    result = asyncio.run(
        legacy.execute_legacy_turn_ongoing_effects(
            db,
            campaign_id=8,
            ending_token_id=None,
            starting_token_id=target_token.id,
        )
    )

    # Caster's CHA mod is +4 → temp HP should be set to 4 (was 0).
    assert target_token.temp_hp == 4
    assert result == {"ending_fired": False, "starting_fired": True}
    assert db.commits == 1
    # The HP/temp_hp publisher must have fired so the browser refreshes.
    kinds = [k for k, _ in _stub_publisher_and_flag_modified]
    assert "hp" in kinds


def test_heroism_does_not_fire_for_unrelated_starting_token(
    _stub_publisher_and_flag_modified,
):
    """If a different token (not the one carrying the effect) starts its turn,
    the legacy executor must do nothing."""
    db, caster_token, target_token = _build_heroism_world()

    # Spin up a third token that has no ongoing entries.
    bystander = _FakeToken(token_id=999, campaign_id=8, temp_hp=0)
    db._tokens[bystander.id] = bystander

    result = asyncio.run(
        legacy.execute_legacy_turn_ongoing_effects(
            db,
            campaign_id=8,
            ending_token_id=None,
            starting_token_id=bystander.id,
        )
    )

    assert target_token.temp_hp == 0
    assert bystander.temp_hp == 0
    assert result == {"ending_fired": False, "starting_fired": False}
    assert db.commits == 0
    assert _stub_publisher_and_flag_modified == []


def test_heroism_does_not_fire_on_end_of_target_turn(_stub_publisher_and_flag_modified):
    """The Heroism entry is keyed on ``start_of_target_turn``; it must not
    also fire when the same token's turn ends."""
    db, _caster, target_token = _build_heroism_world()

    result = asyncio.run(
        legacy.execute_legacy_turn_ongoing_effects(
            db,
            campaign_id=8,
            ending_token_id=target_token.id,
            starting_token_id=None,
        )
    )

    assert target_token.temp_hp == 0
    assert result == {"ending_fired": False, "starting_fired": False}


def test_temp_hp_uses_caster_modifier_not_target_modifier(
    _stub_publisher_and_flag_modified,
):
    """The ``MOD`` formula variable must resolve to the *caster's*
    spellcasting modifier, not the target's. This is the load-bearing
    correctness property of the whole fix."""
    db, caster_token, target_token = _build_heroism_world()

    # Add a different character backing the target with a huge MOD (+5). If
    # the service mistakenly rebuilt the SpellContext from the target, temp
    # HP would come out as 5 instead of 4.
    target_char = _FakeCharacter(
        char_id=42,
        name="Bertha",
        level=20,
        class_id="wizard",
        ability_scores={"intelligence": 20},  # MOD +5
    )
    target_token.character_id = target_char.id
    db._characters[target_char.id] = target_char

    asyncio.run(
        legacy.execute_legacy_turn_ongoing_effects(
            db,
            campaign_id=8,
            ending_token_id=None,
            starting_token_id=target_token.id,
        )
    )

    assert target_token.temp_hp == 4  # caster's CHA mod, not target's INT mod


def test_save_gated_effects_remain_untouched_for_non_save_path(
    _stub_publisher_and_flag_modified,
):
    """A token carrying both a save-gated entry and a plain ongoing entry:
    only the plain one should fire here; the save-gated one stays for the
    /combat/batch-ongoing-saves endpoint."""
    db, caster_token, target_token = _build_heroism_world()

    target_token.active_effects.append(
        {
            "id": "fake_save_dot",
            "spell_id": "made_up",
            "ongoing_trigger": "start_of_target_turn",
            "ongoing_effects": [{"type": "deal_damage", "formula": "10"}],
            "ongoing_save": {"ability": "con", "dc": 12, "timing": "start_of_target_turn"},
            "source_token_id": caster_token.id,
        }
    )

    asyncio.run(
        legacy.execute_legacy_turn_ongoing_effects(
            db,
            campaign_id=8,
            ending_token_id=None,
            starting_token_id=target_token.id,
        )
    )

    # Heroism fired → temp_hp 4. The save-gated DoT was skipped → no HP loss.
    assert target_token.temp_hp == 4
    assert target_token.current_hp == 20
