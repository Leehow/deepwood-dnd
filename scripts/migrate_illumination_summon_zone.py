#!/usr/bin/env python3
"""
Illumination / Summon / Zone mechanic 法术效果迁移脚本。

给光照类、召唤类法术补上 apply_illumination / spawn_summon primitive，
给已有 create_zone_visual 的法术补上 zone mechanic 字段，
给需要新增 zone visual 的法术添加完整 create_zone_visual。
"""
import json
import sys
from pathlib import Path

SPELLS_PATH = Path(__file__).resolve().parent.parent / "frontend" / "app" / "data" / "rules" / "spells.json"

# ── Illumination spells ─────────────────────────────────────

ILLUMINATION_MAP = {
    "light":            {"lightType": "light", "brightRadius": 20, "dimRadius": 20, "attachTo": "object"},
    "produce_flame":    {"lightType": "light", "brightRadius": 10, "dimRadius": 10, "attachTo": "caster"},
    "dancing_lights":   {"lightType": "light", "brightRadius": 0, "dimRadius": 10, "attachTo": "point", "movable": True, "moveAction": "bonus_action"},
    "continual_flame":  {"lightType": "light", "brightRadius": 20, "dimRadius": 20, "attachTo": "object"},
    "flame_blade":      {"lightType": "light", "brightRadius": 10, "dimRadius": 10, "attachTo": "caster"},
    "flaming_sphere":   {"lightType": "light", "brightRadius": 20, "dimRadius": 20, "attachTo": "point", "movable": True, "moveAction": "bonus_action"},
    "moonbeam":         {"lightType": "light", "brightRadius": 0, "dimRadius": 5, "attachTo": "point", "movable": True, "moveAction": "action"},
    "fire_shield":      {"lightType": "light", "brightRadius": 10, "dimRadius": 10, "attachTo": "caster"},
    "wall_of_fire":     {"lightType": "light", "brightRadius": 60, "dimRadius": 60, "attachTo": "point"},
    "sunbeam":          {"lightType": "light", "brightRadius": 30, "dimRadius": 30, "attachTo": "caster", "isSunlight": True},
    "faerie_fire":      {"lightType": "light", "brightRadius": 0, "dimRadius": 10, "attachTo": "target"},
    "holy_aura":        {"lightType": "light", "brightRadius": 0, "dimRadius": 5, "attachTo": "caster"},
    "prismatic_wall":   {"lightType": "light", "brightRadius": 100, "dimRadius": 100, "attachTo": "point"},
    "hunger_of_hadar":  {"lightType": "darkness", "darknessRadius": 20, "blocksDarkvision": True, "attachTo": "point"},
}

# ── Summon spells ───────────────────────────────────────────

SUMMON_MAP = {
    "find_familiar":              {"instanceName": "魔宠", "count": 1, "faction": "player"},
    "unseen_servant":             {"instanceName": "隐形仆役", "count": 1, "faction": "player"},
    "find_steed":                 {"instanceName": "坐骑", "count": 1, "faction": "player"},
    "animate_dead":               {"instanceName": "亡灵", "count": 1, "faction": "player"},
    "conjure_animals":            {"instanceName": "野兽", "faction": "player"},
    "phantom_steed":              {"instanceName": "魅影驹", "count": 1, "faction": "player"},
    "conjure_woodland_beings":    {"instanceName": "林地精类", "faction": "player"},
    "conjure_minor_elementals":   {"instanceName": "次级元素生物", "faction": "player"},
    "guardian_of_faith":          {"instanceName": "信仰守卫", "count": 1, "faction": "player"},
    "mordenkainens_faithful_hound": {"instanceName": "摩登肯忠犬", "count": 1, "faction": "player"},
    "animate_objects":            {"instanceName": "活化物件", "faction": "player"},
    "conjure_elemental":          {"instanceName": "元素生物", "count": 1, "faction": "neutral"},
    "conjure_fey":                {"instanceName": "精类生物", "count": 1, "faction": "neutral"},
    "create_undead":              {"instanceName": "高等亡灵", "count": 3, "faction": "player"},
    "conjure_celestial":          {"instanceName": "天界生物", "count": 1, "faction": "player"},
}

# ── Zone patches: existing zones that need more fields ──────

ZONE_PATCHES = {
    "fog_cloud": {
        "spreadsAroundCorners": True,
        "windDispel": {"moderate": 4, "strong": 1},
    },
    "darkness": {
        "spreadsAroundCorners": True,
    },
    "daylight": {
        "spreadsAroundCorners": True,
    },
}

# ── New zone visuals ────────────────────────────────────────

