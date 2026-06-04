import pytest

from app.services.spell_runtime_engine import execute_phase

from ._helpers import make_instance


@pytest.mark.asyncio
async def test_narrative_collects_description_into_result():
    instance = make_instance()
    spell_data = {
        "effects": [
            {
                "trigger": "on_action_invoked",
                "condition": {"action_id": "transfer_hex"},
                "effects": [
                    {"type": "narrative", "description": "诅咒转移到了新目标"},
                ],
            }
        ]
    }

    result = await execute_phase(
        db=None,
        instance=instance,
        trigger="on_action_invoked",
        ctx_overrides={"invoked_action_id": "transfer_hex"},
        spell_data=spell_data,
    )

    assert "诅咒转移到了新目标" in result.narrative_parts


@pytest.mark.asyncio
async def test_narrative_without_description_emits_nothing():
    instance = make_instance()
    spell_data = {
        "effects": [
            {
                "trigger": "on_cast",
                "effects": [{"type": "narrative"}],
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

    assert result.narrative_parts == []
