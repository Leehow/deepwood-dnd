#!/usr/bin/env python3
"""修复怪物 actions 数据，从描述文本中提取数值"""
import json
import re
from pathlib import Path

MONSTERS_PATH = Path("/Users/haoli/leehow/code/dw/frontend/public/dnd-platform/configs/npc/monsters.json")

def parse_attack_bonus(description: str) -> int | None:
    """从描述中提取攻击加值，如 '命中+5' 或 '命中 +5'"""
    match = re.search(r'命中\s*[+＋]\s*(\d+)', description)
    if match:
        return int(match.group(1))
    return None

def parse_damage(description: str) -> dict | None:
    """从描述中提取伤害数据，如 '14(4d6)的穿刺伤害' 或 '2d6+3挥砍伤害'"""
    # 格式1: 14(4d6)的穿刺伤害
    match = re.search(r'(\d+)\s*\((\d+d\d+)(?:[+＋](\d+))?\)\s*(?:的|点)?(\w+)伤害', description)
    if match:
        dice = match.group(2)
        bonus = int(match.group(3)) if match.group(3) else 0
        damage_type = match.group(4)
        return {"dice": dice, "bonus": bonus, "type": damage_type}

    # 格式2: 2d6+3挥砍伤害
    match = re.search(r'(\d+d\d+)\s*[+＋]\s*(\d+)\s*(?:点)?(\w+)伤害', description)
    if match:
        return {"dice": match.group(1), "bonus": int(match.group(2)), "type": match.group(3)}

    # 格式3: 1d4穿刺伤害
    match = re.search(r'(\d+d\d+)\s*(?:点)?(\w+)伤害', description)
    if match:
        return {"dice": match.group(1), "bonus": 0, "type": match.group(2)}

    # 格式4: X点Y伤害
    match = re.search(r'(\d+)\s*点\s*(\w+)伤害', description)
    if match:
        return {"dice": str(match.group(1)), "bonus": 0, "type": match.group(2)}

    return None

def parse_reach(description: str) -> str | None:
    """从描述中提取触及距离"""
    match = re.search(r'触及\s*(\d+)\s*尺', description)
    if match:
        return f"{match.group(1)}尺"
    return None

def parse_range(description: str) -> str | None:
    """从描述中提取射程"""
    match = re.search(r'射程\s*(\d+)/(\d+)\s*尺', description)
    if match:
        return f"{match.group(1)}/{match.group(2)}尺"
    return None

def parse_save_dc(description: str) -> dict | None:
    """从描述中提取豁免DC"""
    match = re.search(r'DC\s*(\d+)\s*的?\s*(力量|敏捷|体质|智力|感知|魅力)豁免', description)
    if match:
        ability_map = {
            "力量": "strength", "敏捷": "dexterity", "体质": "constitution",
            "智力": "intelligence", "感知": "wisdom", "魅力": "charisma"
        }
        return {"dc": int(match.group(1)), "ability": ability_map.get(match.group(2), "dexterity")}
    return None

def fix_action(action: dict) -> dict:
    """修复单个动作数据"""
    name = action.get("name", "")
    desc = action.get("description", "")

    # 如果name太长，尝试截取真正的动作名
    if len(name) > 50:
        # 尝试找到英文名部分
        match = re.search(r'(\w+Multiattack|\w+Bite|\w+Claw|长剑Longsword|短弓Shortbow|[\u4e00-\u9fa5]+\s*[A-Z][a-z]+)', name)
        if match:
            action["name"] = match.group(1).strip()

    # 从描述中提取 attack_bonus
    if action.get("attack_bonus") is None and ("近战武器攻击" in desc or "远程武器攻击" in desc):
        bonus = parse_attack_bonus(desc)
        if bonus is not None:
            action["attack_bonus"] = bonus
            action["action_category"] = "weapon_attack"
            action["attack_type"] = "melee" if "近战" in desc else "ranged"

    # 修复 damage 数据
    damage = action.get("damage")
    if damage is None or (isinstance(damage, dict) and not damage.get("dice")):
        parsed_damage = parse_damage(desc)
        if parsed_damage:
            action["damage"] = parsed_damage
    elif isinstance(damage, list):
        # 如果 damage 是 list，转换为 dict
        if damage and isinstance(damage[0], dict):
            first = damage[0]
            action["damage"] = {
                "dice": str(first.get("amount", 1)),
                "bonus": 0,
                "type": first.get("type", "piercing")
            }

    # 提取触及/射程
    if action.get("reach") is None:
        reach = parse_reach(desc)
        if reach:
            action["reach"] = reach

    if action.get("range") is None:
        range_val = parse_range(desc)
        if range_val:
            action["range"] = range_val

    # 提取豁免DC
    if action.get("save") is None:
        save = parse_save_dc(desc)
        if save:
            action["save"] = save
            if action.get("action_category") is None:
                action["action_category"] = "special"

    return action

def fix_monster(monster: dict) -> dict:
    """修复单个怪物的所有动作"""
    actions = monster.get("actions", [])
    fixed_actions = []

    for action in actions:
        # 跳过明显是垃圾数据的动作
        name = action.get("name", "")
        if len(name) > 100 or name.startswith("如果目标"):
            continue

        fixed_action = fix_action(action)
        fixed_actions.append(fixed_action)

    monster["actions"] = fixed_actions
    return monster

def main():
    # 读取原始数据
    with open(MONSTERS_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)

    monsters = data.get("monsters", [])
    fixed_count = 0

    for i, monster in enumerate(monsters):
        name = monster.get("name", "")
        original_actions = json.dumps(monster.get("actions", []))

        monsters[i] = fix_monster(monster)

        new_actions = json.dumps(monsters[i].get("actions", []))
        if original_actions != new_actions:
            fixed_count += 1
            print(f"修复: {name}")

    # 保存修复后的数据
    data["monsters"] = monsters
    with open(MONSTERS_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"\n共修复 {fixed_count} 个怪物")

if __name__ == "__main__":
    main()
