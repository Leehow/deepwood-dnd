"""Importing this package registers every Stage 1 verb handler."""

from __future__ import annotations

from . import (  # noqa: F401  — side-effect imports populate VERB_HANDLERS
    damage,
    granted_action,
    lifecycle,
    mark,
    modifier,
    narrative,
    runtime_param,
    visual,
)
