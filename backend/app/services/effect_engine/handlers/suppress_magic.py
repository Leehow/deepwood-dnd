"""
SuppressMagicHandler — suppress_magic verb.

Records magic suppression zone/effect in caster's active_effects.
Used by: globe_of_invulnerability, antimagic_field, nondetection.
"""
from __future__ import annotations

from typing import Any, Dict, Literal, Optional, Type

from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.token import Token
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects


class SuppressMagicParams(BaseModel):
    type: str = "suppress_magic"
    maxSpellLevel: Optional[int] = None  # None = all levels
    scope: Literal["zone", "target"] = "zone"

    model_config = ConfigDict(extra="forbid")


class SuppressMagicHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return SuppressMagicParams

    async def execute(
        self,
        params: SuppressMagicParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        db: AsyncSession = hctx.db
        ctx = hctx.caster_ctx

        caster_token: Token | None = await db.get(Token, ctx.caster_token_id)
        if not caster_token:
            return HandlerOutcome(description="施法者 token 不存在")

        effect_id = f"{ctx.spell_id}_suppress"
        entry: Dict[str, Any] = {
            "id": effect_id,
            "name": f"魔法压制({ctx.spell_name})",
            "source": ctx.spell_name,
            "source_token_id": ctx.caster_token_id,
            "spell_id": ctx.spell_id,
            "is_concentration": ctx.concentration,
            "effect_type": "suppress_magic",
            "scope": params.scope,
        }
        if params.maxSpellLevel is not None:
            entry["max_spell_level"] = params.maxSpellLevel

        current = [e for e in (caster_token.active_effects or []) if e.get("id") != effect_id]
        current.append(entry)
        caster_token.active_effects = current
        flag_modified(caster_token, "active_effects")
        await db.flush()

        level_desc = f"{params.maxSpellLevel}环及以下" if params.maxSpellLevel else "所有"
        return HandlerOutcome(description=f"压制{level_desc}魔法效果")
