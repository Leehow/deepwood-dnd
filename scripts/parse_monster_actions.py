#!/usr/bin/env python3
"""
Parse action description text into structured numerical fields
for non-SRD monsters that only have description text.

Extracts: actionType, attackBonus, reach, range, damage[], dc
from Chinese description text like:
  "近战武器攻击：命中+9，触及10尺，单一目标。命中：12（2d6+5）点钝击伤害。"
"""

import json
import math
import re
from pathlib import Path
from datetime import datetime

MONSTERS_PATH = Path(__file__).parent.parent / "frontend" / "app" / "data" / "npc" / "monsters.json"

# Damage type mapping: Chinese -> English key
DAMAGE_TYPE_CN = {
    "钝击": "bludgeoning", "穿刺": "piercing", "挥砍": "slashing",
    "斩击": "slashing", "砍击": "slashing",
    "火焰": "fire", "冰冷": "cold", "寒冷": "cold", "冰霜": "cold",
    "闪电": "lightning", "雷鸣": "thunder", "雷暴": "thunder",
    "强酸": "acid", "酸液": "acid", "毒素": "poison", "中毒": "poison",
    "黯蚀": "necrotic", "死灵": "necrotic",
    "光耀": "radiant", "光辉": "radiant",
    "心灵": "psychic", "精神": "psychic",
    "力场": "force",
    # English fallbacks
    "bludgeoning": "bludgeoning", "piercing": "piercing", "slashing": "slashing",
    "fire": "fire", "cold": "cold", "lightning": "lightning", "thunder": "thunder",
    "acid": "acid", "poison": "poison", "necrotic": "necrotic",
    "radiant": "radiant", "psychic": "psychic", "force": "force",
}

# Ability name mapping for DC
ABILITY_CN = {
    "力量": "str", "敏捷": "dex", "体质": "con",
    "智力": "int", "感知": "wis", "魅力": "cha",
    "Constitution": "con", "Dexterity": "dex", "Strength": "str",
    "Intelligence": "int", "Wisdom": "wis", "Charisma": "cha",
}


def calc_avg(dice_str):
    """Calculate average from dice notation."""
    dice_str = dice_str.replace(" ", "").replace("＋", "+").replace("－", "-")
    m = re.match(r"(\d+)d(\d+)([+-]\d+)?", dice_str)
    if not m:
        try:
            return int(dice_str)
        except ValueError:
            return 0
    num, sides = int(m.group(1)), int(m.group(2))
    mod = int(m.group(3)) if m.group(3) else 0
    return math.floor(num * (sides + 1) / 2 + mod)


def parse_action_type(desc):
    """Determine action type from description text."""
    if re.search(r"近战或远程武器攻击|Melee or Ranged Weapon Attack", desc):
        return "melee"
    if re.search(r"近战武器攻击|近战法术攻击|Melee Weapon Attack|Melee Spell Attack", desc):
        return "melee"
    if re.search(r"远程武器攻击|远程法术攻击|Ranged Weapon Attack|Ranged Spell Attack", desc):
        return "ranged"
    if re.search(r"多重攻击|Multiattack", desc):
        return "multiattack"
    return None


def parse_attack_bonus(desc):
    """Extract attack bonus from description."""
    patterns = [
        r"[+＋]\s*(\d+)\s*命中",           # +9命中 / +9 命中
        r"命中\s*[+＋]\s*(\d+)",           # 命中+9 / 命中 +9
        r"命中加值\s*[+＋]?\s*(\d+)",       # 命中加值+9
        r"[+＋](\d+)\s*to\s*hit",          # +9 to hit
    ]
    for pat in patterns:
        m = re.search(pat, desc)
        if m:
            return int(m.group(1))
    return None


def parse_reach(desc):
    """Extract melee reach."""
    patterns = [
        r"触及\s*(\d+)\s*尺",
        r"范围\s*(\d+)\s*尺",  # some use 范围 for reach
        r"距离\s*(\d+)\s*尺",
        r"reach\s+(\d+)\s*ft",
    ]
    for pat in patterns:
        m = re.search(pat, desc, re.I)
        if m:
            return int(m.group(1))
    return None


def parse_range(desc):
    """Extract ranged range (normal/long)."""
    m = re.search(r"射程\s*(\d+)\s*/\s*(\d+)\s*尺", desc)
    if m:
        return {"normal": int(m.group(1)), "long": int(m.group(2))}
    m = re.search(r"range\s+(\d+)\s*/\s*(\d+)\s*ft", desc, re.I)
    if m:
        return {"normal": int(m.group(1)), "long": int(m.group(2))}
    # Single range
    if "射程" in desc:
        m = re.search(r"射程\s*(\d+)\s*尺", desc)
        if m:
            return {"normal": int(m.group(1))}
    return None


