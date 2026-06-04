#!/usr/bin/env python3
"""Scan spells.json for apply_condition effects missing save fields, then use LLM to fix them."""
import json
import os
import sys
import httpx

SPELLS_PATH = os.path.join(os.path.dirname(__file__), "..", "frontend", "app", "data", "rules", "spells.json")
API_URL = "https://yunwu.ai/v1/chat/completions"
API_KEY = os.environ.get("YUNWU_API_KEY", "")
MODEL = "gpt-5.4"


def find_conditions_without_save():
    with open(SPELLS_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    issues = []
    for spell in data.get("spells", []):
        effects = spell.get("effects", [])
        for phase in effects:
            for eff in phase.get("effects", []):
                if eff.get("type") == "apply_condition" and not eff.get("save"):
                    # Check if the phase already has a top-level save
                    phase_save = phase.get("save")
                    issues.append({
                        "spell_id": spell["id"],
                        "spell_name": spell["name"],
                        "condition": eff.get("condition"),
                        "condition_cn": eff.get("condition_cn", ""),
                        "description": spell.get("description", "")[:300],
                        "has_phase_save": bool(phase_save),
                        "phase_save_ability": phase_save.get("ability") if phase_save else None,
                    })
    return issues, data


def ask_llm(issues):
    prompt = """以下是D&D 5E法术中使用了 apply_condition 但该效果本身没有 save 字段的情况。
有些情况下，phase 层级已经有 save（has_phase_save=true），这意味着豁免是针对整个效果的（比如命中时豁免避免所有效果），这种情况下 apply_condition 不需要单独的 save。
但有些法术的 apply_condition 需要一个**独立的**豁免来抵抗该状态（比如致病射线：攻击命中造成伤害，然后目标需要CON豁免来抵抗中毒）。

请分析每个法术，判断其 apply_condition 是否需要一个独立的 save 字段。

返回 JSON 数组，每个元素格式：
{"spell_id": "xxx", "needs_save": true/false, "save_ability": "con/str/dex/wis/cha/int", "reason": "简短原因"}

如果 needs_save 为 false，不需要 save_ability 字段。

法术列表：
"""
    for i in issues:
        prompt += f"\n- {i['spell_id']} ({i['spell_name']}): condition={i['condition']}, has_phase_save={i['has_phase_save']}, phase_save={i['phase_save_ability']}"
        prompt += f"\n  描述: {i['description'][:200]}"

    print(f"Sending {len(issues)} spells to LLM for analysis...")
    resp = httpx.post(
        API_URL,
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
        json={"model": MODEL, "messages": [{"role": "user", "content": prompt}], "temperature": 0},
        timeout=120,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    print("LLM response received.")

    # Extract JSON from response
    start = content.find("[")
    end = content.rfind("]") + 1
    if start >= 0 and end > start:
        return json.loads(content[start:end])
    print("Could not parse LLM response:")
    print(content)
    return []


def apply_fixes(data, fixes):
    fix_map = {f["spell_id"]: f for f in fixes if f.get("needs_save")}
    if not fix_map:
        print("No fixes needed.")
        return False

    count = 0
    for spell in data.get("spells", []):
        fix = fix_map.get(spell["id"])
        if not fix:
            continue
        for phase in spell.get("effects", []):
            for eff in phase.get("effects", []):
                if eff.get("type") == "apply_condition" and not eff.get("save"):
                    eff["save"] = {"ability": fix["save_ability"], "on_fail": "apply"}
                    print(f"  Fixed: {spell['id']} ({spell['name']}) - added {fix['save_ability']} save to {eff.get('condition')}")
                    print(f"    Reason: {fix.get('reason', 'N/A')}")
                    count += 1

    if count:
        with open(SPELLS_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"\nApplied {count} fixes to spells.json")
        return True
    return False


def main():
    issues, data = find_conditions_without_save()
    print(f"Found {len(issues)} apply_condition effects without save field:")
    for i in issues:
        print(f"  {i['spell_id']} ({i['spell_name']}): {i['condition']} | phase_save={i['has_phase_save']}")

    if not issues:
        print("All apply_condition effects already have save fields!")
        return

    fixes = ask_llm(issues)
    print(f"\nLLM analysis results:")
    for f in fixes:
        status = f"needs {f.get('save_ability', '?')} save" if f.get("needs_save") else "OK (no separate save needed)"
        print(f"  {f['spell_id']}: {status} - {f.get('reason', '')}")

    needs_fix = [f for f in fixes if f.get("needs_save")]
    if needs_fix:
        print(f"\n{len(needs_fix)} spells need save fields added. Applying fixes...")
        apply_fixes(data, fixes)
    else:
        print("\nNo spells need additional save fields.")


if __name__ == "__main__":
    main()

