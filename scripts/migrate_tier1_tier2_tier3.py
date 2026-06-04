#!/usr/bin/env python3
"""
Tier 1/2/3 法术效果迁移脚本。

给所有剩余缺失 primitive 的法术补上结构化 effect。
"""
import json
from pathlib import Path

SPELLS_PATH = Path(__file__).resolve().parent.parent / "frontend" / "app" / "data" / "rules" / "spells.json"


def _has(spell, etype):
    for p in spell.get("effects", []):
        for e in p.get("effects", []):
            if e.get("type") == etype:
                return True
    return False


def _add(spell, effect, trigger="on_cast", target_type="single"):
    if "effects" not in spell:
        spell["effects"] = []
    spell["effects"].append({
        "trigger": trigger,
        "target": {"type": target_type},
        "effects": [effect],
    })


# ── Tier 1: forced_movement ─────────────────────────────────
FORCED_MOVEMENT = {
    "thunderwave":       {"direction": "push", "distance": 10},
    "thorn_whip":        {"direction": "pull", "distance": 10},
    "thunderous_smite":  {"direction": "push", "distance": 10},
    "gust_of_wind":      {"direction": "push", "distance": 15},
    "grasping_vine":     {"direction": "pull", "distance": 20, "relativeTo": "spell_origin"},
    "eldritch_blast":    {"direction": "push", "distance": 10},
}

# ── Tier 1: create_wall ─────────────────────────────────────
WALLS = {
    "wind_wall":        {"shape": "line", "lengthFt": 50, "heightFt": 15, "thicknessFt": 1, "blocksProjectiles": True, "blocksLineOfSight": False},
    "wall_of_force":    {"shape": "line", "lengthFt": 100, "heightFt": 10, "blocksMovement": True, "blocksLineOfSight": False},
    "wall_of_stone":    {"shape": "line", "lengthFt": 100, "heightFt": 20, "thicknessFt": 6, "hpPerSegment": 30, "blocksMovement": True, "blocksLineOfSight": True},
    "wall_of_ice":      {"shape": "line", "lengthFt": 60, "heightFt": 10, "thicknessFt": 1, "hpPerSegment": 30, "blocksMovement": True, "blocksLineOfSight": True,
                         "passThroughDamage": {"formula": "10d6", "damageType": "cold"}},
    "prismatic_wall":   {"shape": "line", "lengthFt": 90, "heightFt": 30, "blocksMovement": True, "blocksLineOfSight": True},
}

# ── Tier 1: moving_aura ─────────────────────────────────────
AURAS = {
    "spirit_guardians":  {"radiusFt": 15, "anchor": "caster", "auraType": "damage"},
    "crusaders_mantle":  {"radiusFt": 30, "anchor": "caster", "auraType": "buff"},
    "aura_of_purity":    {"radiusFt": 30, "anchor": "caster", "auraType": "protection"},
    "aura_of_life":      {"radiusFt": 30, "anchor": "caster", "auraType": "buff"},
    "aura_of_vitality":  {"radiusFt": 30, "anchor": "caster", "auraType": "buff"},
    "circle_of_power":   {"radiusFt": 30, "anchor": "caster", "auraType": "protection"},
    "holy_aura":         {"radiusFt": 30, "anchor": "caster", "auraType": "protection"},
}

# ── Tier 1: counter_spell ───────────────────────────────────
COUNTER = {
    "counterspell": {"autoCounterLevel": 3, "checkAbility": "spellcasting", "checkDcFormula": "10 + spell_level"},
}

# ── Tier 2: create_barrier ──────────────────────────────────
BARRIERS = {
    "otilukes_resilient_sphere": {"shape": "sphere", "radiusFt": 5, "indestructible": True, "blocksPhysical": True, "blocksMagic": True},
    "forcecage":                 {"shape": "cage", "sideFt": 10, "indestructible": True, "teleportBlocked": True},
    "antimagic_field":           {"shape": "sphere", "radiusFt": 10, "blocksMagic": True},
}

