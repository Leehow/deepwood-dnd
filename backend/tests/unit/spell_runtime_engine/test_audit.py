"""Stage 7 audit tests.

Synthetic in-memory spell lists are injected by monkeypatching
`app.services.spell_runtime_engine.audit.get_all_spells`. No edits to
`spells.json`.
"""

import pytest

from app.services.spell_runtime_engine import audit_pipeline
from app.services.spell_runtime_engine import audit as audit_module


def _patch_spells(monkeypatch: pytest.MonkeyPatch, spells: list[dict]) -> None:
    monkeypatch.setattr(audit_module, "get_all_spells", lambda: list(spells))


def test_audit_reports_handled_vs_unhandled_verbs(monkeypatch: pytest.MonkeyPatch):
    # `narrative` has a real handler; `totally_made_up_verb` does not.
    spells = [
        {
            "id": "synthetic",
            "effects": [
                {
                    "trigger": "on_cast",
                    "effects": [
                        {"type": "narrative", "description": "hi"},
                        {"type": "totally_made_up_verb"},
                    ],
                }
            ],
        }
    ]
    _patch_spells(monkeypatch, spells)

    audit = audit_pipeline()

    # Explicit verb fields.
    assert "narrative" in audit["dispatched_verbs"]
    assert "totally_made_up_verb" in audit["declared_only_verbs"]
    assert "narrative" not in audit["declared_only_verbs"]
    assert "totally_made_up_verb" not in audit["dispatched_verbs"]

    # Legacy aliases mirror verb coverage.
    assert audit["dispatched"] == audit["dispatched_verbs"]
    assert audit["declared_only"] == audit["declared_only_verbs"]

    # Declared verbs still include both regardless of handler presence.
    assert {"narrative", "totally_made_up_verb"}.issubset(set(audit["declared_verbs"]))

    # Registered verbs comes from the global registry, must be non-empty and
    # include real ones like `narrative`.
    assert "narrative" in audit["registered_verbs"]


def test_audit_reports_wired_vs_unwired_triggers(monkeypatch: pytest.MonkeyPatch):
    # on_cast / start_of_turn (Stage 8) and on_enter_zone / on_leave_zone
    # (Stage 10) are all wired via service-layer callsites. A made-up trigger
    # stays in declared_only_triggers to prove the partition still works.
    spells = [
        {
            "id": "synthetic",
            "effects": [
                {
                    "trigger": "on_cast",
                    "effects": [{"type": "narrative", "description": "cast"}],
                },
                {
                    "trigger": "start_of_turn",
                    "effects": [{"type": "narrative", "description": "tick"}],
                },
                {
                    "trigger": "on_enter_zone",
                    "effects": [{"type": "narrative", "description": "enter"}],
                },
                {
                    "trigger": "on_leave_zone",
                    "effects": [{"type": "narrative", "description": "leave"}],
                },
                {
                    "trigger": "totally_made_up_trigger",
                    "effects": [{"type": "narrative", "description": "noop"}],
                },
            ],
        }
    ]
    _patch_spells(monkeypatch, spells)

    audit = audit_pipeline()

    assert "on_cast" in audit["dispatched_triggers"]
    assert "start_of_turn" in audit["dispatched_triggers"]
    assert "on_enter_zone" in audit["dispatched_triggers"]
    assert "on_leave_zone" in audit["dispatched_triggers"]
    assert "on_enter_zone" not in audit["declared_only_triggers"]
    assert "on_leave_zone" not in audit["declared_only_triggers"]
    assert "on_cast" not in audit["declared_only_triggers"]
    assert "start_of_turn" not in audit["declared_only_triggers"]
    assert "totally_made_up_trigger" in audit["declared_only_triggers"]
    assert "totally_made_up_trigger" not in audit["dispatched_triggers"]
    # Everything still appears in declared_triggers.
    assert {
        "on_cast",
        "start_of_turn",
        "on_enter_zone",
        "on_leave_zone",
        "totally_made_up_trigger",
    }.issubset(set(audit["declared_triggers"]))


def test_audit_legacy_keys_preserved_on_real_spells():
    # Run against the live spells.json (no monkeypatch). The Stage 1 contract
    # in test_executor.py asserted `dispatched` contains the core verb set;
    # we re-assert the same alias here and prove `handler_count` matches the
    # registry size.
    from app.services.spell_runtime_engine.verb_registry import VERB_HANDLERS

    audit = audit_pipeline()
    assert audit["handler_count"] == len(VERB_HANDLERS)
    assert set(audit["registered_verbs"]) == set(VERB_HANDLERS.keys())
    # Aliases match explicit verb fields.
    assert audit["dispatched"] == audit["dispatched_verbs"]
    assert audit["declared_only"] == audit["declared_only_verbs"]
