"""
ZoneVisualHandler — create_zone_visual verb.

Records zone visual data (fog, darkness, light, terrain) in
caster token's active_effects. The frontend reads this to render
zone overlays on the tactical map.
"""
from __future__ import annotations

from typing import Any, Dict, Literal, Optional, Type

from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.token import Token
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects


class CloudMovementConfig(BaseModel):
    distance: int = 10
    direction: str = "away_from_caster"
    timing: str = "start_of_caster_turn"

    model_config = ConfigDict(extra="forbid")


class CreateZoneVisualParams(BaseModel):
    type: str = "create_zone_visual"
    zoneType: str  # fog | darkness | light | terrain | other
    obscurement: Optional[Literal["heavy", "light"]] = None
    difficultTerrain: Optional[bool] = None
    spreadsAroundCorners: Optional[bool] = None
    windDispel: Optional[Dict[str, int]] = None  # {"moderate": 1, "strong": 3}
    cloudMovement: Optional[CloudMovementConfig] = None

    model_config = ConfigDict(extra="forbid")


class ZoneVisualHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return CreateZoneVisualParams

    async def execute(
        self,
        params: CreateZoneVisualParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        db: AsyncSession = hctx.db
        ctx = hctx.caster_ctx

        caster_token: Token | None = await db.get(Token, ctx.caster_token_id)
        if not caster_token:
            return HandlerOutcome(description="施法者 token 不存在")

        effect_id = f"{ctx.spell_id}_zone_visual"
        current = [
            e for e in (caster_token.active_effects or [])
            if e.get("id") != effect_id
        ]
        entry = {
            "id": effect_id,
            "name": f"区域效果({params.zoneType})",
            "source": ctx.spell_name,
            "source_token_id": ctx.caster_token_id,
            "spell_id": ctx.spell_id,
            "is_concentration": ctx.concentration,
            "effect_type": "create_zone_visual",
            "zone_type": params.zoneType,
        }
        if params.obscurement:
            entry["obscurement"] = params.obscurement
        if params.difficultTerrain:
            entry["difficult_terrain"] = True
        if params.spreadsAroundCorners is not None:
            entry["spreads_around_corners"] = params.spreadsAroundCorners
        if params.windDispel:
            entry["wind_dispel"] = params.windDispel
        if params.cloudMovement:
            entry["cloud_movement"] = params.cloudMovement.model_dump()

        current.append(entry)
        caster_token.active_effects = current
        flag_modified(caster_token, "active_effects")
        await db.flush()

        zone_cn = {
            "fog": "云雾", "darkness": "黑暗", "light": "光亮",
            "terrain": "地形", "other": "区域",
        }
        return HandlerOutcome(
            description=f"创建{zone_cn.get(params.zoneType, params.zoneType)}区域效果",
        )
