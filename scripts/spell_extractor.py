#!/usr/bin/env python3
"""
法术数据结构化提取脚本 v2
从中文和英文描述中提取结构化数据，不覆盖已有字段
"""

import json
import re
from pathlib import Path
from collections import defaultdict

SPELLS_FILE = Path(__file__).parent.parent / "frontend/app/data/rules/spells_merged.json"
OUTPUT_FILE = Path(__file__).parent.parent / "frontend/app/data/rules/spells_final.json"

# 伤害类型映射
DAMAGE_TYPES = {
    "火焰": "fire", "冰霜": "cold", "闪电": "lightning", "雷鸣": "thunder",
    "强酸": "acid", "毒素": "poison", "黯蚀": "necrotic", "光耀": "radiant",
    "力场": "force", "精神": "psychic", "穿刺": "piercing", "挥砍": "slashing",
    "钝击": "bludgeoning",
    # 英文
    "fire": "fire", "cold": "cold", "lightning": "lightning", "thunder": "thunder",
    "acid": "acid", "poison": "poison", "necrotic": "necrotic", "radiant": "radiant",
    "force": "force", "psychic": "psychic", "piercing": "piercing", "slashing": "slashing",
    "bludgeoning": "bludgeoning",
}

DAMAGE_TYPE_CN = {
    "fire": "火焰", "cold": "冰霜", "lightning": "闪电", "thunder": "雷鸣",
    "acid": "强酸", "poison": "毒素", "necrotic": "黯蚀", "radiant": "光耀",
    "force": "力场", "psychic": "精神", "piercing": "穿刺", "slashing": "挥砍",
    "bludgeoning": "钝击",
}

# 豁免类型映射
SAVE_TYPES = {
    "力量": "strength", "敏捷": "dexterity", "体质": "constitution",
    "智力": "intelligence", "感知": "wisdom", "魅力": "charisma",
    # 英文
    "strength": "strength", "dexterity": "dexterity", "constitution": "constitution",
    "intelligence": "intelligence", "wisdom": "wisdom", "charisma": "charisma",
    "str": "strength", "dex": "dexterity", "con": "constitution",
    "int": "intelligence", "wis": "wisdom", "cha": "charisma",
}

SAVE_TYPE_CN = {
    "strength": "力量", "dexterity": "敏捷", "constitution": "体质",
    "intelligence": "智力", "wisdom": "感知", "charisma": "魅力",
}

CONDITIONS = [
    "恐惧", "魅惑", "中毒", "麻痹", "石化", "目盲", "耳聋",
    "昏迷", "倒地", "束缚", "擒抱", "隐形", "震慑", "失能",
    # 英文
    "frightened", "charmed", "poisoned", "paralyzed", "petrified",
    "blinded", "deafened", "unconscious", "prone", "restrained",
    "grappled", "invisible", "stunned", "incapacitated"
]


def extract_damage_en(desc: str) -> tuple:
    """从英文描述提取伤害"""
    # 匹配: Xd6 fire damage, Xd6 + modifier damage
    patterns = [
        r'(\d+d\d+(?:\s*\+\s*\w+)?)\s+(fire|cold|lightning|thunder|acid|poison|necrotic|radiant|force|psychic|piercing|slashing|bludgeoning)\s+damage',
        r'takes?\s+(\d+d\d+(?:\s*\+\s*\w+)?)\s+(fire|cold|lightning|thunder|acid|poison|necrotic|radiant|force|psychic|piercing|slashing|bludgeoning)\s+damage',
        r'(\d+d\d+(?:\s*\+\s*\w+)?)\s+damage',
    ]
    for pattern in patterns:
        match = re.search(pattern, desc, re.IGNORECASE)
        if match:
            damage = match.group(1).replace(" ", "")
            damage_type = match.group(2).lower() if len(match.groups()) > 1 else None
            return damage, damage_type
    return None, None


def extract_save_en(desc: str) -> tuple:
    """从英文描述提取豁免"""
    patterns = [
        r'(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+saving\s+throw',
        r'make\s+a\s+(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+save',
    ]
    for pattern in patterns:
        match = re.search(pattern, desc, re.IGNORECASE)
        if match:
            save_type = match.group(1).lower()
            # 检查效果
            if "half as much damage" in desc.lower() or "half damage" in desc.lower():
                return save_type, "half"
            return save_type, "none"
    return None, None


def extract_healing_en(desc: str) -> str:
    """从英文描述提取治疗"""
    patterns = [
        r'regains?\s+(\d+d\d+(?:\s*\+\s*\w+)?)\s+hit\s+points',
        r'heals?\s+(\d+d\d+(?:\s*\+\s*\w+)?)\s+hit\s+points',
    ]
    for pattern in patterns:
        match = re.search(pattern, desc, re.IGNORECASE)
        if match:
            return match.group(1).replace(" ", "")
    return None


