#!/usr/bin/env python3
"""
Monster data audit script.
Phase 1: Compare our monsters.json against SRD reference data.
Phase 2: Use AI to fix discrepancies in batches.
"""

import json
import sys
import os
import time
import httpx

# Paths
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRD_PATH = os.path.join(PROJECT_ROOT, "dnd-platform/references/5e-srd/5e-SRD-Monsters.json")
OUR_PATH = os.path.join(PROJECT_ROOT, "dnd-platform/configs/npc/monsters.json")
RESULT_PATH = os.path.join(PROJECT_ROOT, "scripts/monster_audit_results.json")

# AI API config
AI_API_URL = "https://yunwu.ai/v1/chat/completions"
AI_API_KEY = os.environ.get("YUNWU_API_KEY", "")
AI_MODEL = "gpt-5.2"

ABILITY_MAP = {
    "strength": "str", "dexterity": "dex", "constitution": "con",
    "intelligence": "int", "wisdom": "wis", "charisma": "cha"
}


def load_data():
    with open(SRD_PATH) as f:
        srd = json.load(f)
    with open(OUR_PATH) as f:
        ours = json.load(f)
    return srd, ours


def compare_monsters(srd_list, our_data):
    """Compare matched monsters and return error details."""
    srd_by_name = {m["name"].lower(): m for m in srd_list}
    our_by_name = {}
    for m in our_data["monsters"]:
        name_en = m.get("nameEn", "").lower().strip()
        if name_en:
            our_by_name[name_en] = m

    matches = set(srd_by_name.keys()) & set(our_by_name.keys())
    results = {"matched": len(matches), "errors": [], "summary": {}}
    field_error_counts = {}

    for name in sorted(matches):
        s = srd_by_name[name]
        o = our_by_name[name]
        monster_errors = []

        # AC
        srd_ac = s["armor_class"][0]["value"] if isinstance(s["armor_class"], list) else s["armor_class"]
        our_ac = o.get("ac")
        if srd_ac != our_ac:
            monster_errors.append({"field": "ac", "srd": srd_ac, "ours": our_ac})

        # HP
        if s["hit_points"] != o.get("hp"):
            monster_errors.append({"field": "hp", "srd": s["hit_points"], "ours": o.get("hp")})

        # HP formula
        srd_hp_roll = s.get("hit_points_roll", "")
        our_hp_formula = o.get("hpFormula", "")
        if srd_hp_roll and our_hp_formula and srd_hp_roll != our_hp_formula:
            monster_errors.append({"field": "hpFormula", "srd": srd_hp_roll, "ours": our_hp_formula})

        # Ability scores
        for srd_key, our_key in ABILITY_MAP.items():
            if s[srd_key] != o.get(our_key):
                monster_errors.append({"field": our_key, "srd": s[srd_key], "ours": o.get(our_key)})

        # CR
        srd_cr = str(s["challenge_rating"])
        our_cr = str(o.get("cr", ""))
        if srd_cr != our_cr:
            monster_errors.append({"field": "cr", "srd": srd_cr, "ours": our_cr})

        # XP
        if s.get("xp") != o.get("xp"):
            monster_errors.append({"field": "xp", "srd": s.get("xp"), "ours": o.get("xp")})

        # Speed
        srd_speed = {}
        for k, v in s.get("speed", {}).items():
            if isinstance(v, str):
                num = int("".join(c for c in v if c.isdigit()) or "0")
            else:
                num = v
            srd_speed[k] = num
        our_speed = o.get("speed", {})
        if srd_speed != our_speed:
            monster_errors.append({"field": "speed", "srd": srd_speed, "ours": our_speed})

        # Size
        size_map = {"Tiny": "微型", "Small": "小型", "Medium": "中型", "Large": "大型",
                    "Huge": "巨型", "Gargantuan": "超巨型"}
        srd_size_cn = size_map.get(s.get("size"), s.get("size"))
        if srd_size_cn != o.get("size"):
            monster_errors.append({"field": "size", "srd": s.get("size"), "ours": o.get("size")})

        if monster_errors:
            for e in monster_errors:
                field_error_counts[e["field"]] = field_error_counts.get(e["field"], 0) + 1
            results["errors"].append({
                "nameEn": s["name"],
                "name": o.get("name", ""),
                "id": o.get("id", ""),
                "issues": monster_errors
            })

    results["summary"] = {
        "total_matched": len(matches),
        "monsters_with_errors": len(results["errors"]),
        "error_rate": f"{len(results['errors'])*100/len(matches):.1f}%",
        "field_error_counts": dict(sorted(field_error_counts.items(), key=lambda x: -x[1]))
    }
    return results, srd_by_name, our_by_name


