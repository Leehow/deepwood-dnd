import pytest

from app.services.spell_runtime_engine import execute_phase, evaluate_phase

from ._helpers import make_instance, make_target


@pytest.mark.asyncio
async def test_apply_mark_writes_marked_token_id_and_narrative():
    instance = make_instance(primary_target_token_id=None, params={})
    target = make_target(token_id=42, name="哥布林")

    spell_data = {
        "effects": [
            {
                "trigger": "on_cast",
                "effects": [{"type": "apply_mark", "params": {"extra_flag": True}}],
            }
        ]
    }

    result = await execute_phase(
        db=None,
        instance=instance,
        trigger="on_cast",
        ctx_overrides={"primary_target": target},
        spell_data=spell_data,
    )

    assert instance.params["marked_token_id"] == 42
    assert instance.params["marked_target_name"] == "哥布林"
    assert instance.params["extra_flag"] is True
    assert 42 in result.touched_token_ids
    assert any("标记" in part for part in result.narrative_parts)


@pytest.mark.asyncio
async def test_apply_mark_skipped_when_primary_target_missing():
    instance = make_instance(primary_target_token_id=None, params={})

    spell_data = {
        "effects": [
            {
                "trigger": "on_cast",
                "effects": [{"type": "apply_mark"}],
            }
        ]
    }

    result = await execute_phase(
        db=None,
        instance=instance,
        trigger="on_cast",
        ctx_overrides={},
        spell_data=spell_data,
    )

    assert result.failed_verbs == [("apply_mark", "missing ctx: primary_target")]
    assert "marked_token_id" not in (instance.params or {})


@pytest.mark.asyncio
async def test_retarget_mark_changes_primary_target_and_clears_transfer_flag():
    instance = make_instance(
        primary_target_token_id=20,
        params={"transfer_available": True, "marked_token_id": 20},
    )

    spell_data = {
        "effects": [
            {
                "trigger": "on_action_invoked",
                "condition": {"action_id": "transfer_hex"},
                "effects": [{"type": "retarget_mark"}],
            }
        ]
    }

    result = await execute_phase(
        db=None,
        instance=instance,
        trigger="on_action_invoked",
        ctx_overrides={
            "invoked_action_id": "transfer_hex",
            "invoked_target_token_id": 77,
        },
        spell_data=spell_data,
    )

    assert instance.primary_target_token_id == 77
    assert instance.linked_target_token_ids == [77]
    assert instance.params["marked_token_id"] == 77
    assert instance.params["transfer_available"] is False
    assert {20, 77}.issubset(result.touched_token_ids)


@pytest.mark.asyncio
async def test_retarget_mark_evaluate_mode_does_not_mutate_instance():
    instance = make_instance(
        primary_target_token_id=20,
        params={"transfer_available": True, "marked_token_id": 20},
    )

    spell_data = {
        "effects": [
            {
                "trigger": "on_action_invoked",
                "condition": {"action_id": "transfer_hex"},
                "effects": [{"type": "retarget_mark"}],
            }
        ]
    }

    result = await evaluate_phase(
        db=None,
        instance=instance,
        trigger="on_action_invoked",
        ctx_overrides={
            "invoked_action_id": "transfer_hex",
            "invoked_target_token_id": 77,
        },
        spell_data=spell_data,
    )

    # Instance must be untouched.
    assert instance.primary_target_token_id == 20
    assert instance.params["transfer_available"] is True
    assert instance.params["marked_token_id"] == 20
    # But the PhaseResult still describes the would-be change.
    assert result.primary_target_change == 77
    assert result.linked_targets_change == [77]
    assert result.applied is False
