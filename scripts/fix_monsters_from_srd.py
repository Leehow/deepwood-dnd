#!/usr/bin/env python3
"""
Fix monsters.json using SRD 5e-SRD-Monsters.json as authoritative source.

Fixes:
1. proficiencyBonus - calculate from CR for all monsters
2. Action damage_type/dice errors - align with SRD
3. Missing actions - add from SRD
4. Attack bonus errors - align with SRD
5. Add 19 missing shape-form monsters from SRD
"""

import json
import math
import re
import copy
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).parent.parent
SRD_PATH = PROJECT_ROOT / "dnd-platform" / "references" / "5e-srd" / "5e-SRD-Monsters.json"
MONSTERS_PATH = PROJECT_ROOT / "frontend" / "app" / "data" / "npc" / "monsters.json"

# CR -> Proficiency Bonus mapping (D&D 5E rules)
def cr_to_prof_bonus(cr):
    if cr is None:
        return 2
    cr = float(cr)
    if cr < 5:
        return 2
    elif cr < 9:
        return 3
    elif cr < 13:
        return 4
    elif cr < 17:
        return 5
    elif cr < 21:
        return 6
    elif cr < 25:
        return 7
    elif cr < 29:
        return 8
    else:
        return 9


# SRD type/size translations
TYPE_MAP = {
    "aberration": "异怪", "beast": "野兽", "celestial": "天界生物",
    "construct": "构装体", "dragon": "龙", "elemental": "元素生物",
    "fey": "精类", "fiend": "邪魔", "giant": "巨人",
    "humanoid": "类人生物", "monstrosity": "怪物", "ooze": "泥怪",
    "plant": "植物", "undead": "不死生物",
}
SIZE_MAP = {
    "Tiny": "微型", "Small": "小型", "Medium": "中型",
    "Large": "大型", "Huge": "巨型", "Gargantuan": "超巨型",
}
ALIGNMENT_MAP = {
    "lawful good": "守序善良", "neutral good": "中立善良", "chaotic good": "混乱善良",
    "lawful neutral": "守序中立", "neutral": "绝对中立", "true neutral": "绝对中立",
    "chaotic neutral": "混乱中立",
    "lawful evil": "守序邪恶", "neutral evil": "中立邪恶", "chaotic evil": "混乱邪恶",
    "unaligned": "无阵营", "any alignment": "任意阵营",
    "any non-good alignment": "任意非善良阵营",
    "any non-lawful alignment": "任意非守序阵营",
    "any evil alignment": "任意邪恶阵营",
    "any chaotic alignment": "任意混乱阵营",
}
DAMAGE_TYPE_MAP = {
    "bludgeoning": "bludgeoning", "piercing": "piercing", "slashing": "slashing",
    "fire": "fire", "cold": "cold", "lightning": "lightning", "thunder": "thunder",
    "acid": "acid", "poison": "poison", "necrotic": "necrotic", "radiant": "radiant",
    "psychic": "psychic", "force": "force",
}


def convert_srd_damage(srd_damage_list):
    """Convert SRD damage array to current format.

    Handles two SRD formats:
    1. Standard: {"damage_type": {...}, "damage_dice": "2d6+5"}
    2. Versatile (choose): {"choose": 1, "from": {"options": [one-hand, two-hand]}}
       -> We take the one-handed version as default
    """
    result = []
    for d in srd_damage_list:
        # Handle versatile "choose" format
        if d.get("choose") and d.get("from"):
            options = d["from"].get("options", [])
            if options:
                # Take first option (one-handed) as default
                opt = options[0]
                dice = opt.get("damage_dice", "")
                dtype = opt.get("damage_type", {}).get("index", "")
                if dice:
                    result.append({
                        "dice": dice,
                        "avg": calc_avg_damage(dice),
                        "type": dtype,
                    })
                # If there's a two-handed version, add as secondary
                if len(options) > 1:
                    opt2 = options[1]
                    dice2 = opt2.get("damage_dice", "")
                    dtype2 = opt2.get("damage_type", {}).get("index", "")
                    if dice2 and dice2 != dice:
                        result.append({
                            "dice": dice2,
                            "avg": calc_avg_damage(dice2),
                            "type": dtype2,
                            "note": "two-handed",
                        })
            continue

        dice = d.get("damage_dice", "")
        dtype = d.get("damage_type", {}).get("index", "")
        if not dice and not dtype:
            continue
        avg = 0
        if dice:
            avg = calc_avg_damage(dice)
        entry = {"dice": dice, "avg": avg, "type": dtype}
        result.append(entry)
    return result


