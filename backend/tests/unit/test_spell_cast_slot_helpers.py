from types import SimpleNamespace
from unittest.mock import ANY, AsyncMock

import pytest

import app.api.routes.spell_cast as spell_cast
import app.api.routes.tokens as token_routes
from app.api.routes.spell_cast import (
    _build_default_spell_slots_state_for_character,
    _cleanup_replaced_concentration_effects,
    _consume_spell_slot_state,
    _get_available_spell_slot_count,
    _resolve_appearance_illusion_target_ids,
)


def test_build_default_spell_slots_state_for_warlock_uses_pact_table():
    character = SimpleNamespace(
        class_id="warlock",
        subclass_id=None,
        level=1,
    )

    spell_slots_state = _build_default_spell_slots_state_for_character(character)

    assert spell_slots_state == [0, 1, 0, 0, 0, 0, 0, 0, 0, 0]


def test_consume_spell_slot_state_supports_exact_level_list_slots():
    next_state, consumed = _consume_spell_slot_state([0, 1, 0, 0, 0, 0, 0, 0, 0, 0], 1)

    assert consumed is True
    assert next_state == [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    assert _get_available_spell_slot_count(next_state, 1) == 0


def test_consume_spell_slot_state_supports_pact_slot_dicts():
    next_state, consumed = _consume_spell_slot_state(
        {
            "slots": [0] * 10,
            "pact_slots": [0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
            "pact_level": 2,
            "pact_count": 1,
        },
        2,
    )

    assert consumed is True
    assert next_state["pact_slots"][2] == 0
    assert _get_available_spell_slot_count(next_state, 2) == 0


def test_resolve_appearance_illusion_target_ids_skips_targets_that_saved():
    result = SimpleNamespace(
        phase_results=[
            [
                SimpleNamespace(target_token_id=21, save_rolled=True, save_succeeded=False),
                SimpleNamespace(target_token_id=22, save_rolled=True, save_succeeded=True),
                SimpleNamespace(target_token_id=23, save_rolled=False, save_succeeded=None),
            ]
        ]
    )

    target_ids = _resolve_appearance_illusion_target_ids([21, 22, 23], result)

    assert target_ids == [21, 23]


def test_should_clear_disguise_after_effect_update_only_when_last_disguise_buff_disappears():
    old_effects = [
        {
            "id": "spell_buff_disguise_self",
            "spell_buff": True,
            "spell_id": "disguise_self",
        },
        {
            "id": "other",
            "spell_buff": True,
            "spell_id": "bless",
        },
    ]

    assert token_routes._should_clear_disguise_after_effect_update(
        old_effects=old_effects,
        new_effects=[old_effects[1]],
        has_disguise_data=True,
    ) is True

    assert token_routes._should_clear_disguise_after_effect_update(
        old_effects=old_effects,
        new_effects=old_effects,
        has_disguise_data=True,
    ) is False


@pytest.mark.asyncio
async def test_cleanup_replaced_concentration_effects_removes_old_caster_and_target_effects(
    monkeypatch: pytest.MonkeyPatch,
):
    token = SimpleNamespace(
        id=10,
        campaign_id=7,
        active_effects=[
            {
                "id": "spell_buff_expeditious_retreat",
                "spell_buff": True,
                "spell_id": "expeditious_retreat",
            },
            {
                "id": "spell_buff_comprehend_languages",
                "spell_buff": True,
                "spell_id": "comprehend_languages",
            },
        ],
        active_auras=[],
        concentration_spell={
            "spell_id": "expeditious_retreat",
            "affected_token_ids": [20],
        },
    )

    delete_linked_mock = AsyncMock(return_value=[91])
    end_runtime_mock = AsyncMock(return_value=[10, 20])
    remove_control_mock = AsyncMock(return_value=[20])

    monkeypatch.setattr(spell_cast, "_delete_linked_concentration_tokens", delete_linked_mock)
    monkeypatch.setattr(spell_cast, "end_concentration_runtime_instances", end_runtime_mock)
    monkeypatch.setattr(spell_cast, "flag_modified", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(token_routes, "_remove_control_effects_from_tokens", remove_control_mock)

    removed_linked_token_ids, runtime_touched_token_ids = await _cleanup_replaced_concentration_effects(
        token,
        db=SimpleNamespace(),
        concentration_spell=token.concentration_spell,
    )

    assert removed_linked_token_ids == [91]
    assert runtime_touched_token_ids == [10, 20]
    assert token.active_effects == [
        {
            "id": "spell_buff_comprehend_languages",
            "spell_buff": True,
            "spell_id": "comprehend_languages",
        }
    ]
    remove_control_mock.assert_awaited_once_with(
        db=ANY,
        spell_id="expeditious_retreat",
        affected_token_ids=[20],
        caster_token_id=10,
        campaign_id=7,
    )