# ── Tier 2: grant_sense ─────────────────────────────────────
SENSES = {
    "see_invisibility":   {"senseType": "detect_invisible", "range": 60},
    "true_seeing":        {"senseType": "truesight", "range": 120},
    "clairvoyance":       {"senseType": "remote_sensor"},
    "arcane_eye":         {"senseType": "remote_sensor"},
    "scrying":            {"senseType": "remote_sensor"},
    "detect_thoughts":    {"senseType": "detect_thoughts", "range": 30},
    "detect_magic":       {"senseType": "detect_magic", "range": 30},
    "identify":           {"senseType": "identify"},
    "find_traps":         {"senseType": "detect_traps", "range": 120},
}

# ── Tier 2: prevent_healing ─────────────────────────────────
PREVENT_HEALING = {
    "chill_touch": {"duration": "until_caster_next_turn"},
}

# ── Tier 2: stabilize ───────────────────────────────────────
STABILIZE = ["spare_the_dying"]

# ── Tier 2: instant_kill ────────────────────────────────────
INSTANT_KILL = {
    "power_word_kill": {"hpThreshold": 100},
}

# ── Tier 2: resurrect ───────────────────────────────────────
RESURRECT = {
    "raise_dead":           {"hpRestored": "1", "debuffDuration": "4_long_rests", "requiresBody": True},
    "reincarnate":          {"hpRestored": "full", "requiresBody": False},
    "resurrection":         {"hpRestored": "full", "debuffDuration": "4_long_rests", "requiresBody": False},
    "true_resurrection":    {"hpRestored": "full", "requiresBody": False},
}

# ── Tier 3: stored_trigger ──────────────────────────────────
TRIGGERS = {
    "glyph_of_warding": {"triggerCondition": "enter_area"},
    "contingency":       {"triggerCondition": "custom"},
    "symbol":            {"triggerCondition": "enter_area"},
}

# ── Tier 3: suppress_magic ──────────────────────────────────
SUPPRESS = {
    "globe_of_invulnerability": {"maxSpellLevel": 5, "scope": "zone"},
    "antimagic_field":          {"scope": "zone"},
    "nondetection":             {"scope": "target"},
}


def main():
    with open(SPELLS_PATH, "r", encoding="utf-8") as f:
        root = json.load(f)

    spells = root["spells"]
    idx = {s["id"]: s for s in spells}
    total = 0

    def _migrate(map_data, etype, label):
        nonlocal total
        for sid, params in map_data.items():
            spell = idx.get(sid)
            if not spell:
                print(f"[SKIP] {sid} not found")
                continue
            if _has(spell, etype):
                print(f"[SKIP] {sid} already has {etype}")
                continue
            _add(spell, {"type": etype, **params})
            total += 1
            print(f"[ADD] {sid} ← {etype}")

    _migrate(FORCED_MOVEMENT, "forced_movement", "forced_movement")
    _migrate(WALLS, "create_wall", "create_wall")
    _migrate(AURAS, "create_moving_aura", "create_moving_aura")
    _migrate(COUNTER, "counter_spell", "counter_spell")
    _migrate(BARRIERS, "create_barrier", "create_barrier")
    _migrate(SENSES, "grant_sense", "grant_sense")
    _migrate(PREVENT_HEALING, "prevent_healing", "prevent_healing")
    _migrate(INSTANT_KILL, "instant_kill", "instant_kill")
    _migrate(RESURRECT, "resurrect", "resurrect")
    _migrate(TRIGGERS, "stored_trigger", "stored_trigger")
    _migrate(SUPPRESS, "suppress_magic", "suppress_magic")

    # stabilize (no params)
    for sid in STABILIZE:
        spell = idx.get(sid)
        if not spell:
            continue
        if _has(spell, "stabilize"):
            continue
        _add(spell, {"type": "stabilize"})
        total += 1
        print(f"[ADD] {sid} ← stabilize")

    with open(SPELLS_PATH, "w", encoding="utf-8") as f:
        json.dump(root, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"\n✅ Done: {total} effects added")


if __name__ == "__main__":
    main()
