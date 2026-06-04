"""
从法术描述中提取受影响的生物类型 (D&D 5E creature types)
使用 Gemini AI (via yunwu.ai) 分析法术描述文本

用法: python backend/scripts/extract_spell_creature_types.py
"""

import json
import httpx
import asyncio
from pathlib import Path

API_URL = "https://yunwu.ai/v1/chat/completions"
API_KEY = "REDACTED_API_KEY"
# 备用 key，轮换使用
API_KEYS = [
    "REDACTED_API_KEY",
    "REDACTED_API_KEY",
]
MODEL = "gemini-3-flash-preview"

VALID_CREATURE_TYPES = {
    "aberration", "beast", "celestial", "construct", "dragon",
    "elemental", "fey", "fiend", "giant", "humanoid",
    "monstrosity", "ooze", "plant", "undead",
}

# 中文→英文映射，兜底 AI 返回中文的情况（含怪物系统和法术描述两种叫法）
CN_TO_EN = {
    "异怪": "aberration", "野兽": "beast", "天界生物": "celestial",
    "构装生物": "construct", "构装体": "construct",
    "龙类": "dragon", "元素生物": "elemental",
    "精类": "fey", "精类生物": "fey", "妖精": "fey",
    "邪魔": "fiend", "巨人": "giant",
    "人形生物": "humanoid", "人型生物": "humanoid",
    "怪兽": "monstrosity", "怪物": "monstrosity",
    "泥怪": "ooze", "软泥怪": "ooze",
    "植物": "plant", "不死生物": "undead",
}

SPELLS_PATH = Path(__file__).parent.parent.parent / "frontend/app/data/rules/spells.json"

SYSTEM_PROMPT = """从D&D法术描述中提取明确提到的生物类型。
只使用这些英文标识: aberration, beast, celestial, construct, dragon, elemental, fey, fiend, giant, humanoid, monstrosity, ooze, plant, undead
返回JSON数组，没有就返回[]。不要写其他文字。"""


_key_index = 0

async def extract_creature_types(client: httpx.AsyncClient, spell: dict) -> list[str]:
    global _key_index
    name = spell.get("name", "")
    desc = spell.get("description", "")

    for attempt in range(3):
        key = API_KEYS[_key_index % len(API_KEYS)]
        try:
            resp = await client.post(
                API_URL,
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={
                    "model": MODEL,
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": f"{name}: {desc[:500]}"},
                    ],
                    "temperature": 0,
                    "max_tokens": 1000,
                },
            )
            if resp.status_code == 429:
                _key_index += 1
                await asyncio.sleep(2)
                continue
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"].strip()
            if "[" in content and "]" in content:
                raw = json.loads(content[content.index("["):content.rindex("]") + 1])
                result = []
                for t in raw:
                    en = CN_TO_EN.get(t, t)
                    if en in VALID_CREATURE_TYPES:
                        result.append(en)
                return list(dict.fromkeys(result))
            return []
        except Exception as e:
            if attempt < 2:
                _key_index += 1
                await asyncio.sleep(2)
            else:
                print(f"  [ERROR] {name}: {e}")
    return []


async def main():
    with open(SPELLS_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    spells = data.get("spells", data) if isinstance(data, dict) else data
    print(f"共 {len(spells)} 个法术\n")

    # 关键词预筛
    keywords = [
        "异怪", "天界", "元素生物", "精类", "妖精", "邪魔", "不死生物",
        "野兽", "构装", "龙类", "巨人", "人型生物", "软泥", "植物生物",
        "aberration", "celestial", "elemental", "fey", "fiend", "undead",
        "beast", "construct", "dragon", "giant", "humanoid", "ooze", "monstrosity",
    ]
    candidates = [s for s in spells if any(kw in (s.get("description", "") + " " + s.get("descriptionEn", "")) for kw in keywords)]
    print(f"初筛 {len(candidates)} 个候选法术\n")

    results = {}
    timeout = httpx.Timeout(connect=10, read=120, write=10, pool=10)
    async with httpx.AsyncClient(timeout=timeout) as client:
        # 每批3个，串行批次
        for i in range(0, len(candidates), 3):
            batch = candidates[i:i + 3]
            tasks = [extract_creature_types(client, s) for s in batch]
            batch_results = await asyncio.gather(*tasks)
            for s, types in zip(batch, batch_results):
                if types:
                    results[s["id"]] = types
                    print(f"  ✓ {s['name']}: {types}")
                else:
                    print(f"    {s['name']}: []")
            if i + 3 < len(candidates):
                await asyncio.sleep(0.3)

    print(f"\n共 {len(results)} 个法术有特定生物类型\n")

    # 写入
    for s in spells:
        if s["id"] in results:
            s["affectedCreatureTypes"] = results[s["id"]]

    if isinstance(data, dict) and "spells" in data:
        data["spells"] = spells
    with open(SPELLS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"已写入 {SPELLS_PATH}")
    print("\n=== 汇总 ===")
    for sid, types in sorted(results.items()):
        name = next((s["name"] for s in spells if s["id"] == sid), sid)
        print(f"  {name}: {types}")


if __name__ == "__main__":
    asyncio.run(main())