def calc_avg_damage(dice_str):
    """Calculate average damage from dice notation like '2d6+5'."""
    dice_str = dice_str.replace(" ", "")
    match = re.match(r"(\d+)d(\d+)([+-]\d+)?", dice_str)
    if not match:
        try:
            return int(dice_str)
        except ValueError:
            return 0
    num = int(match.group(1))
    sides = int(match.group(2))
    mod = int(match.group(3)) if match.group(3) else 0
    return math.floor(num * (sides + 1) / 2 + mod)


def determine_action_type(srd_action):
    """Determine actionType from SRD action."""
    if srd_action.get("multiattack_type"):
        return "multiattack"
    desc = srd_action.get("desc", "")
    if "Melee Weapon Attack" in desc or "Melee Spell Attack" in desc:
        return "melee"
    if "Ranged Weapon Attack" in desc or "Ranged Spell Attack" in desc:
        return "ranged"
    if "Melee or Ranged Weapon Attack" in desc:
        return "melee"  # default to melee for versatile
    if srd_action.get("dc"):
        return "ability"
    return "ability"


def extract_reach(desc):
    """Extract reach from action description."""
    m = re.search(r"reach (\d+) ft", desc)
    return int(m.group(1)) if m else None


def extract_range(desc):
    """Extract range from action description."""
    m = re.search(r"range (\d+)/(\d+) ft", desc)
    if m:
        return {"normal": int(m.group(1)), "long": int(m.group(2))}
    m = re.search(r"range (\d+) ft", desc)
    if m:
        return {"normal": int(m.group(1))}
    return None


def convert_srd_action(srd_action, cur_action=None):
    """Convert an SRD action to current format, preserving CN name/description."""
    result = {}

    # Preserve Chinese name if we have a matching current action
    if cur_action:
        result["name"] = cur_action["name"]
        result["description"] = cur_action["description"]
    else:
        result["name"] = srd_action["name"]
        result["description"] = srd_action.get("desc", "")

    action_type = determine_action_type(srd_action)
    result["actionType"] = action_type

    if action_type == "multiattack":
        return result

    # Attack bonus
    if srd_action.get("attack_bonus") is not None:
        result["attackBonus"] = srd_action["attack_bonus"]

    # Reach / Range
    desc = srd_action.get("desc", "")
    if action_type == "melee":
        reach = extract_reach(desc)
        if reach:
            result["reach"] = reach
    elif action_type == "ranged":
        rng = extract_range(desc)
        if rng:
            result["range"] = rng

    # Damage
    if srd_action.get("damage"):
        result["damage"] = convert_srd_damage(srd_action["damage"])

    # DC
    if srd_action.get("dc"):
        result["dc"] = {
            "value": srd_action["dc"]["dc_value"],
            "ability": srd_action["dc"]["dc_type"]["index"],
        }

    # Usage
    if srd_action.get("usage"):
        result["usage"] = srd_action["usage"]

    return result


def _extract_en_name(action_name):
    """Extract clean English name from action name.

    Handles formats like:
    - "咬击 (Bite)" -> "bite"
    - "咬击 Bite" -> "bite"
    - "Bite" -> "bite"
    - "Claw (Fiend Form Only)" -> "claw"
    - "Claw (Bite in Beast Form)" -> "claw"
    - "爪击（野兽形态为啃咬） Claw (Bite in Beast Form)" -> "claw"
    """
    name = action_name.strip()

    # Check if first part contains Chinese characters
    parts = name.split(" ", 1)
    if len(parts) > 1 and re.search(r'[\u4e00-\u9fff]', parts[0]):
        en_part = parts[1].strip()
    else:
        en_part = name

    # Strip outer parentheses like "(Bite)" -> "Bite"
    if en_part.startswith("(") and en_part.endswith(")"):
        en_part = en_part[1:-1]

    # Get base name: take first word(s) before any parenthetical
    base = re.sub(r"\s*\(.*\)$", "", en_part).strip()
    return base.lower()


