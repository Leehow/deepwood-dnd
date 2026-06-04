"""
ForcedMovementHandler — forced_movement verb.

Records forced displacement intent in target's active_effects.
Actual token repositioning is handled by the frontend map layer.
"""
from __future__ import annotations

from typing import Literal, Optional, Type

from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.token import Token
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects


class ForcedMovementParams(BaseModel):
    type: str = "forced_movement"
    direction: Literal["push", "pull", "toward_point"]
    distance: int  # ft
    relativeTo: Optional[str] = "caster"

    model_config = ConfigDict(extra="forbid")


class ForcedMovementHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return ForcedMovementParams

    async def execute(
        self,
        params: ForcedMovementParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        db: AsyncSession = hctx.db
        target = hctx.target
        ctx = hctx.caster_ctx

        token: Token | None = await db.get(Token, target.token_id)
        if not token:
            return HandlerOutcome(description="目标 token 不存在")

        effect_id = f"{ctx.spell_id}_forced_movement"
        entry = {
            "id": effect_id,
            "name": f"{'推开' if params.direction == 'push' else '拉近'}{params.distance}尺",
            "source": ctx.spell_name,
            "source_token_id": ctx.caster_token_id,
            "spell_id": ctx.spell_id,
            "effect_type": "forced_movement",
            "direction": params.direction,
            "distance": params.distance,
            "relative_to": params.relativeTo,
            "transient": True,
        }

        current = [e for e in (token.active_effects or []) if e.get("id") != effect_id]
        current.append(entry)
        token.active_effects = current
        flag_modified(token, "active_effects")
        await db.flush()

        dir_cn = {"push": "推开", "pull": "拉近", "toward_point": "移向指定点"}
        return HandlerOutcome(
            description=f"{target.name}被{dir_cn.get(params.direction, params.direction)}{params.distance}尺",
        )
