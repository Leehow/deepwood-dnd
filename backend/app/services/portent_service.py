"""
Portent Service — 预言骰（占卜系法师）
长休时预投 d20，可在任何 d20 投骰前替换结果。
"""
from __future__ import annotations

import random
from typing import List, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.character import Character


def _portent_count(level: int) -> int:
    """预言骰数量：2级2颗，14级起3颗"""
    if level >= 14:
        return 3
    return 2


async def roll_portent_dice(
    db: AsyncSession,
    character_id: int,
) -> List[int]:
    """长休时投预言骰，存入 class_feature_uses.portent.prerolledValues"""
    char = await db.get(Character, character_id)
    if not char:
        return []

    # 确认是占卜系法师
    if (char.class_id or "").lower() != "wizard":
        return []
    if not char.subclass_id or "divination" not in char.subclass_id.lower():
        return []
    if (char.level or 0) < 2:
        return []

    count = _portent_count(char.level or 2)
    values = sorted([random.randint(1, 20) for _ in range(count)])

    uses = dict(char.class_feature_uses or {})
    uses["portent"] = {
        "current": count,
        "max": count,
        "prerolledValues": values,
    }
    char.class_feature_uses = uses
    flag_modified(char, "class_feature_uses")
    await db.flush()

    return values


async def use_portent_die(
    db: AsyncSession,
    character_id: int,
    value: int,
) -> Optional[List[int]]:
    """消耗一个预言骰值，返回剩余值。值不存在则返回 None。"""
    char = await db.get(Character, character_id)
    if not char:
        return None

    uses = dict(char.class_feature_uses or {})
    portent = uses.get("portent", {})
    values: list = list(portent.get("prerolledValues", []))

    if value not in values:
        return None

    values.remove(value)
    portent["prerolledValues"] = values
    portent["current"] = len(values)
    uses["portent"] = portent
    char.class_feature_uses = uses
    flag_modified(char, "class_feature_uses")
    await db.flush()

    return values


async def get_portent_values(
    db: AsyncSession,
    character_id: int,
) -> List[int]:
    """获取当前存储的预言骰值"""
    char = await db.get(Character, character_id)
    if not char:
        return []
    portent = (char.class_feature_uses or {}).get("portent", {})
    return list(portent.get("prerolledValues", []))
