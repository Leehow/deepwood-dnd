#!/usr/bin/env python3
"""
Convert all monster actions in monsters.json from camelCase format
to ActionSchema snake_case format.

Old format (camelCase):
  actionType, attackBonus, reach (int), range ({normal, long}),
  damage ([{dice, avg, type}]), dc ({value, ability})

New format (ActionSchema):
  action_category, attack_bonus, reach (str "5尺"), range (str "150/600尺"),
  damage ({dice, bonus, average, type}), extra_damage, save ({dc, ability}),
  usage, multiattack_actions
"""

import json
import math
import re
from datetime import datetime
from pathlib import Path

MONSTERS_PATH = Path(__file__).parent.parent / "frontend" / "app" / "data" / "npc" / "monsters.json"

# === Mappings ===

DAMAGE_TYPE_EN_TO_CN = {
    "piercing": "穿刺", "slashing": "挥砍", "bludgeoning": "钝击",
    "fire": "火焰", "cold": "冰冷", "lightning": "闪电", "thunder": "雷鸣",
    "acid": "强酸", "poison": "毒素", "necrotic": "黯蚀",
    "radiant": "光耀", "psychic": "心灵", "force": "力场",
}

ABILITY_ABBR_TO_CN = {
    "str": "力量", "dex": "敏捷", "con": "体质",
    "int": "智力", "wis": "感知", "cha": "魅力",
}

ACTION_TYPE_MAP = {
    "melee": ("weapon_attack", "melee"),
    "ranged": ("weapon_attack", "ranged"),
    "multiattack": ("multiattack", None),
    "ability": ("special_attack", None),
}


def split_dice_and_bonus(dice_str: str):
    """Split '2d6+5' into ('2d6', 5) or '2d6' into ('2d6', None)."""
    dice_str = dice_str.replace(" ", "").replace("＋", "+").replace("－", "-")
    m = re.match(r"(\d+d\d+)([+-]\d+)?", dice_str)
    if not m:
        return dice_str, None
    dice_part = m.group(1)
    bonus = int(m.group(2)) if m.group(2) else None
    return dice_part, bonus


def convert_damage_entry(old_dmg: dict) -> dict:
    """Convert a single old damage entry {dice, avg, type} to DamageSchema."""
    dice_str = old_dmg.get("dice", "")
    dice_only, bonus = split_dice_and_bonus(dice_str)

    new_dmg = {}
    if dice_only:
        new_dmg["dice"] = dice_only
    if bonus is not None:
        new_dmg["bonus"] = bonus
    if old_dmg.get("avg") is not None:
        new_dmg["average"] = old_dmg["avg"]
    dtype = old_dmg.get("type", "")
    new_dmg["type"] = DAMAGE_TYPE_EN_TO_CN.get(dtype, dtype)
    return new_dmg


def convert_range(old_range) -> str:
    """Convert range object {normal: 150, long: 600} to string '150/600尺'."""
    if isinstance(old_range, dict):
        n = old_range.get("normal", 0)
        l = old_range.get("long")
        if l:
            return f"{n}/{l}尺"
        return f"{n}尺"
    if isinstance(old_range, (int, float)):
        return f"{int(old_range)}尺"
    return str(old_range)


def extract_usage_from_name(name: str) -> tuple:
    """Extract usage info from name like '火焰吐息 (充能 5~6)' or '治愈之触 (3/日)'.
    Returns (usage_dict_or_None, cleaned_name)."""
    # Recharge pattern: (充能 5~6), (Recharge 5-6), (Recharge 5–6)
    m = re.search(r'[（(]\s*(?:充能|[Rr]echarge)\s*(\d+)\s*[~\-–]\s*(\d+)\s*[）)]', name)
    if m:
        cleaned = re.sub(r'\s*[（(]\s*(?:充能|[Rr]echarge)\s*\d+\s*[~\-–]\s*\d+\s*[）)]', '', name).strip()
        return {"type": "recharge", "value": f"{m.group(1)}-{m.group(2)}"}, cleaned

    # Per day pattern: (1/日), (3/日), (4/日)
    m = re.search(r'[（(]\s*(\d+)\s*/\s*[日天]\s*[）)]', name)
    if m:
        cleaned = re.sub(r'\s*[（(]\s*\d+\s*/\s*[日天]\s*[）)]', '', name).strip()
        return {"type": "per_day", "value": int(m.group(1))}, cleaned

    # Parenthetical like (3/8) which means 3/day in some entries
    m = re.search(r'[（(]\s*(\d+)\s*/\s*(\d+)\s*[）)]', name)
    if m:
        cleaned = re.sub(r'\s*[（(]\s*\d+\s*/\s*\d+\s*[）)]', '', name).strip()
        return {"type": "per_day", "value": int(m.group(1))}, cleaned

    return None, name


