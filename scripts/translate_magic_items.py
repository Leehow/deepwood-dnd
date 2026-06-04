#!/usr/bin/env python3
"""
翻译魔法物品描述 - 使用项目配置的 AI API
"""
import json
import asyncio
import asyncpg
from pathlib import Path
from openai import AsyncOpenAI

# 文件路径
MAGIC_ITEMS_FILE = Path(__file__).parent.parent / "frontend/public/rules/magic-items.json"
PROGRESS_FILE = Path("/tmp/magic_items_desc_progress.json")

# 数据库配置
DATABASE_URL = "postgresql://haoli@localhost:5432/dnd_platform"

async def get_ai_config():
    """从数据库获取 AI API 配置"""
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        row = await conn.fetchrow("""
            SELECT api_url, api_key, model_name
            FROM ai_model_configs
            WHERE model_type = 'FAST'
            ORDER BY id
            LIMIT 1
        """)
        if row:
            return {
                "api_url": row['api_url'],
                "api_key": row['api_key'],
                "model_name": row['model_name']
            }
        return None
    finally:
        await conn.close()

def load_progress():
    """加载翻译进度"""
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {"translated": {}, "errors": []}

def save_progress(progress):
    """保存翻译进度"""
    with open(PROGRESS_FILE, 'w', encoding='utf-8') as f:
        json.dump(progress, f, ensure_ascii=False, indent=2)

async def translate_descriptions(client, model_name, items):
    """批量翻译物品描述"""
    # 构建翻译请求，用序号分隔
    descriptions = []
    for i, item in enumerate(items):
        desc = item.get('description', '') or ''
        descriptions.append(f"[{i+1}] {desc}")

    prompt = f"""请将以下D&D 5E魔法物品描述翻译成中文。保持简洁。
每条翻译前保留原始序号格式 [数字]，例如：
[1] 中文翻译内容
[2] 中文翻译内容

原文：
{chr(10).join(descriptions)}"""

    try:
        response = await client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": "你是D&D 5E翻译专家。翻译要准确简洁。"},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=3000
        )

        result_text = response.choices[0].message.content.strip()

        # 解析结果 - 按序号提取
        translations = {}
        import re
        matches = re.findall(r'\[(\d+)\]\s*(.+?)(?=\[\d+\]|$)', result_text, re.DOTALL)
        for idx, content in matches:
            translations[int(idx) - 1] = content.strip()

        return translations
    except Exception as e:
        print(f"  翻译错误: {e}")
        return None

async def main():
    print("获取 AI API 配置...")
    config = await get_ai_config()

    if not config:
        print("错误: 未找到 AI API 配置")
        return

    print(f"使用模型: {config['model_name']}")

    client = AsyncOpenAI(
        api_key=config['api_key'],
        base_url=config['api_url']
    )

    print("加载魔法物品数据...")
    with open(MAGIC_ITEMS_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    items = data['items']
    total = len(items)
    print(f"总计: {total} 件魔法物品")

    progress = load_progress()
    translated = progress['translated']
    print(f"已翻译描述: {len(translated)} 件")

    # 筛选未翻译的
    untranslated = [(i, item) for i, item in enumerate(items) if item['id'] not in translated]
    print(f"待翻译描述: {len(untranslated)} 件")

    if not untranslated:
        print("所有描述已翻译完成!")
    else:
        batch_size = 15
        for i in range(0, len(untranslated), batch_size):
            batch = untranslated[i:i+batch_size]
            batch_items = [item for _, item in batch]

            print(f"\n翻译进度: {len(translated)}/{total} ({len(translated)*100//total}%)")
            print(f"  正在翻译: {batch_items[0]['name']} 等 {len(batch_items)} 件...")

            translations = await translate_descriptions(client, config['model_name'], batch_items)

            if translations:
                for j, (orig_idx, item) in enumerate(batch):
                    if j in translations:
                        translated[item['id']] = translations[j]
                        print(f"    {item['name'][:15]}... -> {translations[j][:30]}...")

                save_progress({"translated": translated, "errors": progress['errors']})
            else:
                print(f"  警告: 翻译失败，跳过此批次")

            await asyncio.sleep(0.5)

    # 更新文件
    print("\n更新魔法物品文件...")
    for item in items:
        if item['id'] in translated:
            item['descriptionEn'] = item.get('description', '')
            item['description'] = translated[item['id']]

    with open(MAGIC_ITEMS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"\n完成! 已翻译 {len(translated)} 条描述")

    if PROGRESS_FILE.exists() and len(progress['errors']) == 0:
        PROGRESS_FILE.unlink()
        print("进度文件已清理")

if __name__ == "__main__":
    asyncio.run(main())
