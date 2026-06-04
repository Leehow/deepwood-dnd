import pytest

from app.services.spell_runtime_engine import evaluate_phase, execute_phase

from ._helpers import make_instance


@pytest.mark.asyncio
async def test_set_runtime_param_writes_value():
    instance = make_instance(params={"existing": "keep"})
    spell_data = {
        "effects": [
            {
                "trigger": "on_target_downed",
                "effects": [
                    {"type": "set_runtime_param", "key": "transfer_available", "value": True}
                ],
            }
        ]
    }

    await execute_phase(
        db=None,
        instance=instance,
        trigger="on_target_downed",
        ctx_overrides={},
        spell_data=spell_data,
    )

    assert instance.params["transfer_available"] is True
    assert instance.params["existing"] == "keep"


@pytest.mark.asyncio
async def test_clear_runtime_param_removes_key():
    instance = make_instance(params={"transfer_available": True, "marked_token_id": 5})
    spell_data = {
        "effects": [
            {
                "trigger": "on_action_invoked",
                "condition": {"action_id": "transfer_hex"},
                "effects": [
                    {"type": "clear_runtime_param", "key": "transfer_available"},
                ],
            }
        ]
    }

    await execute_phase(
        db=None,
        instance=instance,
        trigger="on_action_invoked",
        ctx_overrides={"invoked_action_id": "transfer_hex"},
        spell_data=spell_data,
    )

    assert "transfer_available" not in instance.params
    assert instance.params["marked_token_id"] == 5


@pytest.mark.asyncio
async def test_evaluate_mode_does_not_mutate_params():
    instance = make_instance(params={"transfer_available": False})
    spell_data = {
        "effects": [
            {
                "trigger": "on_target_downed",
                "effects": [
                    {"type": "set_runtime_param", "key": "transfer_available", "value": True}
                ],
            }
        ]
    }

    result = await evaluate_phase(
        db=None,
        instance=instance,
        trigger="on_target_downed",
        ctx_overrides={},
        spell_data=spell_data,
    )

    assert instance.params["transfer_available"] is False
    assert result.param_updates == {"transfer_available": True}
    assert result.applied is False
