"""
批量解析 monsters.json 中的 actions，使用 LLM 提取结构化数据
优化版本：每批次合并处理，减少 API 调用次数
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


PARSE_ACTIONS_PROMPT = """你是D&D 5E数据解析专家。请解析以下怪物动作，提取结构化数据。

## 输入数据
这是多个怪物的动作列表，格式为 {{monster_id: [actions]}}:
{actions_json}

## 任务
对每个动作，分析其描述文本，提取以下信息：

1. **action_category** 动作分类:
   - "multiattack": 多重攻击
   - "weapon_attack": 武器攻击（有命中加值和伤害）
   - "special_attack": 特殊攻击（吐息、凝视等，通常有豁免DC）
   - "spell": 施法
   - "other": 其他

2. **name_en**: 英文名称

3. **attack_type**: "melee"/"ranged"/"melee_or_ranged" (仅weapon_attack)

4. **attack_bonus**: 命中加值数字 (仅weapon_attack)

5. **reach**: 触及距离 (仅近战)

6. **range**: 射程 (仅远程)

7. **damage**: {{dice, bonus, average, type}}

8. **extra_damage**: 额外伤害

9. **save**: {{ability, dc, success_effect, fail_effect}}

10. **area**: {{shape, size}}

11. **usage**: {{type: "recharge"/"per_day", value}}

12. **multiattack_actions**: 引用的动作名列表 (仅multiattack)

## 输出格式
返回相同结构的JSON，每个动作添加上述字段（只添加有值的字段）:
```json
{{
  "monster_id_1": [
    {{"name": "...", "description": "...", "action_category": "...", ...}}
  ],
  "monster_id_2": [...]
}}
```

只返回JSON，不要其他内容。"""


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

    # 尝试直接解析
    try:
        return json.loads(text)
    except:
        pass

    # 尝试从代码块提取
    code_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', text)
    if code_match:
        try:
            return json.loads(code_match.group(1))
        except:
            pass

    # 尝试找JSON对象
    brace_match = re.search(r'\{[\s\S]*\}', text)
    if brace_match:
        try:
            return json.loads(brace_match.group(0))
        except:
            pass

    return None


async def parse_batch_with_llm(batch_data: Dict[str, List[Dict]], config: Dict, max_retries: int = 3) -> Dict[str, List[Dict]]:
    """使用LLM解析一批怪物的动作"""
    if not batch_data:
        return {}

    actions_json = json.dumps(batch_data, ensure_ascii=False, indent=2)
    prompt = PARSE_ACTIONS_PROMPT.format(actions_json=actions_json)

    endpoint = config["api_url"].rstrip('/')
    if not endpoint.endswith('/chat/completions'):
        endpoint = endpoint + '/chat/completions'

    for attempt in range(max_retries):
        try:
            async with httpx.AsyncClient(timeout=180.0) as client:
                resp = await client.post(
                    endpoint,
                    json={
                        "model": config["model"],
                        "messages": [
                            {"role": "system", "content": "你是D&D 5E数据解析专家，只返回JSON格式数据。"},
                            {"role": "user", "content": prompt}
                        ],
                        "max_tokens": 8000,
                        "temperature": 0.1
                    },
                    headers={
                        "Authorization": f"Bearer {config['api_key']}",
                        "Content-Type": "application/json",
                    },
                )

            if resp.status_code != 200:
                logger.error(f"API error: {resp.status_code}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                continue

            data = resp.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

            if not content:
                logger.warning("Empty response")
                continue

            parsed = extract_json_from_response(content)
            if parsed and isinstance(parsed, dict):
                return parsed

            logger.warning(f"Failed to parse response (attempt {attempt + 1})")

        except Exception as e:
            logger.error(f"API call failed: {e}")
            if attempt < max_retries - 1:
                await asyncio.sleep(2 ** attempt)

    return batch_data  # 失败时返回原数据


async def main():
    # 加载配置
    logger.info("加载AI配置...")
    config = await load_config()
    logger.info(f"使用模型: {config['model']}")

    # 读取JSON
    logger.info(f"读取 {MONSTERS_JSON_PATH}")
    with open(MONSTERS_JSON_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)

    monsters = data.get('monsters', [])

    # 过滤出有actions且未解析的怪物
    to_parse = []
    for i, m in enumerate(monsters):
        actions = m.get('actions', [])
        if actions and not any(a.get('action_category') for a in actions):
            to_parse.append((i, m))

    logger.info(f"共 {len(monsters)} 个怪物，需要解析 {len(to_parse)} 个")

    if not to_parse:
        logger.info("所有怪物已解析完成")
        return

    # 分批处理，每批5个怪物
    batch_size = 5
    total_batches = (len(to_parse) + batch_size - 1) // batch_size

    for batch_num in range(total_batches):
        start = batch_num * batch_size
        end = min(start + batch_size, len(to_parse))
        batch = to_parse[start:end]

        logger.info(f"处理批次 {batch_num + 1}/{total_batches} ({len(batch)} 个怪物)")

        # 构建批次数据
        batch_data = {}
        idx_map = {}
        for idx, m in batch:
            monster_id = m.get('id', str(idx))
            batch_data[monster_id] = m.get('actions', [])
            idx_map[monster_id] = idx

        # 调用LLM解析
        parsed_batch = await parse_batch_with_llm(batch_data, config)

        # 更新数据
        for monster_id, parsed_actions in parsed_batch.items():
            if monster_id in idx_map:
                monsters[idx_map[monster_id]]['actions'] = parsed_actions

        # 保存进度
        with open(MONSTERS_JSON_PATH, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        logger.info(f"批次 {batch_num + 1} 完成")

        # 避免API限流
        await asyncio.sleep(2)

    # 统计结果
    total_actions = sum(len(m.get('actions', [])) for m in monsters)
    parsed_actions = sum(
        1 for m in monsters
        for a in m.get('actions', [])
        if a.get('action_category')
    )

    logger.info(f"\n=== 解析完成 ===")
    logger.info(f"总动作数: {total_actions}")
    logger.info(f"已解析动作数: {parsed_actions}")
    logger.info(f"解析率: {100*parsed_actions/total_actions:.1f}%")


if __name__ == "__main__":
    asyncio.run(main())
