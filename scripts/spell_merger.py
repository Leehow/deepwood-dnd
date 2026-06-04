#!/usr/bin/env python3
"""
从5e-database API获取结构化法术数据并合并到现有数据
"""

import json
import asyncio
import httpx
from pathlib import Path

SPELLS_FILE = Path(__file__).parent.parent / "frontend/app/data/rules/spells.json"
OUTPUT_FILE = Path(__file__).parent.parent / "frontend/app/data/rules/spells_merged.json"
API_BASE = "https://www.dnd5eapi.co/api/2014/spells"

# 英文名到中文id的映射（处理名称差异）
NAME_MAPPING = {
    # SRD简称 -> 我们的id（带发明者名）
    "acid arrow": "melfs_acid_arrow",
    "arcane hand": "bigbys_hand",
    "arcane sword": "mordenkainens_sword",
    "black tentacles": "evards_black_tentacles",
    "faithful hound": "mordenkainens_faithful_hound",
    "floating disk": "tensers_floating_disk",
    "freezing sphere": "otilukes_freezing_sphere",
    "hideous laughter": "tashas_hideous_laughter",
    "instant summons": "drawmijs_instant_summons",
    "irresistible dance": "ottos_irresistible_dance",
    "magnificent mansion": "mordenkainens_magnificent_mansion",
    "private sanctum": "mordenkainens_private_sanctum",
    "resilient sphere": "otilukes_resilient_sphere",
    "secret chest": "leomunds_secret_chest",
    "telepathic bond": "rarys_telepathic_bond",
    "tiny hut": "leomunds_tiny_hut",
    # 名称差异
    "fire bolt": "firebolt",
    "grasping vine": "grasping_vine",
    "augury": "augury",
    "divination": "divination",
    # 其他常用法术
    "cure wounds": "cure_wounds",
    "magic missile": "magic_missile",
    "ray of frost": "ray_of_frost",
    "chill touch": "chill_touch",
    "eldritch blast": "eldritch_blast",
    "healing word": "healing_word",
    "acid splash": "acid_splash",
    "sacred flame": "sacred_flame",
    "spare the dying": "spare_the_dying",
    "shocking grasp": "shocking_grasp",
    "mage hand": "mage_hand",
    "minor illusion": "minor_illusion",
    "poison spray": "poison_spray",
    "produce flame": "produce_flame",
    "thorn whip": "thorn_whip",
    "vicious mockery": "vicious_mockery",
}

# 伤害类型翻译
DAMAGE_TYPE_CN = {
    "fire": "火焰",
    "cold": "冰霜",
    "lightning": "闪电",
    "thunder": "雷鸣",
    "acid": "强酸",
    "poison": "毒素",
    "necrotic": "黯蚀",
    "radiant": "光耀",
    "force": "力场",
    "psychic": "精神",
    "piercing": "穿刺",
    "slashing": "挥砍",
    "bludgeoning": "钝击",
}

# 豁免类型翻译
SAVE_TYPE_CN = {
    "str": "力量", "strength": "力量",
    "dex": "敏捷", "dexterity": "敏捷",
    "con": "体质", "constitution": "体质",
    "int": "智力", "intelligence": "智力",
    "wis": "感知", "wisdom": "感知",
    "cha": "魅力", "charisma": "魅力",
}


async def fetch_all_spells():
    """获取所有法术列表"""
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(API_BASE, follow_redirects=True)
        response.raise_for_status()
        data = response.json()
        return data.get("results", [])


async def fetch_spell_detail(client: httpx.AsyncClient, index: str, semaphore: asyncio.Semaphore):
    """获取单个法术详情"""
    async with semaphore:
        try:
            response = await client.get(f"{API_BASE}/{index}", follow_redirects=True)
            response.raise_for_status()
            await asyncio.sleep(0.1)  # 限流
            return response.json()
        except Exception as e:
            print(f"  获取失败: {index} - {e}")
            return None


def normalize_id(name: str) -> str:
    """将英文名转换为id格式"""
    # 先检查映射
    name_lower = name.lower()
    if name_lower in NAME_MAPPING:
        return NAME_MAPPING[name_lower]

    # 转换为id格式：小写，空格替换为下划线
    return name.lower().replace(" ", "_").replace("'", "").replace("/", "_")


