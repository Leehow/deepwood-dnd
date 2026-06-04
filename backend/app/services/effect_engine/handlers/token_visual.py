"""
TokenVisualHandler — apply_token_filter & set_visibility verbs.

Writes visual filter / visibility state to token.active_effects
for the frontend to render (glow, blur, opacity, overlay, etc.).
"""
from __future__ import annotations

from typing import Any, Dict, Literal, Optional, Type

from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.token import Token
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects


class TokenFilterData(BaseModel):
    blur: Optional[float] = None
    opacity: Optional[float] = None
    glow: Optional[str] = None
    glowRadius: Optional[float] = None
    glowAnimation: Optional[str] = None
    overlay: Optional[str] = None
    saturate: Optional[float] = None
    brightness: Optional[float] = None

    model_config = ConfigDict(extra="forbid")


class ApplyTokenFilterParams(BaseModel):
    type: str = "apply_token_filter"
    filter: TokenFilterData

    model_config = ConfigDict(extra="forbid")


class SetVisibilityParams(BaseModel):
    type: str = "set_visibility"
    mode: Literal["invisible", "ethereal"]
    filter: Optional[TokenFilterData] = None

    model_config = ConfigDict(extra="forbid")


class TokenVisualHandler(EffectHandler):
    """Handles both apply_token_filter and set_visibility verbs."""

    def __init__(self, verb: str = "apply_token_filter") -> None:
        self._verb = verb

    def get_param_schema(self) -> Type[BaseModel]:
        if self._verb == "set_visibility":
            return SetVisibilityParams
        return ApplyTokenFilterParams

    async def execute(
        self,
        params: BaseModel,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        db: AsyncSession = hctx.db
        target = hctx.target
        token: Token | None = await db.get(Token, target.token_id)
        if not token:
            return HandlerOutcome(description="目标 token 不存在")

        if self._verb == "set_visibility":
            return await self._handle_visibility(params, token, hctx, db)
        return await self._handle_filter(params, token, hctx, db)

    async def _handle_filter(
        self, params: ApplyTokenFilterParams, token: Token,
        hctx: HandlerContext, db: AsyncSession,
    ) -> HandlerOutcome:
        ctx = hctx.caster_ctx
        filter_dict = params.filter.model_dump(exclude_none=True)

        _upsert_visual_effect(token, hctx, {
            "effect_type": "apply_token_filter",
            "filter": filter_dict,
        })
        await db.flush()
        return HandlerOutcome(description=f"对 {hctx.target.name} 施加视觉效果")

    async def _handle_visibility(
        self, params: SetVisibilityParams, token: Token,
        hctx: HandlerContext, db: AsyncSession,
    ) -> HandlerOutcome:
        filter_dict = params.filter.model_dump(exclude_none=True) if params.filter else {}
        mode_cn = "隐形" if params.mode == "invisible" else "虚体"

        _upsert_visual_effect(token, hctx, {
            "effect_type": "set_visibility",
            "mode": params.mode,
            "filter": filter_dict,
        })
        await db.flush()
        return HandlerOutcome(description=f"{hctx.target.name} 进入{mode_cn}状态")


def _upsert_visual_effect(
    token: Token, hctx: HandlerContext, extra: Dict[str, Any],
) -> None:
    """Insert or replace a visual effect entry in active_effects."""
    ctx = hctx.caster_ctx
    effect_id = f"{ctx.spell_id}_{extra['effect_type']}"
    current = [
        e for e in (token.active_effects or [])
        if e.get("id") != effect_id
    ]
    current.append({
        "id": effect_id,
        "name": extra["effect_type"],
        "source": ctx.spell_name,
        "source_token_id": ctx.caster_token_id,
        "spell_id": ctx.spell_id,
        "is_concentration": ctx.concentration,
        **extra,
    })
    token.active_effects = current
    flag_modified(token, "active_effects")
