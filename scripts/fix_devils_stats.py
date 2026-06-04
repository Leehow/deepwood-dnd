#!/usr/bin/env python3
"""
Fix Devil stats that were all copied from Barbed Devil.
Uses SRD data to correct HP, AC, ability scores, speed, senses for each devil.
"""
import json
import re
import math
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
MONSTERS_PATH = PROJECT_ROOT / "dnd-platform" / "configs" / "npc" / "monsters.json"
SRD_PATH = PROJECT_ROOT / "dnd-platform" / "references" / "5e-srd" / "5e-SRD-Monsters.json"


def normalize(name):
    return re.sub(r'[^a-z0-9]', '', name.lower())


def ability_mod(score):
    return math.floor((score - 10) / 2)


def main():
    with open(MONSTERS_PATH, encoding="utf-8") as f:
        data = json.load(f)
    with open(SRD_PATH, encoding="utf-8") as f:
        srd_all = json.load(f)

    # Build SRD lookup
    srd_lookup = {}
    for m in srd_all:
        srd_lookup[normalize(m["name"])] = m

    # Devils to fix (map our nameEn pattern to SRD name)
    devil_map = {
        "bearded devil": "Bearded Devil",
        "bone devil": "Bone Devil",
        "chain devil": "Chain Devil",
        "horned devil": "Horned Devil",
        "ice devil": "Ice Devil",
        "spined devil": "Spined Devil",
        "barbed devil": "Barbed Devil",
    }

    fixes = []

    for m in data["monsters"]:
        name_en = m.get("nameEn", "").lower()

        # Match devil by checking if nameEn starts with the devil name
        matched_srd = None
        for pattern, srd_name in devil_map.items():
            if name_en.startswith(pattern) or pattern in name_en:
                srd_key = normalize(srd_name)
                if srd_key in srd_lookup:
                    matched_srd = srd_lookup[srd_key]
                break

        if not matched_srd:
            continue

        srd = matched_srd
        changed = []

        # Fix AC
        srd_ac_list = srd.get("armor_class", [])
        srd_ac = srd_ac_list[0].get("value") if srd_ac_list else None
        if srd_ac and m.get("ac") != srd_ac:
            changed.append(f"AC {m.get('ac')}->{srd_ac}")
            m["ac"] = srd_ac

        # Fix HP
        if srd.get("hit_points") and m.get("hp") != srd["hit_points"]:
            changed.append(f"HP {m.get('hp')}->{srd['hit_points']}")
            m["hp"] = srd["hit_points"]

        # Fix HP formula
        srd_hpf = srd.get("hit_points_roll", "")
        if srd_hpf and m.get("hpFormula") != srd_hpf:
            changed.append(f"hpFormula {m.get('hpFormula')}->{srd_hpf}")
            m["hpFormula"] = srd_hpf

        # Fix ability scores
        ability_map = {
            "strength": "str", "dexterity": "dex", "constitution": "con",
            "intelligence": "int", "wisdom": "wis", "charisma": "cha"
        }
        abs_scores = m.get("abilityScores", {})
        for srd_key, our_key in ability_map.items():
            srd_val = srd.get(srd_key)
            if srd_val is None:
                continue
            mod_key = our_key + "Mod"
            mod_val = ability_mod(srd_val)

            if abs_scores.get(our_key) != srd_val:
                changed.append(f"{our_key.upper()} {abs_scores.get(our_key)}->{srd_val}")
                abs_scores[our_key] = srd_val
                abs_scores[mod_key] = mod_val
                # Also fix top-level if present
                if our_key in m:
                    m[our_key] = srd_val
                if mod_key in m:
                    m[mod_key] = mod_val

        # Fix speed
        srd_speed = srd.get("speed", {})
        our_speed = m.get("speed", {})
        for move_type, srd_spd_str in srd_speed.items():
            srd_num_match = re.search(r'(\d+)', str(srd_spd_str))
            if srd_num_match:
                srd_num = int(srd_num_match.group(1))
                if our_speed.get(move_type) != srd_num:
                    changed.append(f"speed.{move_type} {our_speed.get(move_type)}->{srd_num}")
                    our_speed[move_type] = srd_num
        # Add missing speed types
        for move_type, srd_spd_str in srd_speed.items():
            if move_type not in our_speed:
                srd_num_match = re.search(r'(\d+)', str(srd_spd_str))
                if srd_num_match:
                    our_speed[move_type] = int(srd_num_match.group(1))
                    changed.append(f"speed.{move_type} added={our_speed[move_type]}")
        m["speed"] = our_speed

        if changed:
            fixes.append(f"{m.get('nameEn', '?')}: {', '.join(changed)}")

    print(f"Fixed {len(fixes)} devil entries:")
    for f in fixes:
        print(f"  {f}")

    with open(MONSTERS_PATH, "w", encoding="utf-8") as f_out:
        json.dump(data, f_out, ensure_ascii=False, indent=2)
    print(f"\nSaved to: {MONSTERS_PATH}")


if __name__ == "__main__":
    main()
