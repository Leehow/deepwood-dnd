#!/usr/bin/env python3
"""
法术数据增强脚本
1. 修复基础字段问题 (concentration, materials, ritual)
2. 使用AI提取结构化数据 (damage, saveType, healing, atHigherLevels)
"""

import json
import os
import sys
import re
import asyncio
import httpx
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv

# 加载环境变量
load_dotenv(Path(__file__).parent.parent / "backend" / ".env")

SPELLS_FILE = Path(__file__).parent.parent / "frontend/app/data/rules/spells.json"
OUTPUT_FILE = Path(__file__).parent.parent / "frontend/app/data/rules/spells_enhanced.json"

# D&D 5E SRD 法术材料数据（补全缺失的）
MISSING_MATERIALS = {
    "触发术": "一撮硫�ite及些许蝙蝠毛皮和一根浸油的棍子",
    "预置幻影": "一小滴沥青和一片蜘蛛网"
}

# 修正concentration的法术
FIX_CONCENTRATION = {
    "动植物定位术": False,  # 这个法术确实不需要专注，duration中的专注是描述效果
    "守卫刻文": False,      # 不需要专注
    "疫病术": False,        # 不需要专注
    "群体暗示术": False,    # 不需要专注，效果持续24小时
}

# AI配置
CST_API_URL = os.getenv("CST_API_URL", "https://api.cstcloud.cn/v1")
CST_API_KEY = os.getenv("CST_API_KEY", "")

EXTRACTION_PROMPT = """你是D&D 5E法术数据提取专家。请从以下法术信息中提取结构化数据。

法术名称: {name}
法术等级: {level}环{level_desc}
原始描述: {description}

请提取以下信息（如果法术没有该属性则返回null）:

1. damage: 基础伤害骰（如"8d6"，戏法随等级成长的写初始值如"1d10"）
2. damageType: 伤害类型（火焰/冰霜/闪电/雷鸣/强酸/毒素/黯蚀/光耀/力场/精神/穿刺/挥砍/钝击）
3. attackType: "melee_spell"(近战法术攻击) / "ranged_spell"(远程法术攻击) / "save"(豁免) / "auto"(自动生效) / "utility"(效用法术)
4. saveType: 豁免属性（力量/敏捷/体质/智力/感知/魅力）
5. saveEffect: 豁免成功效果（"half"伤害减半 / "none"无效果 / "partial"部分效果）
6. healing: 治疗骰（如"2d8+modifier"）
7. areaOfEffect: 效果区域对象，包含type(sphere球/cone锥/cube立方/line直线/cylinder圆柱)和size(尺为单位)
8. conditions: 造成的状态数组（恐惧/魅惑/中毒/麻痹/石化/目盲/耳聋/昏迷/倒地/束缚/擒抱/隐形/震慑/失能）
9. atHigherLevels: 升环效果描述（简洁，如"+1d6伤害每环"）
10. cantripScaling: 戏法成长描述（如"5级2d10，11级3d10，17级4d10"）
11. fullDescription: 完整的法术效果描述（如果原描述不完整，请补全；如果完整则原样返回）

请严格以JSON格式返回，不要有额外文字:
{
  "damage": "8d6",
  "damageType": "火焰",
  "attackType": "save",
  "saveType": "敏捷",
  "saveEffect": "half",
  "healing": null,
  "areaOfEffect": {"type": "sphere", "size": 20},
  "conditions": [],
  "atHigherLevels": "+1d6伤害每环",
  "cantripScaling": null,
  "fullDescription": "..."
}"""


async def call_ai(prompt: str) -> Optional[dict]:
    """调用AI API提取结构化数据"""
    if not CST_API_KEY:
        print("警告: 未配置CST_API_KEY，跳过AI增强")
        return None

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(
                f"{CST_API_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {CST_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "deepseek-v3",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.1,
                    "max_tokens": 1000
                }
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]

            # 提取JSON
            json_match = re.search(r'\{[\s\S]*\}', content)
            if json_match:
                return json.loads(json_match.group())
        except Exception as e:
            print(f"AI调用失败: {e}")
    return None


