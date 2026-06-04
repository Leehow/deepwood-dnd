"""Regression tests for `_remove_control_effects_from_tokens` cleanup scoping.

Chrome QA on 2026-05-28 found that replacing concentration removed unrelated
non-concentration spell effects from the caster (e.g. False Life, Armor of
Agathys) when the caster was in the old concentration's `affected_token_ids`.

The root cause was an overly broad filter that removed any effect where
`source_token_id == caster_token_id`, regardless of which spell produced it.
This test pins the corrected behavior: only effects belonging to the ended
concentration spell are removed.
"""
from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest

import app.api.routes.tokens as token_routes
from app.api.routes.tokens import (
    _old_concentration_cleanup_token_ids,
    _remove_control_effects_from_tokens,
)


class _FakeResult:
    def __init__(self, value: Any) -> None:
        self._value = value

    def scalar_one_or_none(self) -> Any:
        return self._value


class _FakeDb:
    def __init__(self, tokens: dict[int, Any]) -> None:
        self._tokens = tokens

    async def execute(self, _stmt: Any) -> _FakeResult:
        token_id = getattr(self, "_next_id", None)
        return _FakeResult(self._tokens.get(token_id))


def _make_token(token_id: int, *, active_effects: list[dict]) -> SimpleNamespace:
    return SimpleNamespace(
        id=token_id,
        campaign_id=42,
        active_effects=list(active_effects),
        transformation_data=None,
        token_size="1x1",
    )


@pytest.mark.asyncio
async def test_replacing_concentration_does_not_strip_unrelated_caster_buffs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Caster keeps non-concentration buffs sourced from themselves."""
    caster_token_id = 527
    caster = _make_token(
        caster_token_id,
        active_effects=[
            # Old concentration buff (Bless on self) — should be removed.
            {
                "id": "spell_buff_bless_self",
                "spell_buff": True,
                "spell_id": "bless",
                "source_token_id": caster_token_id,
            },
            # Self-cast non-concentration buffs — must remain.
            {
                "id": "false_life_temp_hp",
                "spell_buff": True,
                "spell_id": "false_life",
                "source_token_id": caster_token_id,
            },
            {
                "id": "armor_of_agathys",
                "spell_buff": True,
                "spell_id": "armor_of_agathys",
                "source_token_id": caster_token_id,
            },
            # Effect from a different caster — must remain.
            {
                "id": "ally_buff",
                "spell_buff": True,
                "spell_id": "aid",
                "source_token_id": 999,
            },
        ],
    )

    tokens = {caster_token_id: caster}

    async def fake_execute(_stmt: Any) -> _FakeResult:
        return _FakeResult(caster)

    db = SimpleNamespace(execute=fake_execute)

    monkeypatch.setattr(token_routes, "flag_modified", lambda *_a, **_k: None)
    monkeypatch.setattr(
        token_routes.realtime_publisher,
        "publish_token_effects_updated",
        AsyncMock(),
    )
    monkeypatch.setattr(
        token_routes.realtime_publisher,
        "publish_transformation_updated",
        AsyncMock(),
    )
    monkeypatch.setattr(token_routes, "get_spell_by_id", lambda _id: None)
    monkeypatch.setattr(token_routes, "get_spell_size_delta", lambda *_a, **_k: None)

    removed_from = await _remove_control_effects_from_tokens(
        db=db,
        spell_id="bless",
        affected_token_ids=[caster_token_id],
        caster_token_id=caster_token_id,
        campaign_id=42,
    )

    assert removed_from == [caster_token_id]
    remaining_ids = {e["id"] for e in caster.active_effects}
    assert "spell_buff_bless_self" not in remaining_ids
    assert remaining_ids == {"false_life_temp_hp", "armor_of_agathys", "ally_buff"}


@pytest.mark.asyncio
async def test_replacing_concentration_strips_target_effects_of_ended_spell(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Targets lose the ended concentration's effects, not unrelated ones."""
    caster_token_id = 527
    target_token_id = 533
    target = _make_token(
        target_token_id,
        active_effects=[
            {
                "id": "spell_debuff_hold_person",
                "spell_id": "hold_person",
                "source_token_id": caster_token_id,
                "condition": "paralyzed",
            },
            # Pre-existing Command from same caster, applied earlier — should
            # remain when Hold Person ends (Command is its own concentration
            # ending path).
            {
                "id": "spell_buff_command",
                "spell_id": "command",
                "source_token_id": caster_token_id,
            },
        ],
    )

    async def fake_execute(_stmt: Any) -> _FakeResult:
        return _FakeResult(target)

    db = SimpleNamespace(execute=fake_execute)

    monkeypatch.setattr(token_routes, "flag_modified", lambda *_a, **_k: None)
    monkeypatch.setattr(
        token_routes.realtime_publisher,
        "publish_token_effects_updated",
        AsyncMock(),
    )
    monkeypatch.setattr(
        token_routes.realtime_publisher,
        "publish_transformation_updated",
        AsyncMock(),
    )
    monkeypatch.setattr(token_routes, "get_spell_by_id", lambda _id: None)
    monkeypatch.setattr(token_routes, "get_spell_size_delta", lambda *_a, **_k: None)

    removed_from = await _remove_control_effects_from_tokens(
        db=db,
        spell_id="hold_person",
        affected_token_ids=[target_token_id],
        caster_token_id=caster_token_id,
        campaign_id=42,
    )

    assert removed_from == [target_token_id]
    remaining_ids = {e["id"] for e in target.active_effects}
    assert remaining_ids == {"spell_buff_command"}


