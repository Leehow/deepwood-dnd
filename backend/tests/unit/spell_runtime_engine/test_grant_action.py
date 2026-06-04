import pytest

from app.services.spell_runtime_engine import evaluate_phase, execute_phase

from ._helpers import make_instance


@pytest.mark.asyncio
async def test_grant_action_appends_to_instance_only_when_apply():
    instance = make_instance(granted_actions=[])
    grant_effect = {
        "type": "grant_action",
        "action_id": "transfer_hex",
        "action_name": "转移诅咒",
    }
    spell_data = {
        "effects": [
            {"trigger": "on_cast", "effects": [grant_effect]},
        ]
    }

    # evaluate-only: instance must not change, but result records pending append.
    eval_result = await evaluate_phase(
        db=None,
        instance=instance,
        trigger="on_cast",
        ctx_overrides={},
        spell_data=spell_data,
    )

    assert instance.granted_actions == []
    assert eval_result.granted_actions_append == [grant_effect]
    assert eval_result.applied is False

    # apply: actually mutates.
    apply_result = await execute_phase(
        db=None,
        instance=instance,
        trigger="on_cast",
        ctx_overrides={},
        spell_data=spell_data,
    )

    assert instance.granted_actions == [grant_effect]
    assert apply_result.applied is True


@pytest.mark.asyncio
async def test_evaluate_phase_called_twice_does_not_grow_granted_actions():
    """Read-only projection flows must be safe to repeat."""
    instance = make_instance(granted_actions=[])
    spell_data = {
        "effects": [
            {
                "trigger": "on_cast",
                "effects": [
                    {"type": "grant_action", "action_id": "transfer_hex"},
                ],
            }
        ]
    }

    for _ in range(3):
        await evaluate_phase(
            db=None,
            instance=instance,
            trigger="on_cast",
            ctx_overrides={},
            spell_data=spell_data,
        )

    assert instance.granted_actions == []
