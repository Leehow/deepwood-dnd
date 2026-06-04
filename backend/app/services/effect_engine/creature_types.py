"""Creature-type normalization + matching for spell effect targeting.

Spell data (``frontend/app/data/rules/spells.json``) declares exclusions in
English, e.g. ``"excludeCreatureTypes": ["undead", "construct"]`` on healing
spells. Monster ``type`` strings in this project are mostly Chinese (often with
parenthetical subtypes, sometimes mixed CN/EN), and instances created without a
full parse may have no ``type`` at all — only a ``monster_id`` slug.

This module bridges those by:
  * resolving a canonical creature type from a ``monster_id`` via the preset
    monsters dataset (cached), and
  * matching an arbitrary (CN or EN) type string against a set of English
    canonical type keys using a per-type alias table.

Only matching is needed for correctness today (cure wounds et al. excluding
undead/construct), but the alias table covers all 5e creature types so future
``excludeCreatureTypes`` / advantage-by-type rules work the same way.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Iterable, Optional

# Canonical English creature type -> substrings (lowercased) that identify it.
# A type string matches a key if it contains ANY of the key's aliases. Chinese
# aliases are matched as substrings against the raw string; English aliases are
# matched against the lowercased string.
_CREATURE_TYPE_ALIASES: dict[str, tuple[str, ...]] = {
    "aberration": ("aberration", "异怪", "异常生物"),
    "beast": ("beast", "野兽", "动物", "怪兽", "怪物"),
    "celestial": ("celestial", "天界生物", "天体", "天使"),
    "construct": ("construct", "构装体", "构装生物", "构装"),
    "dragon": ("dragon", "龙类", "龙"),
    "elemental": ("elemental", "元素生物", "元素"),
    "fey": ("fey", "妖精类生物", "妖精", "精类", "精灵"),
    "fiend": ("fiend", "demon", "devil", "邪魔", "恶魔", "魔鬼", "尤格罗斯魔"),
    "giant": ("giant", "巨人"),
    "humanoid": ("humanoid", "类人生物", "人形生物"),
    "monstrosity": ("monstrosity", "超怪兽", "鸟妖"),
    "ooze": ("ooze", "泥怪"),
    "plant": ("plant", "植物"),
    "undead": ("undead", "不死生物", "不死本质", "不死", "亡灵"),
}


def _normalize_key(key: str) -> str:
    return (key or "").strip().lower()


def creature_type_matches(creature_type: Optional[str], keys: Iterable[str]) -> bool:
    """True if ``creature_type`` belongs to any canonical type in ``keys``.

    ``creature_type`` is a raw monster type string (CN/EN/mixed). ``keys`` are
    canonical English type names (e.g. from a spell's ``excludeCreatureTypes``).
    Unknown keys fall back to a direct case-insensitive substring test so the
    feature degrades gracefully if the data uses a type we have no alias for.
    """
    if not creature_type:
        return False
    raw = creature_type.strip()
    lowered = raw.lower()
    for key in keys:
        norm = _normalize_key(key)
        if not norm:
            continue
        aliases = _CREATURE_TYPE_ALIASES.get(norm)
        if aliases is None:
            # No alias table entry — best-effort direct substring match.
            if norm in lowered:
                return True
            continue
        for alias in aliases:
            if alias.isascii():
                if alias in lowered:
                    return True
            elif alias in raw:
                return True
    return False


@lru_cache(maxsize=1)
def _monster_type_by_id() -> dict[str, str]:
    """Map preset monster slug/id -> raw type string (cached)."""
    from app.utils.rules_cache import get_all_monsters

    out: dict[str, str] = {}
    for m in get_all_monsters() or []:
        if not isinstance(m, dict):
            continue
        mid = m.get("id") or m.get("slug") or m.get("index")
        mtype = m.get("type")
        if mid and mtype:
            out[str(mid)] = str(mtype)
    return out


def resolve_creature_type_from_monster_id(monster_id: Optional[str]) -> str:
    """Look up a preset monster's raw type string by its slug/id.

    Returns "" when the id is unknown or the dataset has no type for it.
    """
    if not monster_id:
        return ""
    return _monster_type_by_id().get(str(monster_id), "")