def parse_damage(desc):
    """Extract all damage entries from description."""
    results = []

    # Pattern 1: avg(dice) type伤害 — e.g. "12（2d6+5）点钝击伤害" or "12(2d6+5)的钝击伤害"
    pat1 = (
        r"(\d+)\s*[（(]\s*"
        r"(\d+d\d+(?:\s*[+＋-]\s*\d+)?)"
        r"\s*[）)]\s*(?:点|的)?\s*"
        r"(\S+?)(?:伤害|damage)"
    )
    for m in re.finditer(pat1, desc):
        avg_val = int(m.group(1))
        dice = m.group(2).replace("＋", "+").replace(" ", "")
        dtype_raw = m.group(3).replace("点", "").replace("的", "").strip()
        dtype = _resolve_damage_type(dtype_raw)
        if dtype:
            results.append({"dice": dice, "avg": avg_val, "type": dtype})

    if results:
        return results

    # Pattern 2: dice点type伤害 (no avg) — e.g. "2d6+5点钝击伤害"
    pat2 = (
        r"(\d+d\d+(?:\s*[+＋-]\s*\d+)?)"
        r"\s*(?:点|的)?\s*"
        r"(\S+?)(?:伤害|damage)"
    )
    for m in re.finditer(pat2, desc):
        dice = m.group(1).replace("＋", "+").replace(" ", "")
        dtype_raw = m.group(2).replace("点", "").replace("的", "").strip()
        dtype = _resolve_damage_type(dtype_raw)
        if dtype:
            results.append({"dice": dice, "avg": calc_avg(dice), "type": dtype})

    return results


def _resolve_damage_type(raw):
    """Resolve a raw damage type string to English key."""
    raw = raw.strip()
    # Direct match
    if raw in DAMAGE_TYPE_CN:
        return DAMAGE_TYPE_CN[raw]
    # Try partial match
    for cn, en in DAMAGE_TYPE_CN.items():
        if cn in raw:
            return en
    return None


def parse_dc(desc):
    """Extract saving throw DC."""
    # "DC 14的体质豁免" / "DC 14 的敏捷豁免"
    m = re.search(r"DC\s*(\d+)\s*的?\s*(\S+?)豁免", desc)
    if m:
        dc_val = int(m.group(1))
        ability_raw = m.group(2)
        ability = _resolve_ability(ability_raw)
        if ability:
            return {"value": dc_val, "ability": ability}

    # "DC 14 Constitution saving throw"
    m = re.search(r"DC\s*(\d+)\s*(\w+)\s*saving", desc, re.I)
    if m:
        dc_val = int(m.group(1))
        ability = _resolve_ability(m.group(2))
        if ability:
            return {"value": dc_val, "ability": ability}

    return None


def _resolve_ability(raw):
    """Resolve ability name to short key."""
    raw = raw.strip()
    if raw in ABILITY_CN:
        return ABILITY_CN[raw]
    for cn, en in ABILITY_CN.items():
        if cn in raw:
            return en
    return None


def parse_action(action):
    """Parse a single action's description into structured fields."""
    desc = action.get("description", "")
    if not desc:
        return {}

    updates = {}

    # Action type
    if not action.get("actionType"):
        atype = parse_action_type(desc)
        if atype:
            updates["actionType"] = atype

    # Attack bonus
    if action.get("attackBonus") is None:
        atk = parse_attack_bonus(desc)
        if atk is not None:
            updates["attackBonus"] = atk

    # Reach / Range
    atype = action.get("actionType") or updates.get("actionType")
    if atype == "melee" and not action.get("reach"):
        reach = parse_reach(desc)
        if reach:
            updates["reach"] = reach
    if atype == "ranged" and not action.get("range"):
        rng = parse_range(desc)
        if rng:
            updates["range"] = rng
    # For melee-or-ranged, extract both
    if atype == "melee" and "射程" in desc:
        rng = parse_range(desc)
        if rng:
            updates["range"] = rng

    # Damage
    if not action.get("damage"):
        dmg = parse_damage(desc)
        if dmg:
            updates["damage"] = dmg

    # DC
    if not action.get("dc"):
        dc = parse_dc(desc)
        if dc:
            updates["dc"] = dc

    return updates


def main():
    print("Loading monsters.json...")
    with open(MONSTERS_PATH) as f:
        data = json.load(f)

    monsters = data["monsters"]
    stats = {"actions_parsed": 0, "monsters_updated": 0, "fields_added": 0}

    for m in monsters:
        monster_updated = False
        for action in m.get("actions", []):
            # Skip already structured actions
            has_structured = (
                action.get("attackBonus") is not None
                or action.get("damage")
                or action.get("actionType") == "multiattack"
            )
            desc = action.get("description", "")
            has_parseable = bool(
                re.search(r"\d+d\d+|命中|to hit", desc, re.I)
            )

            if has_parseable:
                updates = parse_action(action)
                if updates:
                    action.update(updates)
                    stats["actions_parsed"] += 1
                    stats["fields_added"] += len(updates)
                    monster_updated = True

        if monster_updated:
            stats["monsters_updated"] += 1

    # Write back
    data["overview"]["lastUpdated"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")

    print(f"\nWriting {len(monsters)} monsters...")
    with open(MONSTERS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"\nDone! Stats:")
    print(f"  actions_parsed: {stats['actions_parsed']}")
    print(f"  monsters_updated: {stats['monsters_updated']}")
    print(f"  fields_added: {stats['fields_added']}")


if __name__ == "__main__":
    main()
