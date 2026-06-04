#!/usr/bin/env python3
"""
法术数据补全脚本 - 使用AI补全不完整的法术描述和提取结构化数据
"""

import json
import os
import re
import asyncio
import httpx
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / "backend" / ".env")

SPELLS_FILE = Path(__file__).parent.parent / "frontend/app/data/rules/spells.json"
OUTPUT_FILE = Path(__file__).parent.parent / "frontend/app/data/rules/spells_complete.json"
PROGRESS_FILE = Path(__file__).parent.parent / "frontend/app/data/rules/spells_progress.json"

CST_API_URL = os.getenv("CST_API_URL", "https://api.cstcloud.cn/v1")
CST_API_KEY = os.getenv("CST_API_KEY", "")

SYSTEM_PROMPT = """你是D&D 5E法术专家。请根据法术名称和现有描述，提供完整准确的法术信息。

要求：
1. 基于D&D 5E PHB/SRD的官方规则
2. 描述要完整，包含所有游戏机制信息
3. 严格按JSON格式输出，不要有额外文字"""

USER_PROMPT = """法术名称: {name} ({nameEn})
法术等级: {level}环{level_type}
学派: {school}
施法时间: {castingTime}
施法距离: {range}
成分: {components}
持续时间: {duration}
专注: {concentration}
现有描述（可能不完整）: {description}

请补全并提供完整的法术数据，严格按以下JSON格式输出:
{{
  "description": "完整的法术效果描述（中文，包含所有机制细节）",
  "damage": "伤害骰（如8d6，无则null）",
  "damageType": "伤害类型（火焰/冰霜/闪电/雷鸣/强酸/毒素/黯蚀/光耀/力场/精神，无则null）",
  "attackType": "melee_spell/ranged_spell/save/auto/utility",
  "saveType": "豁免属性（力量/敏捷/体质/智力/感知/魅力，无则null）",
  "saveEffect": "half/none/partial（豁免成功效果，无则null）",
  "healing": "治疗骰（如1d8+modifier，无则null）",
  "areaOfEffect": {{"type": "sphere/cone/cube/line/cylinder", "size": 20}}（无则null）,
  "conditions": ["造成的状态"]（无则null）,
  "atHigherLevels": "升环效果简述（无则null）",
  "cantripScaling": "戏法成长（如5级2d10，11级3d10，17级4d10，非戏法则null）"
}}"""


async def call_ai(prompt: str, system: str = SYSTEM_PROMPT) -> dict:
    """调用AI API"""
    async with httpx.AsyncClient(timeout=90.0) as client:
        try:
            response = await client.post(
                f"{CST_API_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {CST_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "deepseek-v3",
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.1,
                    "max_tokens": 1500
                }
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]

            # 提取JSON
            json_match = re.search(r'\{[\s\S]*\}', content)
            if json_match:
                return json.loads(json_match.group())
        except json.JSONDecodeError as e:
            print(f"  JSON解析失败: {e}")
        except Exception as e:
            print(f"  API调用失败: {e}")
    return None


def needs_completion(spell: dict) -> bool:
    """判断法术是否需要补全"""
    desc = spell.get("description", "")

    # 描述过短
    if len(desc) < 80:
        return True

    # 描述只有升环效果
    if desc.strip().startswith("升环施法") or desc.strip().startswith("使用"):
        return True

    # 描述只有戏法成长
    if desc.strip().startswith("你到达") or desc.strip().startswith("当你到达"):
        return True

    # 有伤害关键词但描述中没有伤害骰
    damage_types = ["伤害", "damage"]
    dice_pattern = r'\d+d\d+'
    if any(kw in desc for kw in damage_types) and not re.search(dice_pattern, desc):
        return True

    return False


async def complete_spell(spell: dict, semaphore: asyncio.Semaphore) -> dict:
    """补全单个法术"""
    async with semaphore:
        level = spell.get("level", 0)
        level_type = "（戏法）" if level == 0 else ""

        prompt = USER_PROMPT.format(
            name=spell.get("name", ""),
            nameEn=spell.get("nameEn", ""),
            level=level,
            level_type=level_type,
            school=spell.get("school", ""),
            castingTime=spell.get("castingTime", ""),
            range=spell.get("range", ""),
            components=", ".join(spell.get("components", [])),
            duration=spell.get("duration", ""),
            concentration=spell.get("concentration", False),
            description=spell.get("description", "")
        )

        result = await call_ai(prompt)
        if result:
            # 合并结果
            for key in ["description", "damage", "damageType", "attackType", "saveType",
                        "saveEffect", "healing", "areaOfEffect", "conditions",
                        "atHigherLevels", "cantripScaling"]:
                if result.get(key) is not None:
                    spell[key] = result[key]

            print(f"  ✓ {spell.get('name')}")
        else:
            print(f"  ✗ {spell.get('name')} (失败)")

        await asyncio.sleep(0.3)  # 限流
        return spell


async def main():
    print("=== 法术数据补全工具 ===\n")

    if not CST_API_KEY:
        print("错误: 未配置CST_API_KEY")
        return

    # 读取数据
    with open(SPELLS_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    spells = data.get("spells", [])
    print(f"读取法术: {len(spells)} 个\n")

    # 加载进度
    completed_ids = set()
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
            progress = json.load(f)
            completed_ids = set(progress.get("completed", []))
        print(f"已完成: {len(completed_ids)} 个\n")

    # 筛选需要补全的法术
    to_complete = []
    for spell in spells:
        spell_id = spell.get("id", "")
        if spell_id in completed_ids:
            continue
        if needs_completion(spell):
            to_complete.append(spell)

    print(f"需要补全: {len(to_complete)} 个\n")

    if not to_complete:
        print("所有法术已完成!")
        return

    # 批量处理
    semaphore = asyncio.Semaphore(3)  # 并发限制

    print("开始处理...")
    batch_size = 20  # 每批处理数量

    for i in range(0, len(to_complete), batch_size):
        batch = to_complete[i:i+batch_size]
        print(f"\n批次 {i//batch_size + 1}/{(len(to_complete)-1)//batch_size + 1}:")

        tasks = [complete_spell(s, semaphore) for s in batch]
        await asyncio.gather(*tasks)

        # 更新进度
        for spell in batch:
            completed_ids.add(spell.get("id", ""))

        with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
            json.dump({"completed": list(completed_ids)}, f, ensure_ascii=False)

        # 保存中间结果
        data["spells"] = spells
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        print(f"  进度已保存 ({len(completed_ids)}/{len(spells)})")

    print(f"\n✅ 完成! 已保存到: {OUTPUT_FILE}")


if __name__ == "__main__":
    asyncio.run(main())
