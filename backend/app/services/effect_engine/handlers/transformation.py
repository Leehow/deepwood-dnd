"""
TransformationHandler — apply_transformation verb.

Writes transformation metadata to token.transformation_data.
Actual stat replacement (polymorph form stats, etc.) is handled by
the runtime service; this handler records the transformation source.
"""
from __future__ import annotations

from typing import Type

from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.token import Token
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects


class ApplyTransformationParams(BaseModel):
    type: str = "apply_transformation"
    transformType: str  # polymorph | wild_shape | alter_self | animal_shapes

    model_config = ConfigDict(extra="forbid")


class TransformationHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return ApplyTransformationParams

    async def execute(
        self,
        params: ApplyTransformationParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        db: AsyncSession = hctx.db
        target = hctx.target
        token: Token | None = await db.get(Token, target.token_id)
        if not token:
            return HandlerOutcome(description="目标 token 不存在")

        ctx = hctx.caster_ctx

        # Write transformation source — form details are filled by runtime service
        token.transformation_data = {
            "source": {
                "config_id": params.transformType,
                "source_type": "spell",
                "spell_id": ctx.spell_id,
                "spell_name": ctx.spell_name,
                "caster_token_id": ctx.caster_token_id,
                "is_concentration": ctx.concentration,
            },
            "type": _resolve_transform_type(params.transformType),
        }
        flag_modified(token, "transformation_data")
        await db.flush()

        type_cn = {
            "polymorph": "变形",
            "wild_shape": "荒野变形",
            "alter_self": "变形自我",
            "animal_shapes": "动物形态",
        }
        return HandlerOutcome(
            description=f"对 {target.name} 施加{type_cn.get(params.transformType, params.transformType)}效果",
        )


def _resolve_transform_type(transform_type: str) -> str:
    """Map transform type to transformation_data.type value."""
    if transform_type in ("polymorph", "animal_shapes"):
        return "full_replace"
    if transform_type == "alter_self":
        return "special_form"
    return "full_replace"