def fix_with_ai(errors, srd_by_name, our_data, batch_size=10):
    """Use AI to generate corrected monster entries based on SRD data."""
    monsters_by_id = {m.get("id"): m for m in our_data["monsters"]}
    fixed_count = 0
    total_batches = (len(errors) + batch_size - 1) // batch_size

    for batch_idx in range(0, len(errors), batch_size):
        batch = errors[batch_idx:batch_idx + batch_size]
        batch_num = batch_idx // batch_size + 1
        print(f"\n--- Batch {batch_num}/{total_batches} ({len(batch)} monsters) ---")

        # Build correction data from SRD
        corrections = []
        for err in batch:
            name_lower = err["nameEn"].lower()
            srd_m = srd_by_name.get(name_lower)
            if not srd_m:
                continue

            our_m = monsters_by_id.get(err["id"])
            if not our_m:
                continue

            # Extract SRD values for errored fields
            fix = {"id": err["id"], "nameEn": err["nameEn"], "fixes": {}}
            for issue in err["issues"]:
                field = issue["field"]
                srd_val = issue["srd"]

                if field == "hpFormula":
                    fix["fixes"]["hpFormula"] = srd_val
                    fix["fixes"]["hp"] = srd_m["hit_points"]
                elif field in ABILITY_MAP.values():
                    fix["fixes"][field] = srd_val
                    fix["fixes"][f"{field}Mod"] = (srd_val - 10) // 2
                    # Also update abilityScores
                    fix["fixes"][f"abilityScores.{field}"] = srd_val
                    fix["fixes"][f"abilityScores.{field}Mod"] = (srd_val - 10) // 2
                else:
                    fix["fixes"][field] = srd_val

            corrections.append(fix)

        # Use AI to also verify actions/special abilities for this batch
        monster_names = [c["nameEn"] for c in corrections]
        prompt = f"""I'm auditing D&D 5E monster data. For the following monsters, I have their SRD-correct stat blocks.
Please verify if their special abilities and actions descriptions are roughly accurate for D&D 5E.
Just respond with a JSON array of objects, each with:
- "nameEn": monster name
- "actions_ok": true/false (are the action descriptions roughly correct for 5E?)
- "abilities_ok": true/false (are the special ability descriptions roughly correct for 5E?)
- "notes": any important corrections needed for actions/abilities (empty string if ok)

Monsters to check: {json.dumps(monster_names)}

Here are their current action/ability data:
"""
        for c in corrections:
            m = monsters_by_id[c["id"]]
            prompt += f"\n{c['nameEn']}:\n"
            prompt += f"  Special Abilities: {json.dumps([a.get('name','') for a in m.get('specialAbilities', [])], ensure_ascii=False)}\n"
            prompt += f"  Actions: {json.dumps([a.get('name','') for a in m.get('actions', [])], ensure_ascii=False)}\n"

        prompt += "\nRespond ONLY with the JSON array, no other text."

        try:
            resp = httpx.post(
                AI_API_URL,
                headers={"Authorization": f"Bearer {AI_API_KEY}", "Content-Type": "application/json"},
                json={"model": AI_MODEL, "messages": [{"role": "user", "content": prompt}], "temperature": 0.1},
                timeout=60
            )
            resp.raise_for_status()
            ai_result = resp.json()
            ai_text = ai_result["choices"][0]["message"]["content"]
            # Try to parse JSON from response
            ai_text = ai_text.strip()
            if ai_text.startswith("```"):
                ai_text = ai_text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
            ai_checks = json.loads(ai_text)
            ai_check_map = {c["nameEn"].lower(): c for c in ai_checks}
        except Exception as e:
            print(f"  AI check failed: {e}")
            ai_check_map = {}

        # Apply corrections
        for c in corrections:
            m = monsters_by_id[c["id"]]
            for field, val in c["fixes"].items():
                if "." in field:
                    # Nested field like abilityScores.str
                    parts = field.split(".")
                    obj = m
                    for p in parts[:-1]:
                        if p not in obj:
                            obj[p] = {}
                        obj = obj[p]
                    obj[parts[-1]] = val
                else:
                    m[field] = val
            fixed_count += 1

            ai_info = ai_check_map.get(c["nameEn"].lower(), {})
            notes = ai_info.get("notes", "")
            status = "FIXED"
            if notes:
                status += f" (AI notes: {notes[:80]})"
            print(f"  {c['nameEn']}: {status} - fixed {len(c['fixes'])} fields")

        time.sleep(1)  # Rate limiting

    return fixed_count


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "audit"

    print("Loading data...")
    srd_list, our_data = load_data()

    print("Comparing monsters...")
    results, srd_by_name, our_by_name = compare_monsters(srd_list, our_data)

    print(f"\n=== AUDIT RESULTS ===")
    print(f"Total matched: {results['summary']['total_matched']}")
    print(f"Monsters with errors: {results['summary']['monsters_with_errors']}")
    print(f"Error rate: {results['summary']['error_rate']}")
    print(f"\nField error counts:")
    for field, count in results['summary']['field_error_counts'].items():
        print(f"  {field}: {count}")

    # Save audit results
    with open(RESULT_PATH, "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\nDetailed results saved to: {RESULT_PATH}")

    if mode == "fix":
        print(f"\n=== FIXING {len(results['errors'])} MONSTERS ===")
        fixed = fix_with_ai(results["errors"], srd_by_name, our_data, batch_size=10)
        print(f"\nFixed {fixed} monsters total.")

        # Save corrected data
        backup_path = OUR_PATH + ".bak"
        import shutil
        shutil.copy2(OUR_PATH, backup_path)
        print(f"Backup saved to: {backup_path}")

        with open(OUR_PATH, "w") as f:
            json.dump(our_data, f, indent=2, ensure_ascii=False)
        print(f"Corrected data saved to: {OUR_PATH}")

        # Re-audit
        print("\n=== RE-AUDIT AFTER FIX ===")
        srd_list2, our_data2 = load_data()
        results2, _, _ = compare_monsters(srd_list2, our_data2)
        print(f"Remaining errors: {results2['summary']['monsters_with_errors']}")
        print(f"Remaining error rate: {results2['summary']['error_rate']}")
    else:
        print(f"\nRun with 'fix' argument to auto-correct: python scripts/monster_audit.py fix")


if __name__ == "__main__":
    main()
