"""
Monster Parser Service - Two-stage parsing for module monsters
Stage 1: Parse basic stats (AC, HP, abilities, saves, etc.)
Stage 2: Parse actions (attacks, spells, special abilities)
"""
import asyncio
import json
import re
import httpx
import logging
from typing import Dict, Any, Optional, List
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.ai_model_service import ai_model_service

logger = logging.getLogger(__name__)


# ==================== Stage 1: Basic Stats ====================
PARSE_STATS_PROMPT = """你是D&D 5E怪物数据解析专家。请从以下怪物描述中提取基础属性数据。

## 怪物描述
{description}

## 任务
仔细阅读描述，提取能找到的所有基础属性。如果某项属性在描述中没有提及，对应字段设为null。

## 输出格式（JSON）
```json
{{
  "size": "体型(tiny/small/medium/large/huge/gargantuan)或null",
  "type": "生物类型(humanoid/dragon/undead等)或null",
  "alignment": "阵营或null",
  "armor_class": AC数值或null,
  "armor_type": "护甲类型描述或null",
  "hit_points": HP数值或null,
  "hit_dice": "生命骰如3d8+6或null",
  "speeds": {{
    "walk": 步行速度或null,
    "fly": 飞行速度或null,
    "swim": 游泳速度或null,
    "climb": 攀爬速度或null,
    "burrow": 掘地速度或null
  }},
  "ability_scores": {{
    "str": 力量值或null,
    "dex": 敏捷值或null,
    "con": 体质值或null,
    "int": 智力值或null,
    "wis": 感知值或null,
    "cha": 魅力值或null
  }},
  "saving_throws": ["豁免加值列表，如 感知+6"],
  "skills": ["技能加值列表，如 察觉+5"],
  "damage_resistances": ["伤害抗性"],
  "damage_immunities": ["伤害免疫"],
  "condition_immunities": ["状态免疫"],
  "senses": ["感官，如 黑暗视觉 60尺"],
  "passive_perception": 被动察觉数值或null,
  "languages": ["语言列表"],
  "challenge_rating": "CR值如1/2或5",
  "xp": 经验值或null
}}
```

只返回JSON，不要其他内容。"""


