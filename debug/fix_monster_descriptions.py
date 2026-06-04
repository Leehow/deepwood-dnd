#!/usr/bin/env python3
"""
修复 monsters.json 中 action description 混入其他怪物数据的问题
"""

import json
import re
import time
import httpx
from pathlib import Path

API_URL = "https://yunwu.ai/v1/chat/completions"
API_KEY = "REDACTED_API_KEY"
MODEL = "gemini-3-flash-preview"

# 匹配混入数据的模式
DIRTY_PATTERN = re.compile(r'(AC:\s*\d+.*?HP:\s*\d+.*?速度:\s*\d+\s*尺)')


def call_ai(prompt: str) -> str:
    """调用 AI API"""
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": "你是一个数据清洗助手。只返回清洗后的文本，不要任何解释。"},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0,
        "max_tokens": 1000
    }

    with httpx.Client(timeout=30) as client:
        resp = client.post(API_URL, headers=headers, json=payload)
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()


def is_dirty(text: str) -> bool:
    """检查文本是否包含混入的怪物数据"""
    # 检查是否有 "怪物名 AC:" 或 "AC:数字 HP:" 模式
    if re.search(r'AC:\s*\d+.*HP:\s*\d+.*速度:', text):
        return True
    return False


def clean_description_simple(text: str) -> str:
    """简单清理：在常见的混入点截断"""
    # 常见的混入模式：怪物名后跟属性
    patterns = [
        r'\s+[^\s]{2,20}\s+(小型|中型|大型|巨型|超巨型)(怪兽|元素生物|不死生物|邪魔|构装生物|类人生物|天界生物|野兽|龙类|巨人|植物|精类|泥怪|异怪)',
        r'\s+AC:\s*\d+\s*\(?',  # 直接跟 AC:
    ]

    result = text
    for pattern in patterns:
        match = re.search(pattern, result)
        if match:
            # 截断到匹配位置之前
            result = result[:match.start()].rstrip()
            break

    return result


def clean_with_ai(text: str, monster_name: str, action_name: str) -> str:
    """用 AI 清理描述"""
    prompt = f"""以下是D&D怪物"{monster_name}"的动作"{action_name}"的描述，但描述末尾混入了其他怪物的数据。
请只提取并返回该动作的有效描述部分，去掉混入的其他怪物数据。

原文：
{text}

只返回清洗后的动作描述，不要任何其他内容。"""

    return call_ai(prompt)


