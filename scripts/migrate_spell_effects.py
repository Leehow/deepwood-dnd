#!/usr/bin/env python3
"""
Phase 4 法术数据迁移脚本 — 给 narrative-only 法术补上结构化 effect primitive。

迁移策略：保留所有现有 effects（含 narrative），在对应 phase 中追加机械化 primitive。
不删除任何现有字段（tokenFilter、illusion、controlEffect 等保留用于遗留兼容）。

运行方式: python scripts/migrate_spell_effects.py
"""
import json
import sys
from pathlib import Path

SPELLS_PATH = Path(__file__).resolve().parent.parent / "frontend" / "app" / "data" / "rules" / "spells.json"

# ── T2: tokenFilter → apply_token_filter ───────────────────────

T2_SPELL_EXTRAS = {
    # enlarge-reduce 已经有 castOptions，需要在每个 option 的 effects 中补 resize_token + apply_token_filter
    "enlarge-reduce": "special",
    # 以下法术在 spell 顶级有 tokenFilter，补 apply_token_filter
    "blink": {"effect_type": "set_visibility", "mode": "ethereal"},
    "alter_self": None,  # 纯 tokenFilter
    "death_ward": None,
    "mirror_image": None,
}

# ── T3: illusion → spawn_illusion / set_disguise ───────────────

T3_DISGUISE = {"disguise_self", "seeming"}
T3_ILLUSION = {
    "silent_image", "minor_illusion", "major_image",
    "hallucinatory_terrain", "mirage_arcane", "programmed_illusion",
    "creation", "simulacrum", "magic_mouth", "nystuls_magic_aura",
}

# ── T4: areaOfEffect → create_zone_visual ─────────────────────

T4_ZONE_MAP = {
    "darkness": {"zoneType": "darkness", "obscurement": "heavy"},
    "fog_cloud": {"zoneType": "fog", "obscurement": "heavy"},
    "daylight": {"zoneType": "light"},
    "detect_evil_and_good": {"zoneType": "other"},
    "detect_magic": {"zoneType": "other"},
    "detect_poison_and_disease": {"zoneType": "other"},
    "globe_of_invulnerability": {"zoneType": "other"},
    "gust_of_wind": {"zoneType": "terrain"},
    "leomunds_tiny_hut": {"zoneType": "other"},
    "antilife_shell": {"zoneType": "other"},
    "move_earth": {"zoneType": "terrain"},
    "purify_food_and_drink": {"zoneType": "other"},
    "teleportation_circle": {"zoneType": "other"},
    "word_of_recall": {"zoneType": "other"},
    "zone_of_truth": {"zoneType": "other"},
}

# ── T1 子集：有 apply_transformation 意义的 ───────────────────

T1_TRANSFORMATION = {
    "polymorph": "polymorph",
    "true_polymorph": "polymorph",
    "animal_shapes": "animal_shapes",
    "shapechange": "polymorph",
}


def _has_mechanical_effect(spell: dict, effect_type: str) -> bool:
    """Check if spell already has a specific effect type in its effects."""
    for phase in spell.get("effects", []):
        for eff in phase.get("effects", []):
            if eff.get("type") == effect_type:
                return True
    # Also check castOptions
    for opt in spell.get("castOptions", []):
        for phase in opt.get("effects", []):
            for eff in phase.get("effects", []):
                if eff.get("type") == effect_type:
                    return True
    return False


def _append_effect_to_first_phase(spell: dict, effect: dict) -> None:
    """Append an effect primitive to the first phase's effects list."""
    if spell.get("effects") and len(spell["effects"]) > 0:
        spell["effects"][0]["effects"].append(effect)
    else:
        # Create a new phase
        spell["effects"] = [{
            "trigger": "on_cast",
            "target": {"type": "self"},
            "effects": [effect],
        }]


def migrate_t2(spell: dict) -> bool:
    """T2: tokenFilter → apply_token_filter / set_visibility / resize_token."""
    sid = spell["id"]
    changed = False

    if sid == "enlarge-reduce":
        # 给 castOptions 中的 enlarge/reduce 补 resize_token
        for opt in spell.get("castOptions", []):
            if opt["key"] == "enlarge" and opt.get("effects"):
                if not any(e.get("type") == "resize_token"
                           for p in opt["effects"] for e in p.get("effects", [])):
                    opt["effects"][0]["effects"].insert(0, {
                        "type": "resize_token", "sizeDelta": 1,
                    })
                    changed = True
            elif opt["key"] == "reduce" and opt.get("effects"):
                if not any(e.get("type") == "resize_token"
                           for p in opt["effects"] for e in p.get("effects", [])):
                    opt["effects"][0]["effects"].insert(0, {
                        "type": "resize_token", "sizeDelta": -1,
                    })
                    changed = True
        return changed

    extra = T2_SPELL_EXTRAS.get(sid)
    tf = spell.get("tokenFilter")
    if not tf:
        return False

    # 已有 apply_token_filter 则跳过
    if _has_mechanical_effect(spell, "apply_token_filter"):
        return False

    if isinstance(extra, dict) and extra.get("effect_type") == "set_visibility":
        # blink → set_visibility
        if not _has_mechanical_effect(spell, "set_visibility"):
            _append_effect_to_first_phase(spell, {
                "type": "set_visibility",
                "mode": extra["mode"],
                "filter": {k: v for k, v in tf.items()},
            })
            changed = True
    else:
        # 普通 tokenFilter → apply_token_filter
        _append_effect_to_first_phase(spell, {
            "type": "apply_token_filter",
            "filter": {k: v for k, v in tf.items()},
        })
        changed = True

    return changed