def extract_structured_data(api_spell: dict) -> dict:
    """从API数据提取结构化字段"""
    result = {}

    # 伤害
    damage_info = api_spell.get("damage", {})
    if damage_info:
        slot_damage = damage_info.get("damage_at_slot_level", {})
        char_damage = damage_info.get("damage_at_character_level", {})

        if slot_damage:
            # 获取基础伤害（最低等级）
            min_level = min(int(k) for k in slot_damage.keys())
            result["damage"] = slot_damage[str(min_level)]
            result["damageAtSlotLevel"] = slot_damage
        elif char_damage:
            # 戏法按角色等级成长
            min_level = min(int(k) for k in char_damage.keys())
            result["damage"] = char_damage[str(min_level)]
            result["damageAtCharacterLevel"] = char_damage

        # 伤害类型
        damage_type = damage_info.get("damage_type", {})
        if damage_type:
            type_index = damage_type.get("index", "")
            result["damageType"] = type_index
            result["damageTypeCn"] = DAMAGE_TYPE_CN.get(type_index, type_index)

    # 治疗
    heal_info = api_spell.get("heal_at_slot_level", {})
    if heal_info:
        min_level = min(int(k) for k in heal_info.keys())
        result["healing"] = heal_info[str(min_level)]
        result["healingAtSlotLevel"] = heal_info

    # 豁免
    dc_info = api_spell.get("dc", {})
    if dc_info:
        dc_type = dc_info.get("dc_type", {}).get("index", "")
        result["saveType"] = dc_type
        result["saveTypeCn"] = SAVE_TYPE_CN.get(dc_type, dc_type)
        result["saveEffect"] = dc_info.get("dc_success", "none")
        result["attackType"] = "save"

    # 攻击类型（如果没有豁免）
    if not dc_info and api_spell.get("attack_type"):
        attack = api_spell.get("attack_type", "")
        if attack == "ranged":
            result["attackType"] = "ranged_spell"
        elif attack == "melee":
            result["attackType"] = "melee_spell"

    # 效果区域
    aoe = api_spell.get("area_of_effect", {})
    if aoe:
        result["areaOfEffect"] = {
            "type": aoe.get("type", ""),
            "size": aoe.get("size", 0)
        }

    # 升环效果
    higher = api_spell.get("higher_level", [])
    if higher:
        result["atHigherLevelsEn"] = " ".join(higher)

    # 完整英文描述
    desc = api_spell.get("desc", [])
    if desc:
        result["descriptionEn"] = " ".join(desc)

    return result


async def main():
    print("=== 5e-database 法术数据合并工具 ===\n")

    # 读取现有数据
    with open(SPELLS_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    spells = data.get("spells", [])
    print(f"现有法术: {len(spells)} 个\n")

    # 建立id索引
    spell_by_id = {s.get("id", ""): s for s in spells}
    spell_by_name_en = {s.get("nameEn", "").lower(): s for s in spells}

    # 获取API法术列表
    print("获取5e API法术列表...")
    api_spells = await fetch_all_spells()
    print(f"API法术: {len(api_spells)} 个\n")

    # 批量获取详情
    print("获取法术详情...")
    semaphore = asyncio.Semaphore(5)

    async with httpx.AsyncClient(timeout=30.0) as client:
        tasks = [fetch_spell_detail(client, s["index"], semaphore) for s in api_spells]
        api_details = await asyncio.gather(*tasks)

    # 过滤失败的
    api_details = [d for d in api_details if d]
    print(f"获取成功: {len(api_details)} 个\n")

    # 合并数据
    print("合并结构化数据...")
    merged_count = 0
    not_found = []

    for api_spell in api_details:
        name_en = api_spell.get("name", "")
        index = api_spell.get("index", "")

        # 尝试匹配现有法术
        spell_id = normalize_id(name_en)
        our_spell = spell_by_id.get(spell_id) or spell_by_name_en.get(name_en.lower())

        if our_spell:
            # 提取结构化数据
            structured = extract_structured_data(api_spell)

            # 合并（不覆盖已有的中文数据）
            for key, value in structured.items():
                if key not in our_spell or not our_spell[key]:
                    our_spell[key] = value

            merged_count += 1
        else:
            not_found.append(name_en)

    print(f"成功合并: {merged_count} 个")
    print(f"未匹配: {len(not_found)} 个")

    if not_found[:10]:
        print("\n未匹配的法术示例:")
        for name in not_found[:10]:
            print(f"  - {name}")

    # 统计结果
    print("\n=== 合并后统计 ===")
    has_damage = sum(1 for s in spells if s.get("damage"))
    has_save = sum(1 for s in spells if s.get("saveType"))
    has_healing = sum(1 for s in spells if s.get("healing"))
    has_aoe = sum(1 for s in spells if s.get("areaOfEffect"))
    has_desc_en = sum(1 for s in spells if s.get("descriptionEn"))

    print(f"  damage: {has_damage}")
    print(f"  saveType: {has_save}")
    print(f"  healing: {has_healing}")
    print(f"  areaOfEffect: {has_aoe}")
    print(f"  descriptionEn: {has_desc_en}")

    # 保存
    data["spells"] = spells
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"\n✅ 已保存到: {OUTPUT_FILE}")


if __name__ == "__main__":
    asyncio.run(main())
