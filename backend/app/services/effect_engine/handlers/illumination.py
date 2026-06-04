"""
IlluminationHandler — apply_illumination verb.

Records illumination data (light/darkness) in caster token's active_effects.
The frontend's IlluminationLayer reads this to render lighting on the map.
"""
from __future__ import annotations

from typing import Any, Dict, Literal, Optional, Type

from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.token import Token
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects


class ApplyIlluminationParams(BaseModel):
    type: str = "apply_illumination"
    lightType: Literal["light", "darkness"]
    brightRadius: int = 0
    dimRadius: int = 0
    darknessRadius: Optional[int] = None
    attachTo: str = "point"  # object | caster | point | target
    color: Optional[str] = None
    blocksDarkvision: Optional[bool] = None
    dispelsLevel: Optional[int] = None
    isSunlight: Optional[bool] = None
    movable: Optional[bool] = None
    moveAction: Optional[str] = None

    model_config = ConfigDict(extra="forbid")


class IlluminationHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return ApplyIlluminationParams

    async def execute(
        self,
        params: ApplyIlluminationParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        db: AsyncSession = hctx.db
        ctx = hctx.caster_ctx

        # Attach to caster token (most illumination spells emit from caster or a point near them)
        token_id = ctx.caster_token_id
        if params.attachTo == "target":
            token_id = hctx.target.token_id

        token: Token | None = await db.get(Token, token_id)
        if not token:
            return HandlerOutcome(description="目标 token 不存在")

        effect_id = f"{ctx.spell_id}_illumination"
        entry: Dict[str, Any] = {
            "id": effect_id,
            "name": "光照" if params.lightType == "light" else "黑暗",
            "source": ctx.spell_name,
            "source_token_id": ctx.caster_token_id,
            "spell_id": ctx.spell_id,
            "is_concentration": ctx.concentration,
            "effect_type": "apply_illumination",
            "light_type": params.lightType,
            "bright_radius": params.brightRadius,
            "dim_radius": params.dimRadius,
            "attach_to": params.attachTo,
        }
        if params.darknessRadius is not None:
            entry["darkness_radius"] = params.darknessRadius
        if params.color:
            entry["color"] = params.color
        if params.blocksDarkvision:
            entry["blocks_darkvision"] = True
        if params.dispelsLevel is not None:
            entry["dispels_level"] = params.dispelsLevel
        if params.isSunlight:
            entry["is_sunlight"] = True
        if params.movable:
            entry["movable"] = True
            if params.moveAction:
                entry["move_action"] = params.moveAction

        current = [e for e in (token.active_effects or []) if e.get("id") != effect_id]
        current.append(entry)
        token.active_effects = current
        flag_modified(token, "active_effects")
        await db.flush()

        if params.lightType == "darkness":
            return HandlerOutcome(description=f"创建半径{params.darknessRadius or 0}尺魔法黑暗")
        desc = f"发出{params.brightRadius}尺明亮光照 + {params.dimRadius}尺微光"
        return HandlerOutcome(description=desc)
