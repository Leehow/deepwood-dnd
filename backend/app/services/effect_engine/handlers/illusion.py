"""
IllusionHandler — spawn_illusion verb.

Records illusion data in caster token's active_effects.
Actual illusion token creation is handled by the runtime service
or a separate map-level action; this handler stores the intent.
"""
from __future__ import annotations

from typing import Optional, Type

from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.token import Token
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects


class SpawnIllusionParams(BaseModel):
    type: str = "spawn_illusion"
    illusionType: str = "visual"  # visual | auditory | visual_auditory
    controllable: Optional[bool] = None
    physicalPass: Optional[bool] = None

    model_config = ConfigDict(extra="forbid")


class IllusionHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return SpawnIllusionParams

    async def execute(
        self,
        params: SpawnIllusionParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        db: AsyncSession = hctx.db
        ctx = hctx.caster_ctx

        # Write illusion intent to caster's active_effects
        caster_token: Token | None = await db.get(Token, ctx.caster_token_id)
        if not caster_token:
            return HandlerOutcome(description="施法者 token 不存在")

        effect_id = f"{ctx.spell_id}_illusion"
        current = [
            e for e in (caster_token.active_effects or [])
            if e.get("id") != effect_id
        ]
        current.append({
            "id": effect_id,
            "name": "幻象",
            "source": ctx.spell_name,
            "source_token_id": ctx.caster_token_id,
            "spell_id": ctx.spell_id,
            "is_concentration": ctx.concentration,
            "effect_type": "spawn_illusion",
            "illusion_type": params.illusionType,
            "controllable": params.controllable,
            "physical_pass": params.physicalPass,
        })
        caster_token.active_effects = current
        flag_modified(caster_token, "active_effects")
        await db.flush()

        type_cn = {"visual": "视觉", "auditory": "听觉", "visual_auditory": "视听"}
        kind = type_cn.get(params.illusionType, params.illusionType)
        return HandlerOutcome(description=f"创建{kind}幻象")
