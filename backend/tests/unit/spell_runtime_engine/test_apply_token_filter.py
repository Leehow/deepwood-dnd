import pytest

from app.services.spell_runtime_engine import evaluate_phase, execute_phase

from ._helpers import make_instance


@pytest.mark.asyncio
async def test_apply_token_filter_writes_into_params_on_apply():
    instance = make_instance(params={})
    spell_data = {
        "effects": [
            {
                "trigger": "on_cast",
                "effects": [
                    {
                        "type": "apply_token_filter",
                        "tokenFilter": {"blur": 3, "opacity": 0.75},
                    }
                ],
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

    assert result.token_filter == {"blur": 3, "opacity": 0.75}
    assert instance.params["token_filter"] == {"blur": 3, "opacity": 0.75}


@pytest.mark.asyncio
async def test_apply_token_filter_evaluate_mode_keeps_instance_unchanged():
    instance = make_instance(params={})
    spell_data = {
        "effects": [
            {
                "trigger": "on_cast",
                "effects": [
                    {"type": "apply_token_filter", "token_filter": {"blur": 1}}
                ],
            }
        ]
    }

    result = await evaluate_phase(
        db=None,
        instance=instance,
        trigger="on_cast",
        ctx_overrides={},
        spell_data=spell_data,
    )

    assert result.token_filter == {"blur": 1}
    assert "token_filter" not in (instance.params or {})


@pytest.mark.asyncio
async def test_apply_token_filter_ignores_empty_filter():
    instance = make_instance(params={})
    spell_data = {
        "effects": [
            {
                "trigger": "on_cast",
                "effects": [{"type": "apply_token_filter", "tokenFilter": {}}],
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

    assert result.token_filter is None
    assert "token_filter" not in (instance.params or {})