def migrate_t3(spell: dict) -> bool:
    """T3: illusion → spawn_illusion / set_disguise."""
    sid = spell["id"]
    changed = False

    if sid in T3_DISGUISE:
        if not _has_mechanical_effect(spell, "set_disguise"):
            _append_effect_to_first_phase(spell, {
                "type": "set_disguise",
                "disguiseType": "appearance",
                "requiresImage": True,
            })
            changed = True

    elif sid in T3_ILLUSION:
        if not _has_mechanical_effect(spell, "spawn_illusion"):
            ill = spell.get("illusion", {})
            ill_types = ill.get("types", ["visual"])
            if len(ill_types) > 1:
                ill_type = "visual_auditory"
            else:
                ill_type = ill_types[0] if ill_types else "visual"

            effect: dict = {
                "type": "spawn_illusion",
                "illusionType": ill_type,
            }
            if ill.get("controllable") is not None:
                effect["controllable"] = ill["controllable"]
            if ill.get("physicalPass") is not None:
                effect["physicalPass"] = ill["physicalPass"]
            _append_effect_to_first_phase(spell, effect)
            changed = True

    return changed


def migrate_t4(spell: dict) -> bool:
    """T4: areaOfEffect → create_zone_visual."""
    sid = spell["id"]
    zone_cfg = T4_ZONE_MAP.get(sid)
    if not zone_cfg:
        return False

    if _has_mechanical_effect(spell, "create_zone_visual"):
        return False

    effect: dict = {"type": "create_zone_visual", "zoneType": zone_cfg["zoneType"]}
    if "obscurement" in zone_cfg:
        effect["obscurement"] = zone_cfg["obscurement"]

    # 检查 zoneEffects 中是否有 difficultTerrain
    ze = spell.get("zoneEffects", {})
    if ze.get("difficultTerrain"):
        effect["difficultTerrain"] = True

    _append_effect_to_first_phase(spell, effect)
    return True


def migrate_t5(spell: dict) -> bool:
    """T5: dimension_door → deal_damage（碰撞伤害）."""
    if spell["id"] != "dimension_door":
        return False
    if _has_mechanical_effect(spell, "deal_damage"):
        return False

    # 追加一个条件触发的 deal_damage phase（碰撞时）
    spell["effects"].append({
        "trigger": "on_cast",
        "target": {"type": "self"},
        "condition": {"collision": True},
        "effects": [
            {"type": "deal_damage", "formula": "4d6", "damageType": "force"},
            {"type": "narrative", "description": "传送至被占据位置，传送失败，受到4d6力场伤害。"},
        ],
    })
    return True


def migrate_t1_transformation(spell: dict) -> bool:
    """T1 子集: polymorph 类 → apply_transformation."""
    sid = spell["id"]
    transform_type = T1_TRANSFORMATION.get(sid)
    if not transform_type:
        return False
    if _has_mechanical_effect(spell, "apply_transformation"):
        return False

    _append_effect_to_first_phase(spell, {
        "type": "apply_transformation",
        "transformType": transform_type,
    })
    return True


def main():
    if not SPELLS_PATH.exists():
        print(f"ERROR: {SPELLS_PATH} not found")
        sys.exit(1)

    with open(SPELLS_PATH, "r", encoding="utf-8") as f:
        root = json.load(f)

    spells = root["spells"]
    stats = {"t1_transform": 0, "t2": 0, "t3": 0, "t4": 0, "t5": 0}
    modified_ids: dict[str, list[str]] = {k: [] for k in stats}

    for spell in spells:
        sid = spell["id"]

        if sid in T2_SPELL_EXTRAS and migrate_t2(spell):
            stats["t2"] += 1
            modified_ids["t2"].append(sid)

        if (sid in T3_DISGUISE or sid in T3_ILLUSION) and migrate_t3(spell):
            stats["t3"] += 1
            modified_ids["t3"].append(sid)

        if sid in T4_ZONE_MAP and migrate_t4(spell):
            stats["t4"] += 1
            modified_ids["t4"].append(sid)

        if sid == "dimension_door" and migrate_t5(spell):
            stats["t5"] += 1
            modified_ids["t5"].append(sid)

        if sid in T1_TRANSFORMATION and migrate_t1_transformation(spell):
            stats["t1_transform"] += 1
            modified_ids["t1_transform"].append(sid)

    # Write back
    with open(SPELLS_PATH, "w", encoding="utf-8") as f:
        json.dump(root, f, ensure_ascii=False, indent=2)
        f.write("\n")

    total = sum(stats.values())
    print(f"=== 迁移完成: {total} 个法术已更新 ===")
    for tier, count in stats.items():
        if count:
            print(f"  {tier}: {count} — {modified_ids[tier]}")


if __name__ == "__main__":
    main()
