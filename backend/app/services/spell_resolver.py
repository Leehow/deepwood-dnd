"""
Spell Effect Resolver — orchestration layer for the effect pipeline.

Reads a spell's `effects` array and dispatches to existing services:
  - Damage → dice_formula + combat helpers
  - Healing → dice_formula + combat helpers
  - Conditions → active_effects + immunity_service
  - Buffs → active_effects (effect_service reads modifiers)
  - TempHP → token.temp_hp
  - Concentration → token.concentration_spell

Falls back to None for spells without `effects` field (old path).
"""
import logging
import random
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy import update

from app.utils.pending_effects import apply_pending_damage_received_effects
from app.utils.rules_cache import get_spell_by_id, spell_has_effect_type
from app.schemas.spell_effect import (
    EffectResult, SpellResolveResult,
)
from app.models.token import Token
from app.models.character import Character
from app.models.monster_instance import MonsterInstance
from app.services.combat_spell_service import remove_expired_temp_hp_spell_effects
from app.services.character_progression_service import calculate_max_hp
from app.services.qa.forced_roll import qa_randint
from app.services.effect_engine.creature_types import creature_type_matches

logger = logging.getLogger(__name__)

# Visual mapping for on_hit spell buffs displayed on token
_DAMAGE_TYPE_VISUALS = {
    "radiant": ("✨", "#eab308"),
    "necrotic": ("💀", "#7c3aed"),
    "fire": ("🔥", "#f97316"),
    "thunder": ("⚡", "#6366f1"),
    "psychic": ("😡", "#dc2626"),
    "cold": ("❄️", "#38bdf8"),
    "lightning": ("⚡", "#facc15"),
    "acid": ("🧪", "#22c55e"),
    "force": ("💫", "#a78bfa"),
    "poison": ("🤢", "#16a34a"),
}


def _on_hit_buff_visual(damage_type: str) -> tuple[str, str]:
    """Return (icon, color) for an on-hit buff based on damage type."""
    return _DAMAGE_TYPE_VISUALS.get(damage_type, ("⚔️", "#9ca3af"))


class SpellContext:
    """All info the resolver needs about the current spell cast."""

    def __init__(
        self,
        caster_token_id: int,
        caster_name: str,
        caster_level: int,
        spellcasting_mod: int,
        proficiency_bonus: int,
        spell_save_dc: int,
        spell_attack_bonus: int,
        spell_level: Optional[int] = None,
        slot_level: int = 0,
        spell_id: str = "",
        spell_name: str = "",
        caster_class_id: Optional[str] = None,
        caster_subclass_id: Optional[str] = None,
        caster_ability_scores: Optional[Dict[str, int]] = None,
        concentration: bool = False,
        campaign_id: Optional[int] = None,
        in_combat: bool = True,
        selected_option: Optional[str] = None,
        current_world_time: Optional[Dict[str, Any]] = None,
    ):
        self.caster_token_id = caster_token_id
        self.caster_name = caster_name
        self.caster_level = caster_level
        self.caster_class_id = caster_class_id
        self.caster_subclass_id = caster_subclass_id
        self.caster_ability_scores = caster_ability_scores or {}
        self.spellcasting_mod = spellcasting_mod
        self.proficiency_bonus = proficiency_bonus
        self.spell_save_dc = spell_save_dc
        self.spell_attack_bonus = spell_attack_bonus
        self.spell_level = spell_level if spell_level is not None else slot_level
        self.slot_level = slot_level
        self.spell_id = spell_id
        self.spell_name = spell_name
        self.concentration = concentration
        self.campaign_id = campaign_id
        self.current_world_time = current_world_time
        self.in_combat = in_combat
        self.selected_option = selected_option
        self.target_auto_fail_save = False

    @property
    def variables(self) -> Dict[str, int]:
        return {
            "MOD": self.spellcasting_mod,
            "PROF": self.proficiency_bonus,
            "LEVEL": self.caster_level,
        }


class TargetInfo:
    """Target token info for effect resolution."""

    # Size ordering for comparison
    SIZE_ORDER = {"微型": 0, "超小型": 0, "小型": 1, "中型": 2, "大型": 3, "巨型": 4, "超巨型": 5}

    def __init__(
        self,
        token_id: int,
        name: str,
        ac: int = 10,
        current_hp: Optional[int] = None,
        max_hp: Optional[int] = None,
        character_id: Optional[int] = None,
        monster_instance_id: Optional[int] = None,
        damage_resistances: Optional[List[str]] = None,
        damage_immunities: Optional[List[str]] = None,
        condition_immunities: Optional[List[str]] = None,
        active_effects: Optional[List[Dict]] = None,
        ability_scores: Optional[Dict[str, int]] = None,
        level: int = 1,
        class_id: Optional[str] = None,
        proficiency_bonus: int = 2,
        save_override: Optional[int] = None,
        creature_type: Optional[str] = None,
        size: Optional[str] = None,
    ):
        self.token_id = token_id
        self.name = name
        self.ac = ac
        self.current_hp = current_hp
        self.max_hp = max_hp
        self.character_id = character_id
        self.monster_instance_id = monster_instance_id
        self.damage_resistances = damage_resistances or []
        self.damage_immunities = damage_immunities or []
        self.condition_immunities = condition_immunities or []
        self.active_effects = active_effects or []
        self.ability_scores = ability_scores or {}
        self.level = level
        self.class_id = class_id
        self.proficiency_bonus = proficiency_bonus
        self.save_override = save_override
        self.creature_type = creature_type or ""
        self.size = size or "中型"

    def size_index(self) -> int:
        return self.SIZE_ORDER.get(self.size, 2)