def process_monsters(input_path: str, output_path: str, use_ai: bool = False):
    """处理怪物数据"""
    with open(input_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    monsters = data.get('monsters', [])

    fixed_count = 0
    fixed_items = []

    for monster in monsters:
        monster_name = monster.get('name', 'Unknown')

        # 检查 alignment 字段
        alignment = monster.get('alignment', '')
        if is_dirty(alignment):
            if use_ai:
                try:
                    prompt = f"""以下是D&D怪物"{monster_name}"的阵营(alignment)字段，但混入了AC/HP等数据。
请只提取阵营信息（如"守序善良"、"混乱邪恶"、"绝对中立"等），去掉其他数据。

原文：{alignment}

只返回阵营，如"守序善良"，不要任何其他内容。"""
                    cleaned = call_ai(prompt)
                    time.sleep(0.3)
                except Exception as e:
                    print(f"AI 清理失败 ({monster_name}/alignment): {e}")
                    # 简单规则：取 AC: 之前的部分
                    cleaned = re.split(r'\s*AC:', alignment)[0].strip()
            else:
                cleaned = re.split(r'\s*AC:', alignment)[0].strip()

            if cleaned and cleaned != alignment:
                fixed_items.append({
                    'monster': monster_name,
                    'field': 'alignment',
                    'before': alignment[:80] + '...' if len(alignment) > 80 else alignment,
                    'after': cleaned
                })
                monster['alignment'] = cleaned
                fixed_count += 1

        # 检查 actions
        for action in monster.get('actions', []):
            desc = action.get('description', '')
            if is_dirty(desc):
                action_name = action.get('name', 'Unknown')

                if use_ai:
                    try:
                        cleaned = clean_with_ai(desc, monster_name, action_name)
                        time.sleep(0.3)  # 避免 rate limit
                    except Exception as e:
                        print(f"AI 清理失败 ({monster_name}/{action_name}): {e}")
                        cleaned = clean_description_simple(desc)
                else:
                    cleaned = clean_description_simple(desc)

                if cleaned != desc:
                    fixed_items.append({
                        'monster': monster_name,
                        'action': action_name,
                        'before': desc[:100] + '...' if len(desc) > 100 else desc,
                        'after': cleaned[:100] + '...' if len(cleaned) > 100 else cleaned
                    })
                    action['description'] = cleaned
                    fixed_count += 1

        # 检查 specialAbilities
        for ability in monster.get('specialAbilities', []):
            desc = ability.get('description', '')
            if is_dirty(desc):
                ability_name = ability.get('name', 'Unknown')

                if use_ai:
                    try:
                        cleaned = clean_with_ai(desc, monster_name, ability_name)
                        time.sleep(0.3)
                    except Exception as e:
                        print(f"AI 清理失败 ({monster_name}/{ability_name}): {e}")
                        cleaned = clean_description_simple(desc)
                else:
                    cleaned = clean_description_simple(desc)

                if cleaned != desc:
                    fixed_items.append({
                        'monster': monster_name,
                        'ability': ability_name,
                        'before': desc[:100] + '...' if len(desc) > 100 else desc,
                        'after': cleaned[:100] + '...' if len(cleaned) > 100 else cleaned
                    })
                    ability['description'] = cleaned
                    fixed_count += 1

    # 保存结果
    data['monsters'] = monsters
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"\n修复完成！共修复 {fixed_count} 处")
    print(f"输出文件: {output_path}")

    # 打印修复详情
    if fixed_items:
        print("\n修复详情（前10条）:")
        for i, item in enumerate(fixed_items[:10]):
            print(f"\n{i+1}. {item['monster']} - {item.get('action') or item.get('ability')}")
            print(f"   修复前: {item['before']}")
            print(f"   修复后: {item['after']}")

    return fixed_count


def preview_dirty_data(input_path: str, limit: int = 20):
    """预览脏数据"""
    with open(input_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    monsters = data.get('monsters', [])

    dirty_items = []

    for monster in monsters:
        monster_name = monster.get('name', 'Unknown')

        for action in monster.get('actions', []):
            desc = action.get('description', '')
            if is_dirty(desc):
                dirty_items.append({
                    'monster': monster_name,
                    'type': 'action',
                    'name': action.get('name', ''),
                    'desc': desc
                })

        for ability in monster.get('specialAbilities', []):
            desc = ability.get('description', '')
            if is_dirty(desc):
                dirty_items.append({
                    'monster': monster_name,
                    'type': 'ability',
                    'name': ability.get('name', ''),
                    'desc': desc
                })

    print(f"发现 {len(dirty_items)} 处脏数据\n")

    for i, item in enumerate(dirty_items[:limit]):
        print(f"{i+1}. [{item['monster']}] {item['type']}: {item['name']}")
        print(f"   {item['desc'][:150]}...")
        print()

    return dirty_items


if __name__ == "__main__":
    import sys

    input_file = Path(__file__).parent.parent / "dnd-platform/configs/npc/monsters.json"
    output_file = Path(__file__).parent.parent / "dnd-platform/configs/npc/monsters_fixed.json"

    if len(sys.argv) > 1 and sys.argv[1] == "preview":
        # 预览模式
        preview_dirty_data(str(input_file))
    elif len(sys.argv) > 1 and sys.argv[1] == "fix":
        # 修复模式（使用简单规则）
        process_monsters(str(input_file), str(output_file), use_ai=False)
    elif len(sys.argv) > 1 and sys.argv[1] == "fix-ai":
        # 使用 AI 修复
        process_monsters(str(input_file), str(output_file), use_ai=True)
    else:
        print("用法:")
        print("  python fix_monster_descriptions.py preview   # 预览脏数据")
        print("  python fix_monster_descriptions.py fix       # 简单规则修复")
        print("  python fix_monster_descriptions.py fix-ai    # 使用AI修复")
