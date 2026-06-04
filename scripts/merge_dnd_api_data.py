#!/usr/bin/env python3
"""
从 D&D 5E API 获取数据并合并到本地数据文件
https://www.dnd5eapi.co/api/2014/
"""

import json
import requests
from pathlib import Path
from typing import Any

API_BASE = "https://www.dnd5eapi.co/api/2014"

# 状态的中文名和图标映射
CONDITION_CN = {
    "blinded": {"name": "目盲", "icon": "🙈", "color": "#374151"},
    "charmed": {"name": "魅惑", "icon": "💕", "color": "#ec4899"},
    "deafened": {"name": "耳聋", "icon": "🔇", "color": "#6b7280"},
    "exhaustion": {"name": "力竭", "icon": "😫", "color": "#78716c"},
    "frightened": {"name": "恐惧", "icon": "😨", "color": "#7c3aed"},
    "grappled": {"name": "擒抱", "icon": "🔗", "color": "#78716c"},
    "incapacitated": {"name": "失能", "icon": "💫", "color": "#9ca3af"},
    "invisible": {"name": "隐形", "icon": "👻", "color": "#94a3b8"},
    "paralyzed": {"name": "麻痹", "icon": "⚡", "color": "#fbbf24"},
    "petrified": {"name": "石化", "icon": "🗿", "color": "#78716c"},
    "poisoned": {"name": "中毒", "icon": "☠️", "color": "#16a34a"},
    "prone": {"name": "倒地", "icon": "⬇️", "color": "#92400e"},
    "restrained": {"name": "束缚", "icon": "⛓️", "color": "#64748b"},
    "stunned": {"name": "震慑", "icon": "⭐", "color": "#eab308"},
    "unconscious": {"name": "昏迷", "icon": "💤", "color": "#1f2937"},
}

# 状态的结构化修饰符 (根据D&D 5E规则)
CONDITION_MODIFIERS = {
    "blinded": [
        {"type": "auto_fail", "target": "ability_check", "condition": {"requires_sight": True}},
        {"type": "disadvantage", "target": "attack_roll"},
        {"type": "advantage", "target": "incoming_attack"},
    ],
    "charmed": [
        {"type": "cannot_attack", "target": "charmer"},
        {"type": "advantage", "target": "social_check", "condition": {"from": "charmer"}},
    ],
    "deafened": [
        {"type": "auto_fail", "target": "ability_check", "condition": {"requires_hearing": True}},
    ],
    "frightened": [
        {"type": "disadvantage", "target": "ability_check", "condition": {"source_visible": True}},
        {"type": "disadvantage", "target": "attack_roll", "condition": {"source_visible": True}},
        {"type": "cannot_approach", "target": "fear_source"},
    ],
    "grappled": [
        {"type": "speed_zero", "target": "movement"},
    ],
    "incapacitated": [
        {"type": "cannot_act", "target": "action"},
        {"type": "cannot_act", "target": "reaction"},
    ],
    "invisible": [
        {"type": "advantage", "target": "attack_roll"},
        {"type": "disadvantage", "target": "incoming_attack"},
    ],
    "paralyzed": [
        {"type": "incapacitated", "target": "self"},
        {"type": "speed_zero", "target": "movement"},
        {"type": "auto_fail", "target": "saving_throw", "condition": {"ability": ["strength", "dexterity"]}},
        {"type": "advantage", "target": "incoming_attack"},
        {"type": "auto_crit", "target": "incoming_attack", "condition": {"range": "5ft"}},
    ],
    "petrified": [
        {"type": "incapacitated", "target": "self"},
        {"type": "speed_zero", "target": "movement"},
        {"type": "auto_fail", "target": "saving_throw", "condition": {"ability": ["strength", "dexterity"]}},
        {"type": "advantage", "target": "incoming_attack"},
        {"type": "resistance", "target": "damage_taken", "condition": {"damage_type": "all"}},
        {"type": "immunity", "target": "damage_taken", "condition": {"damage_type": ["poison"]}},
        {"type": "immunity", "target": "condition", "condition": {"condition": ["poisoned"]}},
    ],
    "poisoned": [
        {"type": "disadvantage", "target": "attack_roll"},
        {"type": "disadvantage", "target": "ability_check"},
    ],
    "prone": [
        {"type": "disadvantage", "target": "attack_roll"},
        {"type": "advantage", "target": "incoming_attack", "condition": {"range": "5ft"}},
        {"type": "disadvantage", "target": "incoming_attack", "condition": {"range": "ranged"}},
    ],
    "restrained": [
        {"type": "speed_zero", "target": "movement"},
        {"type": "disadvantage", "target": "attack_roll"},
        {"type": "advantage", "target": "incoming_attack"},
        {"type": "disadvantage", "target": "saving_throw", "condition": {"ability": "dexterity"}},
    ],
    "stunned": [
        {"type": "incapacitated", "target": "self"},
        {"type": "speed_zero", "target": "movement"},  # 实际上是不能移动，但速度不变
        {"type": "auto_fail", "target": "saving_throw", "condition": {"ability": ["strength", "dexterity"]}},
        {"type": "advantage", "target": "incoming_attack"},
    ],
    "unconscious": [
        {"type": "incapacitated", "target": "self"},
        {"type": "prone", "target": "self"},
        {"type": "speed_zero", "target": "movement"},
        {"type": "auto_fail", "target": "saving_throw", "condition": {"ability": ["strength", "dexterity"]}},
        {"type": "advantage", "target": "incoming_attack"},
        {"type": "auto_crit", "target": "incoming_attack", "condition": {"range": "5ft"}},
    ],
}

