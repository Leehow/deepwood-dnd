"""
RemoveConditionHandler — remove_condition verb.

Removes one or all of the specified conditions/statuses from the target token.
Unifies: lesser_restoration, greater_restoration, remove_curse, cure disease,
neutralize poison, etc. — all expressed as "remove these states".
"""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Type

from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.character import Character
from app.models.monster_instance import MonsterInstance
from app.models.token import Token
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects


class RemoveConditionParams(BaseModel):
    type: str = "remove_condition"
    conditions: List[str]  # 可移除的状态列表
    mode: Literal["choose_one", "all"] = "all"

    model_config = ConfigDict(extra="forbid")


class RemoveConditionHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return RemoveConditionParams

    async def execute(
        self,
        params: RemoveConditionParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        db: AsyncSession = hctx.db
        target = hctx.target

        token: Token | None = await db.get(Token, target.token_id)
        if not token:
            return HandlerOutcome(description="目标 token 不存在")

        removable = set(c.lower() for c in params.conditions)
        removed: List[str] = []

        # ── Remove from token.active_effects ──
        current_effects = list(token.active_effects or [])
        kept_effects: List[Dict[str, Any]] = []
        for eff in current_effects:
            cond = (eff.get("condition") or "").lower()
            if cond and cond in removable:
                if params.mode == "all" or not removed:
                    removed.append(cond)
                    continue
            kept_effects.append(eff)

        if removed:
            token.active_effects = kept_effects
            flag_modified(token, "active_effects")

        # ── Remove from character/monster status_effects ──
        await _clean_status_effects(target, removable, params.mode, removed, db)

        await db.flush()

        if not removed:
            return HandlerOutcome(description="目标没有可移除的状态")

        names = "、".join(removed)
        return HandlerOutcome(
            description=f"移除状态: {names}",
            conditions_removed=removed,
        )


async def _clean_status_effects(
    target, removable: set, mode: str, removed: List[str], db: AsyncSession,
) -> None:
    """Remove matching conditions from character or monster status_effects."""
    if target.character_id:
        char = await db.get(Character, target.character_id)
        if char:
            status = dict(char.status_effects or {})
            conds = list(status.get("active_conditions", []))
            new_conds = []
            for c in conds:
                cond_name = (c.get("condition") or "").lower() if isinstance(c, dict) else ""
                if cond_name in removable and (mode == "all" or cond_name in removed):
                    continue
                new_conds.append(c)
            status["active_conditions"] = new_conds
            char.status_effects = status
            flag_modified(char, "status_effects")

    elif target.monster_instance_id:
        mi = await db.get(MonsterInstance, target.monster_instance_id)
        if mi:
            status = dict(mi.status_effects or {})
            conds = list(status.get("conditions", []))
            new_conds = []
            for c in conds:
                cond_name = (c.get("condition") or "").lower() if isinstance(c, dict) else ""
                if cond_name in removable and (mode == "all" or cond_name in removed):
                    continue
                new_conds.append(c)
            status["conditions"] = new_conds
            mi.status_effects = status
            flag_modified(mi, "status_effects")