# ==================== Stage 2: Actions ====================
PARSE_ACTIONS_PROMPT = """你是D&D 5E怪物动作解析专家。请从以下怪物描述中提取所有特性、动作、反应和传奇动作。

## 怪物描述
{description}

## 任务
仔细阅读描述，正确分类提取。注意：很多描述中没有明确的"动作"标题，需要根据内容特征识别。

## 关键识别规则

### 这是【动作】- 必须放入 actions 数组：
凡是包含以下关键词的条目，都是动作：
- "近战武器攻击" 或 "远程武器攻击" 或 "近战或远程武器攻击"
- "命中+X"（如"命中+4"）
- "触及 X 尺" 或 "射程 X/X 尺"
- "伤害：X（XdX+X）" 或 "命中：X（XdX+X）"

**动作示例**（这些必须放入 actions）：
- 「钉头锤 Morningstar。近战武器攻击：命中+4，触及 5 尺，单一目标。伤害：11（2d8+2）的穿刺伤害。」
- 「标枪 Javelin。近战或远程武器攻击：命中+4，触及 5 尺或射程 30/120 尺，单一目标。」
- 「利爪 Claw。近战武器攻击：命中+6，触及5尺，单一目标。命中：8（1d8+4）挥砍伤害。」
- 「多重攻击。熊地精发动两次挥砍攻击。」

### 这是【特殊能力】- 放入 special_abilities 数组：
不包含攻击动作关键词的被动能力：
- 无"命中+X"
- 无"近战/远程武器攻击"
- 描述的是被动效果或修改其他能力

**特殊能力示例**：
- 「残暴 Brute。熊地精用近战武器命中敌人时，其伤害掷骰额外增加一粒该武器的伤害骰。」
- 「突袭打击 Surprise Attack。熊地精突袭一个生物...额外受到7（2d6）的同类伤害。」
- 「黑暗视觉。该生物在黑暗中能看到60尺。」

## 输出格式（JSON）
```json
{{
  "special_abilities": [
    {{
      "name": "能力名称",
      "name_en": "英文名或null",
      "description": "完整描述"
    }}
  ],
  "actions": [
    {{
      "name": "动作名称",
      "name_en": "英文名或null",
      "description": "完整描述",
      "action_category": "multiattack/weapon_attack/special_attack/spell/other",
      "attack_type": "melee/ranged/melee_or_ranged",
      "attack_bonus": 命中加值数字或null,
      "reach": "5尺",
      "range": "30/120尺",
      "damage": {{
        "dice": "2d6",
        "bonus": 3,
        "average": 10,
        "type": "挥砍"
      }},
      "extra_damage": {{
        "dice": "1d6",
        "type": "火焰"
      }},
      "save": {{
        "ability": "体质",
        "dc": 15,
        "success_effect": "伤害减半"
      }},
      "area": {{
        "shape": "锥形",
        "size": "30尺"
      }},
      "usage": {{
        "type": "recharge",
        "value": "5-6"
      }},
      "multiattack_actions": ["爪击", "啮咬"]
    }}
  ],
  "reactions": [],
  "legendary_actions": {{
    "description": "传奇动作总体说明（如拥有几次传奇动作）",
    "actions": [
      {{
        "name": "传奇动作名称",
        "name_en": "英文名或null",
        "description": "完整描述",
        "cost": 消耗次数默认1,
        "attack_bonus": 攻击加值或null,
        "damage": {{
          "dice": "2d6",
          "bonus": 3,
          "average": 10,
          "type": "挥砍"
        }},
        "save": {{
          "ability": "体质",
          "dc": 15,
          "success_effect": "伤害减半"
        }}
      }}
    ]
  }}
}}
```

## 字段规则
- **damage.dice** 和 **bonus** 分开：`2d6+5` → dice:"2d6", bonus:5
- **伤害类型**用中文：穿刺/挥砍/钝击/火焰/冰冷/闪电/雷鸣/强酸/毒素/黯蚀/光耀/心灵/力场
- **save.ability** 用中文：力量/敏捷/体质/智力/感知/魅力
- **action_category**: weapon_attack(有命中加值的攻击), special_attack(有豁免DC的能力), multiattack(多重攻击), spell(法术), other(其他)
- **multiattack** 必须有 multiattack_actions 列出引用的动作中文名
- **usage**: 充能→{{"type":"recharge","value":"5-6"}}，每日次数→{{"type":"per_day","value":3}}
- **area**: 区域效果→shape(锥形/球形/线形/立方体)+size(如"30尺")
- 只输出有值的字段，null/空的不要

## ⚠️ 重要检查清单
解析完成后，请检查：
1. 是否有包含"命中+X"的条目被遗漏？
2. 是否有包含"近战武器攻击"或"远程武器攻击"的条目被遗漏？
3. 如果有，必须将其添加到 actions 数组！
4. 传奇动作中包含"消耗 X 动作"的，cost 字段必须填写对应数字
5. 传奇动作或特殊能力中包含"DC X"豁免的，必须填写 save 字段
6. 特殊能力中包含"X/日"使用次数的（如传奇抗性3/日），放入 special_abilities

只返回JSON，不要其他内容。"""


def _parse_json_response(text: str) -> Optional[Dict]:
    """Parse JSON from LLM response"""
    # Try direct parse
    try:
        return json.loads(text)
    except:
        pass

    # Try extracting from code block
    code_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', text)
    if code_match:
        try:
            return json.loads(code_match.group(1))
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


