#!/usr/bin/env python3
"""
修复怪物阵营数据的脚本
使用参考 Markdown 文件和 LLM 来修正错误的阵营值
"""

import json
import re
import os
from pathlib import Path

# 标准阵营值
VALID_ALIGNMENTS = {
    '守序善良', '中立善良', '混乱善良',
    '守序中立', '绝对中立', '混乱中立',
    '守序邪恶', '中立邪恶', '混乱邪恶',
    '无阵营',
    # 灵活阵营 (NPC等)
    '任意阵营', '任意善良阵营', '任意邪恶阵营',
    '任意中立阵营', '任意混乱阵营', '任意守序阵营',
    '任意非善良阵营', '任意非邪恶阵营',
}

# 阵营匹配正则 - 从 Markdown 中提取
ALIGNMENT_PATTERN = re.compile(
    r'(?:中型|小型|大型|超大型|微型|巨型)[^,，]+[,，]\s*'
    r'(守序善良|中立善良|混乱善良|守序中立|绝对中立|混乱中立|守序邪恶|中立邪恶|混乱邪恶|无阵营|'
    r'任意阵营|任意善良阵营|任意邪恶阵营|任意中立阵营|任意混乱阵营|任意守序阵营|'
    r'任意非善良阵营|任意非邪恶阵营|unaligned)',
    re.IGNORECASE
)


def load_reference_md(md_path: str) -> str:
    """加载参考 Markdown 文件"""
    with open(md_path, 'r', encoding='utf-8') as f:
        return f.read()


def extract_alignment_from_md(md_content: str, monster_name: str, monster_name_en: str) -> str | None:
    """从 Markdown 中提取怪物的阵营"""
    # 尝试多种搜索模式
    patterns = [
        # 模式1: 英文名后跟阵营信息
        rf'{re.escape(monster_name_en)}\s+[^#]*?(?:中型|小型|大型|超大型|微型|巨型)[^,，]+[,，]\s*'
        rf'(守序善良|中立善良|混乱善良|守序中立|绝对中立|混乱中立|守序邪恶|中立邪恶|混乱邪恶|无阵营|'
        rf'任意阵营|任意善良阵营|任意邪恶阵营|任意中立阵营|任意混乱阵营|任意守序阵营|'
        rf'任意非善良阵营|任意非邪恶阵营|unaligned)',
        # 模式2: 中文名后跟阵营
        rf'{re.escape(monster_name)}\s+[^#]*?(?:中型|小型|大型|超大型|微型|巨型)[^,，]+[,，]\s*'
        rf'(守序善良|中立善良|混乱善良|守序中立|绝对中立|混乱中立|守序邪恶|中立邪恶|混乱邪恶|无阵营|'
        rf'任意阵营|任意善良阵营|任意邪恶阵营|任意中立阵营|任意混乱阵营|任意守序阵营|'
        rf'任意非善良阵营|任意非邪恶阵营|unaligned)',
    ]

    for pattern in patterns:
        match = re.search(pattern, md_content, re.IGNORECASE | re.DOTALL)
        if match:
            alignment = match.group(1)
            if alignment.lower() == 'unaligned':
                return '无阵营'
            return alignment

    return None


def find_invalid_alignments(monsters: list) -> list:
    """找出所有无效的阵营值"""
    invalid = []
    for m in monsters:
        alignment = m.get('alignment', '')
        if not alignment:
            invalid.append(m)
        elif alignment not in VALID_ALIGNMENTS:
            invalid.append(m)
    return invalid


def fix_alignments(monsters_path: str, md_path: str, output_path: str = None):
    """主修复函数"""
    # 加载数据
    with open(monsters_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    md_content = load_reference_md(md_path)

    # 找出无效阵营
    invalid = find_invalid_alignments(data['monsters'])
    print(f"找到 {len(invalid)} 个需要修复的怪物阵营")

    fixed_count = 0
    manual_review = []

    for monster in invalid:
        name = monster.get('name', '')
        name_en = monster.get('nameEn', '')
        old_alignment = monster.get('alignment', '(空)')

        # 从 MD 中提取正确阵营
        new_alignment = extract_alignment_from_md(md_content, name, name_en)

        if new_alignment:
            # 在原数据中更新
            for m in data['monsters']:
                if m['id'] == monster['id']:
                    m['alignment'] = new_alignment
                    fixed_count += 1
                    print(f"  [已修复] {name} ({name_en}): '{old_alignment[:30]}...' -> '{new_alignment}'")
                    break
        else:
            manual_review.append({
                'id': monster['id'],
                'name': name,
                'nameEn': name_en,
                'current': old_alignment[:50] + '...' if len(old_alignment) > 50 else old_alignment
            })

    # 保存修复后的数据
    output = output_path or monsters_path
    with open(output, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"\n修复完成: {fixed_count}/{len(invalid)} 个已自动修复")

    if manual_review:
        print(f"\n以下 {len(manual_review)} 个需要手动检查:")
        for item in manual_review:
            print(f"  - {item['name']} ({item['nameEn']}): {item['current']}")

    return manual_review


if __name__ == '__main__':
    base_dir = Path(__file__).parent.parent

    monsters_path = base_dir / 'dnd-platform/configs/npc/monsters.json'
    md_path = base_dir / 'trpg/DND_5E_怪物图鉴CN_2025-10-27-11_59_20/DND_5E_怪物图鉴CN.md'

    print("开始修复怪物阵营数据...")
    print(f"怪物数据: {monsters_path}")
    print(f"参考文档: {md_path}")
    print()

    manual = fix_alignments(str(monsters_path), str(md_path))
