#!/usr/bin/env python3
"""
Parse race traits and generate structured combatEffects using LLM.
This script analyzes race trait descriptions and generates machine-readable
combat effect configurations.
"""
import json
import asyncio
import sys
import os
import re
import httpx

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.ai_model_service import AIModelService
from app.db.session import async_session_maker

# Combat effect schema documentation for LLM
COMBAT_EFFECTS_SCHEMA = """
combatEffects 结构说明：

1. trigger (触发时机):
   - "on_attack_roll" - 进行攻击检定时
   - "on_critical" - 造成重击时
   - "on_natural_1" - 攻击/检定投出自然1时
   - "on_take_damage" - 受到伤害时
   - "on_hp_zero" - HP降为0时
   - "on_saving_throw" - 进行豁免检定时
   - "passive" - 被动效果，始终生效

2. effect (效果类型):
   - "extra_damage_die" - 额外投伤害骰
   - "reroll" - 重投骰子
   - "damage_resistance" - 伤害抗性（受到该类型伤害减半）
   - "saving_throw_advantage" - 豁免检定具有优势
   - "set_hp" - 设置HP值
   - "skill_proficiency" - 技能熟练
   - "none" - 无战斗效果

3. conditions (触发条件，可选):
   - "is_melee": true/false - 必须是近战攻击
   - "is_ranged": true/false - 必须是远程攻击
   - "damage_type": "poison"/"fire"/etc - 伤害类型匹配
   - "save_type": "poison"/"charm"/"fear"/etc - 豁免类型匹配
   - "against_magic": true - 对抗魔法效果时

4. params (效果参数):
   - "dice_count": 1 - 骰子数量
   - "use_weapon_die": true - 使用武器伤害骰
   - "must_use_new": true - 必须使用新结果
   - "resistance_type": "poison" - 抗性伤害类型
   - "hp_value": 1 - HP设置值
   - "uses_per_long_rest": 1 - 每长休可用次数

5. 示例：
野蛮攻击（半兽人）:
{
  "trigger": "on_critical",
  "effect": "extra_damage_die",
  "conditions": { "is_melee": true },
  "params": { "dice_count": 1, "use_weapon_die": true }
}

幸运（半身人）:
{
  "trigger": "on_natural_1",
  "effect": "reroll",
  "params": { "must_use_new": true }
}

矮人韧性:
[
  {
    "trigger": "on_saving_throw",
    "effect": "saving_throw_advantage",
    "conditions": { "save_type": "poison" }
  },
  {
    "trigger": "passive",
    "effect": "damage_resistance",
    "params": { "resistance_type": "poison" }
  }
]

不屈（半兽人）:
{
  "trigger": "on_hp_zero",
  "effect": "set_hp",
  "params": { "hp_value": 1, "uses_per_long_rest": 1 }
}
"""

PARSE_PROMPT = """你是一个D&D 5E规则专家。请分析以下种族特性，判断它是否有战斗相关效果。

种族: {race_name}
特性名: {trait_name}
特性描述: {trait_description}

{schema}

请返回JSON格式的combatEffects。如果该特性没有战斗效果（如语言、工具熟练、纯叙事特性等），返回 {{"effect": "none"}}。

只返回JSON，不要其他文字。如果有多个效果，返回数组。"""


def _parse_json_response(text: str):
    """Parse JSON from LLM response, handling markdown code blocks."""
    # Clean up code blocks
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    if text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()

    # Try direct parse
    try:
        return json.loads(text)
    except:
        pass

    # Try finding JSON array
    bracket_match = re.search(r'\[[\s\S]*\]', text)
    if bracket_match:
        try:
            return json.loads(bracket_match.group(0))
        except:
            pass

    # Try finding JSON object
    brace_match = re.search(r'\{[\s\S]*\}', text)
    if brace_match:
        try:
            return json.loads(brace_match.group(0))
        except:
            pass

    return None


