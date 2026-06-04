import pytest

from app.services.spell_runtime_engine import evaluate_phase, execute_phase

from ._helpers import make_instance


@pytest.mark.asyncio
async def test_end_spell_instance_marks_status_ended_on_apply():
    instance = make_instance(params={})
    spell_data = {
        "effects": [
            {
                "trigger": "on_concentration_end",
                "effects": [{"type": "end_spell_instance"}],
            }
        ]
    }

    result = await execute_phase(
        db=None,
        instance=instance,
        trigger="on_concentration_end",
        ctx_overrides={},
        spell_data=spell_data,
    )

    assert instance.status == "ended"
    assert {10, 20}.issubset(result.touched_token_ids)
    assert result.status_change == "ended"


@pytest.mark.asyncio
async def test_end_spell_instance_evaluate_mode_keeps_status_active():
    instance = make_instance(params={})
    spell_data = {
        "effects": [
            {
                "trigger": "on_concentration_end",
                "effects": [{"type": "end_spell_instance"}],
            }
        ]
    }

    result = await evaluate_phase(
        db=None,
        instance=instance,
        trigger="on_concentration_end",
        ctx_overrides={},
        spell_data=spell_data,
    )

    assert instance.status == "active"
    assert result.status_change == "ended"
    assert result.applied is False


@pytest.mark.asyncio
async def test_end_spell_instance_includes_all_linked_target_token_ids():
    """Multi-target spells (e.g. Bless) must have every linked runtime
    target included in touched_token_ids so projection refresh fans out
    correctly when concentration ends."""
    instance = make_instance(
        params={},
        primary_target_token_id=21,
        linked_target_token_ids=[21, 22, 23],
    )
    spell_data = {
        "effects": [
            {
                "trigger": "on_concentration_end",
                "effects": [{"type": "end_spell_instance"}],
            }
        ]
    }

    result = await execute_phase(
        db=None,
        instance=instance,
        trigger="on_concentration_end",
        ctx_overrides={},
        spell_data=spell_data,
    )

    assert instance.status == "ended"
    # caster (10) plus all linked targets.
    assert {10, 21, 22, 23}.issubset(result.touched_token_ids)
