"""
处理剩余失败的怪物 - 逐个动作解析
"""
import json
import asyncio
import httpx
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

MONSTERS_JSON_PATH = Path(__file__).parent.parent.parent / "frontend/public/dnd-platform/configs/npc/monsters.json"
FAILED_IDS = ["behir", "beholder", "death_tyrant", "ancient_bronze_dragon_超巨型龙类,守序善良", "adult_bronze_dragon", "adult_silver_dragon"]

SINGLE_ACTION_PROMPT = """解析这个D&D 5E怪物动作，提取结构化数据。

怪物: {monster_name}
动作名: {action_name}
描述: {description}

返回JSON（只添加有值的字段）:
```json
{{
  "name": "动作名",
  "description": "原描述",
  "action_category": "weapon_attack/multiattack/special_attack/spell/other",
  "name_en": "英文名（如果有）",
  "attack_type": "melee/ranged/melee_or_ranged",
  "attack_bonus": 数字,
  "reach": "5尺",
  "range": "30/120尺",
  "damage": {{"dice": "2d6", "bonus": 3, "average": 10, "type": "穿刺"}},
  "extra_damage": {{"dice": "1d6", "type": "火焰"}},
  "save": {{"ability": "体质", "dc": 15, "success_effect": "...", "fail_effect": "..."}},
  "area": {{"shape": "锥形", "size": "30尺"}},
  "usage": {{"type": "recharge", "value": "5-6"}},
  "multiattack_actions": ["爪击", "啮咬"]
}}
```

只返回JSON，不要其他内容。"""


async def load_config():
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
    from sqlalchemy.orm import sessionmaker
    from app.core.config import settings
    from app.services.ai_model_service import ai_model_service

    engine = create_async_engine(settings.DATABASE_URL)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as db:
        usage_params = await ai_model_service.get_usage_params(db, "module_extract_monsters")
        config = usage_params.config
        return {"api_url": config.api_url, "api_key": config.api_key, "model": config.model_name}


def extract_json(text):
    import re
    text = text.strip()
    try:
        return json.loads(text)
    except:
        pass
    match = re.search(r'```(?:json)?\s*([\s\S]*?)```', text)
    if match:
        try:
            return json.loads(match.group(1))
        except:
            pass
    match = re.search(r'\{[\s\S]*\}', text)
    if match:
        try:
            return json.loads(match.group(0))
        except:
            pass
    return None


async def parse_single_action(monster_name, action, config):
    prompt = SINGLE_ACTION_PROMPT.format(
        monster_name=monster_name,
        action_name=action.get('name', ''),
        description=action.get('description', '')
    )

    endpoint = config["api_url"].rstrip('/') + '/chat/completions'

    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(
                    endpoint,
                    json={
                        "model": config["model"],
                        "messages": [
                            {"role": "system", "content": "你是D&D 5E数据解析专家，只返回JSON。"},
                            {"role": "user", "content": prompt}
                        ],
                        "max_tokens": 1000,
                        "temperature": 0.1
                    },
                    headers={"Authorization": f"Bearer {config['api_key']}", "Content-Type": "application/json"},
                )

            if resp.status_code == 200:
                content = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")
                parsed = extract_json(content)
                if parsed and parsed.get('action_category'):
                    return parsed
        except Exception as e:
            print(f"    Error: {e}")
        await asyncio.sleep(1)

    return None


async def main():
    print("加载配置...")
    config = await load_config()
    print(f"使用模型: {config['model']}")

    with open(MONSTERS_JSON_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)

    monsters = data.get('monsters', [])

    for monster in monsters:
        if monster.get('id') not in FAILED_IDS:
            continue

        monster_name = monster.get('name', monster.get('id'))
        actions = monster.get('actions', [])

        print(f"\n处理: {monster_name} ({len(actions)} 个动作)")

        new_actions = []
        for i, action in enumerate(actions):
            if action.get('action_category'):
                new_actions.append(action)
                print(f"  [{i+1}/{len(actions)}] {action.get('name')} - 已解析，跳过")
                continue

            print(f"  [{i+1}/{len(actions)}] {action.get('name')} - 解析中...", end=" ")
            parsed = await parse_single_action(monster_name, action, config)

            if parsed:
                new_actions.append(parsed)
                print(f"✓ {parsed.get('action_category')}")
            else:
                new_actions.append(action)
                print("✗ 失败")

            await asyncio.sleep(0.5)

        monster['actions'] = new_actions

        # 每个怪物处理完保存一次
        with open(MONSTERS_JSON_PATH, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"  已保存 {monster_name}")

    # 统计
    total = sum(len(m.get('actions', [])) for m in monsters)
    parsed = sum(1 for m in monsters for a in m.get('actions', []) if a.get('action_category'))
    print(f"\n完成! 总动作: {total}, 已解析: {parsed} ({100*parsed/total:.1f}%)")


if __name__ == "__main__":
    asyncio.run(main())