NEW_ZONES = {
    "stinking_cloud":   {"zoneType": "cloud", "obscurement": "heavy", "spreadsAroundCorners": True, "windDispel": {"moderate": 4, "strong": 1}},
    "cloudkill":        {"zoneType": "cloud", "obscurement": "heavy", "spreadsAroundCorners": True, "windDispel": {"strong": 1}, "cloudMovement": {"distance": 10, "direction": "away_from_caster", "timing": "start_of_caster_turn"}},
    "incendiary_cloud": {"zoneType": "cloud", "obscurement": "heavy", "spreadsAroundCorners": True, "windDispel": {"moderate": 1}, "cloudMovement": {"distance": 10, "direction": "chosen", "timing": "end_of_caster_turn"}},
    "insect_plague":    {"zoneType": "other", "difficultTerrain": True, "obscurement": "light", "spreadsAroundCorners": True},
    "web":              {"zoneType": "terrain", "difficultTerrain": True, "obscurement": "light"},
    "entangle":         {"zoneType": "terrain", "difficultTerrain": True},
    "grease":           {"zoneType": "terrain", "difficultTerrain": True},
    "spike_growth":     {"zoneType": "terrain", "difficultTerrain": True},
    "sleet_storm":      {"zoneType": "terrain", "difficultTerrain": True, "obscurement": "heavy"},
    "plant_growth":     {"zoneType": "terrain", "difficultTerrain": True},
    "wall_of_thorns":   {"zoneType": "terrain", "difficultTerrain": True},
    "blade_barrier":    {"zoneType": "terrain", "difficultTerrain": True},
    "silence":          {"zoneType": "other"},
}


def _has_effect_type(spell: dict, etype: str) -> bool:
    for phase in spell.get("effects", []):
        for eff in phase.get("effects", []):
            if eff.get("type") == etype:
                return True
    return False


def _add_on_cast_effect(spell: dict, effect: dict) -> None:
    """Append an on_cast phase with a single effect to spell.effects[]."""
    if "effects" not in spell:
        spell["effects"] = []
    spell["effects"].append({
        "trigger": "on_cast",
        "target": {"type": "self"},
        "effects": [effect],
    })


def _patch_zone_visual(spell: dict, patches: dict) -> bool:
    """Merge extra fields into existing create_zone_visual effect."""
    for phase in spell.get("effects", []):
        for eff in phase.get("effects", []):
            if eff.get("type") == "create_zone_visual":
                eff.update(patches)
                return True
    return False


def main():
    with open(SPELLS_PATH, "r", encoding="utf-8") as f:
        root = json.load(f)

    spells = root["spells"]
    idx = {s["id"]: s for s in spells}
    stats = {"illumination": 0, "summon": 0, "zone_patch": 0, "zone_new": 0}

    # 1. Illumination
    for spell_id, params in ILLUMINATION_MAP.items():
        spell = idx.get(spell_id)
        if not spell:
            print(f"[SKIP] {spell_id} not found")
            continue
        if _has_effect_type(spell, "apply_illumination"):
            print(f"[SKIP] {spell_id} already has apply_illumination")
            continue
        effect = {"type": "apply_illumination", **params}
        _add_on_cast_effect(spell, effect)
        stats["illumination"] += 1
        print(f"[ADD] {spell_id} ← apply_illumination ({params.get('lightType')})")

    # 2. Summon
    for spell_id, params in SUMMON_MAP.items():
        spell = idx.get(spell_id)
        if not spell:
            print(f"[SKIP] {spell_id} not found")
            continue
        if _has_effect_type(spell, "spawn_summon"):
            print(f"[SKIP] {spell_id} already has spawn_summon")
            continue
        effect = {"type": "spawn_summon", **params}
        _add_on_cast_effect(spell, effect)
        stats["summon"] += 1
        print(f"[ADD] {spell_id} ← spawn_summon ({params['instanceName']})")

    # 3. Zone patches (existing zones)
    for spell_id, patches in ZONE_PATCHES.items():
        spell = idx.get(spell_id)
        if not spell:
            print(f"[SKIP] {spell_id} not found")
            continue
        if _patch_zone_visual(spell, patches):
            stats["zone_patch"] += 1
            print(f"[PATCH] {spell_id} ← zone fields: {list(patches.keys())}")
        else:
            print(f"[MISS] {spell_id} has no create_zone_visual to patch")

    # 4. New zone visuals
    for spell_id, params in NEW_ZONES.items():
        spell = idx.get(spell_id)
        if not spell:
            print(f"[SKIP] {spell_id} not found")
            continue
        if _has_effect_type(spell, "create_zone_visual"):
            print(f"[SKIP] {spell_id} already has create_zone_visual")
            continue
        effect = {"type": "create_zone_visual", **params}
        target_type = "area" if params.get("zoneType") != "terrain" else "area"
        _add_on_cast_effect(spell, effect)
        stats["zone_new"] += 1
        print(f"[ADD] {spell_id} ← create_zone_visual ({params['zoneType']})")

    with open(SPELLS_PATH, "w", encoding="utf-8") as f:
        json.dump(root, f, ensure_ascii=False, indent=2)
        f.write("\n")

    total = sum(stats.values())
    print(f"\n✅ Done: {total} effects added/patched")
    print(f"   illumination: {stats['illumination']}, summon: {stats['summon']}, "
          f"zone_patch: {stats['zone_patch']}, zone_new: {stats['zone_new']}")


if __name__ == "__main__":
    main()
