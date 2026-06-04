"""Spell runtime pipeline audit (Stage 7).

Reports both verb and trigger executability against the runtime engine and
the service callsites that actually dispatch each trigger.

Verb coverage:

- `registered_verbs`: every verb type currently in `VERB_HANDLERS`.
- `dispatched_verbs`: declared verbs that have a registered handler.
- `declared_only_verbs`: declared verbs with no registered handler.

Trigger coverage:

- `dispatched_triggers`: declared triggers that have a currently wired service
  callsite in `WIRED_TRIGGERS`.
- `declared_only_triggers`: declared triggers with no wired callsite.

The legacy keys `dispatched` / `declared_only` are preserved as aliases for
the verb-oriented view so existing callers and tests keep working.
"""

from __future__ import annotations

from typing import Any, Dict, FrozenSet, List

from app.utils.rules_cache import get_all_spells, get_spell_effect_phases

from .verb_registry import VERB_HANDLERS

# Triggers currently wired through spell_runtime_service callsites.
# Keep in sync with the service-layer dispatch points:
#  * create_runtime_spell_instance         -> on_cast
#  * get_runtime_bonus_damage              -> on_hit, on_weapon_hit
#  * execute_runtime_action                -> on_action_invoked
#  * notify_target_downed                  -> on_target_downed
#  * end_concentration_runtime_instances   -> on_concentration_end
#  * execute_runtime_turn_triggers (S8)    -> start_of_turn, end_of_turn,
#                                             start_of_target_turn,
#                                             end_of_target_turn
#  * execute_runtime_zone_triggers (S10)   -> on_enter_zone, on_leave_zone
WIRED_TRIGGERS: FrozenSet[str] = frozenset(
    {
        "on_cast",
        "on_hit",
        "on_weapon_hit",
        "on_action_invoked",
        "on_target_downed",
        "on_concentration_end",
        "start_of_turn",
        "end_of_turn",
        "start_of_target_turn",
        "end_of_target_turn",
        "on_enter_zone",
        "on_leave_zone",
    }
)


def audit_pipeline() -> Dict[str, Any]:
    declared_verbs: set[str] = set()
    declared_triggers: set[str] = set()

    for spell in get_all_spells():
        option_keys: List[Any] = [None]
        option_keys.extend(
            opt.get("key")
            for opt in (spell.get("castOptions") or [])
            if opt.get("key")
        )
        seen: set[tuple[Any, str]] = set()
        for option_key in option_keys:
            for phase in get_spell_effect_phases(spell, option_key):
                key = (option_key, repr(phase))
                if key in seen:
                    continue
                seen.add(key)
                trigger = str(phase.get("trigger") or "on_cast")
                declared_triggers.add(trigger)
                for effect in phase.get("effects") or []:
                    verb_type = str(effect.get("type") or "")
                    if verb_type:
                        declared_verbs.add(verb_type)

    dispatched_verbs = sorted(declared_verbs & VERB_HANDLERS.keys())
    declared_only_verbs = sorted(declared_verbs - VERB_HANDLERS.keys())
    dispatched_triggers = sorted(declared_triggers & WIRED_TRIGGERS)
    declared_only_triggers = sorted(declared_triggers - WIRED_TRIGGERS)

    return {
        # Legacy keys (verb-oriented).
        "declared_verbs": sorted(declared_verbs),
        "declared_triggers": sorted(declared_triggers),
        "dispatched": dispatched_verbs,
        "declared_only": declared_only_verbs,
        "handler_count": len(VERB_HANDLERS),
        # Explicit verb fields.
        "registered_verbs": sorted(VERB_HANDLERS.keys()),
        "dispatched_verbs": dispatched_verbs,
        "declared_only_verbs": declared_only_verbs,
        # Explicit trigger fields.
        "dispatched_triggers": dispatched_triggers,
        "declared_only_triggers": declared_only_triggers,
    }
