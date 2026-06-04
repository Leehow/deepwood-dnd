"""Spell runtime phase executor (Stage 1).

Public exports:

    execute_phase, evaluate_phase           # phase_executor
    register_verb, VERB_HANDLERS            # verb_registry
    PhaseExecutionContext, VerbResult, PhaseResult   # context
    audit_pipeline                          # audit

Importing this package eagerly imports every verb module so that
`VERB_HANDLERS` is fully populated before the first `execute_phase` call.
"""

from __future__ import annotations

from .audit import audit_pipeline
from .context import PhaseExecutionContext, PhaseResult, VerbResult
from .phase_executor import evaluate_phase, execute_phase
from .verb_registry import VERB_HANDLERS, register_verb
from . import verbs  # noqa: F401  — register handlers on import

__all__ = [
    "PhaseExecutionContext",
    "PhaseResult",
    "VerbResult",
    "VERB_HANDLERS",
    "audit_pipeline",
    "evaluate_phase",
    "execute_phase",
    "register_verb",
]