def extract_area_en(desc: str) -> dict:
    """从英文描述提取效果区域"""
    patterns = [
        (r'(\d+)-foot[- ]radius\s+sphere', 'sphere'),
        (r'(\d+)-foot\s+cone', 'cone'),
        (r'(\d+)-foot\s+cube', 'cube'),
        (r'(\d+)-foot[- ]long\s+line', 'line'),
        (r'(\d+)-foot[- ]radius.*cylinder', 'cylinder'),
    ]
    for pattern, area_type in patterns:
        match = re.search(pattern, desc, re.IGNORECASE)
        if match:
            return {"type": area_type, "size": int(match.group(1))}
    return None


def extract_attack_type(desc_cn: str, desc_en: str) -> str:
    """提取攻击类型"""
    # 中文
    if "近战法术攻击" in desc_cn:
        return "melee_spell"
    if "远程法术攻击" in desc_cn or "法术攻击" in desc_cn:
        return "ranged_spell"

    # 英文
    if "melee spell attack" in desc_en.lower():
        return "melee_spell"
    if "ranged spell attack" in desc_en.lower() or "spell attack" in desc_en.lower():
        return "ranged_spell"

    # 豁免类
    for save_cn in ["力量", "敏捷", "体质", "智力", "感知", "魅力"]:
        if f"{save_cn}豁免" in desc_cn:
            return "save"
    if "saving throw" in desc_en.lower():
        return "save"

    return None


def extract_conditions(desc_cn: str, desc_en: str) -> list:
    """提取造成的状态"""
    found = set()

    # 中文
    cn_conditions = ["恐惧", "魅惑", "中毒", "麻痹", "石化", "目盲", "耳聋",
                     "昏迷", "倒地", "束缚", "擒抱", "隐形", "震慑", "失能"]
    for cond in cn_conditions:
        if cond in desc_cn:
            found.add(cond)

    # 英文到中文映射
    en_to_cn = {
        "frightened": "恐惧", "charmed": "魅惑", "poisoned": "中毒",
        "paralyzed": "麻痹", "petrified": "石化", "blinded": "目盲",
        "deafened": "耳聋", "unconscious": "昏迷", "prone": "倒地",
        "restrained": "束缚", "grappled": "擒抱", "invisible": "隐形",
        "stunned": "震慑", "incapacitated": "失能"
    }
    for en, cn in en_to_cn.items():
        if en in desc_en.lower():
            found.add(cn)

    return list(found) if found else None


def extract_higher_levels(desc_cn: str, desc_en: str) -> str:
    """提取升环施法效果"""
    # 中文
    patterns_cn = [
        r'升环施法(?:效应)?[。：:]\s*(.+?)(?:\n|$)',
        r'使用\s*\d+\s*环或更高法术位施展(?:该法术)?时[，,]\s*(.+?)(?:\n|$)',
    ]
    for pattern in patterns_cn:
        match = re.search(pattern, desc_cn)
        if match:
            return match.group(1).strip()[:100]

    # 英文
    patterns_en = [
        r'At Higher Levels[.:]\s*(.+?)(?:\n|$)',
        r'using a spell slot of (\d+)(?:st|nd|rd|th) level or higher[,.]?\s*(.+?)(?:\n|$)',
    ]
    for pattern in patterns_en:
        match = re.search(pattern, desc_en, re.IGNORECASE)
        if match:
            return match.group(1).strip()[:100] if len(match.groups()) == 1 else match.group(2).strip()[:100]

    return None


def extract_cantrip_scaling(desc_cn: str, desc_en: str, level: int) -> str:
    """提取戏法成长"""
    if level != 0:
        return None

    # 中文
    pattern_cn = r'(?:你)?(?:到达|达到)\s*(\d+)\s*级时.+?(?:增加|变为)\s*(\d+d\d+)'
    matches = re.findall(pattern_cn, desc_cn)
    if matches:
        return ", ".join(f"{lvl}级{dice}" for lvl, dice in matches)

    # 英文
    pattern_en = r'at (?:(\d+)(?:st|nd|rd|th) level|higher levels).+?(\d+d\d+)'
    matches = re.findall(pattern_en, desc_en, re.IGNORECASE)
    if matches:
        return ", ".join(f"{lvl}级{dice}" for lvl, dice in matches if lvl)

    return None


