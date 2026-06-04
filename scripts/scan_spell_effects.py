#!/usr/bin/env python3
"""
扫描 spells.json，找出 controlEffect 与 effects 数组不一致的法术。
"""
import json
import sys
import os

sys.stdout.reconfigure(line_buffering=True)

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPELLS_PATH = os.path.join(PROJECT_ROOT, "frontend/app/data/rules/spells.json")

with open(SPELLS_PATH, encoding="utf-8") as f:
    data = json.load(f)
    spells = data.get("spells", data) if isinstance(data, dict) else data

issues = []
for spell in spells:
    ce = spell.get("controlEffect")
    effects = spell.get("effects", [])
    if not ce or not effects:
        continue

    ce_duration = ce.get("durationRounds")
    ce_ongoing = ce.get("ongoingSave")
    ce_escape = ce.get("escapeAction")
    ce_condition = ce.get("condition")

    has_phase_duration = False
    has_phase_escape = False
    has_apply_condition = False

    for phase in effects:
        phase_dur = phase.get("duration") or {}
        if phase_dur.get("rounds"):
            has_phase_duration = True
        if phase.get("escape"):
            has_phase_escape = True
        for eff in phase.get("effects", []):
            if eff.get("type") == "apply_condition":
                cond = eff.get("condition", "")
                if cond == ce_condition or not ce_condition:
                    has_apply_condition = True
                if eff.get("escape"):
                    has_phase_escape = True

    problems = []
    if ce_duration and not has_phase_duration and has_apply_condition:
        problems.append(f"controlEffect.durationRounds={ce_duration} but effects phase missing duration")
    if ce_ongoing and not has_phase_escape and has_apply_condition:
        problems.append(f"controlEffect.ongoingSave exists but effects missing escape")
    if ce_escape and not has_phase_escape and has_apply_condition:
        problems.append(f"controlEffect.escapeAction exists but effects missing escape")

    if problems:
        issues.append({
            "id": spell["id"],
            "name": spell["name"],
            "nameEn": spell.get("nameEn", ""),
            "concentration": spell.get("concentration", False),
            "controlEffect": ce,
            "problems": problems,
        })

print(f"Total spells with mismatch: {len(issues)}")
for i in issues:
    print(f"  {i['id']} ({i['name']}/{i['nameEn']}) conc={i['concentration']} - {'; '.join(i['problems'])}")
    print(f"    controlEffect: {json.dumps(i['controlEffect'], ensure_ascii=False)}")

# Save for the fix script
output_path = os.path.join(PROJECT_ROOT, "scripts/spell_effect_mismatch.json")
with open(output_path, "w", encoding="utf-8") as f:
    json.dump(issues, f, ensure_ascii=False, indent=2)
print(f"\nSaved to {output_path}")

