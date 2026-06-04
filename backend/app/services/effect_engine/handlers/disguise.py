"""
DisguiseHandler — set_disguise verb.

Writes disguise state to token.disguise_data for spells like
易容术 (Disguise Self), 似体 (Seeming), etc.
"""
from __future__ import annotations

from typing import Literal, Type

from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.token import Token
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects


class SetDisguiseParams(BaseModel):
    type: str = "set_disguise"
    disguiseType: Literal["appearance", "form_change"]
    requiresImage: bool = False

    model_config = ConfigDict(extra="forbid")


class DisguiseHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return SetDisguiseParams

    async def execute(
        self,
        params: SetDisguiseParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        db: AsyncSession = hctx.db
        target = hctx.target
        token: Token | None = await db.get(Token, target.token_id)
        if not token:
            return HandlerOutcome(description="目标 token 不存在")

        ctx = hctx.caster_ctx
        token.disguise_data = {
            "spell_id": ctx.spell_id,
            "spell_name": ctx.spell_name,
            "disguise_type": params.disguiseType,
            "requires_image": params.requiresImage,
            "caster_token_id": ctx.caster_token_id,
            "is_concentration": ctx.concentration,
        }
        flag_modified(token, "disguise_data")
        await db.flush()

        kind_cn = "易容" if params.disguiseType == "appearance" else "变形"
        return HandlerOutcome(description=f"{target.name} 获得{kind_cn}伪装")
