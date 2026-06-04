#!/usr/bin/env python3
"""
将 spell_effect_fixes.json 中的修复应用到 spells.json。
"""
import json
import sys
import os

sys.stdout.reconfigure(line_buffering=True)

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPELLS_PATH = os.path.join(PROJECT_ROOT, "frontend/app/data/rules/spells.json")
FIXES_PATH = os.path.join(PROJECT_ROOT, "scripts/spell_effect_fixes.json")

with open(SPELLS_PATH, encoding="utf-8") as f:
    all_data = json.load(f)

spells = all_data["spells"]
spell_map = {s["id"]: (i, s) for i, s in enumerate(spells)}

with open(FIXES_PATH, encoding="utf-8") as f:
    fixes_data = json.load(f)

applied = 0
skipped = 0

for fix_entry in fixes_data["fixes"]:
    spell_id = fix_entry["spell_id"]
    fix = fix_entry["fix"]

    if spell_id not in spell_map:
        print(f"[SKIP] {spell_id} not found in spells")
        skipped += 1
        continue

    idx, spell = spell_map[spell_id]
    effects = spell.get("effects", [])

    # Normalize to list of fixes
    fix_list = fix if isinstance(fix, list) else [fix]

    for f_item in fix_list:
        phase_index = f_item["phase_index"]
        add_fields = f_item["add_fields"]

        if phase_index >= len(effects):
            print(f"[WARN] {spell_id}: phase_index {phase_index} out of range (has {len(effects)} phases)")
            skipped += 1
            continue

        phase = effects[phase_index]
        for key, value in add_fields.items():
            if key in phase:
                print(f"  [EXIST] {spell_id} phase[{phase_index}].{key} already exists, overwriting")
            phase[key] = value
            print(f"  ✅ {spell_id} phase[{phase_index}].{key} = {json.dumps(value, ensure_ascii=False)}")

    applied += 1

# Write back
with open(SPELLS_PATH, "w", encoding="utf-8") as f:
    json.dump(all_data, f, ensure_ascii=False, indent=2)

print(f"\nApplied: {applied}, Skipped: {skipped}")
print(f"Written to {SPELLS_PATH}")