async def _call_llm(db: AsyncSession, prompt: str, usage_key: str) -> Optional[Dict]:
    """Call LLM with the given prompt"""
    try:
        usage_params = await ai_model_service.get_usage_params(db, usage_key)
        config = usage_params.config
    except Exception as e:
        logger.error(f"Failed to get AI config: {e}")
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
                        {"role": "system", "content": "你是D&D 5E数据解析专家，只返回JSON格式数据。"},
                        {"role": "user", "content": prompt}
                    ],
                    "max_tokens": 4000,
                    "temperature": 0.1
                },
                headers={
                    "Authorization": f"Bearer {config.api_key}",
                    "Content-Type": "application/json",
                },
            )

        if resp.status_code != 200:
            logger.error(f"LLM API error: {resp.status_code}")
            return None

        data = resp.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

        if not content:
            logger.warning("Empty response from LLM")
            return None

        return _parse_json_response(content)

    except Exception as e:
        logger.error(f"LLM call failed: {e}")
        return None


async def parse_monster_stats(db: AsyncSession, description: str) -> Dict[str, Any]:
    """
    Stage 1: Parse basic monster stats from description text
    """
    if not description or len(description) < 20:
        return {}

    prompt = PARSE_STATS_PROMPT.format(description=description[:8000])
    result = await _call_llm(db, prompt, "module_extract_monsters")

    if not result:
        logger.warning("Failed to parse monster stats")
        return {}

    # Clean up null values
    return {k: v for k, v in result.items() if v is not None}


async def parse_monster_actions(db: AsyncSession, description: str) -> Dict[str, Any]:
    """
    Stage 2: Parse monster actions from description text
    """
    if not description or len(description) < 20:
        return {}

    prompt = PARSE_ACTIONS_PROMPT.format(description=description[:8000])
    result = await _call_llm(db, prompt, "module_extract_monsters")

    if not result:
        logger.warning("Failed to parse monster actions")
        return {}

    # Clean up null values and empty arrays
    cleaned = {}
    for k, v in result.items():
        if v is None:
            continue
        if isinstance(v, list) and len(v) == 0:
            continue
        cleaned[k] = v

    return cleaned


# ==================== Stage 3: Spellcasting (Optional) ====================
SPELLCASTING_KEYWORDS = ['施法', '法术', 'Spellcasting', 'Innate Spellcasting', '天生施法', '法术位', '戏法']

PARSE_SPELLCASTING_PROMPT = """你是D&D 5E法术数据解析专家。请从以下怪物描述中提取施法能力信息。

## 怪物描述
{description}

## 任务
仔细阅读描述，提取施法能力相关信息。注意区分：
- 普通施法（有法术位）
- 天生施法（每日次数限制）

## 输出格式（JSON）
```json
{{
  "has_spellcasting": true,
  "spellcasting_type": "normal或innate或both",
  "caster_level": 施法者等级数值或null,
  "spellcasting_ability": "施法属性(智力/感知/魅力)",
  "spell_save_dc": 法术豁免DC数值,
  "spell_attack_bonus": 法术攻击加值数值,
  "spells": {{
    "cantrips": ["戏法名称列表"],
    "1st": {{"slots": 法术位数量, "spells": ["1环法术名称列表"]}},
    "2nd": {{"slots": 法术位数量, "spells": ["2环法术名称列表"]}},
    "3rd": {{"slots": 法术位数量, "spells": ["3环法术名称列表"]}},
    "4th": {{"slots": 法术位数量, "spells": ["4环法术名称列表"]}},
    "5th": {{"slots": 法术位数量, "spells": ["5环法术名称列表"]}},
    "6th": {{"slots": 法术位数量, "spells": ["6环法术名称列表"]}},
    "7th": {{"slots": 法术位数量, "spells": ["7环法术名称列表"]}},
    "8th": {{"slots": 法术位数量, "spells": ["8环法术名称列表"]}},
    "9th": {{"slots": 法术位数量, "spells": ["9环法术名称列表"]}}
  }},
  "innate_spells": {{
    "at_will": ["随意施放的法术"],
    "3/day": ["每日3次的法术"],
    "2/day": ["每日2次的法术"],
    "1/day": ["每日1次的法术"]
  }},
  "spell_details": [
    {{
      "name": "法术名称",
      "name_en": "英文名称",
      "level": "环位(cantrip/1st/2nd等)",
      "school": "学派",
      "casting_time": "施法时间",
      "range": "射程",
      "duration": "持续时间",
      "description": "效果描述（简短）"
    }}
  ]
}}
```

注意：
- 如果没有施法能力，返回 {{"has_spellcasting": false}}
- spell_details 只需要包含描述中提到的法术，不需要补充完整法术信息
- 准确提取法术位数量和法术列表

只返回JSON，不要其他内容。"""