@pytest.mark.asyncio
async def test_matcher_normalizes_spell_id_and_source_token_id_aliases(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Effect storage uses several aliases for spell id and caster id; the
    cleanup matcher must compare them as normalized strings so JSON int vs
    str, camelCase aliases, and stray whitespace all match correctly."""
    caster_token_id = 527
    target_token_id = 533
    target = _make_token(
        target_token_id,
        active_effects=[
            # camelCase aliases + numeric sourceTokenId (matches caster as int).
            {
                "id": "alias_camel",
                "sourceSpell": "hold_person",
                "sourceTokenId": 527,
            },
            # snake_case alias + sourceTokenId stored as a string.
            {
                "id": "alias_snake_string_source",
                "source_spell": "hold_person",
                "source_token_id": "527",
            },
            # spellId alias with surrounding whitespace.
            {
                "id": "alias_spellid_whitespace",
                "spellId": " hold_person ",
                "source_token_id": 527,
            },
            # Same ended spell but a different caster — must NOT be removed.
            {
                "id": "other_caster_hold_person",
                "spell_id": "hold_person",
                "source_token_id": 999,
            },
            # Different spell from this caster — must NOT be removed.
            {
                "id": "self_false_life",
                "spell_id": "false_life",
                "source_token_id": 527,
            },
        ],
    )

    async def fake_execute(_stmt: Any) -> _FakeResult:
        return _FakeResult(target)

    db = SimpleNamespace(execute=fake_execute)

    monkeypatch.setattr(token_routes, "flag_modified", lambda *_a, **_k: None)
    monkeypatch.setattr(
        token_routes.realtime_publisher,
        "publish_token_effects_updated",
        AsyncMock(),
    )
    monkeypatch.setattr(
        token_routes.realtime_publisher,
        "publish_transformation_updated",
        AsyncMock(),
    )
    monkeypatch.setattr(token_routes, "get_spell_by_id", lambda _id: None)
    monkeypatch.setattr(token_routes, "get_spell_size_delta", lambda *_a, **_k: None)

    removed_from = await _remove_control_effects_from_tokens(
        db=db,
        spell_id="hold_person",
        affected_token_ids=[target_token_id],
        caster_token_id=caster_token_id,
        campaign_id=42,
    )

    assert removed_from == [target_token_id]
    remaining_ids = {e["id"] for e in target.active_effects}
    # All three alias-shaped Hold Person entries from the right caster are gone;
    # the foreign-caster Hold Person and the self false-life remain.
    assert remaining_ids == {"other_caster_hold_person", "self_false_life"}


def test_old_concentration_cleanup_token_ids_includes_caster_and_dedupes() -> None:
    """Caster is always swept; targets are appended with dedup + int coercion."""
    ids = _old_concentration_cleanup_token_ids(
        caster_token_id=527,
        old_concentration_spell={"affected_token_ids": [535, "527", None, "abc", 535, 8]},
    )
    assert ids == [527, 535, 8]


def test_old_concentration_cleanup_token_ids_handles_none_concentration() -> None:
    """Missing / non-dict concentration still yields caster sweep."""
    assert _old_concentration_cleanup_token_ids(
        caster_token_id=12, old_concentration_spell=None,
    ) == [12]
    assert _old_concentration_cleanup_token_ids(
        caster_token_id=12, old_concentration_spell={},
    ) == [12]


@pytest.mark.asyncio
async def test_grant_action_effect_on_caster_is_removed_when_caster_in_sweep(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Witch Bolt caster-side grant_action effect must be stripped when the
    caster is included in the cleanup sweep (the route now always passes the
    caster id into `_remove_control_effects_from_tokens`).
    """
    caster_token_id = 527
    caster = _make_token(
        caster_token_id,
        active_effects=[
            # Witch Bolt's caster-side grant_action — concentration-bound.
            {
                "id": "witch_bolt_grant_action_巫术箭伤害",
                "spell_id": "witch_bolt",
                "is_concentration": True,
                "effect_type": "grant_action",
                "source_token_id": caster_token_id,
                "target_token_id": 535,
            },
            # Self False Life — unrelated; must remain.
            {
                "id": "false_life_self",
                "spell_buff": True,
                "spell_id": "false_life",
                "source_token_id": caster_token_id,
            },
        ],
    )

    async def fake_execute(_stmt: Any) -> _FakeResult:
        return _FakeResult(caster)

    db = SimpleNamespace(execute=fake_execute)

    monkeypatch.setattr(token_routes, "flag_modified", lambda *_a, **_k: None)
    monkeypatch.setattr(
        token_routes.realtime_publisher,
        "publish_token_effects_updated",
        AsyncMock(),
    )
    monkeypatch.setattr(
        token_routes.realtime_publisher,
        "publish_transformation_updated",
        AsyncMock(),
    )
    monkeypatch.setattr(token_routes, "get_spell_by_id", lambda _id: None)
    monkeypatch.setattr(token_routes, "get_spell_size_delta", lambda *_a, **_k: None)

    removed_from = await _remove_control_effects_from_tokens(
        db=db,
        spell_id="witch_bolt",
        affected_token_ids=[caster_token_id],
        caster_token_id=caster_token_id,
        campaign_id=42,
    )

    assert removed_from == [caster_token_id]
    remaining_ids = {e["id"] for e in caster.active_effects}
    assert remaining_ids == {"false_life_self"}


@pytest.mark.asyncio
async def test_polymorph_full_replace_transformation_cleared_without_size_delta(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Polymorph (full_replace, no size delta) leaves stale `transformation_data`
    behind when concentration is replaced — regression for Chrome QA 2026-05-28
    where casting Banishment after Polymorph kept `polymorph` in transformation_data.
    """
    caster_token_id = 527
    caster = _make_token(caster_token_id, active_effects=[])
    caster.transformation_data = {
        "type": "full_replace",
        "activeMode": None,
        "original_size": "中型",
        "source": {
            "spell_id": "polymorph",
            "config_id": "polymorph",
            "spell_name": "变形术",
        },
        "beast_name": "Tyrannosaurus Rex",
    }

    async def fake_execute(_stmt: Any) -> _FakeResult:
        return _FakeResult(caster)

    db = SimpleNamespace(execute=fake_execute)

    publish_transformation = AsyncMock()
    monkeypatch.setattr(token_routes, "flag_modified", lambda *_a, **_k: None)
    monkeypatch.setattr(
        token_routes.realtime_publisher,
        "publish_token_effects_updated",
        AsyncMock(),
    )
    monkeypatch.setattr(
        token_routes.realtime_publisher,
        "publish_transformation_updated",
        publish_transformation,
    )
    monkeypatch.setattr(token_routes, "get_spell_by_id", lambda _id: {"id": "polymorph"})
    # Polymorph has no size delta — full-replacement transformation.
    monkeypatch.setattr(token_routes, "get_spell_size_delta", lambda *_a, **_k: None)

    original_size = caster.token_size
    await _remove_control_effects_from_tokens(
        db=db,
        spell_id="polymorph",
        affected_token_ids=[caster_token_id],
        caster_token_id=caster_token_id,
        campaign_id=42,
    )

    assert caster.transformation_data is None
    # No size restoration: token_size must be unchanged and not in payload.
    assert caster.token_size == original_size
    publish_transformation.assert_awaited_once()
    call_kwargs = publish_transformation.await_args.kwargs
    assert call_kwargs["token_id"] == caster_token_id
    assert call_kwargs["transformation_data"] is None
    assert "token_size" not in call_kwargs


@pytest.mark.asyncio
async def test_unrelated_transformation_is_preserved(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Cleanup must NOT touch `transformation_data` whose source is a different
    spell from the one whose concentration just ended."""
    target_token_id = 533
    target = _make_token(target_token_id, active_effects=[])
    target.transformation_data = {
        "type": "full_replace",
        "original_size": "中型",
        "source": {"spell_id": "polymorph", "config_id": "polymorph"},
    }

    async def fake_execute(_stmt: Any) -> _FakeResult:
        return _FakeResult(target)

    db = SimpleNamespace(execute=fake_execute)

    publish_transformation = AsyncMock()
    monkeypatch.setattr(token_routes, "flag_modified", lambda *_a, **_k: None)
    monkeypatch.setattr(
        token_routes.realtime_publisher,
        "publish_token_effects_updated",
        AsyncMock(),
    )
    monkeypatch.setattr(
        token_routes.realtime_publisher,
        "publish_transformation_updated",
        publish_transformation,
    )
    monkeypatch.setattr(token_routes, "get_spell_by_id", lambda _id: None)
    monkeypatch.setattr(token_routes, "get_spell_size_delta", lambda *_a, **_k: None)

    # Ending a different concentration spell — should not touch polymorph state.
    await _remove_control_effects_from_tokens(
        db=db,
        spell_id="hold_person",
        affected_token_ids=[target_token_id],
        caster_token_id=527,
        campaign_id=42,
    )

    assert target.transformation_data is not None
    assert target.transformation_data["source"]["spell_id"] == "polymorph"
    publish_transformation.assert_not_awaited()


@pytest.mark.asyncio
async def test_enlarge_reduce_still_restores_token_size(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Size-changing spells (Enlarge/Reduce) must still restore `token_size`
    from `original_size` and include it in the broadcast payload."""
    target_token_id = 533
    target = _make_token(target_token_id, active_effects=[])
    target.token_size = "2x2"
    target.transformation_data = {
        "type": "size_change",
        "activeMode": "enlarge",
        "original_size": "中型",
        "source": {"spell_id": "enlarge_reduce", "config_id": "enlarge_reduce"},
    }

    async def fake_execute(_stmt: Any) -> _FakeResult:
        return _FakeResult(target)

    db = SimpleNamespace(execute=fake_execute)

    publish_transformation = AsyncMock()
    monkeypatch.setattr(token_routes, "flag_modified", lambda *_a, **_k: None)
    monkeypatch.setattr(
        token_routes.realtime_publisher,
        "publish_token_effects_updated",
        AsyncMock(),
    )
    monkeypatch.setattr(
        token_routes.realtime_publisher,
        "publish_transformation_updated",
        publish_transformation,
    )
    monkeypatch.setattr(token_routes, "get_spell_by_id", lambda _id: {"id": "enlarge_reduce"})
    monkeypatch.setattr(token_routes, "get_spell_size_delta", lambda *_a, **_k: 1)

    await _remove_control_effects_from_tokens(
        db=db,
        spell_id="enlarge_reduce",
        affected_token_ids=[target_token_id],
        caster_token_id=527,
        campaign_id=42,
    )

    assert target.transformation_data is None
    assert target.token_size == "1x1"
    publish_transformation.assert_awaited_once()
    call_kwargs = publish_transformation.await_args.kwargs
    assert call_kwargs["transformation_data"] is None
    assert call_kwargs["token_size"] == "1x1"


@pytest.mark.asyncio
async def test_transformation_cleared_when_source_only_has_config_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Some transformation payloads only carry `config_id` (e.g. wild shape variants
    that share an underlying spell). Cleanup must still match by config_id."""
    target_token_id = 533
    target = _make_token(target_token_id, active_effects=[])
    target.transformation_data = {
        "type": "full_replace",
        "source": {"config_id": "polymorph"},  # no spell_id key
    }

    async def fake_execute(_stmt: Any) -> _FakeResult:
        return _FakeResult(target)

    db = SimpleNamespace(execute=fake_execute)

    monkeypatch.setattr(token_routes, "flag_modified", lambda *_a, **_k: None)
    monkeypatch.setattr(
        token_routes.realtime_publisher,
        "publish_token_effects_updated",
        AsyncMock(),
    )
    monkeypatch.setattr(
        token_routes.realtime_publisher,
        "publish_transformation_updated",
        AsyncMock(),
    )
    monkeypatch.setattr(token_routes, "get_spell_by_id", lambda _id: None)
    monkeypatch.setattr(token_routes, "get_spell_size_delta", lambda *_a, **_k: None)

    await _remove_control_effects_from_tokens(
        db=db,
        spell_id="polymorph",
        affected_token_ids=[target_token_id],
        caster_token_id=527,
        campaign_id=42,
    )

    assert target.transformation_data is None