def match_action(srd_name, cur_actions):
    """Find matching current action by English name."""
    srd_base = _extract_en_name(srd_name)

    for a in cur_actions:
        cur_base = _extract_en_name(a["name"])
        if cur_base == srd_base:
            return a
        if srd_base in cur_base or cur_base in srd_base:
            return a
    return None


def fix_actions(srd_monster, cur_monster):
    """Fix actions in current monster using SRD data.

    Handles deduplication: if current has multiple actions with the same
    English name, we replace ALL of them with a single SRD-aligned version.
    """
    srd_actions = srd_monster.get("actions", [])
    cur_actions = cur_monster.get("actions", [])

    if not srd_actions:
        return cur_actions

    fixed = []
    used_cur_indices = set()

    for srd_a in srd_actions:
        srd_base = _extract_en_name(srd_a["name"])
        first_match = None

        for i, ca in enumerate(cur_actions):
            cur_base = _extract_en_name(ca["name"])
            if cur_base == srd_base or srd_base in cur_base or cur_base in srd_base:
                used_cur_indices.add(i)
                if first_match is None:
                    first_match = ca

        fixed.append(convert_srd_action(srd_a, first_match))

    # Keep any current actions not matched to SRD
    for i, ca in enumerate(cur_actions):
        if i not in used_cur_indices:
            fixed.append(ca)

    return fixed


def fix_legendary_actions(srd_monster, cur_monster):
    """Fix legendary actions using SRD data."""
    srd_la = srd_monster.get("legendary_actions", [])
    cur_la = cur_monster.get("legendaryActions", {})

    if not srd_la:
        return cur_la

    cur_la_actions = cur_la.get("actions", []) if isinstance(cur_la, dict) else []

    fixed_actions = []
    for srd_a in srd_la:
        # Use same matching logic
        srd_base = _extract_en_name(srd_a["name"])
        matched = None
        for ca in cur_la_actions:
            cur_base = _extract_en_name(ca["name"])
            if cur_base == srd_base or srd_base in cur_base or cur_base in srd_base:
                matched = ca
                break
        entry = {}
        if matched:
            entry["name"] = matched["name"]
            entry["description"] = matched["description"]
        else:
            entry["name"] = srd_a["name"]
            entry["description"] = srd_a.get("desc", "")

        if srd_a.get("damage"):
            entry["damage"] = convert_srd_damage(srd_a["damage"])
        if srd_a.get("dc"):
            entry["dc"] = {
                "value": srd_a["dc"]["dc_value"],
                "ability": srd_a["dc"]["dc_type"]["index"],
            }
        fixed_actions.append(entry)

    result = {}
    if isinstance(cur_la, dict) and cur_la.get("description"):
        result["description"] = cur_la["description"]
    else:
        result["description"] = ""
    result["actions"] = fixed_actions
    return result


def fix_proficiencies(srd_monster, cur_monster):
    """Fix proficiencies using SRD data."""
    srd_profs = srd_monster.get("proficiencies", [])
    saves = {}
    skills = {}
    for p in srd_profs:
        name = p["proficiency"]["name"]
        value = p["value"]
        if "Saving Throw:" in name:
            ab = name.split(": ")[1].upper()
            saves[ab] = value
        elif "Skill:" in name:
            skill = name.split(": ")[1]
            skills[skill] = value
    return {"savingThrows": saves, "skills": skills}