async def call_llm(db, prompt: str):
    """Call LLM with the given prompt"""
    try:
        usage_params = await AIModelService.get_usage_params(
            db, "race_combat_effects_parse"
        )
        config = usage_params.config
    except Exception as e:
        print(f"Failed to get AI config: {e}")
        return None

    endpoint = config.api_url.rstrip('/')
    if not endpoint.endswith('/chat/completions'):
        endpoint = endpoint + '/chat/completions'

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                endpoint,
                json={
                    "model": config.model_name,
                    "messages": [
                        {"role": "system", "content": "你是D&D 5E规则专家，只返回JSON格式数据。"},
                        {"role": "user", "content": prompt}
                    ],
                    "max_tokens": 500,
                    "temperature": 0.1
                },
                headers={
                    "Authorization": f"Bearer {config.api_key}",
                    "Content-Type": "application/json",
                },
            )

        if resp.status_code != 200:
            print(f"LLM API error: {resp.status_code} - {resp.text}")
            return None

        data = resp.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

        if not content:
            print("Empty response from LLM")
            return None

        return _parse_json_response(content)

    except Exception as e:
        print(f"LLM call error: {e}")
        return None


async def parse_trait_combat_effects(
    db,
    race_name: str,
    trait_name: str,
    trait_description: str
):
    """Parse a single trait and extract combat effects."""
    prompt = PARSE_PROMPT.format(
        race_name=race_name,
        trait_name=trait_name,
        trait_description=trait_description,
        schema=COMBAT_EFFECTS_SCHEMA
    )

    result = await call_llm(db, prompt)

    if result is None:
        return None

    # Skip if no combat effect
    if isinstance(result, dict) and result.get("effect") == "none":
        return None

    return result


async def process_races(races_data: dict) -> dict:
    """Process all races and generate combat effects."""
    async with async_session_maker() as db:
        for race in races_data.get("races", []):
            race_name = race.get("name", "Unknown")
            print(f"\n处理种族: {race_name}")

            # Process main race traits
            for trait in race.get("traits", []):
                trait_name = trait.get("name", "")
                trait_desc = trait.get("description", "")

                if not trait_name or not trait_desc:
                    continue

                print(f"  分析特性: {trait_name}")
                combat_effects = await parse_trait_combat_effects(
                    db, race_name, trait_name, trait_desc
                )

                if combat_effects:
                    trait["combatEffects"] = combat_effects
                    effect_str = json.dumps(combat_effects, ensure_ascii=False)
                    if len(effect_str) > 80:
                        effect_str = effect_str[:80] + "..."
                    print(f"    ✓ 添加战斗效果: {effect_str}")
                else:
                    print(f"    - 无战斗效果")

            # Process subraces
            for subrace in race.get("subraces", []):
                subrace_name = subrace.get("name", "Unknown")
                print(f"  处理亚种: {subrace_name}")

                for trait in subrace.get("traits", []):
                    trait_name = trait.get("name", "")
                    trait_desc = trait.get("description", "")

                    if not trait_name or not trait_desc:
                        continue

                    print(f"    分析特性: {trait_name}")
                    combat_effects = await parse_trait_combat_effects(
                        db, f"{race_name}({subrace_name})", trait_name, trait_desc
                    )

                    if combat_effects:
                        trait["combatEffects"] = combat_effects
                        print(f"      ✓ 添加战斗效果")
                    else:
                        print(f"      - 无战斗效果")

    return races_data


async def main():
    # Read races.json
    races_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
        "frontend/app/data/rules/races.json"
    )

    print(f"读取种族数据: {races_path}")
    with open(races_path, "r", encoding="utf-8") as f:
        races_data = json.load(f)

    # Process races
    updated_data = await process_races(races_data)

    # Save updated data
    output_path = races_path.replace(".json", "_with_combat_effects.json")
    print(f"\n保存到: {output_path}")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(updated_data, f, ensure_ascii=False, indent=2)

    print("\n完成！请检查生成的文件，确认无误后替换原文件。")


if __name__ == "__main__":
    asyncio.run(main())