# 力竭等级效果
EXHAUSTION_LEVELS = {
    1: {"effect": "属性检定劣势", "modifiers": [{"type": "disadvantage", "target": "ability_check"}]},
    2: {"effect": "速度减半", "modifiers": [{"type": "speed_halved", "target": "movement"}]},
    3: {"effect": "攻击和豁免劣势", "modifiers": [
        {"type": "disadvantage", "target": "attack_roll"},
        {"type": "disadvantage", "target": "saving_throw"}
    ]},
    4: {"effect": "HP上限减半", "modifiers": [{"type": "hp_max_halved", "target": "hp"}]},
    5: {"effect": "速度为0", "modifiers": [{"type": "speed_zero", "target": "movement"}]},
    6: {"effect": "死亡", "modifiers": [{"type": "death", "target": "self"}]},
}


def fetch_api(endpoint: str) -> dict:
    """从API获取数据"""
    url = f"{API_BASE}/{endpoint}"
    print(f"  Fetching: {url}")
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_all_conditions() -> list[dict]:
    """获取所有状态数据"""
    print("\n[1/3] 获取状态(Conditions)数据...")
    conditions = []

    # 获取列表
    data = fetch_api("conditions")

    for item in data["results"]:
        detail = fetch_api(f"conditions/{item['index']}")

        cond_id = detail["index"]
        cn_info = CONDITION_CN.get(cond_id, {"name": detail["name"], "icon": "❓", "color": "#666"})

        condition = {
            "id": cond_id,
            "name": cn_info["name"],
            "name_en": detail["name"],
            "category": "condition",
            "icon": cn_info["icon"],
            "color": cn_info["color"],
            "description": "\n".join(detail.get("desc", [])),
            "description_en": "\n".join(detail.get("desc", [])),
            "action_type": "free",
            "can_toggle": True,
            "modifiers": CONDITION_MODIFIERS.get(cond_id, []),
        }

        # 力竭特殊处理
        if cond_id == "exhaustion":
            condition["levels"] = EXHAUSTION_LEVELS

        conditions.append(condition)

    print(f"  获取了 {len(conditions)} 个状态")
    return conditions