def convert_srd_to_new_monster(srd_m):
    """Convert a full SRD monster to current format (for missing monsters)."""
    m = {}
    m["id"] = srd_m["index"]
    m["name"] = srd_m["name"]  # Will need translation
    m["nameEn"] = srd_m["name"]
    m["size"] = SIZE_MAP.get(srd_m["size"], srd_m["size"])
    m["type"] = TYPE_MAP.get(srd_m["type"], srd_m["type"])
    m["alignment"] = ALIGNMENT_MAP.get(srd_m["alignment"], srd_m["alignment"])
    m["ac"] = srd_m["armor_class"][0]["value"] if srd_m["armor_class"] else 10
    m["acType"] = srd_m["armor_class"][0].get("type", "natural") if srd_m["armor_class"] else "dex"
    m["hp"] = srd_m["hit_points"]
    m["hpFormula"] = srd_m.get("hit_points_roll", srd_m.get("hit_dice", ""))
    m["speed"] = {}
    for k, v in srd_m.get("speed", {}).items():
        if isinstance(v, str):
            num = re.search(r"(\d+)", v)
            m["speed"][k] = int(num.group(1)) if num else 0
        else:
            m["speed"][k] = v

    # Ability scores
    ab_map = {"strength": "str", "dexterity": "dex", "constitution": "con",
              "intelligence": "int", "wisdom": "wis", "charisma": "cha"}
    m["abilityScores"] = {}
    for long, short in ab_map.items():
        val = srd_m[long]
        m["abilityScores"][short] = val
        m["abilityScores"][f"{short}Mod"] = math.floor((val - 10) / 2)

    m["cr"] = srd_m["challenge_rating"]
    m["xp"] = srd_m["xp"]
    m["proficiencyBonus"] = srd_m.get("proficiency_bonus") or cr_to_prof_bonus(m["cr"])

    # Languages
    lang = srd_m.get("languages", "")
    m["languages"] = [l.strip() for l in lang.split(",")] if lang else []
    m["languages_text"] = lang

    # Senses
    m["senses"] = {}
    srd_senses = srd_m.get("senses", {})
    for k, v in srd_senses.items():
        if k == "passive_perception":
            m["senses"]["passivePerception"] = v
        else:
            num = re.search(r"(\d+)", str(v)) if isinstance(v, str) else None
            m["senses"][k] = int(num.group(1)) if num else v

    # Damage/condition fields
    m["damageResistances"] = srd_m.get("damage_resistances", [])
    m["damageImmunities"] = srd_m.get("damage_immunities", [])
    m["damageVulnerabilities"] = srd_m.get("damage_vulnerabilities", [])
    m["conditionImmunities"] = [
        ci.get("index", ci.get("name", ""))
        for ci in srd_m.get("condition_immunities", [])
    ]

    # Proficiencies
    m["proficiencies"] = fix_proficiencies(srd_m, {})

    # Special abilities
    if srd_m.get("special_abilities"):
        m["specialAbilities"] = []
        for sa in srd_m["special_abilities"]:
            entry = {"name": sa["name"], "description": sa.get("desc", "")}
            if sa.get("dc"):
                entry["dc"] = {
                    "value": sa["dc"]["dc_value"],
                    "ability": sa["dc"]["dc_type"]["index"],
                }
            m["specialAbilities"].append(entry)

    # Actions
    if srd_m.get("actions"):
        m["actions"] = []
        for a in srd_m["actions"]:
            m["actions"].append(convert_srd_action(a))

    # Legendary actions
    if srd_m.get("legendary_actions"):
        m["legendaryActions"] = fix_legendary_actions(srd_m, {})

    # Reactions
    if srd_m.get("reactions"):
        m["reactions"] = [
            {"name": r["name"], "description": r.get("desc", "")}
            for r in srd_m["reactions"]
        ]

    return m


def _normalize_monster_name(name):
    """Normalize monster nameEn for matching.

    Handles:
    - "Chain Devil (基顿魔 Kyton)" -> "chain devil"
    - "Ice Devil(奇鲁魔 Gelugon)" -> "ice devil"
    - "Bearded Devil(巴霸魔 Barbazu)" -> "bearded devil"
    """
    n = name.lower().strip()
    # Remove parenthetical containing Chinese chars
    n = re.sub(r'\s*\([^)]*[\u4e00-\u9fff][^)]*\)', '', n).strip()
    # Also handle no-space before paren: "Ice Devil(..."
    n = re.sub(r'\([^)]*[\u4e00-\u9fff][^)]*\)', '', n).strip()
    return n


def _build_current_lookup(current_monsters):
    """Build name -> monster lookup with normalized names."""
    lookup = {}
    for m in current_monsters:
        en = m.get("nameEn", "")
        # Exact match
        lookup[en.lower()] = m
        # Normalized match
        norm = _normalize_monster_name(en)
        if norm not in lookup:
            lookup[norm] = m
    return lookup


