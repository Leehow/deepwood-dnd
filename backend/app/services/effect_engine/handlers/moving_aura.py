"""
CreateMovingAuraHandler — create_moving_aura verb.

Records an aura zone anchored to a token (moves with them).
Extends zone concept with anchor='caster'|'target'.
"""
from __future__ import annotations

from typing import Any, Dict, Literal, Optional, Type

from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.token import Token
from app.services.aura_service import build_runtime_aura_entry
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects


class CreateMovingAuraParams(BaseModel):
    type: str = "create_moving_aura"
    radiusFt: int
    anchor: Literal["caster", "target"] = "caster"
    auraType: Optional[str] = None  # damage | buff | debuff | protection

    model_config = ConfigDict(extra="forbid")


class CreateMovingAuraHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return CreateMovingAuraParams

    async def execute(
        self,
        params: CreateMovingAuraParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        db: AsyncSession = hctx.db
        ctx = hctx.caster_ctx

        token_id = ctx.caster_token_id
        if params.anchor == "target":
            token_id = hctx.target.token_id

        token: Token | None = await db.get(Token, token_id)
        if not token:
            return HandlerOutcome(description="目标 token 不存在")

        effect_id = f"{ctx.spell_id}_aura"
        active_auras = list(token.active_auras or [])
        existing_aura = next(
            (
                aura
                for aura in active_auras
                if aura.get("source_effect_id") == effect_id or aura.get("spell_id") == ctx.spell_id
            ),
            None,
        )
        selected_target_token_ids = list(existing_aura.get("selected_target_token_ids") or []) if existing_aura else []
        if hctx.target and hctx.target.token_id:
            target_token_id = int(hctx.target.token_id)
            if target_token_id not in selected_target_token_ids:
                selected_target_token_ids.append(target_token_id)

        aura_entry = build_runtime_aura_entry(
            aura_id=ctx.spell_id,
            radius=params.radiusFt,
            source_effect_id=effect_id,
            spell_id=ctx.spell_id,
            spell_name=ctx.spell_name,
            spell_save_dc=getattr(ctx, "spell_save_dc", None),
            source_token_id=ctx.caster_token_id,
            selected_target_token_ids=selected_target_token_ids,
        )
        active_auras = [
            aura
            for aura in active_auras
            if not (
                aura.get("source_effect_id") == effect_id
                or (aura.get("spell_id") == ctx.spell_id and aura.get("source_token_id") == ctx.caster_token_id)
            )
        ]
        active_auras.append(aura_entry)
        token.active_auras = active_auras
        flag_modified(token, "active_auras")

        entry: Dict[str, Any] = {
            "id": effect_id,
            "name": f"光环({ctx.spell_name})",
            "source": ctx.spell_name,
            "source_token_id": ctx.caster_token_id,
            "spell_id": ctx.spell_id,
            "spell_save_dc": getattr(ctx, "spell_save_dc", None),
            "is_concentration": ctx.concentration,
            "spell_buff": True,
            "effect_type": "create_moving_aura",
            "radius_ft": params.radiusFt,
            "anchor": params.anchor,
        }
        if params.auraType:
            entry["aura_type"] = params.auraType

        current = [e for e in (token.active_effects or []) if e.get("id") != effect_id]
        current.append(entry)
        token.active_effects = current
        flag_modified(token, "active_effects")
        await db.flush()
        side_effects.runtime_touched_token_ids.add(token.id)

        return HandlerOutcome(description=f"创建{params.radiusFt}尺跟随光环")
