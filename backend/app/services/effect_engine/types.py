"""
Effect Engine core types.

These types decouple effect sources (spells, abilities, items, features)
from mechanical effect execution. Any data source can construct an
EffectSource + HandlerContext and route through the engine.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional

from sqlalchemy.ext.asyncio import AsyncSession


@dataclass
class EffectSource:
    """Tracks where an effect originates — used for cleanup and UI display."""

    type: Literal["spell", "ability", "item", "feature"]
    id: str          # spell_id / ability_id / item_id
    name: str        # display name (e.g. "火球术")
    caster_token_id: int
    concentration: bool = False
    instance_id: Optional[str] = None  # runtime spell instance ID
    slot_level: int = 0


@dataclass
class HandlerContext:
    """Everything a handler needs to execute a single effect on one target."""

    source: EffectSource
    # Target info — imported from spell_resolver to avoid circular deps
    target: Any  # TargetInfo
    # Caster context — SpellContext (or future CasterContext)
    caster_ctx: Any  # SpellContext
    # Raw phase data (duration, escape, ongoing_save, etc.)
    phase: Dict[str, Any]
    db: AsyncSession
    # Phase-level resolution results (computed before handler dispatch)
    save_cfg: Optional[Dict[str, Any]] = None
    save_succeeded: Optional[bool] = None
    attack_hit: Optional[bool] = None
    is_critical: bool = False
    scaling: Optional[Dict[str, Any]] = None
    # Accumulated damage from earlier effects in the same phase
    phase_damage_dealt: int = 0


@dataclass
class HandlerOutcome:
    """What a single handler execution produces."""

    # Numeric results
    damage_dealt: int = 0
    healing_done: int = 0
    temp_hp_granted: int = 0
    # Condition
    condition_applied: Optional[str] = None
    condition_immune: bool = False
    conditions_removed: List[str] = field(default_factory=list)
    # Display
    formula_breakdown: Optional[str] = None
    description: Optional[str] = None
    # Generated items (for generate_item handler)
    items_generated: List[Dict[str, Any]] = field(default_factory=list)
    # Extra EffectResult objects (e.g. blessed healer self-heal)
    extra_results: List[Any] = field(default_factory=list)


@dataclass
class SideEffects:
    """Cross-handler side effects accumulated by the engine during a phase.

    The spell resolver reads these after all effects are executed
    to populate SpellResolveResult.
    """

    concentration_broken_token_ids: List[int] = field(default_factory=list)
    concentration_touched_token_ids: set[int] = field(default_factory=set)
    runtime_touched_token_ids: set[int] = field(default_factory=set)
    items_generated: List[Dict[str, Any]] = field(default_factory=list)
