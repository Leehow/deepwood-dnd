#!/usr/bin/env python3
"""
Movement / Teleportation 法术效果迁移脚本。

给传送类、移动类法术补上结构化 teleport / modify_movement / restrict_movement primitive。
保留所有现有 effects（含 narrative）。
"""
import json
import sys
from pathlib import Path

SPELLS_PATH = Path(__file__).resolve().parent.parent / "frontend" / "app" / "data" / "rules" / "spells.json"

# ── Teleport spells ──────────────────────────────────────────

TELEPORT_MAP = {
    "misty_step":          {"range": 30, "mode": "self", "mustSee": True},
    "dimension_door":      {"range": 500, "mode": "self", "carriesOthers": True},
    "teleport":            {"range": 0, "mode": "self", "carriesOthers": True},  # 无限距离
    "plane_shift":         {"range": 0, "mode": "self", "carriesOthers": True},
    "transport_via_plants": {"range": 0, "mode": "self"},
    "tree_stride":         {"range": 500, "mode": "self"},
    "word_of_recall":      {"range": 0, "mode": "self", "carriesOthers": True},
    "arcane_gate":         {"range": 500, "mode": "self"},
    "etherealness":        {"range": 0, "mode": "self"},
    "gate":                {"range": 60, "mode": "target"},
    "teleportation_circle": {"range": 0, "mode": "self", "carriesOthers": True},
}

# ── Movement mod spells ──────────────────────────────────────

MOVEMENT_MAP = {
    "fly":                  [{"movementType": "fly", "formula": "60", "operation": "grant", "hover": False}],
    "spider_climb":         [{"movementType": "climb", "formula": "walk_speed", "operation": "grant"}],
    "haste":                [{"movementType": "walk", "formula": "walk_speed", "operation": "add"}],  # 速度翻倍 ≈ +walk_speed
    "longstrider":          [{"movementType": "walk", "formula": "10", "operation": "add"}],
    "freedom_of_movement":  [],  # restrict_movement 解除，非 modify_movement
    "water_walk":           [{"movementType": "walk", "formula": "walk_speed", "operation": "grant"}],  # 水面行走
    "water_breathing":      [{"movementType": "swim", "formula": "walk_speed", "operation": "grant"}],
    "jump":                 [{"movementType": "walk", "formula": "0", "operation": "add"}],  # 跳跃距离×3，特殊
    "expeditious_retreat":  [{"movementType": "walk", "formula": "0", "operation": "add"}],  # dash 附赠动作
    "levitate":             [{"movementType": "fly", "formula": "20", "operation": "grant", "hover": True}],
    "gaseous_form":         [{"movementType": "fly", "formula": "10", "operation": "grant", "hover": True}],
    "wind_walk":            [{"movementType": "fly", "formula": "300", "operation": "grant"}],
    "feather_fall":         [],  # 减缓坠落，无 modify_movement
}


def _has_effect_type(spell: dict, effect_type: str) -> bool:
    for phase in spell.get("effects", []):
        for eff in phase.get("effects", []):
            if eff.get("type") == effect_type:
                return True
    return False


def _append_to_first_phase(spell: dict, effect: dict) -> None:
    if spell.get("effects") and len(spell["effects"]) > 0:
        spell["effects"][0]["effects"].append(effect)
    else:
        spell["effects"] = [{
            "trigger": "on_cast",
            "target": {"type": "self"},
            "effects": [effect],
        }]


def main():
    with open(SPELLS_PATH, "r", encoding="utf-8") as f:
        root = json.load(f)

    spells = root["spells"]
    spell_map = {s["id"]: s for s in spells}
    modified = []

    # Teleport
    for sid, cfg in TELEPORT_MAP.items():
        spell = spell_map.get(sid)
        if not spell or _has_effect_type(spell, "teleport"):
            continue
        effect = {"type": "teleport", "range": cfg["range"], "mode": cfg["mode"]}
        if cfg.get("mustSee"):
            effect["mustSee"] = True
        if cfg.get("carriesOthers"):
            effect["carriesOthers"] = True
        _append_to_first_phase(spell, effect)
        modified.append(f"teleport: {sid}")

    # Movement mods
    for sid, mods in MOVEMENT_MAP.items():
        spell = spell_map.get(sid)
        if not spell:
            continue
        for mod in mods:
            if _has_effect_type(spell, "modify_movement"):
                continue
            effect = {"type": "modify_movement", "movementType": mod["movementType"],
                      "operation": mod["operation"]}
            if mod.get("formula"):
                effect["formula"] = mod["formula"]
            if mod.get("hover") is not None:
                effect["hover"] = mod["hover"]
            _append_to_first_phase(spell, effect)
            modified.append(f"modify_movement: {sid}")

    # Freedom of movement — special: removes movement restrictions
    fom = spell_map.get("freedom_of_movement")
    if fom and not _has_effect_type(fom, "narrative"):
        pass  # already has narrative, just note it

    with open(SPELLS_PATH, "w", encoding="utf-8") as f:
        json.dump(root, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"=== 迁移完成: {len(modified)} 个效果已添加 ===")
    for m in modified:
        print(f"  {m}")


if __name__ == "__main__":
    main()
