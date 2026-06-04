"""Execute legacy ``Token.active_effects`` ``ongoing_effects`` on turn boundaries.

The v2 SpellRuntimeInstance flow has its own per-turn dispatcher
(``execute_runtime_turn_triggers``). Spells not yet migrated still live on
``Token.active_effects`` as dicts written by ``SpellResolver`` with shape:

    {"id": "<spell>_ongoing", "spell_id": "<spell>", "sourceSpell": "<spell>",
     "source_token_id": <caster>, "sourceTokenId": <caster>,
     "ongoing_trigger": "start_of_target_turn" | "end_of_target_turn" | ...,
     "ongoing_effects": [{"type": "grant_temp_hp", "formula": "MOD"}, ...],
     "cast_level": <slot>, "save": <optional>, ...}

``/combat/batch-ongoing-saves`` handles entries with ``ongoing_save`` /
``ongoingSave``. Non-save entries (Heroism's grant_temp_hp on
``start_of_target_turn``) had no executor, so target tokens never received
their temp HP at turn start. This module fills that gap: it touches only the
ending/starting token, runs effects whose trigger matches, and routes every
effect through the existing ``effect_engine``.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Set

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.character import Character
from app.models.monster_instance import MonsterInstance
from app.models.token import Token

logger = logging.getLogger(__name__)


_END_TRIGGERS: Set[str] = {"end_of_turn", "end_of_target_turn"}
_START_TRIGGERS: Set[str] = {"start_of_turn", "start_of_target_turn"}

# Mirrors CLASS_SPELLCASTING_ABILITY in app/api/routes/spell_cast.py; duplicated
# to keep the entire route module (and its many transitive imports) off the
# combat hook path.
_CLASS_SPELLCASTING_ABILITY = {
    "wizard": "intelligence", "artificer": "intelligence",
    "cleric": "wisdom", "druid": "wisdom",
    "ranger": "wisdom", "monk": "wisdom",
    "bard": "charisma", "paladin": "charisma",
    "sorcerer": "charisma", "warlock": "charisma",
}


def _int_or_none(value: Any) -> Optional[int]:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _matching_effects(
    active_effects: Optional[List[Dict[str, Any]]],
    allowed_triggers: Set[str],
) -> List[Dict[str, Any]]:
    """Entries that should fire here. Skips: non-matching trigger, missing /
    empty ``ongoing_effects``, and save-gated entries (those belong to
    ``/combat/batch-ongoing-saves`` which rolls the save first)."""
    if not isinstance(active_effects, list):
        return []
    out: List[Dict[str, Any]] = []
    for entry in active_effects:
        if not isinstance(entry, dict):
            continue
        if entry.get("ongoing_trigger") not in allowed_triggers:
            continue
        effects = entry.get("ongoing_effects")
        if not isinstance(effects, list) or not effects:
            continue
        if entry.get("ongoing_save") or entry.get("ongoingSave"):
            continue
        out.append(entry)
    return out


async def _build_caster_spell_context(
    db: AsyncSession,
    *,
    caster_token: Optional[Token],
    spell_id: str,
    slot_level: int,
    spell_name: str,
    campaign_id: int,
    concentration: bool,
):
    """Rebuild a SpellContext for the caster. Falls back to a minimal context
    (mod=0, prof=2, dc=8) when the caster cannot be resolved — sufficient for
    handlers whose formulas don't reference MOD/PROF/LEVEL."""
    from app.api.routes.character_utils import (
        calculate_ability_modifier,
        calculate_proficiency_bonus,
    )
    from app.services.spell_resolver import SpellContext

    caster_token_id = caster_token.id if caster_token else 0
    caster_name = "施法者"
    caster_level = 1
    class_id: Optional[str] = None
    subclass_id: Optional[str] = None
    ability_scores: Dict[str, int] = {}
    spellcasting_mod = 0
    prof_bonus = 2

    if caster_token is not None:
        caster_name = caster_token.instance_name or caster_name
        if caster_token.character_id:
            character = await db.get(Character, caster_token.character_id)
            if character is not None:
                caster_name = character.name or caster_name
                caster_level = character.level or 1
                class_id = character.class_id
                subclass_id = character.subclass_id
                ability_scores = character.ability_scores or {}
                prof_bonus = calculate_proficiency_bonus(caster_level)
                ability = _CLASS_SPELLCASTING_ABILITY.get(
                    (class_id or "").lower(), "intelligence"
                )
                score = int(ability_scores.get(ability, 10))
                spellcasting_mod = calculate_ability_modifier(score)
        elif caster_token.monster_instance_id:
            monster = await db.get(
                MonsterInstance, caster_token.monster_instance_id
            )
            if monster is not None:
                ability_scores = monster.ability_scores or {}
                # Best-effort modifier from the highest stat. Non-save legacy
                # ongoing effects (the only ones this executor runs) rarely
                # consult it; this just keeps a sensible default.
                if ability_scores:
                    best = max(
                        int(v) for v in ability_scores.values() if v is not None
                    )
                    spellcasting_mod = calculate_ability_modifier(best)

    spell_save_dc = 8 + prof_bonus + spellcasting_mod
    spell_attack_bonus = prof_bonus + spellcasting_mod

    return SpellContext(
        caster_token_id=caster_token_id,
        caster_name=caster_name,
        caster_level=caster_level,
        spellcasting_mod=spellcasting_mod,
        proficiency_bonus=prof_bonus,
        spell_save_dc=spell_save_dc,
        spell_attack_bonus=spell_attack_bonus,
        slot_level=int(slot_level or 0),
        spell_id=spell_id,
        spell_name=spell_name,
        caster_class_id=class_id,
        caster_subclass_id=subclass_id,
        caster_ability_scores=ability_scores,
        concentration=bool(concentration),
        campaign_id=campaign_id,
        in_combat=True,
    )


