"""
ConditionHandler — apply_condition verb.

Extracted from SpellResolver._resolve_condition().
The most complex handler: builds active_effect + status_effects entries,
handles per-effect saves, escape configs, and DB writes.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Type

from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.character import Character
from app.models.monster_instance import MonsterInstance
from app.models.token import Token
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects

_ABILITY_CN = {
    "str": "力量", "strength": "力量",
    "dex": "敏捷", "dexterity": "敏捷",
    "con": "体质", "constitution": "体质",
    "int": "智力", "intelligence": "智力",
    "wis": "感知", "wisdom": "感知",
    "cha": "魅力", "charisma": "魅力",
}


class ConditionSaveConfig(BaseModel):
    ability: str = "con"
    on_fail: str = "apply"

    model_config = ConfigDict(extra="allow")


class ConditionEscapeConfig(BaseModel):
    trigger: str = "end_of_turn"
    method: str = "save"
    ability: Optional[str] = None
    save_type: Optional[str] = None
    timing: Optional[str] = None
    type: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class ConditionParams(BaseModel):
    type: str = "apply_condition"
    condition: str
    condition_cn: Optional[str] = None
    escape: Optional[ConditionEscapeConfig] = None
    save: Optional[ConditionSaveConfig] = None
    # Optional HP-threshold gate: the condition only lands when the target is at
    # or below this current-HP value (RAW power_word_stun: ≤150 HP, else no
    # effect). Mirrors InstantKillParams.hpThreshold (power_word_kill ≤100).
    hpThreshold: Optional[int] = None
    icon_path: Optional[str] = None
    iconPath: Optional[str] = None
    escape_hint: Optional[str] = None
    escapeHint: Optional[str] = None
    break_conditions: Optional[List[str]] = None
    breakConditions: Optional[List[str]] = None

    model_config = ConfigDict(extra="forbid")


class ConditionHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return ConditionParams

    async def execute(
        self,
        params: ConditionParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        ctx = hctx.caster_ctx
        target = hctx.target
        db = hctx.db
        condition = params.condition

        # Check immunity
        if condition.lower() in [c.lower() for c in target.condition_immunities]:
            return HandlerOutcome(
                condition_immune=True,
                description=f"{target.name} 免疫{condition}状态",
            )

        # HP-threshold gate (power_word_stun: no effect when HP > 150). Same
        # mechanism as instant_kill's hpThreshold (power_word_kill ≤100). A None
        # threshold leaves every other condition spell unchanged; an unknown
        # current_hp does not block (we cannot prove the target is over it).
        if (
            params.hpThreshold is not None
            and target.current_hp is not None
            and target.current_hp > params.hpThreshold
        ):
            cond_cn = params.condition_cn or condition
            return HandlerOutcome(
                description=f"{target.name}(HP>{params.hpThreshold})不受{cond_cn}影响",
            )

        # Per-effect save gate
        if params.save:
            from app.services.spell_resolver import SpellResolver
            save_cfg = params.save.model_dump()
            resolver = SpellResolver()
            save_succeeded, save_total = resolver._roll_save(target, save_cfg, ctx)
            if save_succeeded and save_cfg.get("on_fail", "apply") == "apply":
                condition_cn = params.condition_cn or condition
                return HandlerOutcome(
                    description=f"{target.name} 豁免成功，未陷入{condition_cn}状态",
                )

        # Build escape config from params or phase
        escape_cfg = (
            params.escape.model_dump() if params.escape
            else hctx.phase.get("escape")
        )
        cond_duration = hctx.phase.get("duration", {}).get("rounds")
        condition_cn = params.condition_cn or condition

        escape_hint = _build_escape_hint(params, escape_cfg, hctx.phase, ctx.spell_save_dc)
        icon_path = params.icon_path or params.iconPath or f"/assets/condition-icons/{condition}.png"

        # Build active_effect entry
        effect_data: Dict[str, Any] = {
            "id": f"{ctx.spell_id}_{condition}",
            "name": condition_cn,
            "source": ctx.spell_name,
            "source_token_id": ctx.caster_token_id,
            "sourceTokenId": ctx.caster_token_id,
            "spell_id": ctx.spell_id,
            "spellId": ctx.spell_id,
            "sourceSpell": ctx.spell_id,
            "cast_level": ctx.slot_level,
            "spell_save_dc": ctx.spell_save_dc,
            "condition": condition,
            "is_concentration": ctx.concentration,
            "duration": cond_duration,
            "icon_path": icon_path,
        }

        # Ongoing save
        esc_method = escape_cfg.get("method") or escape_cfg.get("type") if escape_cfg else None
        if escape_cfg and esc_method == "save":
            effect_data["ongoing_save"] = {
                "timing": escape_cfg.get("trigger") or escape_cfg.get("timing", "end_of_turn"),
                "save_type": escape_cfg.get("ability") or escape_cfg.get("save_type", ""),
                "dc": ctx.spell_save_dc,
            }
        if escape_cfg and esc_method == "check":
            effect_data["escape_action"] = {
                "type": "check",
                "ability": escape_cfg.get("ability") or escape_cfg.get("save_type", "strength"),
                "dc": ctx.spell_save_dc,
            }

        if escape_hint:
            effect_data["escapeHint"] = escape_hint

        break_conds = params.break_conditions or params.breakConditions or hctx.phase.get("break_conditions") or hctx.phase.get("breakConditions") or []
        if break_conds:
            effect_data["break_conditions"] = list(break_conds) if isinstance(break_conds, list) else [break_conds]

        # status_effects entry for character/monster
        cond_entry: Dict[str, Any] = {
            "condition": condition,
            "duration": {"type": "permanent", "value": 0, "remaining": 0, "v": 2},
            "source": {
                "type": hctx.source.type,
                "name": ctx.spell_name,
                "spell_id": ctx.spell_id,
                "caster_id": str(ctx.caster_token_id),
                "caster_name": ctx.caster_name,
            },
        }
        if ctx.concentration:
            cond_entry["removal"] = {"type": "concentration"}
        elif escape_cfg and esc_method == "save":
            cond_entry["removal"] = {
                "type": "save",
                "save_dc": ctx.spell_save_dc,
                "save_ability": escape_cfg.get("ability") or escape_cfg.get("save_type", ""),
            }
        elif cond_duration:
            cond_entry["removal"] = {"type": "duration"}
            cond_entry["duration"] = {"type": "rounds", "value": cond_duration, "remaining": cond_duration, "v": 2}
        else:
            cond_entry["removal"] = {"type": "spell_end"}

        if cond_duration and ctx.current_world_time:
            from app.services.spell_resolver import SpellResolver
            expires_at = SpellResolver._calc_expires_at(ctx.current_world_time, cond_duration)
            cond_entry["expires_at"] = expires_at
            effect_data["expires_at"] = expires_at

        # Write to DB
        await _write_active_effect(target, effect_data, ctx, condition, db)
        await _write_status_effects(target, cond_entry, condition, ctx, db)

        return HandlerOutcome(condition_applied=condition)


async def _write_active_effect(target, effect_data, ctx, condition, db: AsyncSession):
    token = await db.get(Token, target.token_id)
    if token:
        current = token.active_effects or []
        current = [
            e for e in current
            if not (
                e.get("spell_id") == ctx.spell_id
                and e.get("source_token_id") == ctx.caster_token_id
                and e.get("condition") == condition
            )
        ]
        current.append(effect_data)
        token.active_effects = current
        flag_modified(token, "active_effects")
        await db.flush()


async def _write_status_effects(target, cond_entry, condition, ctx, db: AsyncSession):
    if target.character_id:
        char = await db.get(Character, target.character_id)
        if char:
            status = dict(char.status_effects or {})
            conds = list(status.get("active_conditions", []))
            conds = [c for c in conds if not (
                isinstance(c, dict) and c.get("condition") == condition
                and c.get("source", {}).get("spell_id") == ctx.spell_id
            )]
            conds.append(cond_entry)
            status["active_conditions"] = conds
            char.status_effects = status
            flag_modified(char, "status_effects")
    elif target.monster_instance_id:
        mi = await db.get(MonsterInstance, target.monster_instance_id)
        if mi:
            status = dict(mi.status_effects or {})
            conds = list(status.get("conditions", []))
            conds = [c for c in conds if not (
                isinstance(c, dict) and c.get("condition") == condition
                and c.get("source", {}).get("spell_id") == ctx.spell_id
            )]
            conds.append(cond_entry)
            status["conditions"] = conds
            mi.status_effects = status
            flag_modified(mi, "status_effects")
    await db.flush()


def _build_escape_hint(params: ConditionParams, escape_cfg, phase, spell_save_dc) -> Optional[str]:
    explicit = params.escape_hint or params.escapeHint or phase.get("escape_hint") or phase.get("escapeHint")
    if explicit:
        return str(explicit)
    if not escape_cfg:
        return None

    esc_ability = str(escape_cfg.get("ability") or escape_cfg.get("save_type") or "").strip()
    ability_cn = _ABILITY_CN.get(esc_ability.lower(), esc_ability or "属性")
    esc_method = str(escape_cfg.get("method") or escape_cfg.get("type") or "").strip().lower()
    esc_timing = str(escape_cfg.get("trigger") or escape_cfg.get("timing") or "").strip().lower()
    timing_cn = {
        "start_of_turn": "每回合开始时", "start_turn": "每回合开始时", "start_of_target_turn": "每回合开始时",
        "end_of_turn": "每回合结束时", "end_turn": "每回合结束时", "end_of_target_turn": "每回合结束时",
    }.get(esc_timing, "每回合结束时")
    if esc_method == "check":
        return f"可使用动作进行{ability_cn}检定对抗法术DC尝试挣脱"
    if esc_method == "save":
        return f"{timing_cn}可进行{ability_cn}豁免，对抗法术DC以摆脱效果"
    return None
