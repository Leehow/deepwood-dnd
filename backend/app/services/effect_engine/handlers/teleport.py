"""
TeleportHandler — teleport verb.

Moves a token to a target position on the map. The actual coordinate
is determined by the spell resolver or map action layer; this handler
records the teleport in active_effects and updates token position
when coordinates are provided in the phase context.
"""
from __future__ import annotations

from typing import Literal, Optional, Type

from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.token import Token
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects


class TeleportParams(BaseModel):
    type: str = "teleport"
    range: int  # 传送距离（尺）
    mode: Literal["self", "target", "swap"] = "self"
    mustSee: Optional[bool] = None
    carriesOthers: Optional[bool] = None

    model_config = ConfigDict(extra="forbid")


class TeleportHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return TeleportParams

    async def execute(
        self,
        params: TeleportParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        db: AsyncSession = hctx.db
        ctx = hctx.caster_ctx
        target = hctx.target

        # Determine which token to teleport
        if params.mode == "self":
            token_id = ctx.caster_token_id
        else:
            token_id = target.token_id

        token: Token | None = await db.get(Token, token_id)
        if not token:
            return HandlerOutcome(description="传送目标 token 不存在")

        # If phase context provides destination coordinates, apply them
        dest = hctx.phase.get("teleport_destination")
        if dest and "x" in dest and "y" in dest:
            token.position_x = dest["x"]
            token.position_y = dest["y"]
            await db.flush()

        mode_cn = {"self": "自身传送", "target": "传送目标", "swap": "位置互换"}
        return HandlerOutcome(
            description=f"{mode_cn.get(params.mode, '传送')}（{params.range}尺）",
        )
