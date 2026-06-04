#!/usr/bin/env python3
"""
用 AI 从魔法物品描述中提取结构化数据
"""
import os
import json
import re
import asyncio
from pathlib import Path
from openai import AsyncOpenAI

MAGIC_ITEMS_FILE = Path(__file__).parent.parent / "frontend/public/rules/magic-items.json"
PROGRESS_FILE = Path("/tmp/magic_items_stats_progress.json")

# Yunwu API 配置
API_URL = "https://yunwu.ai/v1"
API_KEY = os.environ.get("YUNWU_API_KEY", "")
MODEL = "gemini-3-flash-preview"

def load_progress():
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {"extracted": {}}

def save_progress(progress):
    with open(PROGRESS_FILE, 'w', encoding='utf-8') as f:
        json.dump(progress, f, ensure_ascii=False, indent=2)


def repair_json(text, expected_count):
    """尝试修复不完整的 JSON"""
    # 清理 markdown 代码块
    if text.startswith("```"):
        parts = text.split("```")
        if len(parts) >= 2:
            text = parts[1]
            if text.startswith("json"):
                text = text[4:]
    text = text.strip()

    # 尝试直接解析
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 尝试补全截断的 JSON
    # 找到最后一个完整的对象
    try:
        # 查找所有完整的对象
        objects = []
        depth = 0
        start = None
        in_string = False
        escape = False

        for i, c in enumerate(text):
            if escape:
                escape = False
                continue
            if c == '\\':
                escape = True
                continue
            if c == '"' and not escape:
                in_string = not in_string
                continue
            if in_string:
                continue

            if c == '{':
                if depth == 0:
                    start = i
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0 and start is not None:
                    obj_str = text[start:i+1]
                    try:
                        obj = json.loads(obj_str)
                        objects.append(obj)
                    except:
                        pass
                    start = None

        if objects:
            return objects
    except:
        pass

    return None

async def extract_stats(client, items, retry=0):
    """批量提取物品属性"""
    items_text = []
    for i, item in enumerate(items):
        desc_en = item.get('descriptionEn', '') or item.get('description', '')
        items_text.append(f"[{i+1}] {item['nameEn']}: {desc_en[:400]}")

    prompt = f"""Extract data from these D&D magic items. Return ONLY a JSON array.

Fields per item:
- bonus: number or null (attack/damage bonus +1,+2,+3)
- charges: number or null
- recharge: string or null ("dawn","dusk")
- damage: string or null ("1d6 fire")
- healing: string or null ("2d4+2")
- ac_bonus: number or null
- save_dc: number or null
- effects: array of strings (["resistance:cold","fly:60ft"])
- duration: string or null
- uses: string or null

Items:
{chr(10).join(items_text)}

Return exactly {len(items)} objects in a JSON array:"""

    try:
        response = await client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": "Return only valid JSON array. No markdown. No explanation."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.1,
            max_tokens=3000
        )

        result = response.choices[0].message.content.strip()
        parsed = repair_json(result, len(items))

        if parsed and len(parsed) == len(items):
            return parsed
        elif parsed and len(parsed) > 0:
            print(f"  部分成功: 获取 {len(parsed)}/{len(items)} 个")
            # 返回能解析的部分，用 None 填充
            while len(parsed) < len(items):
                parsed.append(None)
            return parsed
        else:
            if retry < 2:
                print(f"  重试 ({retry + 1}/2)...")
                await asyncio.sleep(1)
                return await extract_stats(client, items, retry + 1)
            print(f"  解析失败")
            return None
    except Exception as e:
        print(f"  API错误: {e}")
        if retry < 2:
            await asyncio.sleep(2)
            return await extract_stats(client, items, retry + 1)
        return None

async def main():
    print("加载魔法物品数据...")
    with open(MAGIC_ITEMS_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    items = data['items']
    total = len(items)
    print(f"总计: {total} 件")

    progress = load_progress()
    extracted = progress['extracted']
    print(f"已提取: {len(extracted)} 件")

    # 筛选未处理的
    to_process = [(i, item) for i, item in enumerate(items) if item['id'] not in extracted]
    print(f"待处理: {len(to_process)} 件")

    if not to_process:
        print("所有物品已处理!")
    else:
        client = AsyncOpenAI(api_key=API_KEY, base_url=API_URL)

        batch_size = 5  # 减小批次，提高成功率
        for i in range(0, len(to_process), batch_size):
            batch = to_process[i:i+batch_size]
            batch_items = [item for _, item in batch]

            print(f"\n进度: {len(extracted)}/{total} ({len(extracted)*100//total}%)")
            print(f"  处理: {batch_items[0]['name']} 等 {len(batch_items)} 件...")

            stats_list = await extract_stats(client, batch_items)

            if stats_list:
                saved = 0
                for j, (_, item) in enumerate(batch):
                    if j < len(stats_list) and stats_list[j] is not None:
                        extracted[item['id']] = stats_list[j]
                        stats = stats_list[j]
                        summary = []
                        if stats.get('bonus'): summary.append(f"+{stats['bonus']}")
                        if stats.get('charges'): summary.append(f"{stats['charges']}充能")
                        if stats.get('damage'): summary.append(stats['damage'])
                        if stats.get('effects'): summary.append(f"{len(stats['effects'])}效果")
                        print(f"    {item['name'][:12]}: {', '.join(summary) if summary else '无特殊'}")
                        saved += 1
                if saved > 0:
                    save_progress(progress)
                    print(f"  保存 {saved} 件")
            else:
                print(f"  跳过此批次")

            await asyncio.sleep(0.5)

    # 更新文件
    print("\n更新文件...")
    for item in items:
        if item['id'] in extracted:
            stats = extracted[item['id']]
            # 合并到物品数据
            item['stats'] = {k: v for k, v in stats.items() if v is not None}

    with open(MAGIC_ITEMS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # 统计
    has_bonus = sum(1 for item in items if item.get('stats', {}).get('bonus'))
    has_charges = sum(1 for item in items if item.get('stats', {}).get('charges'))
    has_effects = sum(1 for item in items if item.get('stats', {}).get('effects'))

    print(f"\n完成! 统计:")
    print(f"  有加成值: {has_bonus} 件")
    print(f"  有充能: {has_charges} 件")
    print(f"  有特殊效果: {has_effects} 件")

    if PROGRESS_FILE.exists():
        PROGRESS_FILE.unlink()

if __name__ == "__main__":
    asyncio.run(main())
