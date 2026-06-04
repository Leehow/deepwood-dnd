"""
MovementModHandler — modify_movement verb.
RestrictMovementHandler — restrict_movement verb.

Writes movement modifications to token.active_effects for the
spell resolver / runtime service to apply (speed changes, fly, swim, etc.).
"""
from __future__ import annotations

from typing import Any, Dict, Literal, Optional, Type

from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.token import Token
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects


# ── modify_movement ──────────────────────────────────────────

class ModifyMovementParams(BaseModel):
    type: str = "modify_movement"
    movementType: str = "walk"  # walk | fly | swim | climb | burrow
    formula: Optional[str] = None  # 速度值, e.g. "60", "walk_speed"
    operation: Literal["set", "add", "grant"] = "grant"
    hover: Optional[bool] = None

    model_config = ConfigDict(extra="forbid")


class MovementModHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return ModifyMovementParams

    async def execute(
        self,
        params: ModifyMovementParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        db: AsyncSession = hctx.db
        target = hctx.target
        token: Token | None = await db.get(Token, target.token_id)
        if not token:
            return HandlerOutcome(description="目标 token 不存在")

        ctx = hctx.caster_ctx
        effect_id = f"{ctx.spell_id}_movement_{params.movementType}"

        entry: Dict[str, Any] = {
            "id": effect_id,
            "name": f"移动修改({params.movementType})",
            "source": ctx.spell_name,
            "source_token_id": ctx.caster_token_id,
            "spell_id": ctx.spell_id,
            "is_concentration": ctx.concentration,
            "effect_type": "modify_movement",
            "movement_type": params.movementType,
            "operation": params.operation,
        }
        if params.formula:
            entry["formula"] = params.formula
        if params.hover is not None:
            entry["hover"] = params.hover

        current = [e for e in (token.active_effects or []) if e.get("id") != effect_id]
        current.append(entry)
        token.active_effects = current
        flag_modified(token, "active_effects")
        await db.flush()

        type_cn = {"walk": "步行", "fly": "飞行", "swim": "游泳", "climb": "攀爬", "burrow": "掘地"}
        op_cn = {"set": "设为", "add": "增加", "grant": "获得"}
        desc = f"{target.name} {op_cn.get(params.operation, '获得')}{type_cn.get(params.movementType, params.movementType)}速度"
        if params.formula:
            desc += f" {params.formula}尺"
        return HandlerOutcome(description=desc)


# ── restrict_movement ────────────────────────────────────────

class RestrictMovementParams(BaseModel):
    type: str = "restrict_movement"
    restriction: str  # immobilized | halved | zero | no_teleport

    model_config = ConfigDict(extra="forbid")


class RestrictMovementHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return RestrictMovementParams

    async def execute(
        self,
        params: RestrictMovementParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        db: AsyncSession = hctx.db
        target = hctx.target
        token: Token | None = await db.get(Token, target.token_id)
        if not token:
            return HandlerOutcome(description="目标 token 不存在")

        ctx = hctx.caster_ctx
        effect_id = f"{ctx.spell_id}_movement_restrict"

        entry: Dict[str, Any] = {
            "id": effect_id,
            "name": f"移动限制({params.restriction})",
            "source": ctx.spell_name,
            "source_token_id": ctx.caster_token_id,
            "spell_id": ctx.spell_id,
            "is_concentration": ctx.concentration,
            "effect_type": "restrict_movement",
            "restriction": params.restriction,
        }

        current = [e for e in (token.active_effects or []) if e.get("id") != effect_id]
        current.append(entry)
        token.active_effects = current
        flag_modified(token, "active_effects")
        await db.flush()

        restriction_cn = {
            "immobilized": "无法移动",
            "halved": "速度减半",
            "zero": "速度降为0",
            "no_teleport": "无法传送",
        }
        return HandlerOutcome(
            description=f"{target.name} {restriction_cn.get(params.restriction, params.restriction)}",
        )
