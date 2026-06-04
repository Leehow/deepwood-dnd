"""
StoredTriggerHandler — stored_trigger verb.

Records a stored spell/effect that fires when a trigger condition is met.
Used by: glyph_of_warding, contingency, symbol.
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Type

from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.token import Token
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects


class StoredTriggerParams(BaseModel):
    type: str = "stored_trigger"
    triggerCondition: str  # enter_area | take_damage | custom
    storedSpellId: Optional[str] = None

    model_config = ConfigDict(extra="forbid")


class StoredTriggerHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return StoredTriggerParams

    async def execute(
        self,
        params: StoredTriggerParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        db: AsyncSession = hctx.db
        ctx = hctx.caster_ctx

        caster_token: Token | None = await db.get(Token, ctx.caster_token_id)
        if not caster_token:
            return HandlerOutcome(description="施法者 token 不存在")

        effect_id = f"{ctx.spell_id}_trigger"
        entry: Dict[str, Any] = {
            "id": effect_id,
            "name": f"延迟触发({ctx.spell_name})",
            "source": ctx.spell_name,
            "source_token_id": ctx.caster_token_id,
            "spell_id": ctx.spell_id,
            "effect_type": "stored_trigger",
            "trigger_condition": params.triggerCondition,
        }
        if params.storedSpellId:
            entry["stored_spell_id"] = params.storedSpellId

        current = [e for e in (caster_token.active_effects or []) if e.get("id") != effect_id]
        current.append(entry)
        caster_token.active_effects = current
        flag_modified(caster_token, "active_effects")
        await db.flush()

        trigger_cn = {
            "enter_area": "进入区域", "take_damage": "受到伤害", "custom": "自定义条件",
        }
        return HandlerOutcome(
            description=f"设置延迟触发: {trigger_cn.get(params.triggerCondition, params.triggerCondition)}",
        )
