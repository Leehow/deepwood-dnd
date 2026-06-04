"""
Small utility handlers — prevent_healing, stabilize, instant_kill, resurrect,
grant_action.

Each is lightweight enough to share a file.
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Type

from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.token import Token
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects
from app.services.runtime_schema_service import normalize_token_death_saves


def _reset_death_saves(token: Token) -> None:
    """Clear death-save state when a token regains positive HP."""
    cleared = normalize_token_death_saves(
        {"successes": 0, "failures": 0, "stabilized": False},
        strict=True,
    )
    token.death_saves = cleared
    flag_modified(token, "death_saves")


# ── prevent_healing ──────────────────────────────────────────

class PreventHealingParams(BaseModel):
    type: str = "prevent_healing"
    duration: Optional[str] = "until_caster_next_turn"

    model_config = ConfigDict(extra="forbid")


class PreventHealingHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return PreventHealingParams

    async def execute(self, params, hctx: HandlerContext, side_effects) -> HandlerOutcome:
        db: AsyncSession = hctx.db
        token: Token | None = await db.get(Token, hctx.target.token_id)
        if not token:
            return HandlerOutcome(description="目标 token 不存在")

        ctx = hctx.caster_ctx
        effect_id = f"{ctx.spell_id}_prevent_healing"
        entry = {
            "id": effect_id,
            "name": "无法恢复生命值",
            "source": ctx.spell_name,
            "source_token_id": ctx.caster_token_id,
            "spell_id": ctx.spell_id,
            "effect_type": "prevent_healing",
            "duration": params.duration,
        }
        current = [e for e in (token.active_effects or []) if e.get("id") != effect_id]
        current.append(entry)
        token.active_effects = current
        flag_modified(token, "active_effects")
        await db.flush()
        return HandlerOutcome(description="目标无法恢复生命值")


# ── stabilize ────────────────────────────────────────────────

class StabilizeParams(BaseModel):
    type: str = "stabilize"

    model_config = ConfigDict(extra="forbid")


class StabilizeHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return StabilizeParams

    async def execute(self, params, hctx: HandlerContext, side_effects) -> HandlerOutcome:
        db: AsyncSession = hctx.db
        token: Token | None = await db.get(Token, hctx.target.token_id)
        if not token:
            return HandlerOutcome(description="目标 token 不存在")

        ds = normalize_token_death_saves(token.death_saves, strict=False) or {
            "successes": 0,
            "failures": 0,
            "stabilized": False,
        }
        ds["stabilized"] = True
        token.death_saves = normalize_token_death_saves(ds, strict=True)
        flag_modified(token, "death_saves")
        await db.flush()
        return HandlerOutcome(description=f"{hctx.target.name}已稳定")


# ── instant_kill ─────────────────────────────────────────────

class InstantKillParams(BaseModel):
    type: str = "instant_kill"
    hpThreshold: int = 100

    model_config = ConfigDict(extra="forbid")


class InstantKillHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return InstantKillParams

    async def execute(self, params, hctx: HandlerContext, side_effects) -> HandlerOutcome:
        target = hctx.target
        if target.current_hp <= params.hpThreshold:
            db: AsyncSession = hctx.db
            token: Token | None = await db.get(Token, target.token_id)
            if token:
                token.current_hp = 0
                await db.flush()
            return HandlerOutcome(
                damage_dealt=target.current_hp,
                description=f"{target.name}(HP≤{params.hpThreshold})被立即杀死",
            )
        return HandlerOutcome(
            description=f"{target.name}(HP>{params.hpThreshold})未受影响",
        )


# ── resurrect ────────────────────────────────────────────────

class ResurrectParams(BaseModel):
    type: str = "resurrect"
    hpRestored: Optional[str] = "1"  # "1", "full"
    debuffDuration: Optional[str] = None  # e.g. "4_long_rests"
    requiresBody: Optional[bool] = True

    model_config = ConfigDict(extra="forbid")


class ResurrectHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return ResurrectParams

    async def execute(self, params, hctx: HandlerContext, side_effects) -> HandlerOutcome:
        db: AsyncSession = hctx.db
        token: Token | None = await db.get(Token, hctx.target.token_id)
        if not token:
            return HandlerOutcome(description="目标 token 不存在")

        if params.hpRestored == "full":
            token.current_hp = hctx.target.max_hp
        else:
            token.current_hp = max(1, int(params.hpRestored or 1))

        if token.current_hp and token.current_hp > 0:
            _reset_death_saves(token)
        await db.flush()

        hp_desc = "满血" if params.hpRestored == "full" else f"{token.current_hp}HP"
        return HandlerOutcome(
            healing_done=token.current_hp,
            description=f"{hctx.target.name}复活({hp_desc})",
        )


# ── grant_action ─────────────────────────────────────────────

class GrantActionDamage(BaseModel):
    formula: str
    damage_type: Optional[str] = None

    model_config = ConfigDict(extra="forbid")


class GrantActionAttack(BaseModel):
    """Attack profile for a granted *attack* action (Spiritual Weapon, Flame
    Blade, Vampiric Touch, Mordenkainen's Sword). Mirrors the on-cast ``attack``
    block — a spell attack roll whose ``on_miss`` policy decides the miss
    outcome. ``extra="allow"`` so a future attack key never 500s a cast."""

    type: str = "melee_spell"  # melee_spell | ranged_spell
    on_miss: Optional[str] = None  # no_effect | half_damage

    model_config = ConfigDict(extra="allow")


class GrantActionParams(BaseModel):
    type: str = "grant_action"
    action_type: str = "action"  # action | bonus_action | reaction
    action_name: str
    action_name_en: Optional[str] = None
    icon: Optional[str] = None
    action_kind: Optional[str] = None  # e.g. repeat_damage | attack
    attack: Optional[GrantActionAttack] = None  # repeatable spell-attack actions
    damage: Optional[GrantActionDamage] = None
    duration: Optional[str] = None
    description: Optional[str] = None

    # A granted action carries an open-ended payload — beyond attack/damage the
    # rules data also attaches movement / scaling / healing / save /
    # command_range / trigger_condition / ... The v2 runtime verb stores the
    # raw effect dict verbatim (spell_runtime_engine/verbs/granted_action.py);
    # this legacy handler matches that by tolerating and *preserving* those
    # passthrough keys instead of rejecting the cast with a 500.
    model_config = ConfigDict(extra="allow")


class GrantActionHandler(EffectHandler):
    """Persist a follow-up action (e.g. Witch Bolt repeat damage) on the caster.

    Stores an entry in the caster token's ``active_effects`` so the UI/projection
    layer can expose the granted action while the source spell remains active.
    """

    def get_param_schema(self) -> Type[BaseModel]:
        return GrantActionParams

    async def execute(
        self,
        params: GrantActionParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        db: AsyncSession = hctx.db
        ctx = hctx.caster_ctx

        caster_token: Token | None = await db.get(Token, ctx.caster_token_id)
        if not caster_token:
            return HandlerOutcome(description="施法者 token 不存在")

        effect_id = f"{ctx.spell_id}_grant_action_{params.action_name}"
        entry: Dict[str, Any] = {
            "id": effect_id,
            "name": params.action_name,
            "source": ctx.spell_name,
            "source_token_id": ctx.caster_token_id,
            "spell_id": ctx.spell_id,
            "is_concentration": ctx.concentration,
            "effect_type": "grant_action",
            "action_type": params.action_type,
            "action_name": params.action_name,
        }
        if params.action_name_en:
            entry["action_name_en"] = params.action_name_en
        if params.icon:
            entry["icon"] = params.icon
        if params.action_kind:
            entry["action_kind"] = params.action_kind
        if params.attack is not None:
            entry["attack"] = params.attack.model_dump(exclude_none=True)
        if params.damage is not None:
            entry["damage"] = params.damage.model_dump(exclude_none=True)
        if params.duration:
            entry["duration"] = params.duration
        if params.description:
            entry["description"] = params.description
        # Preserve remaining passthrough sub-objects (movement / scaling /
        # healing / save / ...) so the persisted entry mirrors the raw effect
        # the runtime engine keeps — never overwriting the curated keys above.
        for extra_key, extra_value in (params.model_extra or {}).items():
            entry.setdefault(extra_key, extra_value)
        # Lock the on-cast target only for follow-ups that truly must stay
        # pinned to the original target (Witch Bolt / Heat Metal repeat_damage,
        # plus single-target attack / save_damage). Two kinds must NOT be
        # locked:
        #   - `move_effect` (Moonbeam / Flaming Sphere) relocates an *area*, so
        #     a stale `target_token_id` from the on-cast area context would pin
        #     the follow-up to one token.
        #   - `remove_condition` (Dispel Evil and Good "Break Enchantment") is a
        #     self-cast grant whose follow-up targets a *future* afflicted ally,
        #     not the caster. Locking it to the on-cast self target (the caster)
        #     would make it impossible to cleanse anyone else.
        _NON_LOCKING_GRANT_KINDS = {"move_effect", "remove_condition"}
        if (
            params.action_kind not in _NON_LOCKING_GRANT_KINDS
            and hctx.target
            and getattr(hctx.target, "token_id", None) is not None
        ):
            entry["target_token_id"] = hctx.target.token_id

        current = [
            e for e in (caster_token.active_effects or [])
            if e.get("id") != effect_id
        ]
        current.append(entry)
        caster_token.active_effects = current
        flag_modified(caster_token, "active_effects")
        await db.flush()

        return HandlerOutcome(description=f"获得后续动作：{params.action_name}")