def convert_old_usage(old_usage: dict) -> dict:
    """Convert old usage format to new ActionSchema usage format."""
    t = old_usage.get("type", "")
    if t == "recharge on roll":
        min_val = old_usage.get("min_value", 6)
        return {"type": "recharge", "value": f"{min_val}-6"}
    if t == "per day":
        return {"type": "per_day", "value": old_usage.get("times", 1)}
    if t == "recharge after rest":
        return {"type": "per_day", "value": 1}
    return old_usage


def extract_multiattack_refs(description: str, all_action_names: list) -> list:
    """Extract referenced action names from a multiattack description."""
    refs = []
    for aname in all_action_names:
        # Get the Chinese part of the name (before English or space)
        cn_name = re.split(r'\s+[A-Z]', aname)[0].strip()
        if len(cn_name) >= 2 and cn_name in description:
            refs.append(cn_name)
    # Deduplicate while preserving order
    seen = set()
    result = []
    for r in refs:
        if r not in seen:
            seen.add(r)
            result.append(r)
    return result


def convert_action(action: dict, all_action_names: list) -> dict:
    """Convert a single action from old camelCase to ActionSchema format."""
    new_action = {
        "name": action["name"],
        "description": action.get("description", ""),
    }

    # Copy name_en if present
    if action.get("name_en"):
        new_action["name_en"] = action["name_en"]

    # --- action_category & attack_type ---
    old_type = action.get("actionType")
    if old_type and old_type in ACTION_TYPE_MAP:
        cat, atk_type = ACTION_TYPE_MAP[old_type]
        new_action["action_category"] = cat
        if atk_type:
            new_action["attack_type"] = atk_type
    else:
        # Determine from description if no actionType
        desc = action.get("description", "")
        if re.search(r"近战或远程武器攻击|Melee or Ranged Weapon Attack", desc):
            new_action["action_category"] = "weapon_attack"
            new_action["attack_type"] = "melee_or_ranged"
        elif re.search(r"近战武器攻击|近战法术攻击|Melee Weapon Attack", desc):
            new_action["action_category"] = "weapon_attack"
            new_action["attack_type"] = "melee"
        elif re.search(r"远程武器攻击|远程法术攻击|Ranged Weapon Attack", desc):
            new_action["action_category"] = "weapon_attack"
            new_action["attack_type"] = "ranged"
        elif re.search(r"多重攻击|Multiattack", action.get("name", "")):
            new_action["action_category"] = "multiattack"
        else:
            new_action["action_category"] = "other"

    # --- attack_bonus ---
    if action.get("attackBonus") is not None:
        new_action["attack_bonus"] = action["attackBonus"]

    # --- reach ---
    if action.get("reach") is not None:
        r = action["reach"]
        new_action["reach"] = f"{r}尺" if isinstance(r, (int, float)) else str(r)

    # --- range ---
    if action.get("range") is not None:
        new_action["range"] = convert_range(action["range"])

    # --- damage ---
    old_damage = action.get("damage")
    if isinstance(old_damage, list) and len(old_damage) > 0:
        new_action["damage"] = convert_damage_entry(old_damage[0])
        if len(old_damage) > 1:
            new_action["extra_damage"] = convert_damage_entry(old_damage[1])
    elif isinstance(old_damage, dict):
        # Already in new format somehow
        new_action["damage"] = old_damage

    # --- dc → save ---
    old_dc = action.get("dc")
    if isinstance(old_dc, dict):
        ability_raw = old_dc.get("ability", "")
        ability_cn = ABILITY_ABBR_TO_CN.get(ability_raw, ability_raw)
        save = {"dc": old_dc.get("value"), "ability": ability_cn}
        # Try to extract success/fail effects from description
        desc = action.get("description", "")
        if "伤害减半" in desc or "成功则伤害减半" in desc:
            save["success_effect"] = "伤害减半"
        new_action["save"] = save

    # --- usage (from old usage field or from name) ---
    old_usage = action.get("usage")
    if old_usage:
        new_action["usage"] = convert_old_usage(old_usage)
    else:
        usage_from_name, _ = extract_usage_from_name(action.get("name", ""))
        if usage_from_name:
            new_action["usage"] = usage_from_name

    # --- multiattack_actions ---
    if new_action.get("action_category") == "multiattack":
        refs = extract_multiattack_refs(
            action.get("description", ""), all_action_names
        )
        if refs:
            new_action["multiattack_actions"] = refs

    # --- area extraction from description ---
    desc = action.get("description", "")
    area_match = re.search(r"(\d+)\s*尺\s*(锥形|球形|线形|立方体|圆形|半径)", desc)
    if not area_match:
        area_match = re.search(r"(锥形|球形|线形|立方体)\s*(?:范围|区域).*?(\d+)\s*尺", desc)
    if area_match:
        groups = area_match.groups()
        if groups[0].isdigit():
            size_str, shape = f"{groups[0]}尺", groups[1]
        else:
            shape, size_str = groups[0], f"{groups[1]}尺"
        # Normalize shape names
        shape_map = {"半径": "球形", "圆形": "球形"}
        shape = shape_map.get(shape, shape)
        # Only add area for special attacks/abilities, not weapon attacks
        if new_action.get("action_category") in ("special_attack", "other"):
            new_action["area"] = {"shape": shape, "size": size_str}

    # If weapon_attack but no attack_bonus, try to demote to special_attack
    if (new_action.get("action_category") == "weapon_attack"
            and new_action.get("attack_bonus") is None):
        new_action["action_category"] = "special_attack"
        new_action.pop("attack_type", None)

    return new_action


