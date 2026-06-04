#!/usr/bin/env python3
"""Fix monster stat errors using SRD reference data (numbers only, no AI)."""

import json
import os
import shutil

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRD_PATH = os.path.join(PROJECT_ROOT, "dnd-platform/references/5e-srd/5e-SRD-Monsters.json")
OUR_PATH = os.path.join(PROJECT_ROOT, "dnd-platform/configs/npc/monsters.json")

ABILITY_MAP = {
    "strength": "str", "dexterity": "dex", "constitution": "con",
    "intelligence": "int", "wisdom": "wis", "charisma": "cha"
}

SIZE_MAP = {"Tiny": "微型", "Small": "小型", "Medium": "中型",
            "Large": "大型", "Huge": "巨型", "Gargantuan": "超巨型"}


def parse_speed(srd_speed):
    result = {}
    for k, v in srd_speed.items():
        if isinstance(v, str):
            num = int("".join(c for c in v if c.isdigit()) or "0")
        else:
            num = v
        if isinstance(v, bool):
            result[k] = v
        else:
            result[k] = num
    return result


def main():
    with open(SRD_PATH) as f:
        srd_list = json.load(f)
    with open(OUR_PATH) as f:
        our_data = json.load(f)

    srd_by_name = {m["name"].lower(): m for m in srd_list}
    fix_log = []

    for m in our_data["monsters"]:
        name_en = m.get("nameEn", "").lower().strip()
        if not name_en or name_en not in srd_by_name:
            continue
        s = srd_by_name[name_en]
        fixes = []

        # AC
        srd_ac = s["armor_class"][0]["value"] if isinstance(s["armor_class"], list) else s["armor_class"]
        if srd_ac != m.get("ac"):
            fixes.append(f"ac: {m.get('ac')} -> {srd_ac}")
            m["ac"] = srd_ac

        # HP
        if s["hit_points"] != m.get("hp"):
            fixes.append(f"hp: {m.get('hp')} -> {s['hit_points']}")
            m["hp"] = s["hit_points"]

        # HP formula
        srd_hp_roll = s.get("hit_points_roll", "")
        if srd_hp_roll and srd_hp_roll != m.get("hpFormula"):
            fixes.append(f"hpFormula: {m.get('hpFormula')} -> {srd_hp_roll}")
            m["hpFormula"] = srd_hp_roll

        # Ability scores
        for srd_key, our_key in ABILITY_MAP.items():
            srd_val = s[srd_key]
            if srd_val != m.get(our_key):
                fixes.append(f"{our_key}: {m.get(our_key)} -> {srd_val}")
                m[our_key] = srd_val
            mod = (srd_val - 10) // 2
            m[f"{our_key}Mod"] = mod
            if "abilityScores" in m:
                m["abilityScores"][our_key] = srd_val
                m["abilityScores"][f"{our_key}Mod"] = mod

        # CR
        srd_cr = s["challenge_rating"]
        srd_cr_str = str(srd_cr)
        if srd_cr_str != str(m.get("cr", "")):
            fixes.append(f"cr: {m.get('cr')} -> {srd_cr_str}")
            m["cr"] = srd_cr_str

        # XP
        if s.get("xp") != m.get("xp"):
            fixes.append(f"xp: {m.get('xp')} -> {s.get('xp')}")
            m["xp"] = s.get("xp")

        # Speed
        srd_speed = parse_speed(s.get("speed", {}))
        if srd_speed != m.get("speed"):
            fixes.append(f"speed: {m.get('speed')} -> {srd_speed}")
            m["speed"] = srd_speed

        # Size
        srd_size_cn = SIZE_MAP.get(s.get("size"), s.get("size"))
        if srd_size_cn != m.get("size"):
            fixes.append(f"size: {m.get('size')} -> {srd_size_cn}")
            m["size"] = srd_size_cn

        # Proficiency bonus
        if s.get("proficiency_bonus"):
            m["proficiencyBonus"] = s["proficiency_bonus"]

        if fixes:
            fix_log.append({"name": m.get("nameEn"), "fixes": fixes})

    # Backup and save
    backup_path = OUR_PATH + ".bak"
    shutil.copy2(OUR_PATH, backup_path)
    print(f"Backup: {backup_path}")

    with open(OUR_PATH, "w") as f:
        json.dump(our_data, f, indent=2, ensure_ascii=False)

    print(f"\nFixed {len(fix_log)} monsters:")
    for entry in fix_log:
        print(f"  {entry['name']}: {len(entry['fixes'])} fields")
        for fix in entry["fixes"]:
            print(f"    {fix}")

    # Quick re-verify
    print(f"\n--- Verification ---")
    with open(OUR_PATH) as f:
        verify = json.load(f)
    v_by_name = {m.get("nameEn", "").lower().strip(): m for m in verify["monsters"]}
    remaining = 0
    for name, s in srd_by_name.items():
        o = v_by_name.get(name)
        if not o:
            continue
        srd_ac = s["armor_class"][0]["value"] if isinstance(s["armor_class"], list) else s["armor_class"]
        if srd_ac != o.get("ac") or s["hit_points"] != o.get("hp") or s["strength"] != o.get("str"):
            remaining += 1
    print(f"Remaining stat mismatches (ac/hp/str): {remaining}")


if __name__ == "__main__":
    main()
