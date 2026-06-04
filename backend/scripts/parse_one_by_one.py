"""
逐个动作解析 - 更稳定版本
"""
import json
import asyncio
import httpx
from pathlib import Path

MONSTERS_JSON_PATH = Path(__file__).parent.parent.parent / "frontend/public/dnd-platform/configs/npc/monsters.json"
FAILED_IDS = ["behir", "beholder", "death_tyrant", "ancient_bronze_dragon_超巨型龙类,守序善良", "adult_bronze_dragon", "adult_silver_dragon"]

API_URL = "https://yunwu.ai/v1/chat/completions"
API_KEY = "REDACTED_API_KEY"
MODEL = "gemini-3-flash-preview"

PROMPT = """你是D&D规则专家。解析这个怪物动作:

怪物: {monster}
动作: {name}
描述: {desc}

返回JSON:
{{"name":"{name}","description":"原描述","action_category":"类型","attack_bonus":数字或null,"damage":{{"dice":"骰子","type":"类型"}}或null}}

action_category必须是: multiattack, weapon_attack, special_attack, spell, other 之一
只返回JSON，不要解释。"""


def extract_json(text):
    import re
    for pattern in [r'\{[^{}]*\}', r'```json\s*(.*?)```', r'```(.*?)```']:
        match = re.search(pattern, text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1) if '```' in pattern else match.group(0))
            except:
                continue
    try:
        return json.loads(text.strip())
    except:
        return None


async def call_api(prompt, retries=5):
    for i in range(retries):
        try:
            async with httpx.AsyncClient(timeout=90.0) as client:
                resp = await client.post(
                    API_URL,
                    json={"model": MODEL, "messages": [{"role": "user", "content": prompt}], "max_tokens": 4000, "temperature": 0},
                    headers={"Authorization": f"Bearer {API_KEY}"},
                )
                if resp.status_code == 200:
                    content = resp.json()["choices"][0]["message"]["content"]
                    result = extract_json(content)
                    if result and result.get("action_category"):
                        return result
                print(f"    重试 {i+1}/{retries}...", end=" ", flush=True)
        except Exception as e:
            print(f"    错误: {str(e)[:30]}...", end=" ", flush=True)
        await asyncio.sleep(3 * (i + 1))  # 递增等待
    return None


async def main():
    print("开始解析...")

    with open(MONSTERS_JSON_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)

    monsters = data.get('monsters', [])

    for monster in monsters:
        if monster.get('id') not in FAILED_IDS:
            continue

        name = monster.get('name')
        actions = monster.get('actions', [])
        unparsed = [(i, a) for i, a in enumerate(actions) if not a.get('action_category')]

        if not unparsed:
            print(f"\n{name}: 全部已解析")
            continue

        print(f"\n{name}: {len(unparsed)} 个待解析")

        for idx, action in unparsed:
            action_name = action.get('name', '未知')
            desc = action.get('description', '')[:200]

            print(f"  {action_name}...", end=" ", flush=True)

            prompt = PROMPT.format(monster=name, name=action_name, desc=desc)
            result = await call_api(prompt)

            if result:
                # 保留原描述
                result['description'] = action.get('description', '')
                monster['actions'][idx] = result
                print(f"✓ {result.get('action_category')}")

                # 每个成功后保存
                with open(MONSTERS_JSON_PATH, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
            else:
                print("✗")

            await asyncio.sleep(2)

    # 最终统计
    total = sum(len(m.get('actions', [])) for m in monsters)
    parsed = sum(1 for m in monsters for a in m.get('actions', []) if a.get('action_category'))
    print(f"\n完成: {parsed}/{total} ({100*parsed/total:.1f}%)")


if __name__ == "__main__":
    asyncio.run(main())
