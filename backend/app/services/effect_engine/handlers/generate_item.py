"""
GenerateItemHandler — generate_item verb.

Creates an equipment item and adds it to the caster's inventory.
Extracted from SpellResolver._resolve_generate_item().
"""
from __future__ import annotations

import time
from typing import Any, Dict, Optional, Type

from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm.attributes import flag_modified

from app.models.character import Character
from app.models.token import Token
from app.services.effect_engine.handlers.base import EffectHandler
from app.services.effect_engine.types import HandlerContext, HandlerOutcome, SideEffects


class GenerateItemParams(BaseModel):
    type: str = "generate_item"
    item_name: str = "物品"
    item_name_en: str = ""
    item_description: str = ""
    item_icon: str = ""
    item_template: str = "paper"
    item_template_name: Optional[str] = None
    item_category: str = "gear"

    model_config = ConfigDict(extra="forbid")


class GenerateItemHandler(EffectHandler):
    def get_param_schema(self) -> Type[BaseModel]:
        return GenerateItemParams

    async def execute(
        self,
        params: GenerateItemParams,
        hctx: HandlerContext,
        side_effects: SideEffects,
    ) -> HandlerOutcome:
        ctx = hctx.caster_ctx
        db = hctx.db

        unique_id = f"{ctx.spell_id}_{int(time.time() * 1000)}"
        new_item: Dict[str, Any] = {
            "id": unique_id,
            "name": params.item_name,
            "nameEn": params.item_name_en,
            "equipmentType": "gear",
            "category": params.item_category,
            "description": params.item_description,
            "iconPath": params.item_icon,
            "quantity": 1,
            "weight": 0,
            "sourceItemId": params.item_template,
            "sourceItemName": params.item_template_name or params.item_template,
            "spellGenerated": True,
            "spellId": ctx.spell_id,
            "spellName": ctx.spell_name,
        }

        token = await db.get(Token, ctx.caster_token_id)
        if token and token.character_id:
            char = await db.get(Character, token.character_id)
            if char:
                equipment = list(char.equipment or [])
                equipment.append(new_item)
                char.equipment = equipment
                flag_modified(char, "equipment")
                await db.flush()

                side_effects.items_generated.append({
                    "character_id": token.character_id,
                    "item": new_item,
                })
                return HandlerOutcome(
                    description=f"{params.item_name}已出现在{ctx.caster_name}的背包中",
                    items_generated=[{"character_id": token.character_id, "item": new_item}],
                )
            return HandlerOutcome(description=f"无法找到角色数据，{params.item_name}生成失败")
        return HandlerOutcome(description=f"施法者没有关联角色，{params.item_name}生成失败")
