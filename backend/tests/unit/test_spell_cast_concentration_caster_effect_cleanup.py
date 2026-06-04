"""Caster-side concentration effect cleanup on replacement.

Locks down the predicate in `_cleanup_replaced_concentration_effects` so that
when a concentration spell is replaced or broken, caster-owned runtime effects
created by the old spell (walls, barriers, suppress zones, zone visuals) are
removed even when their `affected_token_ids` did not include the caster.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import app.api.routes.spell_cast as spell_cast
import app.api.routes.tokens as token_routes
from app.api.routes.spell_cast import (
    _cleanup_replaced_concentration_effects,
    _is_replaced_concentration_effect,
)


def test_predicate_matches_concentration_caster_effect():
    effect = {
        "id": "wall_of_force_wall",
        "spell_id": "wall_of_force",
        "effect_type": "create_wall",
        "source_token_id": 527,
        "is_concentration": True,
    }
    assert _is_replaced_concentration_effect(effect, "wall_of_force", 527) is True


def test_predicate_matches_spell_buff():
    effect = {
        "id": "spell_buff_haste",
        "spell_buff": True,
        "spell_id": "haste",
    }
    assert _is_replaced_concentration_effect(effect, "haste", 5) is True


def test_predicate_preserves_non_concentration_same_spell_id():
    # Forcecage shape: same spell_id field, but not concentration and not a buff
    effect = {
        "id": "forcecage_barrier",
        "spell_id": "forcecage",
        "effect_type": "create_barrier",
        "source_token_id": 5,
        "is_concentration": False,
    }
    assert _is_replaced_concentration_effect(effect, "forcecage", 5) is False


def test_predicate_preserves_unrelated_spell_id():
    effect = {
        "id": "spell_buff_bless",
        "spell_buff": True,
        "spell_id": "bless",
    }
    assert _is_replaced_concentration_effect(effect, "wall_of_force", 5) is False


def test_predicate_skips_concentration_effect_owned_by_other_caster():
    effect = {
        "id": "wall_of_force_wall",
        "spell_id": "wall_of_force",
        "effect_type": "create_wall",
        "source_token_id": 999,  # different caster
        "is_concentration": True,
    }
    assert _is_replaced_concentration_effect(effect, "wall_of_force", 527) is False


@pytest.mark.asyncio
async def test_cleanup_removes_caster_side_wall_barrier_suppress_zone_effects(
    monkeypatch: pytest.MonkeyPatch,
):
    """Replacing Wall of Force concentration must drop the caster's wall/barrier/
    suppress/zone effects even though `affected_token_ids` only lists targets.
    """
    caster_id = 527
    token = SimpleNamespace(
        id=caster_id,
        campaign_id=7,
        active_effects=[
            {
                "id": "wall_of_force_wall",
                "spell_id": "wall_of_force",
                "effect_type": "create_wall",
                "source_token_id": caster_id,
                "is_concentration": True,
            },
            {
                "id": "wall_of_force_barrier",
                "spell_id": "wall_of_force",
                "effect_type": "create_barrier",
                "source_token_id": caster_id,
                "is_concentration": True,
            },
            {
                "id": "wall_of_force_suppress",
                "spell_id": "wall_of_force",
                "effect_type": "suppress_magic",
                "source_token_id": caster_id,
                "is_concentration": True,
            },
            {
                "id": "wall_of_force_zone_visual",
                "spell_id": "wall_of_force",
                "effect_type": "create_zone_visual",
                "source_token_id": caster_id,
                "is_concentration": True,
            },
            # Unrelated effect from another spell — must be preserved.
            {
                "id": "spell_buff_bless",
                "spell_buff": True,
                "spell_id": "bless",
            },
            # Same spell_id but explicitly non-concentration — must be preserved
            # to prove the predicate is not "drop everything with this spell_id".
            {
                "id": "wall_of_force_residue",
                "spell_id": "wall_of_force",
                "effect_type": "create_barrier",
                "source_token_id": caster_id,
                "is_concentration": False,
            },
        ],
        active_auras=[],
        concentration_spell={
            "spell_id": "wall_of_force",
            "affected_token_ids": [533],  # target only, NOT the caster
        },
    )

    monkeypatch.setattr(
        spell_cast,
        "_delete_linked_concentration_tokens",
        AsyncMock(return_value=[]),
    )
    monkeypatch.setattr(
        spell_cast,
        "end_concentration_runtime_instances",
        AsyncMock(return_value=[]),
    )
    monkeypatch.setattr(spell_cast, "flag_modified", lambda *_a, **_kw: None)
    remove_control_mock = AsyncMock(return_value=[533])
    monkeypatch.setattr(
        token_routes, "_remove_control_effects_from_tokens", remove_control_mock
    )

    await _cleanup_replaced_concentration_effects(
        token,
        db=SimpleNamespace(),
        concentration_spell=token.concentration_spell,
    )

    remaining_ids = {effect["id"] for effect in token.active_effects}
    assert remaining_ids == {"spell_buff_bless", "wall_of_force_residue"}

    # Target-side cleanup must still be invoked with the original affected ids.
    remove_control_mock.assert_awaited_once()
    kwargs = remove_control_mock.await_args.kwargs
    assert kwargs["spell_id"] == "wall_of_force"
    assert kwargs["affected_token_ids"] == [533]
    assert kwargs["caster_token_id"] == caster_id
    assert kwargs["campaign_id"] == 7