def process_spells(spells: list) -> list:
    """处理所有法术"""
    stats = defaultdict(int)

    for spell in spells:
        desc_cn = spell.get("description", "")
        desc_en = spell.get("descriptionEn", "")
        level = spell.get("level", 0)

        # 从中英文描述提取伤害（不覆盖已有）
        if not spell.get("damage"):
            # 先尝试中文
            damage_cn, dtype_cn = None, None
            patterns = [
                r'(\d+d\d+(?:\s*[+\-]\s*\d+)?)\s*(?:点)?([火冰闪雷强毒黯光力精穿挥钝][焰霜电鸣酸素蚀耀场神刺砍击]?)伤害',
            ]
            for pattern in patterns:
                match = re.search(pattern, desc_cn)
                if match:
                    damage_cn = match.group(1).replace(" ", "")
                    dtype_cn = match.group(2) if match.group(2) else None
                    break

            # 再尝试英文
            damage_en, dtype_en = extract_damage_en(desc_en)

            if damage_cn:
                spell["damage"] = damage_cn
                if dtype_cn and dtype_cn in DAMAGE_TYPES:
                    spell["damageType"] = DAMAGE_TYPES[dtype_cn]
                    spell["damageTypeCn"] = dtype_cn
                stats["damage"] += 1
            elif damage_en:
                spell["damage"] = damage_en
                if dtype_en:
                    spell["damageType"] = dtype_en
                    spell["damageTypeCn"] = DAMAGE_TYPE_CN.get(dtype_en, dtype_en)
                stats["damage"] += 1

        # 提取豁免（不覆盖已有）
        if not spell.get("saveType"):
            # 中文
            for save_cn, save_en in list(SAVE_TYPES.items())[:6]:
                if f"{save_cn}豁免" in desc_cn:
                    spell["saveType"] = save_en
                    spell["saveTypeCn"] = save_cn
                    if "伤害减半" in desc_cn:
                        spell["saveEffect"] = "half"
                    stats["saveType"] += 1
                    break
            else:
                # 英文
                save_type, save_effect = extract_save_en(desc_en)
                if save_type:
                    spell["saveType"] = save_type
                    spell["saveTypeCn"] = SAVE_TYPE_CN.get(save_type, save_type)
                    spell["saveEffect"] = save_effect
                    stats["saveType"] += 1

        # 提取治疗（不覆盖已有）
        if not spell.get("healing"):
            # 中文
            patterns = [
                r'恢复\s*(\d+d\d+(?:\s*[+\-]\s*[\w]+)?)\s*(?:点)?生命值',
            ]
            for pattern in patterns:
                match = re.search(pattern, desc_cn)
                if match:
                    spell["healing"] = match.group(1).replace(" ", "")
                    stats["healing"] += 1
                    break
            else:
                # 英文
                healing = extract_healing_en(desc_en)
                if healing:
                    spell["healing"] = healing
                    stats["healing"] += 1

        # 提取效果区域（不覆盖已有）
        if not spell.get("areaOfEffect"):
            # 中文
            patterns = [
                (r'(\d+)\s*尺半径(?:的)?球', 'sphere'),
                (r'(\d+)\s*尺(?:的)?锥形', 'cone'),
                (r'(\d+)\s*尺(?:的)?立方', 'cube'),
                (r'(\d+)\s*尺(?:长|宽)?(?:的)?直线', 'line'),
            ]
            for pattern, area_type in patterns:
                match = re.search(pattern, desc_cn)
                if match:
                    spell["areaOfEffect"] = {"type": area_type, "size": int(match.group(1))}
                    stats["areaOfEffect"] += 1
                    break
            else:
                # 英文
                area = extract_area_en(desc_en)
                if area:
                    spell["areaOfEffect"] = area
                    stats["areaOfEffect"] += 1

        # 提取状态（不覆盖已有）
        if not spell.get("conditions"):
            conditions = extract_conditions(desc_cn, desc_en)
            if conditions:
                spell["conditions"] = conditions
                stats["conditions"] += 1

        # 提取攻击类型（不覆盖已有）
        if not spell.get("attackType"):
            attack_type = extract_attack_type(desc_cn, desc_en)
            if attack_type:
                spell["attackType"] = attack_type
                stats["attackType"] += 1

        # 提取升环效果（不覆盖已有）
        if not spell.get("atHigherLevels") and not spell.get("atHigherLevelsEn"):
            higher = extract_higher_levels(desc_cn, desc_en)
            if higher:
                spell["atHigherLevels"] = higher
                stats["atHigherLevels"] += 1

        # 提取戏法成长（不覆盖已有）
        if not spell.get("cantripScaling") and not spell.get("damageAtCharacterLevel"):
            scaling = extract_cantrip_scaling(desc_cn, desc_en, level)
            if scaling:
                spell["cantripScaling"] = scaling
                stats["cantripScaling"] += 1

    return spells, stats


def main():
    print("=== 法术数据结构化提取 v2 ===\n")

    # 读取数据
    with open(SPELLS_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    spells = data.get("spells", [])
    print(f"读取法术: {len(spells)} 个\n")

    # 处理
    spells, stats = process_spells(spells)

    # 新增提取统计
    print("=== 新增提取 ===")
    for field, count in sorted(stats.items(), key=lambda x: -x[1]):
        print(f"  {field}: +{count}")

    # 最终统计
    print("\n=== 最终统计 ===")
    fields = {
        "damage": "伤害骰",
        "damageType": "伤害类型",
        "saveType": "豁免类型",
        "healing": "治疗骰",
        "areaOfEffect": "效果区域",
        "conditions": "状态效果",
        "attackType": "攻击类型",
    }
    for field, desc in fields.items():
        count = sum(1 for s in spells if s.get(field))
        pct = count / len(spells) * 100
        print(f"  {desc}: {count} ({pct:.1f}%)")

    # 保存
    data["spells"] = spells
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"\n✅ 已保存到: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
