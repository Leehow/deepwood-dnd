#!/usr/bin/env python3
"""
Use LLM (gpt-5.4 via Yunwu API) to cross-validate D&D 5E data accuracy.
Focuses on numerical parameter correctness, not structure.
"""
import json
import time
import sys
import os
import re
from pathlib import Path
from openai import OpenAI

PROJECT_ROOT = Path(__file__).parent.parent

client = OpenAI(
    base_url="https://yunwu.ai/v1",
    api_key=os.environ.get("YUNWU_API_KEY", "")
)
MODEL = "gpt-5.4"

OUR_EQUIPMENT = PROJECT_ROOT / "frontend" / "app" / "data" / "rules" / "equipment.json"
OUR_MAGIC_ITEMS = PROJECT_ROOT / "frontend" / "public" / "rules" / "magic-items.json"
OUR_MONSTERS = PROJECT_ROOT / "dnd-platform" / "configs" / "npc" / "monsters.json"


def ask_llm(prompt, max_tokens=4096):
    """Call LLM API."""
    try:
        resp = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": "You are a D&D 5E rules expert. You have memorized all official D&D 5E content including the Player's Handbook, Monster Manual, and Dungeon Master's Guide. When asked to verify data, compare against official 5E sources and report ONLY items with INCORRECT values. Be precise with numbers. Respond in the exact JSON format requested."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=max_tokens,
            temperature=0
        )
        return resp.choices[0].message.content
    except Exception as e:
        print(f"  API error: {e}")
        return None


def extract_json(text):
    """Extract JSON from LLM response."""
    if not text:
        return None
    # Try to find JSON array or object
    patterns = [
        r'```json\s*([\s\S]*?)\s*```',
        r'```\s*([\s\S]*?)\s*```',
        r'(\[[\s\S]*\])',
        r'(\{[\s\S]*\})',
    ]
    for pat in patterns:
        m = re.search(pat, text)
        if m:
            try:
                return json.loads(m.group(1))
            except json.JSONDecodeError:
                continue
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def validate_monsters():
    print("=" * 70)
    print("MONSTERS - LLM VALIDATION")
    print("=" * 70)

    with open(OUR_MONSTERS, encoding="utf-8") as f:
        data = json.load(f)

    monsters = data.get("monsters", [])
    all_issues = []
    batch_size = 15

    for i in range(0, len(monsters), batch_size):
        batch = monsters[i:i+batch_size]
        batch_summary = []
        for m in batch:
            entry = {
                "nameEn": m.get("nameEn", ""),
                "name": m.get("name", ""),
                "ac": m.get("ac"),
                "hp": m.get("hp"),
                "hpFormula": m.get("hpFormula"),
                "cr": m.get("cr"),
                "xp": m.get("xp"),
                "speed": m.get("speed", {}),
            }
            abs_s = m.get("abilityScores", {})
            entry["str"] = abs_s.get("str")
            entry["dex"] = abs_s.get("dex")
            entry["con"] = abs_s.get("con")
            entry["int"] = abs_s.get("int")
            entry["wis"] = abs_s.get("wis")
            entry["cha"] = abs_s.get("cha")
            batch_summary.append(entry)

        prompt = f"""Check these D&D 5E monsters for INCORRECT numerical values. Compare against official Monster Manual / SRD data.
For each monster, verify: AC, HP, HP formula, CR, XP, speed, and all 6 ability scores (STR/DEX/CON/INT/WIS/CHA).

IMPORTANT: Only report monsters that have WRONG values. If a monster's stats are all correct, do NOT include it.
If ALL monsters in this batch are correct, return an empty array [].

Return JSON array format:
[{{"nameEn": "...", "field": "...", "ourValue": ..., "correctValue": ..., "note": "..."}}]

Monsters to check:
{json.dumps(batch_summary, ensure_ascii=False, indent=1)}"""

        print(f"  Checking monsters {i+1}-{min(i+batch_size, len(monsters))} of {len(monsters)}...", end=" ", flush=True)
        result = ask_llm(prompt)
        issues = extract_json(result)
        if issues and isinstance(issues, list) and len(issues) > 0:
            all_issues.extend(issues)
            print(f"found {len(issues)} issues")
        else:
            print("OK")
        time.sleep(0.5)

    return all_issues


