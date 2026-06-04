"""
ModifierHandler — handles 6 verb types that all write to active_effects.modifiers:
  modify_stat, modify_roll, grant_resistance, grant_immunity,
  grant_advantage, grant_disadvantage

Extracted from SpellResolver._resolve_modifier_effect().
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Type

from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm.attributes import flag_modified

from app.models.token import Token
from app.services.effect_engine.duration import derive_round_expiry, resolve_round_duration
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.handlers._scaling import scale_formula
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects
from app.utils.dice_formula import is_formula, evaluate as eval_formula


class ModifyStatParams(BaseModel):
    type: str = "modify_stat"
    stat: str = ""
    formula: str = "0"
    operation: str = "add"
    model_config = ConfigDict(extra="forbid")


class ModifyRollParams(BaseModel):
    type: str = "modify_roll"
    roll_types: List[str] = []
    formula: str = "0"
    operation: str = "add"
    consume_on_use: bool = False
    model_config = ConfigDict(extra="forbid")


class GrantResistanceParams(BaseModel):
    type: str = "grant_resistance"
    damage_types: List[str] = []
    model_config = ConfigDict(extra="forbid")


class GrantImmunityParams(BaseModel):
    type: str = "grant_immunity"
    damage_types: List[str] = []
    conditions: List[str] = []     # 免疫的状态，如 ["frightened","paralyzed"]
    model_config = ConfigDict(extra="forbid")


class GrantAdvantageParams(BaseModel):
    type: str = "grant_advantage"
    on: str = "attack"
    condition: Optional[Dict[str, Any]] = None
    consume_on_use: bool = False
    model_config = ConfigDict(extra="forbid")


class GrantDisadvantageParams(BaseModel):
    type: str = "grant_disadvantage"
    on: str = "attack"
    condition: Optional[Dict[str, Any]] = None
    consume_on_use: bool = False
    model_config = ConfigDict(extra="forbid")


# Map verb → schema
_VERB_SCHEMAS: Dict[str, type[BaseModel]] = {
    "modify_stat": ModifyStatParams,
    "modify_roll": ModifyRollParams,
    "grant_resistance": GrantResistanceParams,
    "grant_immunity": GrantImmunityParams,
    "grant_advantage": GrantAdvantageParams,
    "grant_disadvantage": GrantDisadvantageParams,
}


class ModifierHandler(EffectHandler):
    """One handler for all modifier-type effects."""

    def __init__(self, verb: str = "modify_stat"):
        self._verb = verb

    def get_param_schema(self) -> Type[BaseModel]:
        return _VERB_SCHEMAS.get(self._verb, ModifyStatParams)

    async def execute(
        self,
        params: BaseModel,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        ctx = hctx.caster_ctx
        target = hctx.target
        db = hctx.db
        etype = self._verb
        phase = hctx.phase
        consume_on_use = getattr(params, "consume_on_use", False)

        # Round-duration is created for any non-concentration effect, in or out
        # of combat. Out-of-combat creation used to be gated on ctx.in_combat,
        # which left out-of-combat modifier buffs without expiry metadata and
        # thus un-expirable. Concentration effects still get no wall-clock
        # duration here; concentration loss ends them.
        duration_rounds = resolve_round_duration(phase, concentration=ctx.concentration)

        modifier_entries = _build_modifier_entries(etype, params, hctx.scaling, ctx.slot_level)

        token = await db.get(Token, target.token_id)
        if token:
            current = token.active_effects or []
            eff_id = f"{ctx.spell_id}_buff"
            existing = next((e for e in current if e.get("id") == eff_id), None)
            if existing:
                _ensure_source_meta(existing, ctx)
                if modifier_entries:
                    existing.setdefault("modifiers", []).extend(modifier_entries)
                phase_save = phase.get("ongoing_save")
                if phase_save and not existing.get("ongoing_save"):
                    existing["ongoing_save"] = {
                        "timing": phase_save.get("timing", "end_of_turn"),
                        "save_type": phase_save.get("ability", "con"),
                        "dc": ctx.spell_save_dc,
                    }
                    existing["spell_save_dc"] = ctx.spell_save_dc
            else:
                effect_data: Dict[str, Any] = {
                    "id": eff_id,
                    "name": ctx.spell_name,
                    "source": ctx.spell_name,
                    "source_token_id": ctx.caster_token_id,
                    "sourceTokenId": ctx.caster_token_id,
                    "spell_id": ctx.spell_id,
                    "spellId": ctx.spell_id,
                    "sourceSpell": ctx.spell_id,
                    "cast_level": ctx.slot_level,
                    "spell_buff": True,
                    "is_concentration": ctx.concentration,
                    "duration": duration_rounds,
                    "modifiers": list(modifier_entries),
                }
                if consume_on_use:
                    effect_data["consume_on_use"] = True
                phase_save = phase.get("ongoing_save")
                if phase_save:
                    effect_data["ongoing_save"] = {
                        "timing": phase_save.get("timing", "end_of_turn"),
                        "save_type": phase_save.get("ability", "con"),
                        "dc": ctx.spell_save_dc,
                    }
                    effect_data["spell_save_dc"] = ctx.spell_save_dc
                expires_at = derive_round_expiry(duration_rounds, ctx.current_world_time)
                if expires_at:
                    effect_data["expires_at"] = expires_at
                current.append(effect_data)
            token.active_effects = current
            flag_modified(token, "active_effects")
            await db.flush()

        return HandlerOutcome(description=f"{ctx.spell_name} → {target.name}")


def _build_modifier_entries(etype: str, params: BaseModel, scaling=None, slot_level: int = 0) -> List[Dict[str, Any]]:
    if etype == "modify_stat":
        p = params  # type: ModifyStatParams
        type_map = {"set": "set_base", "set_floor": "set_floor"}
        return [{
            "target": _stat_to_modifier_target(p.stat),
            "type": type_map.get(p.operation, "bonus"),
            "value": _scale_stat_value(p.formula, scaling, slot_level),
            "stat": p.stat,
            "operation": p.operation,
        }]
    if etype == "modify_roll":
        p = params  # type: ModifyRollParams
        # Honor the operation: "subtract" (e.g. Bane's -1d4) must reduce the roll,
        # so encode a negated formula. The downstream consumer only understands
        # numeric "bonus" modifiers, so a penalty is a negative value.
        value = _negate_formula(p.formula) if p.operation == "subtract" else p.formula
        return [
            {
                "target": _roll_type_to_modifier_target(rt),
                "type": "bonus",
                "value": value,
            }
            for rt in p.roll_types
        ]
    if etype == "grant_resistance":
        p = params  # type: GrantResistanceParams
        return [
            {"target": "damage_taken", "type": "resistance", "condition": {"damage_type": dt}}
            for dt in p.damage_types
        ]
    if etype == "grant_immunity":
        p = params  # type: GrantImmunityParams
        return [
            {"target": "damage_taken", "type": "immunity", "condition": {"damage_type": dt}}
            for dt in p.damage_types
        ]
    if etype == "grant_advantage":
        p = params  # type: GrantAdvantageParams
        entry: Dict[str, Any] = {"target": p.on, "type": "advantage"}
        if p.condition:
            entry["condition"] = p.condition
        return [entry]
    if etype == "grant_disadvantage":
        p = params  # type: GrantDisadvantageParams
        entry: Dict[str, Any] = {"target": p.on, "type": "disadvantage"}
        if p.condition:
            entry["condition"] = p.condition
        return [entry]
    return []


def _scale_stat_value(formula: str, scaling, slot_level: int):
    """升环缩放 modify_stat 值（如 aid 生命上限随环 +5）。

    纯算术结果预求值成 int —— 下游修正消费方只对含骰子/变量的串调用
    eval_formula，纯算术 "5+10" 会落到 int("5+10") 抛 ValueError 被静默丢弃。
    含骰子/变量（如 "13+DEX_MOD"）则保留 formula 串交由消费方按需求值。"""
    scaled = scale_formula(formula, scaling, slot_level)
    if scaled == formula:
        return formula
    if is_formula(scaled):
        return scaled
    try:
        return eval_formula(scaled).total
    except Exception:
        return scaled


def _ensure_source_meta(effect_data: Dict, ctx) -> None:
    effect_data.setdefault("source", ctx.spell_name)
    effect_data.setdefault("source_token_id", ctx.caster_token_id)
    effect_data.setdefault("sourceTokenId", ctx.caster_token_id)
    effect_data.setdefault("spell_id", ctx.spell_id)
    effect_data.setdefault("spellId", ctx.spell_id)
    effect_data.setdefault("sourceSpell", ctx.spell_id)
    effect_data.setdefault("cast_level", ctx.slot_level)


def _stat_to_modifier_target(stat: str) -> str:
    return {"ac": "incoming_attack", "speed": "speed",
            "hp_max": "hp_max", "max_hp": "hp_max"}.get(stat, stat)


def _roll_type_to_modifier_target(rt: str) -> str:
    return {"attack": "attack_roll", "save": "saving_throw", "ability_check": "ability_check"}.get(rt, rt)


def _negate_formula(formula: str) -> str:
    """Return a formula that evaluates to the negation of ``formula``.

    Numeric constants are negated directly; dice/expression formulas are
    wrapped with a leading minus (the dice evaluator accepts "-1d4")."""
    f = str(formula).strip()
    try:
        return str(-int(f))
    except (TypeError, ValueError):
        pass
    if f.startswith("-"):
        return f[1:].lstrip()
    return f"-{f}"
