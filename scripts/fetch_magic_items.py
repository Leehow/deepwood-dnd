#!/usr/bin/env python3
"""
从 D&D 5E API 获取魔法物品，支持断点续传
"""
import json
import requests
from pathlib import Path
from time import sleep

PROGRESS_FILE = Path("/tmp/magic_items_progress.json")
OUTPUT_FILE = Path(__file__).parent.parent / "frontend/public/rules/magic-items.json"

RARITY_CN = {
    'Common': '普通', 'Uncommon': '罕见', 'Rare': '稀有',
    'Very Rare': '非常稀有', 'Legendary': '传说', 'Artifact': '神器', 'Varies': '不定'
}
CATEGORY_CN = {
    'Armor': '护甲', 'Potion': '药水', 'Ring': '戒指', 'Rod': '权杖',
    'Scroll': '卷轴', 'Staff': '法杖', 'Wand': '魔杖', 'Weapon': '武器',
    'Wondrous Item': '奇物', 'Wondrous item': '奇物'
}

def load_progress():
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {"fetched": {}, "errors": []}

def save_progress(progress):
    with open(PROGRESS_FILE, 'w', encoding='utf-8') as f:
        json.dump(progress, f, ensure_ascii=False)

def main():
    print("获取魔法物品列表...")
    resp = requests.get("https://www.dnd5eapi.co/api/2014/magic-items", timeout=30)
    items_list = resp.json()
    total = items_list['count']
    print(f"总计: {total} 件")

    progress = load_progress()
    fetched = progress["fetched"]
    print(f"已有进度: {len(fetched)} 件")

    for i, item in enumerate(items_list['results']):
        item_id = item['index']

        # 跳过已获取的
        if item_id in fetched:
            continue

        if (i + 1) % 20 == 0 or i == 0:
            print(f"  进度: {len(fetched)}/{total} ({len(fetched)*100//total}%)")

        try:
            resp = requests.get(f"https://www.dnd5eapi.co{item['url']}", timeout=10)
            data = resp.json()

            fetched[item_id] = {
                'id': data['index'],
                'name': data['name'],
                'nameEn': data['name'],
                'rarity': data.get('rarity', {}).get('name', 'Unknown'),
                'rarityCn': RARITY_CN.get(data.get('rarity', {}).get('name', ''), '未知'),
                'category': data.get('equipment_category', {}).get('name', 'Unknown'),
                'categoryCn': CATEGORY_CN.get(data.get('equipment_category', {}).get('name', ''), '其他'),
                'requiresAttunement': data.get('requires_attunement', False),
                'description': (data.get('desc', [''])[0][:300] if data.get('desc') else ''),
            }

            # 每20个保存一次进度
            if len(fetched) % 20 == 0:
                save_progress({"fetched": fetched, "errors": progress["errors"]})

            sleep(0.02)

        except Exception as e:
            print(f"  错误: {item_id} - {e}")
            progress["errors"].append(item_id)

    # 保存最终进度
    save_progress({"fetched": fetched, "errors": progress["errors"]})

    # 生成输出文件
    items = list(fetched.values())
    output = {
        'description': 'D&D 5E 魔法物品数据库',
        'descriptionEn': 'D&D 5E Magic Items Database',
        'source': 'D&D 5E API',
        'totalCount': len(items),
        'items': items
    }

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n完成! {len(items)} 件魔法物品已保存到 {OUTPUT_FILE}")

    # 清理进度文件
    if PROGRESS_FILE.exists():
        PROGRESS_FILE.unlink()
        print("进度文件已清理")

if __name__ == "__main__":
    main()