def validate_equipment():
    print("\n" + "=" * 70)
    print("EQUIPMENT - LLM VALIDATION")
    print("=" * 70)

    with open(OUR_EQUIPMENT, encoding="utf-8") as f:
        data = json.load(f)

    # Flatten all equipment into a list
    items = []

    # Armor
    for cat in ["light", "medium", "heavy"]:
        for item in data.get("armor", {}).get(cat, []):
            items.append({
                "nameEn": item.get("nameEn", ""),
                "type": "armor",
                "ac": item.get("ac"),
                "acBase": item.get("acFormula", {}).get("base") if isinstance(item.get("acFormula"), dict) else None,
                "cost_gp": item.get("cost", {}).get("gp") if isinstance(item.get("cost"), dict) else None,
                "weight": item.get("weight"),
                "stealthDisadvantage": item.get("stealthDisadvantage"),
                "strengthRequired": item.get("strengthRequired"),
            })

    # Weapons
    for cat in ["simple", "martial"]:
        weapons = data.get("weapons", {}).get(cat, {})
        for subcategory in ["melee", "ranged"]:
            for item in weapons.get(subcategory, []):
                items.append({
                    "nameEn": item.get("nameEn", ""),
                    "type": "weapon",
                    "damage": item.get("damage"),
                    "damageType": item.get("damageType"),
                    "cost_gp": item.get("cost", {}).get("gp") if isinstance(item.get("cost"), dict) else None,
                    "weight": item.get("weight"),
                    "properties": [p if isinstance(p, str) else p.get("nameEn", p.get("name","")) for p in item.get("properties", [])],
                })

    all_issues = []
    batch_size = 20

    for i in range(0, len(items), batch_size):
        batch = items[i:i+batch_size]
        prompt = f"""Check these D&D 5E equipment items for INCORRECT values. Compare against official PHB data.
For weapons: verify damage dice, damage type, cost, weight, properties.
For armor: verify AC, cost, weight, stealth disadvantage, strength requirement.

ONLY report items with WRONG values. If all correct, return [].

Return JSON array: [{{"nameEn": "...", "field": "...", "ourValue": ..., "correctValue": ..., "note": "..."}}]

Items:
{json.dumps(batch, ensure_ascii=False, indent=1)}"""

        print(f"  Checking equipment {i+1}-{min(i+batch_size, len(items))} of {len(items)}...", end=" ", flush=True)
        result = ask_llm(prompt)
        issues = extract_json(result)
        if issues and isinstance(issues, list) and len(issues) > 0:
            all_issues.extend(issues)
            print(f"found {len(issues)} issues")
        else:
            print("OK")
        time.sleep(0.5)

    return all_issues


def validate_magic_items():
    print("\n" + "=" * 70)
    print("MAGIC ITEMS - LLM VALIDATION")
    print("=" * 70)

    with open(OUR_MAGIC_ITEMS, encoding="utf-8") as f:
        data = json.load(f)

    items_raw = data.get("items", data) if isinstance(data, dict) else data
    all_issues = []
    batch_size = 20

    for i in range(0, len(items_raw), batch_size):
        batch = items_raw[i:i+batch_size]
        batch_summary = []
        for item in batch:
            batch_summary.append({
                "nameEn": item.get("nameEn", ""),
                "rarity": item.get("rarity"),
                "requiresAttunement": item.get("requiresAttunement"),
                "category": item.get("category"),
            })

        prompt = f"""Check these D&D 5E magic items for INCORRECT values. Compare against official DMG data.
Verify: rarity, requiresAttunement (true/false), category.

ONLY report items with WRONG values. If all correct, return [].

Return JSON array: [{{"nameEn": "...", "field": "...", "ourValue": ..., "correctValue": ..., "note": "..."}}]

Items:
{json.dumps(batch_summary, ensure_ascii=False, indent=1)}"""

        print(f"  Checking magic items {i+1}-{min(i+batch_size, len(items_raw))} of {len(items_raw)}...", end=" ", flush=True)
        result = ask_llm(prompt)
        issues = extract_json(result)
        if issues and isinstance(issues, list) and len(issues) > 0:
            all_issues.extend(issues)
            print(f"found {len(issues)} issues")
        else:
            print("OK")
        time.sleep(0.5)

    return all_issues


if __name__ == "__main__":
    results = {}

    print("Starting LLM-powered D&D 5E data validation...\n")

    results["monsters"] = validate_monsters()
    results["equipment"] = validate_equipment()
    results["magic_items"] = validate_magic_items()

    # Summary
    print("\n" + "=" * 70)
    print("LLM VALIDATION SUMMARY")
    print("=" * 70)
    total = 0
    for cat, issues in results.items():
        count = len(issues) if issues else 0
        total += count
        print(f"  {cat}: {count} potential issues")
    print(f"  TOTAL: {total} potential issues")

    # Save
    output_path = PROJECT_ROOT / "scripts" / "llm_validate_results.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\nDetailed results saved to: {output_path}")

    # Print details
    for cat, issues in results.items():
        if issues:
            print(f"\n--- {cat.upper()} ISSUES ---")
            for issue in issues:
                print(f"  {issue.get('nameEn','?')}: {issue.get('field','?')} = {issue.get('ourValue','?')} -> should be {issue.get('correctValue','?')} ({issue.get('note','')})")
