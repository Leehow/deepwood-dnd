"""Phase executor behavior: registry gating, error isolation, dispatch order."""

import pytest

from app.services.spell_runtime_engine import (
    PhaseExecutionContext,
    VERB_HANDLERS,
    VerbResult,
    audit_pipeline,
    evaluate_phase,
    execute_phase,
    register_verb,
)
from app.services.spell_runtime_engine.verb_registry import VERB_REQUIRED_CTX

from ._helpers import make_instance, make_target


@pytest.mark.asyncio
async def test_unknown_verb_records_failure_and_continues():
    instance = make_instance(params={})
    spell_data = {
        "effects": [
            {
                "trigger": "on_cast",
                "effects": [
                    {"type": "totally_made_up_verb"},
                    {"type": "narrative", "description": "still ran"},
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

    assert ("totally_made_up_verb", "no handler") in result.failed_verbs
    assert "still ran" in result.narrative_parts


@pytest.mark.asyncio
async def test_verb_handler_exception_is_isolated(monkeypatch: pytest.MonkeyPatch):
    instance = make_instance(params={})

    async def explode(_ctx, _effect):
        raise RuntimeError("boom")

    monkeypatch.setitem(VERB_HANDLERS, "narrative", explode)

    spell_data = {
        "effects": [
            {
                "trigger": "on_cast",
                "effects": [
                    {"type": "narrative", "description": "won't show"},
                    {"type": "set_runtime_param", "key": "flag", "value": True},
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

    failures = dict(result.failed_verbs)
    assert "narrative" in failures
    assert "boom" in failures["narrative"]
    # Subsequent verb still applied.
    assert instance.params.get("flag") is True


@pytest.mark.asyncio
async def test_required_ctx_missing_skips_with_failure():
    instance = make_instance(params={})

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
        ctx_overrides={},  # no primary_target
        spell_data=spell_data,
    )

    assert any(
        verb == "apply_mark" and "primary_target" in reason
        for verb, reason in result.failed_verbs
    )


@pytest.mark.asyncio
async def test_phase_condition_filters_phases_for_on_action_invoked():
    instance = make_instance(
        params={"transfer_available": True},
        granted_actions=[{"action_id": "transfer_hex"}],
    )
    spell_data = {
        "effects": [
            {
                "trigger": "on_action_invoked",
                "condition": {"action_id": "transfer_hex"},
                "effects": [
                    {"type": "clear_runtime_param", "key": "transfer_available"},
                ],
            },
            {
                "trigger": "on_action_invoked",
                "condition": {"action_id": "some_other_action"},
                "effects": [
                    {"type": "set_runtime_param", "key": "should_not_run", "value": True},
                ],
            },
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
    assert "should_not_run" not in instance.params


@pytest.mark.asyncio
async def test_evaluate_phase_never_mutates_instance_across_many_verbs():
    """Critical invariant: read-only mode is the projection guarantee."""
    instance = make_instance(
        params={"keep": "yes"},
        granted_actions=[],
    )
    snapshot_params = dict(instance.params)
    snapshot_status = instance.status
    snapshot_primary = instance.primary_target_token_id
    snapshot_actions = list(instance.granted_actions or [])

    spell_data = {
        "effects": [
            {
                "trigger": "on_cast",
                "effects": [
                    {"type": "set_runtime_param", "key": "mutated", "value": True},
                    {"type": "grant_action", "action_id": "added"},
                    {
                        "type": "apply_token_filter",
                        "tokenFilter": {"blur": 1},
                    },
                    {"type": "end_spell_instance"},
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

    assert instance.params == snapshot_params
    assert instance.status == snapshot_status
    assert instance.primary_target_token_id == snapshot_primary
    assert list(instance.granted_actions or []) == snapshot_actions
    assert result.applied is False
    # But the result still describes the would-be writes:
    assert result.param_updates == {"mutated": True}
    assert result.token_filter == {"blur": 1}
    assert result.granted_actions_append and result.granted_actions_append[0]["action_id"] == "added"
    assert result.status_change == "ended"


@pytest.mark.asyncio
async def test_retarget_then_clear_param_preserves_per_key_order():
    """Regression: hex transfer phase emits retarget_mark + clear_runtime_param
    for the same key (`transfer_available`). The aggregate must drop the key
    rather than letting the earlier `update -> False` survive the later clear.
    """
    instance = make_instance(
        params={"transfer_available": True, "marked_token_id": 20},
        primary_target_token_id=20,
    )
    spell_data = {
        "effects": [
            {
                "trigger": "on_action_invoked",
                "condition": {"action_id": "transfer_hex"},
                "effects": [
                    {"type": "retarget_mark"},
                    {"type": "clear_runtime_param", "key": "transfer_available"},
                    {"type": "narrative", "description": "诅咒转移到新目标"},
                ],
            }
        ]
    }

    await execute_phase(
        db=None,
        instance=instance,
        trigger="on_action_invoked",
        ctx_overrides={
            "invoked_action_id": "transfer_hex",
            "invoked_target_token_id": 77,
            "primary_target": make_target(token_id=77, name="新目标"),
        },
        spell_data=spell_data,
    )

    assert instance.primary_target_token_id == 77
    assert instance.linked_target_token_ids == [77]
    assert instance.params["marked_token_id"] == 77
    assert "transfer_available" not in instance.params


def test_register_verb_rejects_duplicates():
    with pytest.raises(RuntimeError, match="Duplicate"):
        @register_verb("narrative")
        async def _shadow(_ctx, _effect):
            return VerbResult()


def test_register_verb_records_required_ctx():
    assert "primary_target" in VERB_REQUIRED_CTX["apply_mark"]


def test_phase_execution_context_supports_design_fields():
    field_names = set(PhaseExecutionContext.__dataclass_fields__.keys())
    for required in {
        "db",
        "instance",
        "spell_data",
        "trigger",
        "primary_target",
        "targets",
        "attacker_token_id",
        "target_token_id",
        "attack_kind",
        "critical",
        "invoked_action_id",
        "invoked_target_token_id",
        "current_world_time",
    }:
        assert required in field_names


def test_audit_pipeline_reports_dispatched_verbs():
    audit = audit_pipeline()
    dispatched = set(audit["dispatched"])
    # Stage 1 verb set must all be dispatched.
    for verb in {
        "apply_mark",
        "retarget_mark",
        "set_runtime_param",
        "clear_runtime_param",
        "grant_action",
        "narrative",
        "apply_token_filter",
        "conditional_extra_damage",
        "end_spell_instance",
        "grant_advantage",
        "grant_disadvantage",
        "grant_resistance",
        "grant_immunity",
        "modify_roll",
    }:
        assert verb in dispatched