def fetch_all_monsters() -> list[dict]:
    """获取所有怪物数据（仅获取我们缺失的字段）"""
    print("\n[2/3] 获取怪物(Monsters)补充数据...")
    monsters = {}

    # 获取列表
    data = fetch_api("monsters")
    total = data["count"]
    print(f"  API共有 {total} 个怪物，开始获取详情...")

    for i, item in enumerate(data["results"]):
        if (i + 1) % 50 == 0:
            print(f"  进度: {i+1}/{total}")

        detail = fetch_api(f"monsters/{item['index']}")

        # 只提取我们缺失的字段
        monster = {
            "id": detail["index"],
            "name_en": detail["name"],
            # 伤害相关
            "damage_vulnerabilities": detail.get("damage_vulnerabilities", []),
            "damage_resistances": detail.get("damage_resistances", []),
            "damage_immunities": detail.get("damage_immunities", []),
            "condition_immunities": [c["index"] for c in detail.get("condition_immunities", [])],
            # 熟练项
            "proficiencies": [
                {
                    "name": p["proficiency"]["name"],
                    "value": p["value"]
                } for p in detail.get("proficiencies", [])
            ],
            # 传奇动作
            "legendary_actions": detail.get("legendary_actions", []),
            # 传奇抗性（从special_abilities中提取）
            "legendary_resistance": None,
        }

        # 提取传奇抗性
        for ability in detail.get("special_abilities", []):
            if "Legendary Resistance" in ability.get("name", ""):
                monster["legendary_resistance"] = {
                    "times": ability.get("usage", {}).get("times", 3),
                    "description": ability.get("desc", "")
                }
                break

        monsters[detail["index"]] = monster

    print(f"  获取了 {len(monsters)} 个怪物的补充数据")
    return monsters


def fetch_all_features() -> list[dict]:
    """获取所有职业特性数据"""
    print("\n[3/3] 获取职业特性(Features)数据...")
    features = []

    # 获取列表
    data = fetch_api("features")
    total = data["count"]
    print(f"  API共有 {total} 个特性，开始获取详情...")

    for i, item in enumerate(data["results"]):
        if (i + 1) % 50 == 0:
            print(f"  进度: {i+1}/{total}")

        detail = fetch_api(f"features/{item['index']}")

        feature = {
            "id": detail["index"],
            "name_en": detail["name"],
            "class": detail.get("class", {}).get("index"),
            "subclass": detail.get("subclass", {}).get("index") if detail.get("subclass") else None,
            "level": detail.get("level"),
            "description_en": "\n".join(detail.get("desc", [])),
            "prerequisites": [p.get("type") for p in detail.get("prerequisites", [])],
        }
        features.append(feature)

    print(f"  获取了 {len(features)} 个职业特性")
    return features


def save_json(data: Any, filepath: Path):
    """保存JSON文件"""
    filepath.parent.mkdir(parents=True, exist_ok=True)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"  已保存: {filepath}")


def main():
    print("=" * 60)
    print("D&D 5E API 数据合并工具")
    print("=" * 60)

    output_dir = Path(__file__).parent.parent / "backend" / "app" / "data" / "dnd_api"

    # 1. 获取状态数据
    conditions = fetch_all_conditions()
    save_json({"conditions": conditions}, output_dir / "conditions.json")

    # 2. 获取怪物补充数据
    monsters = fetch_all_monsters()
    save_json({"monsters": monsters}, output_dir / "monsters_supplement.json")

    # 3. 获取职业特性数据
    features = fetch_all_features()
    save_json({"features": features}, output_dir / "features.json")

    print("\n" + "=" * 60)
    print("完成! 数据已保存到:", output_dir)
    print("=" * 60)

    # 打印统计
    print("\n统计:")
    print(f"  - 状态: {len(conditions)} 个")
    print(f"  - 怪物补充: {len(monsters)} 个")
    print(f"  - 职业特性: {len(features)} 个")


if __name__ == "__main__":
    main()