def _build_target_info(token: Token):
    """Minimal TargetInfo. ``Token`` itself has no ``max_hp`` column (see
    backend/app/models/token.py); we use ``getattr`` so adding one later
    doesn't change behaviour and missing it today doesn't blow up."""
    from app.services.spell_resolver import TargetInfo

    return TargetInfo(
        token_id=token.id,
        name=token.instance_name or f"token-{token.id}",
        current_hp=token.current_hp,
        max_hp=getattr(token, "max_hp", None),
        character_id=token.character_id,
        monster_instance_id=token.monster_instance_id,
        active_effects=token.active_effects or [],
    )


async def _run_entry(
    db: AsyncSession,
    *,
    token: Token,
    entry: Dict[str, Any],
    campaign_id: int,
) -> bool:
    """Execute one matched entry. Returns True iff at least one effect ran."""
    from app.services.effect_engine.engine import (
        EffectValidationError,
        UnknownVerbError,
        get_engine,
    )
    from app.services.effect_engine.types import (
        EffectSource,
        HandlerContext,
        SideEffects,
    )
    from app.utils.rules_cache import get_spell_by_id

    spell_id = (
        entry.get("spell_id")
        or entry.get("spellId")
        or entry.get("sourceSpell")
        or ""
    )
    spell_data = get_spell_by_id(spell_id) if spell_id else None
    spell_name = entry.get("name") or (spell_data or {}).get("name", spell_id)
    slot_level = (
        _int_or_none(entry.get("cast_level"))
        or _int_or_none(entry.get("slot_level"))
        or 0
    )
    concentration = bool(entry.get("is_concentration"))

    caster_token_id = _int_or_none(entry.get("source_token_id")) or _int_or_none(
        entry.get("sourceTokenId")
    )
    caster_token: Optional[Token] = None
    if caster_token_id is not None:
        caster_token = await db.get(Token, caster_token_id)

    caster_ctx = await _build_caster_spell_context(
        db,
        caster_token=caster_token,
        spell_id=spell_id,
        slot_level=slot_level,
        spell_name=spell_name,
        campaign_id=campaign_id,
        concentration=concentration,
    )
    target = _build_target_info(token)
    source = EffectSource(
        type="spell",
        id=spell_id or entry.get("id", ""),
        name=spell_name,
        caster_token_id=caster_ctx.caster_token_id,
        concentration=concentration,
        slot_level=slot_level,
    )

    engine = get_engine()
    side_effects = SideEffects()
    any_ran = False
    for raw_effect in entry.get("ongoing_effects") or []:
        if not isinstance(raw_effect, dict) or not raw_effect.get("type"):
            continue
        hctx = HandlerContext(
            source=source, target=target, caster_ctx=caster_ctx,
            phase=entry, db=db,
        )
        try:
            await engine.execute_effect(raw_effect, hctx, side_effects)
            any_ran = True
        except (UnknownVerbError, EffectValidationError) as exc:
            logger.warning(
                "Skipping legacy ongoing effect %r on token %s: %s",
                raw_effect.get("type"), token.id, exc,
            )
        except Exception:
            logger.exception(
                "Legacy ongoing effect handler raised for token %s effect %r",
                token.id, raw_effect.get("type"),
            )
    return any_ran


