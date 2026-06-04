"""On-take-damage retaliation for defensive spells (armor_of_agathys, fire_shield).

When a token carrying a retaliation ``spell_buff`` is hit by a melee attack, the
spell deals damage back to the attacker (5 cold for Armor of Agathys, 2d8 for
Fire Shield). The ``on_take_damage`` phase lives in the spell definition; this
reader pulls it from the defender's active ``spell_buff`` markers and applies it
to the attacker — the defender-side mirror of ``get_runtime_bonus_damage`` (which
applies the attacker's ``on_hit`` riders).

The retaliation is read from a snapshot of the defender's ``active_effects``
captured *before* temp-HP absorption, so a hit that depletes the temp HP to zero
(removing the Armor of Agathys buff) still retaliates on that same hit, per RAW.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.monster_instance import MonsterInstance
from app.models.token import Token
from app.services.combat_resolution_service import apply_direct_token_damage
from app.services.realtime_publisher import realtime_publisher
from app.utils.dice_formula import evaluate as eval_formula
from app.utils.rules_cache import get_spell_by_id, get_spell_effect_phases

logger = logging.getLogger(__name__)

RETALIATION_TRIGGER = "on_take_damage"


@dataclass
class RetaliationStrike:
    """A single retaliation hit to deal back to the attacker."""
    spell_id: str
    spell_name: str
    damage: int
    damage_type: Optional[str]


def _normalize_damage_type(damage_type: Optional[str]) -> str:
    return str(damage_type or "").strip().lower()


def _eval_formula_total(formula: str) -> int:
    formula = (formula or "").strip()
    if not formula:
        return 0
    if formula.isdigit():
        return int(formula)
    return max(0, eval_formula(formula).total)


def _eval_retaliation_damage(
    formula: str,
    scaling: Optional[Dict[str, Any]],
    cast_level: int,
    base_level: int,
) -> int:
    """Roll the retaliation formula, adding per-slot upcast scaling.

    Armor of Agathys: ``formula="5"`` + ``scaling={"per_slot_above":1,
    "extra_damage":"5"}`` → 5 at 1st level, 10 at 2nd, ... Fire Shield:
    ``formula="2d8"`` with no scaling.
    """
    total = _eval_formula_total(formula)
    if scaling and cast_level > base_level:
        extra_formula = str(scaling.get("extra_damage") or "").strip()
        if extra_formula:
            per = int(scaling.get("per_slot_above") or 1) or 1
            increments = (cast_level - base_level) // per
            if increments > 0:
                total += _eval_formula_total(extra_formula) * increments
    return max(0, total)


def read_retaliation_strikes(
    active_effects: Optional[List[Dict[str, Any]]],
    *,
    defender_temp_hp_before: int,
    is_melee: bool,
) -> List[RetaliationStrike]:
    """Pull ``on_take_damage`` retaliation from the defender's spell_buff markers.

    Each buff names a ``spell_id``; the spell's ``on_take_damage`` phase carries
    the ``deal_damage`` verb (formula + damage_type) plus optional gating flags
    (``melee_only`` defaults true; ``requires_temp_hp`` gates Armor of Agathys on
    its remaining temp HP).
    """
    strikes: List[RetaliationStrike] = []
    for effect in active_effects or []:
        if not isinstance(effect, dict) or not effect.get("spell_buff"):
            continue
        spell_id = effect.get("spell_id")
        if not spell_id:
            continue
        spell = get_spell_by_id(spell_id)
        if not spell:
            continue
        base_level = int(spell.get("level") or 1)
        try:
            cast_level = int(effect.get("cast_level") or base_level)
        except (TypeError, ValueError):
            cast_level = base_level
        for phase in get_spell_effect_phases(spell, effect.get("selected_option")):
            if str(phase.get("trigger") or "").strip().lower() != RETALIATION_TRIGGER:
                continue
            if phase.get("melee_only", True) and not is_melee:
                continue
            if phase.get("requires_temp_hp") and (defender_temp_hp_before or 0) <= 0:
                continue
            for verb in phase.get("effects") or []:
                if not isinstance(verb, dict) or verb.get("type") != "deal_damage":
                    continue
                damage = _eval_retaliation_damage(
                    str(verb.get("formula") or ""),
                    phase.get("scaling"),
                    cast_level,
                    base_level,
                )
                if damage > 0:
                    strikes.append(RetaliationStrike(
                        spell_id=str(spell_id),
                        spell_name=spell.get("name") or str(spell_id),
                        damage=damage,
                        damage_type=verb.get("damage_type"),
                    ))
    return strikes


def _attacker_damage_mods(monster: Optional[MonsterInstance]) -> tuple[set, set]:
    """Collect the attacker's normalized damage resistances/immunities.

    Reads monster ``monster_data`` (canonical) and ``status_effects`` (QA fixture)
    sources. Characters rarely melee while a retaliation aura is up; their
    resistances are left to the broader mitigation pipeline.
    """
    resistances: set = set()
    immunities: set = set()
    if monster is None:
        return resistances, immunities
    for src in (monster.monster_data or {}, monster.status_effects or {}):
        if not isinstance(src, dict):
            continue
        for key in ("damage_resistances", "resistances"):
            for dtype in src.get(key) or []:
                resistances.add(_normalize_damage_type(dtype))
        for key in ("damage_immunities", "immunities"):
            for dtype in src.get(key) or []:
                immunities.add(_normalize_damage_type(dtype))
    return resistances, immunities


async def apply_on_take_damage_retaliation(
    db: AsyncSession,
    *,
    campaign_id: int,
    defender_active_effects: Optional[List[Dict[str, Any]]],
    defender_temp_hp_before: int,
    defender_token_id: Optional[int],
    attacker_token_id: Optional[int],
    attacker_name: str,
    defender_name: str,
    is_melee: bool,
    hit: bool,
    auto_apply: bool,
) -> List[str]:
    """Fire the defender's ``on_take_damage`` retaliation back at the attacker.

    Returns human-readable notes (one per strike) for the combat narrative.
    Mutates + commits the attacker token's HP via ``apply_direct_token_damage``
    and broadcasts the change. No-op unless a real melee hit was auto-applied.
    """
    if not (hit and is_melee and auto_apply):
        return []
    if not attacker_token_id or not defender_token_id or attacker_token_id == defender_token_id:
        return []

    strikes = read_retaliation_strikes(
        defender_active_effects,
        defender_temp_hp_before=defender_temp_hp_before,
        is_melee=is_melee,
    )
    if not strikes:
        return []

    attacker_token = await db.get(Token, attacker_token_id)
    if not attacker_token:
        return []
    monster = (
        await db.get(MonsterInstance, attacker_token.monster_instance_id)
        if attacker_token.monster_instance_id else None
    )
    resistances, immunities = _attacker_damage_mods(monster)

    notes: List[str] = []
    for strike in strikes:
        dmg = strike.damage
        dtype = _normalize_damage_type(strike.damage_type)
        if dtype and dtype in immunities:
            continue
        if dtype and dtype in resistances:
            dmg //= 2
        if dmg <= 0:
            continue

        result = await apply_direct_token_damage(
            db, target_token_id=attacker_token_id, damage_amount=dmg,
        )
        if result.new_hp is None:
            continue

        await realtime_publisher.publish_token_hp_updated(
            campaign_id,
            token_id=attacker_token_id,
            current_hp=result.new_hp,
            temp_hp=result.temp_hp,
            hp_change=result.hp_change,
            target_defeated=result.target_defeated,
            character_id=result.character_id,
            active_effects=result.active_effects,
        )
        notes.append(
            f"\U0001f6e1️ {defender_name} 的【{strike.spell_name}】对 "
            f"{attacker_name} 造成 {dmg} 点{strike.damage_type or ''}伤害"
        )
        logger.info(
            "[Retaliation] %s -> %s: %d %s (spell=%s)",
            defender_name, attacker_name, dmg, strike.damage_type, strike.spell_id,
        )
    return notes
