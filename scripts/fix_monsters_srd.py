#!/usr/bin/env python3
"""
Fix monster data issues found by cross-validation against SRD.
Issues:
1. Pegasus (id: 马_pegasus) - name "k", all stats wrong (horse stats instead of pegasus)
2. Ancient Bronze Dragon - XP=41 (should be 41000), nameEn has garbage suffix
3. Succubus/Incubus - CHA 18 (SRD says 20)
"""
import json
import re
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
MONSTERS_PATH = PROJECT_ROOT / "dnd-platform" / "configs" / "npc" / "monsters.json"
SRD_PATH = PROJECT_ROOT / "dnd-platform" / "references" / "5e-srd" / "5e-SRD-Monsters.json"


def normalize_name(name: str) -> str:
    return re.sub(r'[^a-z0-9]', '', name.lower())


def main():
    with open(MONSTERS_PATH, encoding="utf-8") as f:
        data = json.load(f)
    with open(SRD_PATH, encoding="utf-8") as f:
        srd_monsters = json.load(f)

    # Build SRD lookup
    srd_lookup = {}
    for m in srd_monsters:
        srd_lookup[normalize_name(m["name"])] = m

    fixes = []
    srd_pegasus = srd_lookup.get("pegasus")

    for m in data["monsters"]:
        # Fix 1: Pegasus - replace with SRD data
        if m.get("id") == "马_pegasus" and srd_pegasus:
            m["id"] = "pegasus"
            m["name"] = "天马"
            m["nameEn"] = "Pegasus"
            m["size"] = "大型"
            m["type"] = "天界生物"
            m["alignment"] = "混乱善良"
            m["ac"] = 12
            m["hp"] = 59
            m["hpFormula"] = "7d10+21"
            m["cr"] = "2"
            m["xp"] = 450
            m["speed"] = {"walk": 60, "fly": 90}
            m["abilityScores"] = {
                "str": 18, "strMod": 4,
                "dex": 15, "dexMod": 2,
                "con": 16, "conMod": 3,
                "int": 10, "intMod": 0,
                "wis": 15, "wisMod": 2,
                "cha": 13, "chaMod": 1
            }
            # Also update top-level ability scores if present
            for attr in ["str", "dex", "con", "int", "wis", "cha",
                         "strMod", "dexMod", "conMod", "intMod", "wisMod", "chaMod"]:
                if attr in m:
                    m[attr] = m["abilityScores"][attr]
            m["senses"] = {"passive_perception": 16}
            m["languages"] = []
            m["specialAbilities"] = [
                {
                    "name": "飞行 (Fly)",
                    "description": "天马拥有 90 英尺的飞行速度。"
                }
            ]
            m["actions"] = [
                {
                    "name": "蹄击 (Hooves)",
                    "description": "近战武器攻击：+6 命中，触及 5 尺，一个目标。命中时造成 2d6+4 点钝击伤害。"
                }
            ]
            fixes.append("Pegasus: replaced all stats with SRD data")

        # Fix 2: Ancient Bronze Dragon - XP and nameEn
        if "ancient bronze" in m.get("nameEn", "").lower():
            if m.get("xp") == 41:
                m["xp"] = 41000
                fixes.append(f"Ancient Bronze Dragon: XP 41 -> 41000")
            # Clean nameEn
            if "超巨型" in m.get("nameEn", ""):
                m["nameEn"] = "Ancient Bronze Dragon"
                fixes.append(f"Ancient Bronze Dragon: cleaned nameEn")

        # Fix 3: Succubus/Incubus CHA
        if "succubus" in m.get("nameEn", "").lower():
            abs_scores = m.get("abilityScores", {})
            if abs_scores.get("cha") == 18:
                abs_scores["cha"] = 20
                abs_scores["chaMod"] = 5
                if "cha" in m:
                    m["cha"] = 20
                if "chaMod" in m:
                    m["chaMod"] = 5
                fixes.append("Succubus/Incubus: CHA 18 -> 20")

    # Also scan for other nameEn fields with Chinese characters appended
    cleaned_names = 0
    for m in data["monsters"]:
        name_en = m.get("nameEn", "")
        # Check for Chinese chars after the English name
        match = re.match(r'^([A-Za-z][A-Za-z\s\',\-/()]+?)(\s+[\u4e00-\u9fff].*)$', name_en)
        if match:
            clean_name = match.group(1).strip()
            if clean_name != name_en:
                m["nameEn"] = clean_name
                cleaned_names += 1

    if cleaned_names:
        fixes.append(f"Cleaned {cleaned_names} nameEn fields with Chinese suffixes")

    print("Fixes applied:")
    for fix in fixes:
        print(f"  - {fix}")

    with open(MONSTERS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"\nSaved to: {MONSTERS_PATH}")


if __name__ == "__main__":
    main()
