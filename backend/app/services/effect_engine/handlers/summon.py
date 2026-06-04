"""
SpawnSummonHandler — spawn_summon verb.

Records summoning intent in caster token's active_effects.
Actual token creation is handled by the runtime service or map action layer;
this handler stores the summon data for deferred token spawning.
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Type

from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.token import Token
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects


class SpawnSummonParams(BaseModel):
    type: str = "spawn_summon"
    monsterId: Optional[str] = None
    instanceName: str
    tokenSize: Optional[str] = None
    avatarPath: Optional[str] = None
    hpFormula: Optional[str] = None
    count: Optional[int] = None
    faction: Optional[str] = None  # player | neutral
    description: Optional[str] = None

    model_config = ConfigDict(extra="forbid")


class SpawnSummonHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return SpawnSummonParams

    async def execute(
        self,
        params: SpawnSummonParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        db: AsyncSession = hctx.db
        ctx = hctx.caster_ctx

        caster_token: Token | None = await db.get(Token, ctx.caster_token_id)
        if not caster_token:
            return HandlerOutcome(description="施法者 token 不存在")

        effect_id = f"{ctx.spell_id}_summon"
        entry: Dict[str, Any] = {
            "id": effect_id,
            "name": f"召唤({params.instanceName})",
            "source": ctx.spell_name,
            "source_token_id": ctx.caster_token_id,
            "spell_id": ctx.spell_id,
            "is_concentration": ctx.concentration,
            "effect_type": "spawn_summon",
            "instance_name": params.instanceName,
        }
        if params.monsterId:
            entry["monster_id"] = params.monsterId
        if params.tokenSize:
            entry["token_size"] = params.tokenSize
        if params.avatarPath:
            entry["avatar_path"] = params.avatarPath
        if params.hpFormula:
            entry["hp_formula"] = params.hpFormula
        if params.count and params.count > 1:
            entry["count"] = params.count
        if params.faction:
            entry["faction"] = params.faction
        if params.description:
            entry["description"] = params.description

        current = [e for e in (caster_token.active_effects or []) if e.get("id") != effect_id]
        current.append(entry)
        caster_token.active_effects = current
        flag_modified(caster_token, "active_effects")
        await db.flush()

        count_str = f" ×{params.count}" if params.count and params.count > 1 else ""
        return HandlerOutcome(description=f"召唤{params.instanceName}{count_str}")
