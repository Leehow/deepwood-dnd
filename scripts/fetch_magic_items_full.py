#!/usr/bin/env python3
"""
重新获取魔法物品完整描述
"""
import json
import asyncio
import aiohttp
import asyncpg
from pathlib import Path
from openai import AsyncOpenAI

MAGIC_ITEMS_FILE = Path(__file__).parent.parent / "frontend/public/rules/magic-items.json"
PROGRESS_FILE = Path("/tmp/magic_items_full_progress.json")
DATABASE_URL = "postgresql://haoli@localhost:5432/dnd_platform"

async def get_ai_config():
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        row = await conn.fetchrow("""
            SELECT api_url, api_key, model_name
            FROM ai_model_configs WHERE model_type = 'FAST' LIMIT 1
        """)
        return dict(row) if row else None
    finally:
        await conn.close()

def load_progress():
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {"fetched": {}, "translated": {}}

def save_progress(progress):
    with open(PROGRESS_FILE, 'w', encoding='utf-8') as f:
        json.dump(progress, f, ensure_ascii=False, indent=2)

async def fetch_full_desc(session, item_id):
    """获取物品完整描述"""
    try:
        url = f"https://www.dnd5eapi.co/api/2014/magic-items/{item_id}"
        async with session.get(url, timeout=10) as resp:
            if resp.status == 200:
                data = await resp.json()
                # 合并所有描述段落，跳过第一行（类型信息）
                desc_parts = data.get('desc', [])
                if len(desc_parts) > 1:
                    return '\n'.join(desc_parts[1:])  # 跳过第一行
                return ''
    except Exception as e:
        print(f"  获取 {item_id} 失败: {e}")
    return None

async def translate_batch(client, model_name, items_desc):
    """批量翻译描述"""
    prompt_parts = []
    for i, (item_id, desc) in enumerate(items_desc):
        prompt_parts.append(f"[{i+1}] {desc[:500]}")  # 限制长度

    prompt = f"""将以下D&D魔法物品效果描述翻译成中文，保持格式。每条翻译前保留序号[数字]。

{chr(10).join(prompt_parts)}"""

    try:
        response = await client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": "你是D&D翻译专家，翻译要准确、简洁、符合游戏术语。"},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=4000
        )

        import re
        result = response.choices[0].message.content.strip()
        matches = re.findall(r'\[(\d+)\]\s*(.+?)(?=\[\d+\]|$)', result, re.DOTALL)
        return {int(idx)-1: content.strip() for idx, content in matches}
    except Exception as e:
        print(f"  翻译错误: {e}")
        return {}

async def main():
    print("加载现有数据...")
    with open(MAGIC_ITEMS_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    items = data['items']
    progress = load_progress()

    # 阶段1: 获取完整描述
    print("\n阶段1: 获取完整描述...")
    async with aiohttp.ClientSession() as session:
        for i, item in enumerate(items):
            if item['id'] in progress['fetched']:
                continue

            if i % 20 == 0:
                print(f"  获取进度: {i}/{len(items)}")

            full_desc = await fetch_full_desc(session, item['id'])
            if full_desc:
                progress['fetched'][item['id']] = full_desc
                if len(progress['fetched']) % 30 == 0:
                    save_progress(progress)

            await asyncio.sleep(0.05)

    save_progress(progress)
    print(f"  获取完成: {len(progress['fetched'])} 件有详细描述")

    # 阶段2: 翻译描述
    print("\n阶段2: 翻译描述...")
    config = await get_ai_config()
    if not config:
        print("错误: 未找到AI配置")
        return

    client = AsyncOpenAI(api_key=config['api_key'], base_url=config['api_url'])

    to_translate = [(k, v) for k, v in progress['fetched'].items()
                    if k not in progress['translated'] and v]

    print(f"  待翻译: {len(to_translate)} 条")

    batch_size = 10
    for i in range(0, len(to_translate), batch_size):
        batch = to_translate[i:i+batch_size]
        print(f"  翻译进度: {len(progress['translated'])}/{len(progress['fetched'])}")

        translations = await translate_batch(client, config['model_name'], batch)
        for j, (item_id, _) in enumerate(batch):
            if j in translations:
                progress['translated'][item_id] = translations[j]

        save_progress(progress)
        await asyncio.sleep(0.5)

    # 阶段3: 更新文件
    print("\n阶段3: 更新文件...")
    for item in items:
        if item['id'] in progress['translated']:
            item['descriptionEn'] = progress['fetched'].get(item['id'], '')
            item['description'] = progress['translated'][item['id']]

    with open(MAGIC_ITEMS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"\n完成! 更新了 {len(progress['translated'])} 件物品的详细描述")

    if PROGRESS_FILE.exists():
        PROGRESS_FILE.unlink()

if __name__ == "__main__":
    asyncio.run(main())
