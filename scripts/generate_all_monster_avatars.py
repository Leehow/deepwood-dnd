#!/usr/bin/env python3
"""
批量生成预设怪物头像
使用 yunwu.ai gemini-3-pro-image-preview 生成头像
支持断点续传，自动更新 monsters.json

用法:
    python scripts/generate_all_monster_avatars.py              # 生成所有缺失的
    python scripts/generate_all_monster_avatars.py --batch 50   # 每批50个
    python scripts/generate_all_monster_avatars.py --dry-run    # 只显示待生成列表
"""
import os
import sys
import json
import httpx
import base64
import asyncio
import argparse
from pathlib import Path
from PIL import Image
from io import BytesIO
from datetime import datetime

# 配置
API_URL = "https://yunwu.ai/v1/chat/completions"
API_KEY = os.getenv("YUNWU_API_KEY", "")
MODEL = "gemini-3-pro-image-preview"

# 路径
MONSTERS_JSON = Path("dnd-platform/configs/npc/monsters.json")
FRONTEND_MONSTERS_JSON = Path("frontend/public/dnd-platform/configs/npc/monsters.json")
OUTPUT_DIR = Path("frontend/public/assets/monster-avatars")

# 敏感词替换（避免内容审核）
SENSITIVE_REPLACEMENTS = {
    "Demon": "Fiend",
    "Devil": "Infernal",
    "demon": "fiend",
    "devil": "infernal",
    "Cultist": "Fanatic",
    "cultist": "fanatic",
}


def sanitize_prompt(text: str) -> str:
    """替换敏感词"""
    result = text
    for old, new in SENSITIVE_REPLACEMENTS.items():
        result = result.replace(old, new)
    return result


async def generate_avatar(appearance_en: str, monster_name: str) -> bytes | None:
    """调用 AI 生成头像，返回图片 bytes"""
    sanitized_appearance = sanitize_prompt(appearance_en)
    sanitized_name = sanitize_prompt(monster_name)

    prompt = f"""Generate a fantasy style monster portrait avatar for a D&D creature.

Monster: {sanitized_name}
Appearance: {sanitized_appearance}

Requirements:
- Square portrait format, dark fantasy style
- Oil painting quality, detailed and realistic
- Dark atmospheric background
- Centered composition, front-facing or 3/4 view
- Epic fantasy monster art style like official D&D Monster Manual illustrations
- NO TEXT, NO LABELS, NO UI ELEMENTS
"""

    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            resp = await client.post(API_URL, headers=headers, json=payload)
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 400:
                print(f"    ! Content moderation blocked (400)")
                return None
            raise

        data = resp.json()

        if "choices" not in data or not data["choices"]:
            return None

        message = data["choices"][0].get("message", {})

        # Gemini images 字段
        if "images" in message and message["images"]:
            image_url = message["images"][0].get("image_url", {}).get("url", "")
            if image_url:
                img_resp = await client.get(image_url)
                img_resp.raise_for_status()
                return img_resp.content

        # content 字段
        content = message.get("content", "")
        if content:
            if content.startswith("http"):
                img_resp = await client.get(content)
                img_resp.raise_for_status()
                return img_resp.content
            else:
                try:
                    if "," in content:
                        content = content.split(",", 1)[1]
                    return base64.b64decode(content)
                except Exception:
                    pass

        return None


def process_image(image_data: bytes, monster_id: str) -> tuple[Path, Path]:
    """处理图片：转换为 128x128 和 512x512 的 webp"""
    img = Image.open(BytesIO(image_data))

    if img.mode == 'P':
        img = img.convert('RGBA')
    elif img.mode not in ('RGB', 'RGBA'):
        img = img.convert('RGB')

    # 小图 128x128
    img_small = img.copy()
    img_small = img_small.resize((128, 128), Image.Resampling.LANCZOS)
    small_path = OUTPUT_DIR / f"{monster_id}_128.webp"
    img_small.save(small_path, format='WEBP', quality=85, method=4)

    # 大图 512x512
    img_large = img.copy()
    img_large = img_large.resize((512, 512), Image.Resampling.LANCZOS)
    large_path = OUTPUT_DIR / f"{monster_id}_512.webp"
    img_large.save(large_path, format='WEBP', quality=85, method=4)

    return small_path, large_path


def get_pending_monsters(data: dict) -> list[dict]:
    """获取待生成头像的怪物列表"""
    pending = []
    for monster in data['monsters']:
        # 跳过已有默认头像的
        if monster.get('defaultAvatarSmall'):
            continue
        # 必须有英文外观描述
        if not monster.get('appearanceEn'):
            continue
        pending.append(monster)
    return pending


async def main():
    parser = argparse.ArgumentParser(description='批量生成预设怪物头像')
    parser.add_argument('--batch', type=int, default=0, help='每批生成数量，0=全部')
    parser.add_argument('--dry-run', action='store_true', help='只显示待生成列表')
    parser.add_argument('--start-from', type=str, help='从指定ID开始')
    args = parser.parse_args()

    # 创建输出目录
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 读取怪物数据
    with open(MONSTERS_JSON, 'r', encoding='utf-8') as f:
        data = json.load(f)

    pending = get_pending_monsters(data)

    # 从指定ID开始
    if args.start_from:
        start_idx = next((i for i, m in enumerate(pending) if m['id'] == args.start_from), 0)
        pending = pending[start_idx:]

    # 限制批量大小
    if args.batch > 0:
        pending = pending[:args.batch]

    print(f"=== 预设怪物头像批量生成 ===")
    print(f"待生成: {len(pending)} 个怪物")
    print(f"API: {API_URL}")
    print(f"Model: {MODEL}")
    print(f"Output: {OUTPUT_DIR}\n")

    if args.dry_run:
        print("待生成列表:")
        for m in pending:
            print(f"  - {m['id']}: {m['name']} ({m.get('size', '?')}, CR {m.get('cr', '?')})")
        return

    # 生成头像
    success = 0
    failed = 0
    monsters_by_id = {m['id']: m for m in data['monsters']}

    for i, monster in enumerate(pending):
        mid = monster['id']
        name = monster.get('name', mid)
        name_en = monster.get('nameEn', mid)
        appearance_en = monster.get('appearanceEn', '')

        print(f"[{i+1}/{len(pending)}] {name} ({name_en})")

        try:
            image_data = await generate_avatar(appearance_en, name_en)

            if image_data:
                small_path, large_path = process_image(image_data, mid)

                # 更新 monsters.json
                monsters_by_id[mid]['defaultAvatarSmall'] = f"/assets/monster-avatars/{mid}_128.webp"
                monsters_by_id[mid]['defaultAvatarLarge'] = f"/assets/monster-avatars/{mid}_512.webp"

                print(f"  ✓ Saved: {small_path.name}, {large_path.name}")
                success += 1
            else:
                print(f"  ✗ Failed to generate")
                failed += 1

        except Exception as e:
            print(f"  ✗ Error: {e}")
            failed += 1

        # 每10个保存一次进度
        if (i + 1) % 10 == 0:
            with open(MONSTERS_JSON, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print(f"  [Progress saved at {i+1}]")

        # 避免 rate limit
        await asyncio.sleep(2)

    # 最终保存
    with open(MONSTERS_JSON, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # 同步到 frontend
    with open(FRONTEND_MONSTERS_JSON, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"\n=== 完成 ===")
    print(f"成功: {success}, 失败: {failed}")
    print(f"JSON 已更新: {MONSTERS_JSON}")


if __name__ == "__main__":
    asyncio.run(main())