async def _publish_token_changes(
    *,
    campaign_id: int,
    token: Token,
    pre_hp: Optional[int],
    pre_temp: Optional[int],
    pre_effects: List[Dict[str, Any]],
) -> None:
    from app.services.realtime_publisher import realtime_publisher

    hp_or_temp_changed = (
        token.current_hp != pre_hp or (token.temp_hp or 0) != (pre_temp or 0)
    )
    effects_changed = (token.active_effects or []) != pre_effects

    if hp_or_temp_changed:
        await realtime_publisher.publish_token_hp_updated(
            campaign_id,
            token_id=token.id,
            current_hp=token.current_hp,
            temp_hp=token.temp_hp,
            active_effects=token.active_effects,
            character_id=token.character_id,
            monster_instance_id=token.monster_instance_id,
        )
    elif effects_changed:
        await realtime_publisher.publish_token_active_effects_updated(
            campaign_id,
            token_id=token.id,
            active_effects=token.active_effects,
            character_id=token.character_id,
            monster_instance_id=token.monster_instance_id,
        )


async def _execute_for_token(
    db: AsyncSession,
    *,
    campaign_id: int,
    token_id: int,
    allowed_triggers: Set[str],
) -> bool:
    token = await db.get(Token, token_id)
    if token is None or int(token.campaign_id) != int(campaign_id):
        return False
    matches = _matching_effects(token.active_effects, allowed_triggers)
    if not matches:
        return False

    pre_hp = token.current_hp
    pre_temp = token.temp_hp
    pre_effects = list(token.active_effects or [])
    touched = False
    for entry in matches:
        if await _run_entry(
            db, token=token, entry=entry, campaign_id=campaign_id
        ):
            touched = True
    if not touched:
        return False

    flag_modified(token, "active_effects")
    await db.flush()
    await db.commit()
    await _publish_token_changes(
        campaign_id=campaign_id,
        token=token,
        pre_hp=pre_hp,
        pre_temp=pre_temp,
        pre_effects=pre_effects,
    )
    return True


async def execute_legacy_turn_ongoing_effects(
    db: AsyncSession,
    *,
    campaign_id: int,
    ending_token_id: Optional[int],
    starting_token_id: Optional[int],
    current_round: Optional[int] = None,
) -> Dict[str, bool]:
    """Run matching legacy ongoing effects on the ending/starting tokens for
    the current turn transition. Returns a small status dict for tests; the
    dispatcher ignores the return value."""
    del current_round  # reserved for round-based expiry
    fired_end = False
    fired_start = False
    if ending_token_id is not None:
        fired_end = await _execute_for_token(
            db, campaign_id=campaign_id,
            token_id=int(ending_token_id),
            allowed_triggers=_END_TRIGGERS,
        )
    if starting_token_id is not None:
        fired_start = await _execute_for_token(
            db, campaign_id=campaign_id,
            token_id=int(starting_token_id),
            allowed_triggers=_START_TRIGGERS,
        )
    return {"ending_fired": fired_end, "starting_fired": fired_start}


__all__ = [
    "execute_legacy_turn_ongoing_effects",
    "_matching_effects",
    "_END_TRIGGERS",
    "_START_TRIGGERS",
]