def fix_basic_issues(spells: list) -> list:
    """修复基础字段问题"""
    fixed_count = 0

    for spell in spells:
        name = spell.get("name", "")

        # 1. 补全缺失的materials
        if name in MISSING_MATERIALS and not spell.get("materials"):
            spell["materials"] = MISSING_MATERIALS[name]
            fixed_count += 1
            print(f"  ✓ 补全materials: {name}")

        # 2. 修复concentration (基于duration判断)
        duration = spell.get("duration", "")
        if "专注" in duration and spell.get("concentration") is not True:
            # 检查是否真的需要专注（duration格式通常是"专注, 至多X分钟"）
            if duration.startswith("专注"):
                spell["concentration"] = True
                fixed_count += 1
                print(f"  ✓ 修复concentration: {name}")

        # 3. 确保ritual字段存在
        if "ritual" not in spell:
            spell["ritual"] = False

        # 4. 确保concentration字段存在
        if "concentration" not in spell:
            spell["concentration"] = False

    print(f"\n基础修复完成: {fixed_count} 处")
    return spells


async def enhance_spell_with_ai(spell: dict) -> dict:
    """使用AI增强单个法术数据"""
    level = spell.get("level", 0)
    level_desc = "（戏法）" if level == 0 else ""

    prompt = EXTRACTION_PROMPT.format(
        name=spell.get("name", ""),
        level=level,
        level_desc=level_desc,
        description=spell.get("description", "")
    )

    result = await call_ai(prompt)
    if result:
        # 合并AI提取的数据
        for key in ["damage", "damageType", "attackType", "saveType", "saveEffect",
                    "healing", "areaOfEffect", "conditions", "atHigherLevels",
                    "cantripScaling"]:
            if result.get(key):
                spell[key] = result[key]

        # 如果fullDescription更完整，替换原description
        full_desc = result.get("fullDescription", "")
        if full_desc and len(full_desc) > len(spell.get("description", "")):
            spell["description"] = full_desc

    return spell


async def enhance_all_spells(spells: list, batch_size: int = 5) -> list:
    """批量增强所有法术"""
    # 筛选需要增强的法术（描述中有伤害/豁免/治疗关键词，或描述过短）
    needs_enhancement = []
    keywords = ["d4", "d6", "d8", "d10", "d12", "豁免", "治疗", "恢复生命"]

    for spell in spells:
        desc = spell.get("description", "")
        # 需要增强的条件：有关键词但无结构化字段，或描述过短
        has_keywords = any(kw in desc for kw in keywords)
        missing_struct = not spell.get("damage") and not spell.get("saveType") and not spell.get("healing")
        short_desc = len(desc) < 80

        if (has_keywords and missing_struct) or short_desc:
            needs_enhancement.append(spell)

    print(f"\n需要AI增强的法术: {len(needs_enhancement)} 个")

    if not CST_API_KEY:
        print("未配置API Key，跳过AI增强")
        return spells

    # 批量处理
    enhanced = 0
    for i in range(0, len(needs_enhancement), batch_size):
        batch = needs_enhancement[i:i+batch_size]
        tasks = [enhance_spell_with_ai(s) for s in batch]
        await asyncio.gather(*tasks)
        enhanced += len(batch)
        print(f"  已处理: {enhanced}/{len(needs_enhancement)}")
        await asyncio.sleep(0.5)  # 避免API限流

    return spells


def analyze_results(spells: list):
    """分析增强后的结果"""
    print("\n=== 增强后统计 ===")

    has_damage = sum(1 for s in spells if s.get("damage"))
    has_save = sum(1 for s in spells if s.get("saveType"))
    has_healing = sum(1 for s in spells if s.get("healing"))
    has_area = sum(1 for s in spells if s.get("areaOfEffect"))
    has_conditions = sum(1 for s in spells if s.get("conditions"))
    has_higher = sum(1 for s in spells if s.get("atHigherLevels"))

    print(f"  damage: {has_damage}")
    print(f"  saveType: {has_save}")
    print(f"  healing: {has_healing}")
    print(f"  areaOfEffect: {has_area}")
    print(f"  conditions: {has_conditions}")
    print(f"  atHigherLevels: {has_higher}")


async def main():
    print("=== 法术数据增强工具 ===\n")

    # 读取法术数据
    with open(SPELLS_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    spells = data.get("spells", [])
    print(f"读取法术: {len(spells)} 个\n")

    # 步骤1: 修复基础问题
    print("步骤1: 修复基础字段...")
    spells = fix_basic_issues(spells)

    # 步骤2: AI增强
    print("\n步骤2: AI结构化增强...")
    if "--ai" in sys.argv:
        spells = await enhance_all_spells(spells)
        analyze_results(spells)
    else:
        print("  (跳过AI增强，使用 --ai 参数启用)")

    # 保存结果
    data["spells"] = spells
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"\n✅ 已保存到: {OUTPUT_FILE}")


if __name__ == "__main__":
    asyncio.run(main())
