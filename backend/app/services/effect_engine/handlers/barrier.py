"""
CreateBarrierHandler — create_barrier verb.

Records force-field / enclosed barrier data in caster token's active_effects.
"""
from __future__ import annotations

from typing import Any, Dict, Literal, Optional, Type

from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.token import Token
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects


class CreateBarrierParams(BaseModel):
    type: str = "create_barrier"
    shape: Literal["sphere", "cube", "dome", "cage"] = "sphere"
    radiusFt: Optional[int] = None
    sideFt: Optional[int] = None
    blocksMagic: Optional[bool] = None
    blocksPhysical: Optional[bool] = True
    indestructible: Optional[bool] = None
    teleportBlocked: Optional[bool] = None

    model_config = ConfigDict(extra="forbid")


class CreateBarrierHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return CreateBarrierParams

    async def execute(
        self,
        params: CreateBarrierParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        db: AsyncSession = hctx.db
        ctx = hctx.caster_ctx

        caster_token: Token | None = await db.get(Token, ctx.caster_token_id)
        if not caster_token:
            return HandlerOutcome(description="施法者 token 不存在")

        effect_id = f"{ctx.spell_id}_barrier"
        entry: Dict[str, Any] = {
            "id": effect_id,
            "name": f"屏障({ctx.spell_name})",
            "source": ctx.spell_name,
            "source_token_id": ctx.caster_token_id,
            "spell_id": ctx.spell_id,
            "is_concentration": ctx.concentration,
            "effect_type": "create_barrier",
            "shape": params.shape,
        }
        if params.radiusFt is not None:
            entry["radius_ft"] = params.radiusFt
        if params.sideFt is not None:
            entry["side_ft"] = params.sideFt
        if params.blocksMagic is not None:
            entry["blocks_magic"] = params.blocksMagic
        if params.blocksPhysical is not None:
            entry["blocks_physical"] = params.blocksPhysical
        if params.indestructible:
            entry["indestructible"] = True
        if params.teleportBlocked:
            entry["teleport_blocked"] = True

        current = [e for e in (caster_token.active_effects or []) if e.get("id") != effect_id]
        current.append(entry)
        caster_token.active_effects = current
        flag_modified(caster_token, "active_effects")
        await db.flush()

        shape_cn = {"sphere": "球形", "cube": "立方", "dome": "半球", "cage": "笼形"}
        size = f"{params.radiusFt}尺" if params.radiusFt else (f"{params.sideFt}尺" if params.sideFt else "")
        return HandlerOutcome(description=f"创建{shape_cn.get(params.shape, params.shape)}{size}屏障")
