"""
从法术描述中提取未数值化的机械效果 (buff/debuff)
使用 Gemini AI 分析，批量处理以减少 API 调用次数

用法: python backend/scripts/extract_spell_buffs.py
"""

import json
import re
import httpx
import asyncio
from pathlib import Path

API_URL = "https://yunwu.ai/v1/chat/completions"
API_KEY = "REDACTED_API_KEY"
MODEL = "gemini-3-flash-preview"

SPELLS_PATH = Path(__file__).parent.parent.parent / "frontend/app/data/rules/spells.json"

SYSTEM_PROMPT = """你是D&D 5E规则专家。从法术描述中提取结构化的机械效果数据。

对每个法术，提取以下字段（没有的不写）：

- acBonus: AC加值，整数。如虔诚护盾+2，护盾术+5
- attackBonus: 攻击检定加值，整数。如魔化武器+1
- damageBonus: 额外伤害骰，字符串。如"1d4 radiant"
- tempHp: 临时生命值，字符串。如"5"、"1d4+4"、"level*5"(等级×5)
- resistances: 伤害抗性数组。用英文伤害类型: fire, cold, lightning, thunder, acid, poison, necrotic, radiant, force, psychic, bludgeoning, piercing, slashing, nonmagical_physical(非魔法物理)
- immunities: 免疫(伤害类型或状态)数组。如 ["poison", "frightened", "charmed", "disease"]
- vulnerabilities: 易伤数组。如 ["fire"]
- speedBonus: 速度加值(尺)，整数。如10
- advantageOn: 获得优势的检定类型数组。如 ["all_saves", "wisdom_saves", "attack_rolls", "strength_checks", "death_saves"]
- disadvantageOn: 受到劣势的检定类型数组。同上格式
- grantDisadvantage: 使敌人获得劣势的类型数组。如 ["attack_rolls_against"](敌人攻击你时劣势)

规则：
1. 只提取描述中明确写出的数值效果，不要推测
2. 非魔法钝击/穿刺/挥砍抗性统一写 nonmagical_physical
3. 如果效果有条件（如"对某类生物"），在值后面用括号注明
4. 临时生命值如果是每回合获得的，写成 "CHA_mod/round"（用属性缩写+_mod）
5. 升环效果不要提取，那已经有 atHigherLevels 字段

返回JSON对象，key是法术id，value是效果对象。没有机械效果的法术不要包含。
示例：
{
  "shield_of_faith": {"acBonus": 2},
  "shield": {"acBonus": 5},
  "armor_of_agathys": {"tempHp": "5"},
  "heroism": {"immunities": ["frightened"], "tempHp": "CHA_mod/round"}
}

只返回JSON，不要其他文字。"""


def find_candidates(spells):
    """找出描述中可能有未数值化效果的法术"""
    patterns = [
        r'AC.*[+＋]\s*\d+|[+＋]\s*\d+.*AC|护甲等级.*[+＋增获]',
        r'攻击检定.*[+＋]\s*\d+|攻击掷骰.*优势',
        r'豁免.*[+＋]\s*\d+|豁免.*优势',
        r'抗性|抗力|resistance',
        r'免疫|immunity|immune',
        r'易伤|vulnerability|vulnerable',
        r'速度.*[+＋增]\s*\d+|移动速度.*增|额外.*\d+尺',
        r'临时生命|temporary hit point',
        r'优势|advantage',
        r'劣势|disadvantage',
    ]
    result = []
    for s in spells:
        desc = s.get('description', '')
        if any(re.search(p, desc) for p in patterns):
            result.append(s)
    return result


async def extract_batch(client, batch):
    """对一批法术调用AI提取效果"""
    spells_text = ""
    for s in batch:
        spells_text += f"\n---\nid: {s['id']}\nname: {s['name']}\ndescription: {s['description'][:600]}\n"

    try:
        resp = await client.post(
            API_URL,
            headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
            json={
                "model": MODEL,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"请提取以下法术的机械效果:\n{spells_text}"},
                ],
                "temperature": 0,
                "max_tokens": 4000,
            },
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"].strip()
        # 提取JSON
        if "{" in content:
            json_str = content[content.index("{"):content.rindex("}") + 1]
            return json.loads(json_str)
        return {}
    except Exception as e:
        names = [s['name'] for s in batch]
        print(f"  [ERROR] batch {names}: {e}")
        return {}


# 效果字段白名单
VALID_KEYS = {
    "acBonus", "attackBonus", "damageBonus", "tempHp",
    "resistances", "immunities", "vulnerabilities",
    "speedBonus", "advantageOn", "disadvantageOn", "grantDisadvantage",
}


def clean_result(effects: dict) -> dict:
    """清理AI返回的结果，只保留有效字段"""
    cleaned = {}
    for k, v in effects.items():
        if k in VALID_KEYS and v is not None:
            if k in ("acBonus", "attackBonus", "speedBonus") and isinstance(v, (int, float)):
                cleaned[k] = int(v)
            elif k in ("damageBonus", "tempHp") and isinstance(v, str) and v:
                cleaned[k] = v
            elif k in ("resistances", "immunities", "vulnerabilities", "advantageOn", "disadvantageOn", "grantDisadvantage"):
                if isinstance(v, list) and v:
                    cleaned[k] = v
    return cleaned


async def main():
    with open(SPELLS_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    spells = data.get("spells", data) if isinstance(data, dict) else data

    candidates = find_candidates(spells)
    print(f"共 {len(spells)} 个法术，候选 {len(candidates)} 个\n")

    all_results = {}
    timeout = httpx.Timeout(connect=10, read=180, write=10, pool=10)
    async with httpx.AsyncClient(timeout=timeout) as client:
        # 每批 5 个法术
        batch_size = 5
        for i in range(0, len(candidates), batch_size):
            batch = candidates[i:i + batch_size]
            batch_names = [s['name'] for s in batch]
            print(f"  处理 [{i+1}-{min(i+batch_size, len(candidates))}/{len(candidates)}]: {batch_names}")

            result = await extract_batch(client, batch)
            for spell_id, effects in result.items():
                cleaned = clean_result(effects)
                if cleaned:
                    all_results[spell_id] = cleaned
                    spell_name = next((s['name'] for s in batch if s['id'] == spell_id), spell_id)
                    print(f"    ✓ {spell_name}: {cleaned}")

            if i + batch_size < len(candidates):
                await asyncio.sleep(1)

    print(f"\n共提取 {len(all_results)} 个法术的机械效果\n")

    # 写入 spells.json — 合并到每个法术的 buffEffects 字段
    modified = 0
    for s in spells:
        if s["id"] in all_results:
            s["buffEffects"] = all_results[s["id"]]
            modified += 1

    if isinstance(data, dict) and "spells" in data:
        data["spells"] = spells
    with open(SPELLS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"已更新 {modified} 个法术，写入 {SPELLS_PATH}")

    # 汇总
    print("\n=== 按效果类型汇总 ===")
    type_counts = {}
    for sid, eff in all_results.items():
        for k in eff:
            type_counts[k] = type_counts.get(k, 0) + 1
    for k, c in sorted(type_counts.items(), key=lambda x: -x[1]):
        print(f"  {k}: {c}")


if __name__ == "__main__":
    asyncio.run(main())