def _has_spellcasting(description: str) -> bool:
    """Check if description contains spellcasting keywords"""
    if not description:
        return False
    return any(kw in description for kw in SPELLCASTING_KEYWORDS)


async def parse_monster_spellcasting(db: AsyncSession, description: str) -> Dict[str, Any]:
    """
    Stage 3: Parse monster spellcasting (only called if spellcasting detected)
    """
    if not description or not _has_spellcasting(description):
        return {}

    logger.info("Detected spellcasting, parsing...")
    prompt = PARSE_SPELLCASTING_PROMPT.format(description=description[:8000])
    result = await _call_llm(db, prompt, "module_extract_monsters")

    if not result:
        logger.warning("Failed to parse monster spellcasting")
        return {}

    # Only return if has_spellcasting is true
    if not result.get("has_spellcasting"):
        return {}

    # Clean up null/empty values
    cleaned = {"spellcasting": {}}
    for k, v in result.items():
        if v is None:
            continue
        if isinstance(v, dict) and not v:
            continue
        if isinstance(v, list) and len(v) == 0:
            continue
        cleaned["spellcasting"][k] = v

    return cleaned


async def parse_monster_full(
    db: AsyncSession,
    description: str,
    name: str = "",
    name_en: str = ""
) -> Dict[str, Any]:
    """
    Full three-stage parsing of a monster from text description.
    Stage 1: Basic stats (AC, HP, abilities)
    Stage 2: Actions (attacks, special abilities)
    Stage 3: Spellcasting (only if detected)
    Returns a complete monster_data dict ready for MonsterInstance.
    """
    logger.info(f"Parsing monster: {name or 'Unknown'}")

    # Stage 1 & 2: Run in parallel
    stats_task = parse_monster_stats(db, description)
    actions_task = parse_monster_actions(db, description)

    stats, actions = await asyncio.gather(stats_task, actions_task)

    # Stage 3: Spellcasting (only if keywords detected)
    spellcasting = {}
    if _has_spellcasting(description):
        spellcasting = await parse_monster_spellcasting(db, description)

    # Merge results
    monster_data = {
        "name": name,
        "name_en": name_en,
        "description": description,
        "source": "module_import",
        **stats,
        **actions,
        **spellcasting
    }

    logger.info(f"Parsed monster {name}: stats={bool(stats)}, actions={bool(actions)}, spellcasting={bool(spellcasting)}")
    return monster_data


# Singleton instance
class MonsterParserService:
    async def parse_stats(self, db: AsyncSession, description: str) -> Dict:
        return await parse_monster_stats(db, description)

    async def parse_actions(self, db: AsyncSession, description: str) -> Dict:
        return await parse_monster_actions(db, description)

    async def parse_spellcasting(self, db: AsyncSession, description: str) -> Dict:
        return await parse_monster_spellcasting(db, description)

    async def parse_full(self, db: AsyncSession, description: str, name: str = "", name_en: str = "") -> Dict:
        return await parse_monster_full(db, description, name, name_en)

    def has_spellcasting(self, description: str) -> bool:
        return _has_spellcasting(description)


monster_parser_service = MonsterParserService()
