#!/usr/bin/env python3
"""
用 LLM 验证 monsters.json 数据质量
"""

import json
import time
import httpx
from pathlib import Path

API_URL = "https://yunwu.ai/v1/chat/completions"
API_KEY = "REDACTED_API_KEY"
MODEL = "gemini-3-flash-preview"

# 标杆怪物示例（干净数据）
GOOD_EXAMPLES = """
示例1 - 地精 Goblin:
{
  "id": "goblin",
  "name": "地精",
  "nameEn": "Goblin",
  "size": "小型",
  "type": "类人生物(妖精鬼怪)",
  "alignment": "中立邪恶",
  "ac": 15,
  "hp": 7,
  "hpFormula": "2d6",
  "speed": {"walk": 30},
  "cr": "1/4",
  "actions": [
    {"name": "弯刀 Scimitar", "description": "近战武器攻击：命中+4，触及5尺，单一目标。伤害：5(1d6+2)的挥砍伤害。"},
    {"name": "短弓 Shortbow", "description": "远程武器攻击：命中+4，射程80/320尺，单一目标。伤害：5(1d6+2)的穿刺伤害。"}
  ],
  "specialAbilities": [
    {"name": "灵巧脱身 Nimble Escape", "description": "地精可以在每个自己的回合里，以附赠动作执行撤离或躲藏动作。"}
  ]
}

示例2 - 骷髅 Skeleton:
{
  "id": "skeleton",
  "name": "骷髅",
  "nameEn": "Skeleton",
  "size": "中型",
  "type": "不死生物",
  "alignment": "守序邪恶",
  "ac": 13,
  "hp": 13,
  "hpFormula": "2d8+4",
  "speed": {"walk": 30},
  "cr": "1/4",
  "damageImmunities": "毒素",
  "conditionImmunities": "力竭, 中毒",
  "actions": [
    {"name": "短剑 Shortsword", "description": "近战武器攻击：命中+4，触及5尺，单一目标。伤害：5(1d6+2)的穿刺伤害。"},
    {"name": "短弓 Shortbow", "description": "远程武器攻击：命中+4，射程80/320尺，单一目标。伤害：5(1d6+2)的穿刺伤害。"}
  ]
}
"""

VALIDATION_PROMPT = """你是D&D 5E怪物数据质量检查员。请检查以下怪物数据是否有问题。

## 正确格式标杆
{examples}

## 检查规则
1. alignment（阵营）应该是简短的中文，如"守序善良"、"混乱邪恶"、"绝对中立"等，不应包含AC、HP、速度等数据
2. action的name应该简短（通常<30字符），格式如"啃咬 Bite"、"爪击 Claw"
3. action的description应该是攻击描述，不应包含其他怪物的数据
4. 各字段不应有明显的数据混乱（如description里出现"挑战等级"、"AC:"等）
5. 不应有LaTeX公式残留（如\\mathrm, \\left等）

## 待检查数据
怪物名: {name}
```json
{monster_json}
```

## 输出格式
如果数据正常，只输出: OK
如果有问题，输出问题描述（简短，一行）"""


def call_ai(prompt: str) -> str:
    headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}
    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
        "max_tokens": 200
    }
    with httpx.Client(timeout=30) as client:
        resp = client.post(API_URL, headers=headers, json=payload)
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()


def validate_monster(monster: dict) -> tuple[bool, str]:
    """验证单个怪物，返回 (是否OK, 问题描述)"""
    # 简化数据，只保留关键字段
    simplified = {
        "id": monster.get("id"),
        "name": monster.get("name"),
        "nameEn": monster.get("nameEn"),
        "size": monster.get("size"),
        "type": monster.get("type"),
        "alignment": monster.get("alignment"),
        "ac": monster.get("ac"),
        "hp": monster.get("hp"),
        "cr": monster.get("cr"),
        "damageImmunities": monster.get("damageImmunities"),
        "conditionImmunities": monster.get("conditionImmunities"),
        "actions": monster.get("actions", [])[:3],  # 只取前3个action
        "specialAbilities": monster.get("specialAbilities", [])[:2]
    }
    # 移除 None 值
    simplified = {k: v for k, v in simplified.items() if v is not None}

    prompt = VALIDATION_PROMPT.format(
        examples=GOOD_EXAMPLES,
        name=monster.get("name", "Unknown"),
        monster_json=json.dumps(simplified, ensure_ascii=False, indent=2)
    )

    result = call_ai(prompt)
    is_ok = result.strip().upper() == "OK"
    return is_ok, result


def main():
    input_path = Path(__file__).parent.parent / "dnd-platform/configs/npc/monsters.json"

    with open(input_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    monsters = data['monsters']
    total = len(monsters)

    print(f"开始验证 {total} 个怪物数据...\n")

    issues = []
    ok_count = 0

    for i, monster in enumerate(monsters):
        name = monster.get('name', 'Unknown')

        try:
            is_ok, result = validate_monster(monster)

            if is_ok:
                ok_count += 1
                status = "✓"
            else:
                issues.append({"name": name, "issue": result})
                status = "✗"

            print(f"[{i+1}/{total}] {status} {name}" + (f" - {result[:50]}..." if not is_ok else ""))

            # 避免 rate limit
            time.sleep(0.3)

        except Exception as e:
            print(f"[{i+1}/{total}] ? {name} - 错误: {e}")
            issues.append({"name": name, "issue": f"验证错误: {e}"})

    # 输出总结
    print(f"\n{'='*50}")
    print(f"验证完成!")
    print(f"  正常: {ok_count}/{total}")
    print(f"  问题: {len(issues)}/{total}")

    if issues:
        print(f"\n问题列表:")
        for item in issues:
            print(f"  - {item['name']}: {item['issue'][:80]}")

    # 保存问题列表
    if issues:
        output_path = Path(__file__).parent / "monster_issues.json"
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(issues, f, ensure_ascii=False, indent=2)
        print(f"\n问题列表已保存到: {output_path}")


if __name__ == "__main__":
    main()
