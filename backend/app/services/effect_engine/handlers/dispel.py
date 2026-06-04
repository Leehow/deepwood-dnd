"""
DispelHandler — dispel_magic verb.

Removes spell effects from a target following D&D 5E dispel rules.
Extracted from SpellResolver._resolve_dispel_magic().
"""
from __future__ import annotations

import random
from collections import defaultdict
from typing import Any, Dict, List, Type

from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from app.models.token import Token
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects


class DispelParams(BaseModel):
    type: str = "dispel_magic"

    model_config = ConfigDict(extra="forbid")


class DispelHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return DispelParams

    async def execute(
        self,
        params: DispelParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        ctx = hctx.caster_ctx
        target = hctx.target
        db = hctx.db

        token = await db.get(Token, target.token_id)
        if not token:
            return HandlerOutcome(description="目标不存在")

        effects = token.active_effects or []
        spell_effects = [e for e in effects if e.get("spell_id") or e.get("spell_buff")]
        if not spell_effects:
            return HandlerOutcome(description=f"{target.name} 身上没有可以解除的法术效果")

        # Group by spell_id
        spells_on_target: Dict[str, list] = defaultdict(list)
        for eff in spell_effects:
            key = eff.get("spell_id") or eff.get("id", "unknown")
            spells_on_target[key].append(eff)

        dispelled_ids: List[str] = []
        narrative_parts: List[str] = []

        for spell_id, effs in spells_on_target.items():
            cast_level = max(e.get("cast_level", 1) for e in effs)
            spell_name = effs[0].get("name") or effs[0].get("source") or spell_id

            if cast_level <= ctx.slot_level:
                dispelled_ids.append(spell_id)
                narrative_parts.append(f"✓ {spell_name}({cast_level}环) — 自动解除")
            else:
                dc = 10 + cast_level
                roll = random.randint(1, 20)
                total = roll + ctx.spellcasting_mod
                if total >= dc:
                    dispelled_ids.append(spell_id)
                    narrative_parts.append(
                        f"✓ {spell_name}({cast_level}环) — "
                        f"检定 [{roll}]+{ctx.spellcasting_mod}={total} ≥ DC{dc} 成功"
                    )
                else:
                    narrative_parts.append(
                        f"✗ {spell_name}({cast_level}环) — "
                        f"检定 [{roll}]+{ctx.spellcasting_mod}={total} < DC{dc} 失败"
                    )

        if dispelled_ids:
            id_set = set(dispelled_ids)
            token.active_effects = [
                e for e in effects
                if (e.get("spell_id") or e.get("id", "")) not in id_set
            ]
            flag_modified(token, "active_effects")

            # Concentration cleanup
            await _cleanup_concentration(
                dispelled_ids, target.token_id,
                token.campaign_id, db, side_effects,
            )

        await db.flush()

        summary = f"解除魔法 → {target.name}：\n" + "\n".join(narrative_parts)
        return HandlerOutcome(description=summary)


async def _cleanup_concentration(
    dispelled_ids: List[str],
    target_token_id: int,
    campaign_id: int,
    db,
    side_effects: SideEffects,
):
    if not campaign_id:
        return
    from app.services.combat_spell_service import (
        cleanup_concentration_for_dispelled as cleanup_service,
    )
    from app.services.spell_runtime_service import end_concentration_runtime_instances

    result = await db.execute(select(Token).where(Token.campaign_id == campaign_id))
    all_tokens = result.scalars().all()

    broken = cleanup_service(all_tokens, dispelled_spell_ids=dispelled_ids, target_token_id=target_token_id)
    side_effects.concentration_broken_token_ids.extend(broken)

    if broken:
        touched = await end_concentration_runtime_instances(
            db, campaign_id=campaign_id, concentration_owner_token_ids=broken,
        )
        side_effects.runtime_touched_token_ids.update(touched)

    await db.flush()
