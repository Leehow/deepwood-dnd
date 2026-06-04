#!/usr/bin/env python3
"""
迁移脚本：
1. 给解除状态类法术补上 remove_condition primitive
2. 给有生物类型限制的法术 phase 补上 targetCreatureTypes / excludeCreatureTypes
"""
import json
from pathlib import Path

SPELLS_PATH = Path(__file__).resolve().parent.parent / "frontend" / "app" / "data" / "rules" / "spells.json"

# ── Remove condition spells ─────────────────────────────────

REMOVAL_MAP = {
    "lesser_restoration": {
        "conditions": ["blinded", "deafened", "paralyzed", "poisoned"],
        "mode": "choose_one",
    },
    "greater_restoration": {
        "conditions": ["charmed", "petrified", "cursed", "exhaustion", "ability_reduction", "hp_max_reduction"],
        "mode": "choose_one",
    },
    "remove_curse": {
        "conditions": ["cursed"],
        "mode": "all",
    },
    "protection_from_poison": {
        "conditions": ["poisoned"],
        "mode": "all",
    },
    "power_word_heal": {
        "conditions": ["charmed", "frightened", "paralyzed", "stunned"],
        "mode": "all",
    },
}

# ── Creature type restrictions ──────────────────────────────
# spell_id → list of (phase_index_or_"all", field, value)
# "all" means patch every phase; int means patch that phase index only
# For new spells that need the field on their first/only combat phase, use 0

# targetCreatureTypes: 仅对这些类型生效
TARGET_ONLY = {
    "charm_person":     ["humanoid"],
    "hold_person":      ["humanoid"],
    "dominate_person":  ["humanoid"],
    "calm_emotions":    ["humanoid"],
    "animal_friendship": ["beast"],
    "animal_messenger":  ["beast"],
    "speak_with_animals": ["beast"],
    "awaken":           ["beast", "plant"],
}

# excludeCreatureTypes: 对这些类型无效
EXCLUDE_TYPES = {
    "spare_the_dying":    ["undead", "construct"],
    "cure_wounds":        ["undead", "construct"],
    "healing_word":       ["undead", "construct"],
    "prayer_of_healing":  ["undead", "construct"],
    "mass_healing_word":  ["undead", "construct"],
    "mass_cure_wounds":   ["undead", "construct"],
    "heal":               ["undead", "construct"],
    "power_word_heal":    ["undead", "construct"],
    "mass_heal":          ["undead", "construct"],
    "sleep":              ["undead"],
    "hold_monster":       ["undead"],
    "command":            ["undead"],
}


def _has_effect_type(spell: dict, etype: str) -> bool:
    for phase in spell.get("effects", []):
        for eff in phase.get("effects", []):
            if eff.get("type") == etype:
                return True
    return False


def _add_on_cast_effect(spell: dict, effect: dict) -> None:
    if "effects" not in spell:
        spell["effects"] = []
    spell["effects"].append({
        "trigger": "on_cast",
        "target": {"type": "single"},
        "effects": [effect],
    })


def main():
    with open(SPELLS_PATH, "r", encoding="utf-8") as f:
        root = json.load(f)

    spells = root["spells"]
    idx = {s["id"]: s for s in spells}
    stats = {"removal": 0, "target_type": 0, "exclude_type": 0}

    # 1. Remove condition
    for spell_id, cfg in REMOVAL_MAP.items():
        spell = idx.get(spell_id)
        if not spell:
            print(f"[SKIP] {spell_id} not found")
            continue
        if _has_effect_type(spell, "remove_condition"):
            print(f"[SKIP] {spell_id} already has remove_condition")
            continue
        effect = {"type": "remove_condition", **cfg}
        _add_on_cast_effect(spell, effect)
        stats["removal"] += 1
        print(f"[ADD] {spell_id} ← remove_condition ({cfg['mode']}: {cfg['conditions']})")

    # 2. targetCreatureTypes
    for spell_id, types in TARGET_ONLY.items():
        spell = idx.get(spell_id)
        if not spell:
            print(f"[SKIP] {spell_id} not found")
            continue
        phases = spell.get("effects", [])
        patched = False
        for phase in phases:
            if "targetCreatureTypes" not in phase:
                phase["targetCreatureTypes"] = types
                patched = True
        if patched:
            stats["target_type"] += 1
            print(f"[PATCH] {spell_id} ← targetCreatureTypes: {types}")
        else:
            print(f"[SKIP] {spell_id} already has targetCreatureTypes or no effects")

    # 3. excludeCreatureTypes
    for spell_id, types in EXCLUDE_TYPES.items():
        spell = idx.get(spell_id)
        if not spell:
            print(f"[SKIP] {spell_id} not found")
            continue
        phases = spell.get("effects", [])
        patched = False
        for phase in phases:
            if "excludeCreatureTypes" not in phase:
                phase["excludeCreatureTypes"] = types
                patched = True
        if patched:
            stats["exclude_type"] += 1
            print(f"[PATCH] {spell_id} ← excludeCreatureTypes: {types}")
        else:
            print(f"[SKIP] {spell_id} already has excludeCreatureTypes or no effects")

    with open(SPELLS_PATH, "w", encoding="utf-8") as f:
        json.dump(root, f, ensure_ascii=False, indent=2)
        f.write("\n")

    total = sum(stats.values())
    print(f"\n✅ Done: {total} spells updated")
    print(f"   removal: {stats['removal']}, targetCreatureTypes: {stats['target_type']}, "
          f"excludeCreatureTypes: {stats['exclude_type']}")


if __name__ == "__main__":
    main()