class SpellResolver:
    """
    Reads a spell's `effects` and executes them using existing services.

    Usage:
        resolver = SpellResolver()
        result = await resolver.resolve(spell_data, ctx, targets, db)
        if result is None:
            # No effects field → fall back to old path
    """

    @staticmethod
    def _calc_expires_at(current_time: Dict[str, Any], duration_rounds: int) -> Dict[str, Any]:
        """Calculate world-time expiration: current_time + duration_rounds * 6 seconds."""
        total_sec = (
            int(current_time.get("day", 1)) * 86400
            + int(current_time.get("hour", 0)) * 3600
            + int(current_time.get("minute", 0)) * 60
            + int(current_time.get("second", 0))
            + duration_rounds * 6
        )
        day = max(1, total_sec // 86400)
        remainder = total_sec % 86400
        hour = remainder // 3600
        remainder %= 3600
        minute = remainder // 60
        second = remainder % 60
        return {"day": day, "hour": hour, "minute": minute, "second": second}

    def _ensure_effect_source_metadata(
        self,
        effect_data: Dict[str, Any],
        ctx: SpellContext,
    ) -> Dict[str, Any]:
        """Backfill source/caster metadata used by cleanup and frontend sync."""
        effect_data.setdefault("source", ctx.spell_name)
        effect_data.setdefault("source_token_id", ctx.caster_token_id)
        effect_data.setdefault("sourceTokenId", ctx.caster_token_id)
        effect_data.setdefault("spell_id", ctx.spell_id)
        effect_data.setdefault("spellId", ctx.spell_id)
        effect_data.setdefault("sourceSpell", ctx.spell_id)
        effect_data.setdefault("cast_level", ctx.slot_level)
        return effect_data

    # Whitelist of contextual keys allowed to be merged from the route into
    # each phase dict before handler dispatch. Adding a new key here is the
    # only way to surface route-side picker data (e.g. Misty Step
    # destination) to a handler that reads from `hctx.phase`.
    _ALLOWED_PHASE_CONTEXT_KEYS = {"teleport_destination"}

    async def resolve(
        self,
        spell_data: Dict[str, Any],
        ctx: SpellContext,
        targets: List[TargetInfo],
        db: AsyncSession,
        phase_context: Optional[Dict[str, Any]] = None,
    ) -> Optional[SpellResolveResult]:
        """
        Main entry point. Returns None if spell has no `effects` field.

        `phase_context` carries route-side picker data (currently only
        `teleport_destination`) that should be merged into each phase dict
        so handlers like TeleportHandler can read it from `hctx.phase`.
        """
        self._phase_context = {
            k: v for k, v in (phase_context or {}).items()
            if k in self._ALLOWED_PHASE_CONTEXT_KEYS and v is not None
        }
        effects_phases = list(spell_data.get("effects") or [])

        # Rules-cache fallback: when the area-cast route receives a SpellData
        # payload that omits the effects field (frontend default is None), look
        # up the spell by ID so structured spells like call_lightning still
        # resolve instead of returning None and triggering the route error.
        if not effects_phases and spell_data.get("id"):
            cached = get_spell_by_id(spell_data["id"])
            if cached:
                effects_phases = list(cached.get("effects") or [])

        # Merge castOption effects when a selected_option is provided
        cast_options = spell_data.get("castOptions")
        if cast_options and ctx.selected_option:
            option = next((o for o in cast_options if o.get("key") == ctx.selected_option), None)
            if option and option.get("effects"):
                effects_phases = effects_phases + list(option["effects"])

        if not effects_phases:
            return None

        # Cantrip character-level damage scaling: deal_damage leaves carry the
        # level-1 formula, while the per-level dice live in the spell's top-level
        # `damageAtCharacterLevel` map. Resolve the caster-level formula here — the
        # unified cast path otherwise always used the level-1 dice (1 die forever).
        dacl = spell_data.get("damageAtCharacterLevel")
        if dacl and (spell_data.get("level") or ctx.spell_level or 0) == 0:
            scaled = self._select_cantrip_formula(dacl, ctx.caster_level or 1)
            if scaled:
                import copy
                effects_phases = copy.deepcopy(effects_phases)
                for _ph in effects_phases:
                    self._rewrite_deal_damage_formula(_ph, scaled)

        result = SpellResolveResult()
        self._last_items_generated: List[Dict[str, Any]] = []
        self._concentration_broken_ids: List[int] = []
        self._concentration_touched_ids: set[int] = set()
        self._runtime_touched_token_ids: set[int] = set()
        self._caster_passive_features: Optional[Dict[str, Any]] = None
        self._blessed_healer_consumed = False

        if ctx.caster_class_id:
            from app.services.passive_feature_service import get_passive_features
            self._caster_passive_features = get_passive_features(
                ctx.caster_class_id,
                ctx.caster_level,
                ctx.caster_subclass_id,
            )

        for phase in effects_phases:
            trigger = phase.get("trigger", "on_cast")

            if trigger == "narrative":
                # 纯RP型：只生成叙事文本，不执行机械效果
                desc = phase.get("description") or ctx.spell_name
                er = EffectResult(type="narrative", description=desc)
                result.phase_results.append([er])
            elif trigger == "on_cast":
                phase_results = await self._execute_phase(
                    phase, ctx, targets, db
                )
                result.phase_results.append(phase_results)
            else:
                # Deferred triggers → register into active_effects
                await self._register_deferred_phase(
                    phase, ctx, targets, db
                )

        # Aggregate totals
        for phase_res in result.phase_results:
            for er in phase_res:
                result.total_damage += er.damage_dealt
                result.total_healing += er.healing_done
                if er.description:
                    result.narrative_parts.append(er.description)

        # Attach generated items
        result.items_generated = self._last_items_generated
        result.concentration_broken_token_ids = self._concentration_broken_ids
        result.concentration_touched_token_ids = sorted(self._concentration_touched_ids)
        result.runtime_touched_token_ids = sorted(self._runtime_touched_token_ids)

        return result

    def _phase_with_context(self, phase: Dict[str, Any]) -> Dict[str, Any]:
        """Return a shallow-merged phase dict carrying whitelisted route
        context (e.g. teleport_destination). The route picker data wins
        over spell-defined phase keys of the same name, since route data
        represents the user's just-made choice."""
        ctx = getattr(self, "_phase_context", None) or {}
        if not ctx:
            return phase
        return {**phase, **ctx}

    async def _execute_phase(
        self,
        phase: Dict[str, Any],
        ctx: SpellContext,
        targets: List[TargetInfo],
        db: AsyncSession,
    ) -> List[EffectResult]:
        """Execute an immediate phase against targets."""
        phase = self._phase_with_context(phase)
        results: List[EffectResult] = []
        save_cfg = phase.get("save")
        attack_cfg = phase.get("attack")
        scaling = phase.get("scaling")
        # Creature-type exclusions (e.g. cure wounds does not heal undead/construct).
        exclude_types = (
            phase.get("excludeCreatureTypes")
            or phase.get("exclude_creature_types")
            or []
        )
        # Creature-type inclusions (positive gating, e.g. animal_friendship only
        # affects beasts, awaken only beast/plant). A target whose type is not in
        # this list is unaffected by the phase.
        target_types = (
            phase.get("targetCreatureTypes")
            or phase.get("target_creature_types")
            or []
        )

        # Pre-pass: handle generate_item effects once (operates on caster, not targets)
        from app.services.effect_engine import (
            EffectSource, HandlerContext as HCtx, SideEffects as SE, get_engine,
        )
        remaining_effects = []
        for effect in phase.get("effects", []):
            if effect.get("type") == "generate_item":
                engine = get_engine()
                hctx = HCtx(
                    source=EffectSource(
                        type="spell", id=ctx.spell_id, name=ctx.spell_name,
                        caster_token_id=ctx.caster_token_id,
                        concentration=ctx.concentration, slot_level=ctx.slot_level,
                    ),
                    target=None, caster_ctx=ctx, phase=phase, db=db,
                )
                gen_se = SE()
                outcome = await engine.execute_effect(effect, hctx, gen_se)
                er = EffectResult(
                    type="generate_item",
                    target_token_id=ctx.caster_token_id,
                    target_name=ctx.caster_name,
                    description=outcome.description,
                )
                self._last_items_generated.extend(gen_se.items_generated)
                results.append(er)
            else:
                remaining_effects.append(effect)

        # ── Creature-type gating → eligible targets ──
        # A creature whose type is excluded (5e: undead/construct ignore cure
        # wounds) or outside a positive-gating set (animal_friendship → beasts
        # only) is unaffected by every effect in this phase.
        eligible = []
        for target in targets:
            if exclude_types and creature_type_matches(target.creature_type, exclude_types):
                results.append(EffectResult(
                    type="excluded",
                    target_token_id=target.token_id,
                    target_name=target.name,
                    description=f"{target.name} 的生物类型不受该法术影响",
                ))
                continue
            if target_types and not creature_type_matches(target.creature_type, target_types):
                results.append(EffectResult(
                    type="excluded",
                    target_token_id=target.token_id,
                    target_name=target.name,
                    description=f"{target.name} 的生物类型不是该法术的有效目标",
                ))
                continue
            eligible.append(target)

        # ── Resolution targets (shots) ──
        # Attack phases that fire multiple projectiles (eldritch_blast beams,
        # scorching_ray rays) resolve N independent attack rolls, round-robin
        # over the eligible targets (N total). Single-projectile attack phases
        # and save/buff phases resolve once per eligible target (unchanged).
        if attack_cfg and eligible:
            projectile_count = self._projectile_count(attack_cfg, scaling, ctx)
            if projectile_count > 1:
                shots = [eligible[i % len(eligible)] for i in range(projectile_count)]
            else:
                shots = eligible
        else:
            shots = eligible

        for target in shots:

            # ── Attack roll (melee_spell / ranged_spell) ──
            attack_hit = None
            attack_d20 = None
            attack_total = None
            is_crit = False
            if attack_cfg:
                attack_d20 = qa_randint(1, 20)
                attack_total = attack_d20 + ctx.spell_attack_bonus
                is_crit = attack_d20 == 20
                attack_hit = is_crit or (attack_d20 != 1 and attack_total >= target.ac)

            # ── Save roll ──
            save_succeeded = None
            save_total = None
            if save_cfg and not attack_cfg:  # attack and save are mutually exclusive
                save_succeeded, save_total = self._roll_save(
                    target, save_cfg, ctx
                )

            phase_damage_dealt = 0  # Track damage for half_damage healing
            for effect in remaining_effects:
                etype = effect.get("type", "")
                er = EffectResult(
                    type=etype,
                    target_token_id=target.token_id,
                    target_name=target.name,
                )
                extra_results: List[EffectResult] = []

                # Populate attack fields
                if attack_cfg:
                    er.attack_rolled = True
                    er.attack_hit = attack_hit
                    er.attack_roll = attack_d20
                    er.attack_total = attack_total
                    er.target_ac = target.ac
                    er.critical_hit = is_crit

                # Attack miss → check on_miss policy
                if attack_hit is False and attack_cfg:
                    on_miss = attack_cfg.get("on_miss", "no_effect")
                    if on_miss == "no_effect":
                        results.append(er)
                        continue
                    # half_damage: let damage through but halve it below

                # If save succeeded, check what happens
                if save_succeeded is True and save_cfg:
                    on_success = save_cfg.get("on_success", "no_effect")
                    # "no_effect" negates the ENTIRE phase on a successful save —
                    # regardless of effect type. (Was previously limited to
                    # deal_damage/apply_condition/apply_effect, which let
                    # apply_transformation / set_disguise / resize_token etc. wrongly
                    # apply on a save — e.g. polymorph/true_polymorph/seeming.)
                    if on_success == "no_effect":
                        er.save_rolled = True
                        er.save_succeeded = True
                        er.save_total = save_total
                        er.save_dc = ctx.spell_save_dc
                        results.append(er)
                        continue

                if save_cfg:
                    er.save_rolled = True
                    er.save_succeeded = save_succeeded
                    er.save_total = save_total
                    er.save_dc = ctx.spell_save_dc

                # ── Dispatch through Effect Engine ──
                from app.services.effect_engine import (
                    EffectSource, HandlerContext as HCtx, SideEffects, get_engine,
                )

                engine = get_engine()
                if engine.can_handle(etype):
                    hctx = HCtx(
                        source=EffectSource(
                            type="spell",
                            id=ctx.spell_id,
                            name=ctx.spell_name,
                            caster_token_id=ctx.caster_token_id,
                            concentration=ctx.concentration,
                            slot_level=ctx.slot_level,
                        ),
                        target=target,
                        caster_ctx=ctx,
                        phase=phase,
                        db=db,
                        save_cfg=save_cfg,
                        save_succeeded=save_succeeded,
                        attack_hit=attack_hit,
                        is_critical=is_crit,
                        scaling=scaling,
                        phase_damage_dealt=phase_damage_dealt,
                    )
                    engine_side = SideEffects()
                    outcome = await engine.execute_effect(effect, hctx, engine_side)

                    # Map HandlerOutcome → EffectResult
                    er.damage_dealt = outcome.damage_dealt
                    er.healing_done = outcome.healing_done
                    er.temp_hp_granted = outcome.temp_hp_granted
                    er.condition_applied = outcome.condition_applied
                    er.condition_immune = outcome.condition_immune
                    er.formula_breakdown = outcome.formula_breakdown
                    if outcome.description:
                        er.description = outcome.description

                    # Merge engine side effects
                    self._concentration_broken_ids.extend(engine_side.concentration_broken_token_ids)
                    self._concentration_touched_ids.update(engine_side.concentration_touched_token_ids)
                    self._runtime_touched_token_ids.update(engine_side.runtime_touched_token_ids)
                    self._last_items_generated.extend(engine_side.items_generated)

                    # Post-dispatch: damage HP application + pending effects
                    if etype == "deal_damage" and er.damage_dealt > 0:
                        damage_type = effect.get("damage_type", "")
                        pending_damage_result = await apply_pending_damage_received_effects(
                            token=await db.get(Token, target.token_id) if target.token_id else None,
                            damage_amount=er.damage_dealt,
                            damage_type=damage_type,
                            db=db,
                            resistance_already_applied=self._check_resistance(
                                damage_type, target.damage_resistances,
                            ),
                            immunity_already_applied=self._check_immunity(
                                damage_type, target.damage_immunities,
                            ),
                            consume_effects=True,
                        )
                        er.damage_dealt = pending_damage_result.damage_after_effects
                        for tid in pending_damage_result.concentration_touched_token_ids:
                            self._concentration_touched_ids.add(int(tid))

                    if etype == "deal_damage" and er.damage_dealt > 0:
                        phase_damage_dealt += er.damage_dealt
                        await self._apply_hp_change(target, -er.damage_dealt, db)

                    if etype == "heal" and er.healing_done > 0:
                        if effect.get("heal_target") == "caster":
                            er.target_token_id = ctx.caster_token_id
                            er.target_name = ctx.caster_name
                            er.healing_done = await self._apply_hp_change_by_id(
                                ctx.caster_token_id, er.healing_done, db
                            )
                        else:
                            await self._apply_hp_change(target, er.healing_done, db)
                            blessed_healer_result = await self._maybe_apply_blessed_healer(
                                ctx, target, er.healing_done, db,
                            )
                            if blessed_healer_result:
                                extra_results.append(blessed_healer_result)

                    extra_results.extend(
                        EffectResult(
                            type=r.type if hasattr(r, 'type') else "heal",
                            target_token_id=r.target_token_id,
                            target_name=r.target_name,
                            healing_done=r.healing_done,
                            formula_breakdown=r.formula_breakdown,
                        )
                        for r in outcome.extra_results
                    )
                else:
                    logger.warning("Effect type %r has no engine handler, skipping", etype)

                results.append(er)
                if extra_results:
                    results.extend(extra_results)

        return results

    # ── Deferred phases ────────────────────────────────────────

    async def _register_deferred_phase(
        self,
        phase: Dict,
        ctx: SpellContext,
        targets: List[TargetInfo],
        db: AsyncSession,
    ):
        """
        For non-on_cast triggers (on_hit, start_of_turn, etc.),
        register the phase as deferred effect data on the token.
        Non-combat: skip turn-based triggers (DM handles manually).
        """
        trigger = phase.get("trigger", "")

        if trigger == "on_hit":
            # Smite-style: store as weapon buff on caster
            # Concentration spells (Hex, Hunter's Mark) persist until concentration ends
            # Non-concentration (Smites) consume on first hit
            is_conc = ctx.concentration
            for effect in phase.get("effects", []):
                if effect.get("type") == "deal_damage":
                    dmg_type = effect.get("damage_type", "")
                    icon, color = _on_hit_buff_visual(dmg_type)
                    effect_data = self._ensure_effect_source_metadata({
                        "id": f"{ctx.spell_id}_buff",
                        "name": ctx.spell_name,
                        "spell_buff": True,
                        "spell_id": ctx.spell_id,
                        "trigger": "on_next_melee_hit",
                        "consume_on_hit": not is_conc,
                        "extra_damage_dice": effect.get("formula", "1d6"),
                        "damage_type": dmg_type,
                        "icon": icon,
                        "color": color,
                    }, ctx)
                    token = await db.get(Token, ctx.caster_token_id)
                    if token:
                        current = token.active_effects or []
                        current = [e for e in current
                                   if e.get("id") != effect_data["id"]]
                        current.append(effect_data)
                        token.active_effects = current
                        flag_modified(token, "active_effects")
                        await db.flush()

        elif trigger in ("start_of_target_turn", "end_of_target_turn"):
            # Non-combat: skip turn-based triggers, DM handles manually
            if not ctx.in_combat:
                return

            # Zone spells (target.type == "all_in_area" / "zone"):
            # Do NOT register effects on individual tokens at cast time.
            # The effect data is stored in concentration_spell.area_effect
            # and triggered via settle_zone_spell when DM applies it.
            target_type = phase.get("target", {}).get("type", "")
            if target_type in ("all_in_area", "zone"):
                return

            # Register ongoing effect on each target
            for target in targets:
                duration_rounds = None
                if ctx.in_combat:
                    duration_rounds = phase.get("duration", {}).get("rounds")

                effect_data = self._ensure_effect_source_metadata({
                    "id": f"{ctx.spell_id}_ongoing",
                    "name": ctx.spell_name,
                    "source": ctx.spell_name,
                    "spell_id": ctx.spell_id,
                    "is_concentration": ctx.concentration,
                    "ongoing_trigger": trigger,
                    "ongoing_effects": phase.get("effects", []),
                    "save": phase.get("save"),
                    "duration": duration_rounds,
                }, ctx)
                if duration_rounds and ctx.current_world_time:
                    effect_data["expires_at"] = self._calc_expires_at(ctx.current_world_time, duration_rounds)
                token = await db.get(Token, target.token_id)
                if token:
                    current = token.active_effects or []
                    current.append(effect_data)
                    token.active_effects = current
                    flag_modified(token, "active_effects")
                    await db.flush()

    # ── Helpers ────────────────────────────────────────────────

    def _roll_save(
        self,
        target: TargetInfo,
        save_cfg: Dict,
        ctx: SpellContext,
    ) -> tuple[bool, int]:
        """Roll a saving throw for target. Returns (succeeded, total)."""
        from app.services.effect_service import get_modifiers_for_target

        if ctx.target_auto_fail_save:
            return False, 0

        ability = save_cfg.get("ability", "dex")
        ability_name = {
            "str": "strength",
            "dex": "dexterity",
            "con": "constitution",
            "int": "intelligence",
            "wis": "wisdom",
            "cha": "charisma",
        }.get(str(ability).lower(), str(ability).lower())
        if target.save_override is not None:
            modifier = target.save_override
        else:
            score = target.ability_scores.get(ability_name, target.ability_scores.get(ability, 10))
            modifier = (score - 10) // 2

        # Check save conditions for advantage/disadvantage
        has_advantage = False
        has_disadvantage = False
        conditions = save_cfg.get("conditions") or {}

        # Creature type → disadvantage (e.g., undead/ooze on sunbeam)
        disadv_types = conditions.get("disadvantage_creature_types") or []
        if disadv_types and target.creature_type:
            ct = target.creature_type.lower()
            for dt in disadv_types:
                if dt in ct:
                    has_disadvantage = True
                    break

        # Creature type → advantage (e.g., shapechanger on moonbeam is NOT advantage, skip)
        adv_types = conditions.get("advantage_creature_types") or []
        if adv_types and target.creature_type:
            ct = target.creature_type.lower()
            for at in adv_types:
                if at in ct:
                    has_advantage = True
                    break

        # In combat → advantage on save (e.g., charm_person, dominate_*)
        if conditions.get("advantage_if_in_combat") and ctx.in_combat:
            has_advantage = True

        # Size-based advantage (e.g., Large+ for ensnaring_strike)
        adv_min_size = conditions.get("advantage_min_size")
        if adv_min_size and target.size_index() >= TargetInfo.SIZE_ORDER.get(adv_min_size, 99):
            has_advantage = True

        # Size-based disadvantage
        disadv_max_size = conditions.get("disadvantage_max_size")
        if disadv_max_size and target.size_index() <= TargetInfo.SIZE_ORDER.get(disadv_max_size, -1):
            has_disadvantage = True

        effect_modifiers = get_modifiers_for_target(
            target.active_effects,
            "saving_throw",
            {"ability": ability_name},
        )
        modifier += sum(int(value) for value in effect_modifiers.get("bonuses", []))
        if effect_modifiers.get("has_advantage"):
            has_advantage = True
        if effect_modifiers.get("has_disadvantage"):
            has_disadvantage = True

        # Roll with advantage/disadvantage (cancel if both)
        if has_advantage and has_disadvantage:
            roll = qa_randint(1, 20)
        elif has_advantage:
            roll = max(qa_randint(1, 20), qa_randint(1, 20))
        elif has_disadvantage:
            roll = min(qa_randint(1, 20), qa_randint(1, 20))
        else:
            roll = qa_randint(1, 20)

        total = roll + modifier
        return total >= ctx.spell_save_dc, total

    def _scale_formula(
        self,
        base_formula: str,
        scaling: Optional[Dict],
        slot_level: int,
    ) -> str:
        """Apply upcast scaling to a formula."""
        if not scaling:
            return base_formula
        return self._scale_formula_impl(base_formula, scaling, slot_level)

    @staticmethod
    def _select_cantrip_formula(dacl: Dict[str, str], caster_level: int) -> Optional[str]:
        """Pick the damage formula for the caster's level from a cantrip's
        damageAtCharacterLevel map (highest threshold <= caster_level)."""
        best, best_thr = None, -1
        for k, v in (dacl or {}).items():
            try:
                thr = int(k)
            except (TypeError, ValueError):
                continue
            if thr <= caster_level and thr > best_thr:
                best_thr, best = thr, v
        return best

    @staticmethod
    def _select_projectile_count(pacl: Dict[str, int], caster_level: int) -> int:
        """从 projectilesAtCharacterLevel 取 ≤ caster_level 的最高档发射物数。"""
        best, best_thr = 1, -1
        for k, v in (pacl or {}).items():
            try:
                thr = int(k)
            except (TypeError, ValueError):
                continue
            if thr <= caster_level and thr > best_thr:
                best_thr, best = thr, int(v)
        return best

    @staticmethod
    def _projectile_count(attack_cfg, scaling, ctx) -> int:
        """攻击 phase 的发射物数（束/道）。默认 1。

        底数 = projectilesAtCharacterLevel(按角色等级) 否则 attack.projectiles；
        再 + extra_projectiles × (slot_level − per_slot_above)（升环）。"""
        if not attack_cfg:
            return 1
        pacl = attack_cfg.get("projectilesAtCharacterLevel")
        if pacl:
            base = SpellResolver._select_projectile_count(pacl, ctx.caster_level or 1)
        else:
            base = int(attack_cfg.get("projectiles", 1) or 1)
        count = base
        sc = scaling or {}
        extra = sc.get("extra_projectiles")
        per = sc.get("per_slot_above", 0)
        if extra and per and ctx.slot_level > per:
            count += int(extra) * (ctx.slot_level - per)
        return max(1, count)

    @staticmethod
    def _rewrite_deal_damage_formula(node: Any, formula: str) -> None:
        """Recursively set `formula` on every deal_damage effect leaf."""
        if isinstance(node, dict):
            if node.get("type") == "deal_damage":
                node["formula"] = formula
            for v in node.values():
                SpellResolver._rewrite_deal_damage_formula(v, formula)
        elif isinstance(node, list):
            for v in node:
                SpellResolver._rewrite_deal_damage_formula(v, formula)

    @staticmethod
    def _scale_formula_impl(base_formula, scaling, slot_level):
        if not scaling:
            return base_formula
        per_slot = scaling.get("per_slot_above", 0)
        extra_dice = scaling.get("extra_dice")
        extra_value = scaling.get("extra_value")
        if not per_slot or slot_level <= per_slot:
            return base_formula

        levels_above = slot_level - per_slot
        if levels_above <= 0:
            return base_formula
        result = base_formula
        # Apply extra_dice AND extra_value if both present (e.g. Magic Missile
        # adds 1d4 AND +1 flat per slot). Previously this returned after
        # extra_dice, silently dropping extra_value.
        if extra_dice:
            import re
            m = re.match(r"(\d*)d(\d+)", extra_dice)
            if m:
                count = int(m.group(1) or 1) * levels_above
                result = f"{result}+{count}d{m.group(2)}"
            else:
                result = f"{result}+{extra_dice}"
        if extra_value:
            result = f"{result}+{extra_value * levels_above}"
        return result

    @staticmethod
    def _check_immunity(dmg_type: str, immunities: List[str]) -> bool:
        if not dmg_type or not immunities:
            return False
        return dmg_type.lower() in [i.lower() for i in immunities]

    @staticmethod
    def _check_resistance(dmg_type: str, resistances: List[str]) -> bool:
        if not dmg_type or not resistances:
            return False
        return dmg_type.lower() in [r.lower() for r in resistances]

    @staticmethod
    async def _apply_hp_change(
        target: TargetInfo,
        hp_change: int,
        db: AsyncSession,
    ):
        """Apply HP change to token/character/monster in DB."""
        if target.current_hp is None:
            # The caller (e.g. the area-spell path) may pass a target whose
            # current_hp was never populated — historically this silently
            # dropped the HP write, so damage was counted but never persisted
            # (area cast reported "影响 N 个目标" yet monster HP never moved).
            # Fall back to the DB source of truth instead of bailing out.
            resolved_hp: Optional[int] = None
            token = await db.get(Token, target.token_id)
            if token and token.current_hp is not None:
                resolved_hp = token.current_hp
            elif target.monster_instance_id:
                mi = await db.get(MonsterInstance, target.monster_instance_id)
                if mi and mi.current_hp is not None:
                    resolved_hp = mi.current_hp
            elif target.character_id:
                ch = await db.get(Character, target.character_id)
                if ch and ch.current_hp is not None:
                    resolved_hp = ch.current_hp
            if resolved_hp is None:
                logger.warning(
                    "Skipping HP change for token %s: current_hp unknown "
                    "(client payload and DB both missing HP)",
                    target.token_id,
                )
                return
            target.current_hp = resolved_hp
        if hp_change < 0:
            # Damage — handle temp HP first
            actual = abs(hp_change)
            token = await db.get(Token, target.token_id)
            if token and token.temp_hp and token.temp_hp > 0:
                absorbed = min(token.temp_hp, actual)
                token.temp_hp -= absorbed
                actual -= absorbed
                if token.temp_hp <= 0:
                    token.temp_hp = None
                    if token.active_effects:
                        new_effects = remove_expired_temp_hp_spell_effects(
                            token.active_effects,
                            spell_lookup=get_spell_by_id,
                            spell_has_effect_type=spell_has_effect_type,
                        )
                        if new_effects != token.active_effects:
                            token.active_effects = new_effects
                            from sqlalchemy.orm.attributes import flag_modified
                            flag_modified(token, "active_effects")
            new_hp = max(0, target.current_hp - actual)
        else:
            max_hp = target.max_hp or target.current_hp
            new_hp = min(max_hp, target.current_hp + hp_change)

        target.current_hp = new_hp
        await db.execute(
            update(Token).where(Token.id == target.token_id)
            .values(current_hp=new_hp)
        )
        if target.character_id:
            await db.execute(
                update(Character).where(Character.id == target.character_id)
                .values(current_hp=new_hp)
            )
        if target.monster_instance_id:
            await db.execute(
                update(MonsterInstance)
                .where(MonsterInstance.id == target.monster_instance_id)
                .values(current_hp=new_hp)
            )
        await db.flush()
        if new_hp <= 0:
            token = await db.get(Token, target.token_id)
            if token:
                from app.services.spell_runtime_service import notify_target_downed

                await notify_target_downed(
                    db,
                    campaign_id=token.campaign_id,
                    target_token_id=token.id,
                )

    @staticmethod
    async def _apply_hp_change_by_id(
        token_id: int,
        hp_change: int,
        db: AsyncSession,
    ):
        """Apply HP healing to a token by ID (for caster self-heal)."""
        token = await db.get(Token, token_id)
        if not token or token.current_hp is None:
            return 0

        max_hp: Optional[int] = None
        transformation = token.transformation_data or {}
        if isinstance(transformation, dict):
            transformed_max_hp = transformation.get("max_hp")
            if isinstance(transformed_max_hp, int) and transformed_max_hp > 0:
                max_hp = transformed_max_hp

        character = None
        if max_hp is None and token.character_id:
            character = await db.get(Character, token.character_id)
            if character:
                max_hp = calculate_max_hp(character)

        monster = None
        if max_hp is None and token.monster_instance_id:
            monster = await db.get(MonsterInstance, token.monster_instance_id)
            if monster and isinstance(monster.hit_points, int) and monster.hit_points > 0:
                max_hp = monster.hit_points

        if max_hp is None:
            max_hp = token.current_hp

        new_hp = min(max_hp, token.current_hp + hp_change)
        actual_healing = max(0, new_hp - token.current_hp)
        token.current_hp = new_hp
        await db.execute(
            update(Token).where(Token.id == token_id)
            .values(current_hp=new_hp)
        )
        if token.character_id:
            await db.execute(
                update(Character).where(Character.id == token.character_id)
                .values(current_hp=new_hp)
            )
        if token.monster_instance_id:
            await db.execute(
                update(MonsterInstance).where(MonsterInstance.id == token.monster_instance_id)
                .values(current_hp=new_hp)
            )
        await db.flush()
        return actual_healing

    def _get_caster_feature_by_type(self, feature_type: str) -> Optional[Dict[str, Any]]:
        features = (self._caster_passive_features or {}).get("allFeatures", [])
        return next((feature for feature in features if feature.get("type") == feature_type), None)

    def _get_caster_ability_modifier(self, ctx: SpellContext, ability_name: str) -> int:
        ability_score = (ctx.caster_ability_scores or {}).get(ability_name, 10)
        return max(0, (int(ability_score) - 10) // 2)

    def _get_cantrip_damage_bonus(self, ctx: SpellContext) -> int:
        if ctx.spell_level != 0:
            return 0
        feature = self._get_caster_feature_by_type("cantrip_damage_bonus")
        if not feature:
            return 0
        ability_name = feature.get("effect", {}).get("abilityModifier", "wisdom")
        return self._get_caster_ability_modifier(ctx, ability_name)

    def _get_healing_bonus(self, ctx: SpellContext) -> int:
        if ctx.slot_level < 1:
            return 0
        feature = self._get_caster_feature_by_type("healing_bonus")
        if not feature:
            return 0
        effect = feature.get("effect", {})
        return int(effect.get("value", 0) or 0) + int(effect.get("perSpellLevel", 0) or 0) * ctx.slot_level

    async def _maybe_apply_blessed_healer(
        self,
        ctx: SpellContext,
        healed_target: TargetInfo,
        healed_amount: int,
        db: AsyncSession,
    ) -> Optional[EffectResult]:
        if healed_amount <= 0:
            return None
        if self._blessed_healer_consumed:
            return None
        if ctx.slot_level < 1 or healed_target.token_id == ctx.caster_token_id:
            return None

        feature = self._get_caster_feature_by_type("self_healing")
        if not feature:
            return None

        self._blessed_healer_consumed = True
        effect = feature.get("effect", {})
        healing = int(effect.get("value", 0) or 0) + int(effect.get("perSpellLevel", 0) or 0) * ctx.slot_level
        if healing <= 0:
            return None

        actual_healing = await self._apply_hp_change_by_id(ctx.caster_token_id, healing, db)
        if actual_healing <= 0:
            return None

        return EffectResult(
            type="heal",
            target_token_id=ctx.caster_token_id,
            target_name=ctx.caster_name,
            healing_done=actual_healing,
            formula_breakdown=f"{healing}(祝福治疗者)",
        )
