"""
ResizeTokenHandler — resize_token verb.

Changes a token's grid size by sizeDelta categories.
D&D 5E sizes: Tiny(0.5) → Small(1) → Medium(1) → Large(2) → Huge(3) → Gargantuan(4).
"""
from __future__ import annotations

from typing import Type

from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.token import Token
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects

# Ordered size categories with their grid dimension
_SIZE_LADDER = [
    ("tiny", "0.5x0.5"),
    ("small", "1x1"),
    ("medium", "1x1"),
    ("large", "2x2"),
    ("huge", "3x3"),
    ("gargantuan", "4x4"),
]

_GRID_TO_INDEX: dict[str, int] = {}
for i, (_, grid) in enumerate(_SIZE_LADDER):
    # Map grid → highest index (medium over small for "1x1")
    _GRID_TO_INDEX[grid] = i


class ResizeTokenParams(BaseModel):
    type: str = "resize_token"
    sizeDelta: int  # +1 enlarge, -1 reduce

    model_config = ConfigDict(extra="forbid")


class ResizeTokenHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return ResizeTokenParams

    async def execute(
        self,
        params: ResizeTokenParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        db: AsyncSession = hctx.db
        target = hctx.target
        token: Token | None = await db.get(Token, target.token_id)
        if not token:
            return HandlerOutcome(description="目标 token 不存在")

        old_size = token.token_size or "1x1"
        current_idx = _GRID_TO_INDEX.get(old_size, 2)  # default Medium
        new_idx = max(0, min(len(_SIZE_LADDER) - 1, current_idx + params.sizeDelta))
        new_name, new_grid = _SIZE_LADDER[new_idx]
        old_name = _SIZE_LADDER[current_idx][0]

        if new_idx == current_idx:
            return HandlerOutcome(
                description=f"{target.name} 已经是{old_name}体型，无法继续变化",
            )

        token.token_size = new_grid
        await db.flush()

        # Store revert info in active_effects for cleanup on concentration end
        _write_resize_effect(token, hctx, old_size)
        await db.flush()

        return HandlerOutcome(
            description=f"{target.name} 从{old_name}变为{new_name}体型 ({old_size} → {new_grid})",
        )


def _write_resize_effect(token: Token, hctx: HandlerContext, old_size: str) -> None:
    """Append a resize entry to active_effects for revert on spell end."""
    from sqlalchemy.orm.attributes import flag_modified
    ctx = hctx.caster_ctx
    current = list(token.active_effects or [])
    current.append({
        "id": f"{ctx.spell_id}_resize",
        "name": "体型变化",
        "source": ctx.spell_name,
        "source_token_id": ctx.caster_token_id,
        "spell_id": ctx.spell_id,
        "is_concentration": ctx.concentration,
        "effect_type": "resize_token",
        "revert_size": old_size,
    })
    token.active_effects = current
    flag_modified(token, "active_effects")