def main():
    print("Loading monsters.json...")
    with open(MONSTERS_PATH) as f:
        data = json.load(f)

    monsters = data["monsters"]
    stats = {
        "total_actions": 0,
        "converted": 0,
        "pure_text": 0,
        "multiattack": 0,
        "categories": {},
    }

    for m in monsters:
        actions = m.get("actions", [])
        all_names = [a.get("name", "") for a in actions]
        new_actions = []

        for action in actions:
            stats["total_actions"] += 1
            new_action = convert_action(action, all_names)
            cat = new_action.get("action_category", "other")
            stats["categories"][cat] = stats["categories"].get(cat, 0) + 1

            if cat == "multiattack":
                stats["multiattack"] += 1
            elif new_action.get("attack_bonus") is not None or new_action.get("damage"):
                stats["converted"] += 1
            elif new_action.get("save"):
                stats["converted"] += 1
            else:
                stats["pure_text"] += 1

            new_actions.append(new_action)

        m["actions"] = new_actions

    # Update metadata
    data["overview"]["lastUpdated"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    data["overview"]["optimizationNote"] = (
        "Actions converted to ActionSchema format (snake_case). "
        "Fields: action_category, attack_bonus, damage{dice,bonus,average,type}, "
        "save{dc,ability}, usage, multiattack_actions."
    )

    print(f"\nWriting {len(monsters)} monsters...")
    with open(MONSTERS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"\n=== Conversion Stats ===")
    print(f"Total actions:  {stats['total_actions']}")
    print(f"Converted:      {stats['converted']}")
    print(f"Multiattack:    {stats['multiattack']}")
    print(f"Pure text:      {stats['pure_text']}")
    print(f"\nCategory distribution:")
    for cat, count in sorted(stats["categories"].items(), key=lambda x: -x[1]):
        print(f"  {cat}: {count}")

    # Verify no old fields remain
    print("\n=== Verification ===")
    old_fields = {"attackBonus": 0, "actionType": 0, "avg_in_damage": 0}
    for m in monsters:
        for a in m.get("actions", []):
            if "attackBonus" in a:
                old_fields["attackBonus"] += 1
            if "actionType" in a:
                old_fields["actionType"] += 1
            if isinstance(a.get("damage"), list):
                old_fields["avg_in_damage"] += 1
    for field, count in old_fields.items():
        status = "✓ CLEAN" if count == 0 else f"✗ REMAINING: {count}"
        print(f"  {field}: {status}")


if __name__ == "__main__":
    main()
