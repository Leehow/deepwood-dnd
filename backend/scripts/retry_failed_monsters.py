"""
重试解析失败的怪物动作，逐个处理以提高成功率
"""
import json
import asyncio
import httpx
import logging
from pathlib import Path
from typing import Dict, Any, List

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

MONSTERS_JSON_PATH = Path(__file__).parent.parent.parent / "frontend/public/dnd-platform/configs/npc/monsters.json"

PARSE_SINGLE_PROMPT = """你是D&D 5E数据解析专家。请解析以下怪物的动作，提取结构化数据。

## 怪物: {monster_name}
## 动作列表:
{actions_json}

## 任务
对每个动作，提取以下信息（只添加有值的字段）：

1. **action_category**: "multiattack"/"weapon_attack"/"special_attack"/"spell"/"other"
2. **name_en**: 英文名称
3. **attack_type**: "melee"/"ranged"/"melee_or_ranged" (仅weapon_attack)
4. **attack_bonus**: 命中加值数字 (仅weapon_attack)
5. **reach**: 触及距离，如"5尺"
6. **range**: 射程，如"30/120尺"
7. **damage**: {{"dice": "2d6", "bonus": 3, "average": 10, "type": "挥砍"}}
8. **extra_damage**: 额外伤害对象
9. **save**: {{"ability": "体质", "dc": 15, "success_effect": "...", "fail_effect": "..."}}
10. **area**: {{"shape": "锥形", "size": "30尺"}}
11. **usage**: {{"type": "recharge", "value": "5-6"}} 或 {{"type": "per_day", "value": 3}}
12. **multiattack_actions**: ["爪击", "啮咬"] (仅multiattack)

## 输出格式
直接返回JSON数组，保留原有name和description字段，添加解析出的新字段：
```json
[
  {{"name": "...", "description": "...", "action_category": "...", ...}},
  ...
]
```

只返回JSON数组，不要其他内容。"""


async def load_config():
    """从数据库加载AI配置"""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))

    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
    from sqlalchemy.orm import sessionmaker
    from app.core.config import settings
    from app.services.ai_model_service import ai_model_service

    engine = create_async_engine(settings.DATABASE_URL)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as db:
        usage_params = await ai_model_service.get_usage_params(db, "module_extract_monsters")
        config = usage_params.config
        return {
            "api_url": config.api_url,
            "api_key": config.api_key,
            "model": config.model_name
        }


def extract_json_from_response(text: str) -> Any:
    """从LLM响应中提取JSON"""
    import re
    text = text.strip()

    # 直接解析
    try:
        return json.loads(text)
    except:
        pass

    # 从代码块提取
    code_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', text)
    if code_match:
        try:
            return json.loads(code_match.group(1))
        except:
            pass

    # 找JSON数组
    bracket_match = re.search(r'\[[\s\S]*\]', text)
    if bracket_match:
        try:
            return json.loads(bracket_match.group(0))
        except:
            pass

    return None


async def parse_single_monster(monster: Dict, config: Dict, max_retries: int = 3) -> List[Dict]:
    """解析单个怪物的动作"""
    actions = monster.get('actions', [])
    if not actions:
        return []

    monster_name = monster.get('name', monster.get('id', 'unknown'))
    actions_json = json.dumps(actions, ensure_ascii=False, indent=2)
    prompt = PARSE_SINGLE_PROMPT.format(monster_name=monster_name, actions_json=actions_json)

    endpoint = config["api_url"].rstrip('/')
    if not endpoint.endswith('/chat/completions'):
        endpoint = endpoint + '/chat/completions'

    for attempt in range(max_retries):
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(
                    endpoint,
                    json={
                        "model": config["model"],
                        "messages": [
                            {"role": "system", "content": "你是D&D 5E数据解析专家，只返回JSON格式数据。"},
                            {"role": "user", "content": prompt}
                        ],
                        "max_tokens": 4000,
                        "temperature": 0.1
                    },
                    headers={
                        "Authorization": f"Bearer {config['api_key']}",
                        "Content-Type": "application/json",
                    },
                )

            if resp.status_code != 200:
                logger.warning(f"API error: {resp.status_code}")
                await asyncio.sleep(2 ** attempt)
                continue

            data = resp.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

            if not content:
                continue

            parsed = extract_json_from_response(content)
            if parsed and isinstance(parsed, list):
                # 验证解析结果
                valid = all(isinstance(a, dict) and a.get('action_category') for a in parsed)
                if valid:
                    return parsed

            logger.warning(f"解析失败 (尝试 {attempt + 1})")

        except Exception as e:
            logger.error(f"API调用失败: {e}")
            await asyncio.sleep(2 ** attempt)

    return actions  # 失败返回原数据


async def main():
    logger.info("加载AI配置...")
    config = await load_config()
    logger.info(f"使用模型: {config['model']}")

    # 读取JSON
    logger.info(f"读取 {MONSTERS_JSON_PATH}")
    with open(MONSTERS_JSON_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)

    monsters = data.get('monsters', [])

    # 找出未解析的怪物
    to_retry = []
    for i, m in enumerate(monsters):
        actions = m.get('actions', [])
        if actions and not all(a.get('action_category') for a in actions):
            to_retry.append((i, m))

    logger.info(f"需要重试: {len(to_retry)} 个怪物")

    if not to_retry:
        logger.info("所有怪物已解析完成")
        return

    success_count = 0
    fail_list = []

    for idx, (monster_idx, monster) in enumerate(to_retry):
        monster_id = monster.get('id', str(monster_idx))
        logger.info(f"[{idx+1}/{len(to_retry)}] 处理: {monster.get('name', monster_id)}")

        parsed_actions = await parse_single_monster(monster, config)

        # 检查是否成功
        if all(a.get('action_category') for a in parsed_actions):
            monsters[monster_idx]['actions'] = parsed_actions
            success_count += 1
            logger.info(f"  ✓ 成功")
        else:
            fail_list.append(monster_id)
            logger.warning(f"  ✗ 失败")

        # 每10个保存一次
        if (idx + 1) % 10 == 0:
            with open(MONSTERS_JSON_PATH, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            logger.info(f"  已保存进度")

        await asyncio.sleep(1)  # 避免限流

    # 最终保存
    with open(MONSTERS_JSON_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # 保存失败列表
    if fail_list:
        fail_path = Path(__file__).parent / "still_failed_monsters.json"
        with open(fail_path, 'w', encoding='utf-8') as f:
            json.dump(fail_list, f, ensure_ascii=False, indent=2)
        logger.info(f"失败列表已保存: {fail_path}")

    logger.info(f"\n=== 重试完成 ===")
    logger.info(f"成功: {success_count}/{len(to_retry)}")
    logger.info(f"失败: {len(fail_list)}")


if __name__ == "__main__":
    asyncio.run(main())