def main():
    print("Loading data...")
    with open(SRD_PATH) as f:
        srd_monsters = json.load(f)
    with open(MONSTERS_PATH) as f:
        data = json.load(f)

    current_monsters = data["monsters"]
    current_lookup = _build_current_lookup(current_monsters)

    stats = {
        "prof_bonus_fixed": 0,
        "actions_fixed": 0,
        "legendary_fixed": 0,
        "proficiencies_fixed": 0,
        "monsters_added": 0,
    }

    # Build SRD lookup
    srd_by_norm = {}
    for m in srd_monsters:
        norm = _normalize_monster_name(m["name"])
        srd_by_norm[norm] = m

    # Fix existing monsters
    for cur_m in current_monsters:
        name_en = cur_m.get("nameEn", "")
        cr = cur_m.get("cr")

        # 1. Fix proficiencyBonus
        expected_pb = cr_to_prof_bonus(cr)
        if not cur_m.get("proficiencyBonus"):
            cur_m["proficiencyBonus"] = expected_pb
            stats["prof_bonus_fixed"] += 1

        # Find SRD match (try exact then normalized)
        norm = _normalize_monster_name(name_en)
        srd_m = srd_by_norm.get(name_en.lower()) or srd_by_norm.get(norm)
        if not srd_m:
            continue

        # Use SRD proficiency bonus if available (more accurate)
        if srd_m.get("proficiency_bonus"):
            cur_m["proficiencyBonus"] = srd_m["proficiency_bonus"]

        # 2. Fix actions
        if srd_m.get("actions"):
            old_actions = json.dumps(cur_m.get("actions", []), sort_keys=True)
            cur_m["actions"] = fix_actions(srd_m, cur_m)
            new_actions = json.dumps(cur_m["actions"], sort_keys=True)
            if old_actions != new_actions:
                stats["actions_fixed"] += 1

        # 3. Fix legendary actions
        if srd_m.get("legendary_actions"):
            old_la = json.dumps(cur_m.get("legendaryActions", {}), sort_keys=True)
            cur_m["legendaryActions"] = fix_legendary_actions(srd_m, cur_m)
            new_la = json.dumps(cur_m["legendaryActions"], sort_keys=True)
            if old_la != new_la:
                stats["legendary_fixed"] += 1

        # 4. Fix proficiencies (savingThrows/skills)
        srd_profs = fix_proficiencies(srd_m, cur_m)
        if srd_profs["savingThrows"] or srd_profs["skills"]:
            cur_m["proficiencies"] = srd_profs
            stats["proficiencies_fixed"] += 1

        # 5. Fix conditionImmunities format
        srd_ci = srd_m.get("condition_immunities", [])
        if srd_ci:
            cur_m["conditionImmunities"] = [
                ci.get("index", ci.get("name", ""))
                for ci in srd_ci
            ]

    # Add missing SRD monsters
    for srd_m in srd_monsters:
        norm = _normalize_monster_name(srd_m["name"])
        if norm not in current_lookup and srd_m["name"].lower() not in current_lookup:
            new_m = convert_srd_to_new_monster(srd_m)
            current_monsters.append(new_m)
            current_lookup[norm] = new_m
            stats["monsters_added"] += 1
            print(f"  Added: {srd_m['name']}")

    # Deduplicate monsters by normalized nameEn
    seen = {}
    deduped = []
    for m in current_monsters:
        n = _normalize_monster_name(m.get("nameEn", ""))
        if n in seen:
            # Keep the one with more data
            existing = seen[n]
            if len(json.dumps(m)) > len(json.dumps(existing)):
                deduped.remove(existing)
                deduped.append(m)
                seen[n] = m
            # else skip this duplicate
        else:
            seen[n] = m
            deduped.append(m)

    if len(deduped) < len(current_monsters):
        print(f"  Deduped: {len(current_monsters)} -> {len(deduped)}")
    data["monsters"] = deduped

    # Update overview
    data["overview"]["totalMonsters"] = len(deduped)
    data["overview"]["lastUpdated"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    data["overview"]["lastOptimized"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    data["overview"]["optimizationNote"] = (
        "Enhanced with structured action fields (attackBonus, damage, dc, reach, range, actionType). "
        "Added missing SRD monsters. "
        "SRD alignment fix: actions/damage/proficiencies synced with 5e-SRD-Monsters.json."
    )

    # Write back
    print(f"\nWriting {len(current_monsters)} monsters...")
    with open(MONSTERS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"\nDone! Stats:")
    for k, v in stats.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
