"""
CreateWallHandler — create_wall verb.

Records wall obstacle data in caster token's active_effects.
The frontend renders the wall and enforces blocking.
"""
from __future__ import annotations

from typing import Any, Dict, Literal, Optional, Type

from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.token import Token
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects


class WallDamageConfig(BaseModel):
    formula: str
    damageType: str

    model_config = ConfigDict(extra="forbid")


class CreateWallParams(BaseModel):
    type: str = "create_wall"
    shape: Literal["line", "ring"] = "line"
    lengthFt: Optional[int] = None
    heightFt: Optional[int] = None
    thicknessFt: Optional[int] = None
    hpPerSegment: Optional[int] = None
    blocksMovement: Optional[bool] = True
    blocksLineOfSight: Optional[bool] = None
    blocksProjectiles: Optional[bool] = None
    passThroughDamage: Optional[WallDamageConfig] = None

    model_config = ConfigDict(extra="forbid")


class CreateWallHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return CreateWallParams

    async def execute(
        self,
        params: CreateWallParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        db: AsyncSession = hctx.db
        ctx = hctx.caster_ctx

        caster_token: Token | None = await db.get(Token, ctx.caster_token_id)
        if not caster_token:
            return HandlerOutcome(description="施法者 token 不存在")

        effect_id = f"{ctx.spell_id}_wall"
        entry: Dict[str, Any] = {
            "id": effect_id,
            "name": f"法术墙({ctx.spell_name})",
            "source": ctx.spell_name,
            "source_token_id": ctx.caster_token_id,
            "spell_id": ctx.spell_id,
            "is_concentration": ctx.concentration,
            "effect_type": "create_wall",
            "shape": params.shape,
        }
        if params.lengthFt:
            entry["length_ft"] = params.lengthFt
        if params.heightFt:
            entry["height_ft"] = params.heightFt
        if params.thicknessFt:
            entry["thickness_ft"] = params.thicknessFt
        if params.hpPerSegment is not None:
            entry["hp_per_segment"] = params.hpPerSegment
        if params.blocksMovement is not None:
            entry["blocks_movement"] = params.blocksMovement
        if params.blocksLineOfSight is not None:
            entry["blocks_los"] = params.blocksLineOfSight
        if params.blocksProjectiles is not None:
            entry["blocks_projectiles"] = params.blocksProjectiles
        if params.passThroughDamage:
            entry["pass_through_damage"] = params.passThroughDamage.model_dump()

        current = [e for e in (caster_token.active_effects or []) if e.get("id") != effect_id]
        current.append(entry)
        caster_token.active_effects = current
        flag_modified(caster_token, "active_effects")
        await db.flush()

        desc = f"创建{params.shape}形法术墙"
        if params.lengthFt:
            desc += f"({params.lengthFt}尺)"
        return HandlerOutcome(description=desc)
