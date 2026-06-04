"""
GrantSenseHandler — grant_sense verb.

Records granted perception/sense in target token's active_effects.
The frontend uses this to reveal hidden tokens, show sensor overlays, etc.
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Type

from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.token import Token
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects

_SENSE_CN = {
    "truesight": "真实视觉",
    "blindsight": "盲视",
    "tremorsense": "震颤感知",
    "detect_invisible": "侦测隐形",
    "detect_magic": "侦测魔法",
    "remote_sensor": "远程感应器",
    "darkvision": "暗视觉",
}


class GrantSenseParams(BaseModel):
    type: str = "grant_sense"
    senseType: str
    range: Optional[int] = None  # ft

    model_config = ConfigDict(extra="forbid")


class GrantSenseHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return GrantSenseParams

    async def execute(
        self,
        params: GrantSenseParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        db: AsyncSession = hctx.db
        ctx = hctx.caster_ctx
        target = hctx.target

        token: Token | None = await db.get(Token, target.token_id)
        if not token:
            return HandlerOutcome(description="目标 token 不存在")

        effect_id = f"{ctx.spell_id}_sense"
        entry: Dict[str, Any] = {
            "id": effect_id,
            "name": _SENSE_CN.get(params.senseType, params.senseType),
            "source": ctx.spell_name,
            "source_token_id": ctx.caster_token_id,
            "spell_id": ctx.spell_id,
            "is_concentration": ctx.concentration,
            "effect_type": "grant_sense",
            "sense_type": params.senseType,
        }
        if params.range is not None:
            entry["range"] = params.range

        current = [e for e in (token.active_effects or []) if e.get("id") != effect_id]
        current.append(entry)
        token.active_effects = current
        flag_modified(token, "active_effects")
        await db.flush()

        range_str = f"{params.range}尺" if params.range else ""
        sense_cn = _SENSE_CN.get(params.senseType, params.senseType)
        return HandlerOutcome(description=f"获得{sense_cn}{range_str}")
