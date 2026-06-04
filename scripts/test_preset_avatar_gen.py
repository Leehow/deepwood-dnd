#!/usr/bin/env python3
"""
测试预设怪物头像生成
使用 yunwu.ai gemini-3-pro-image-preview 生成头像
"""
import os
import sys
import json
import httpx
import base64
import asyncio
from pathlib import Path
from PIL import Image
from io import BytesIO

# 配置
API_URL = "https://yunwu.ai/v1/chat/completions"
API_KEY = os.getenv("YUNWU_API_KEY", "")
MODEL = "gemini-3-pro-image-preview"

# 测试怪物 ID 列表
TEST_MONSTER_IDS = ["goblin", "minotaur", "owlbear", "skeletons", "troll"]

# 输出目录
OUTPUT_DIR = Path("scripts/test_avatars")


async def generate_avatar(appearance_en: str, monster_name: str) -> bytes | None:
    """调用 AI 生成头像，返回图片 bytes"""
    prompt = f"""Generate a fantasy style monster portrait avatar for a D&D creature.

Monster: {monster_name}
Appearance: {appearance_en}

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

    print(f"  Calling API for {monster_name}...", flush=True)

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(API_URL, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()

        if "choices" not in data or not data["choices"]:
            print(f"  ERROR: No choices in response")
            return None

        message = data["choices"][0].get("message", {})

        # 检查 images 字段 (Gemini 格式)
        if "images" in message and message["images"]:
            image_url = message["images"][0].get("image_url", {}).get("url", "")
            if image_url:
                print(f"  Got image URL, downloading...")
                img_resp = await client.get(image_url)
                img_resp.raise_for_status()
                return img_resp.content

        # 检查 content 字段中的 base64
        content = message.get("content", "")
        if content and not content.startswith("http"):
            # 可能是 base64
            try:
                if "," in content:
                    content = content.split(",", 1)[1]
                return base64.b64decode(content)
            except Exception:
                pass

        # 检查 content 是否是 URL
        if content and content.startswith("http"):
            print(f"  Got image URL in content, downloading...")
            img_resp = await client.get(content)
            img_resp.raise_for_status()
            return img_resp.content

        print(f"  ERROR: Could not extract image from response")
        print(f"  Response: {str(data)[:500]}")
        return None


def process_image(image_data: bytes, monster_id: str) -> tuple[Path, Path]:
    """处理图片：转换为 128x128 和 512x512 的 webp"""
    img = Image.open(BytesIO(image_data))

    # 转换模式
    if img.mode == 'P':
        img = img.convert('RGBA')
    elif img.mode not in ('RGB', 'RGBA'):
        img = img.convert('RGB')

    # 生成小图 128x128
    img_small = img.copy()
    img_small = img_small.resize((128, 128), Image.Resampling.LANCZOS)
    small_path = OUTPUT_DIR / f"{monster_id}_128.webp"
    img_small.save(small_path, format='WEBP', quality=85, method=4)

    # 生成大图 512x512
    img_large = img.copy()
    img_large = img_large.resize((512, 512), Image.Resampling.LANCZOS)
    large_path = OUTPUT_DIR / f"{monster_id}_512.webp"
    img_large.save(large_path, format='WEBP', quality=85, method=4)

    return small_path, large_path


async def main():
    # 创建输出目录
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 读取怪物数据
    monsters_path = Path("dnd-platform/configs/npc/monsters.json")
    with open(monsters_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    monsters = {m['id']: m for m in data['monsters']}

    print(f"=== 预设怪物头像生成测试 ===\n")
    print(f"API: {API_URL}")
    print(f"Model: {MODEL}")
    print(f"Output: {OUTPUT_DIR}\n")

    results = []

    for monster_id in TEST_MONSTER_IDS:
        if monster_id not in monsters:
            print(f"[SKIP] {monster_id} not found")
            continue

        monster = monsters[monster_id]
        name = monster.get('name', monster_id)
        name_en = monster.get('nameEn', monster_id)
        appearance_en = monster.get('appearanceEn', '')

        if not appearance_en:
            print(f"[SKIP] {name} ({name_en}) - no appearanceEn")
            continue

        print(f"[{monster_id}] {name} ({name_en})")
        print(f"  Size: {monster.get('size', '?')}, CR: {monster.get('cr', '?')}")

        try:
            # 生成头像
            image_data = await generate_avatar(appearance_en, name_en)

            if image_data:
                # 处理并保存
                small_path, large_path = process_image(image_data, monster_id)
                print(f"  ✓ Saved: {small_path.name}, {large_path.name}")

                results.append({
                    "id": monster_id,
                    "name": name,
                    "nameEn": name_en,
                    "small": str(small_path),
                    "large": str(large_path),
                    "status": "success"
                })
            else:
                print(f"  ✗ Failed to generate")
                results.append({
                    "id": monster_id,
                    "name": name,
                    "status": "failed"
                })

        except Exception as e:
            print(f"  ✗ Error: {e}")
            results.append({
                "id": monster_id,
                "name": name,
                "status": "error",
                "error": str(e)
            })

        print()
        # 避免 rate limit
        await asyncio.sleep(2)

    # 保存结果
    result_path = OUTPUT_DIR / "results.json"
    with open(result_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"=== 完成 ===")
    print(f"Results saved to {result_path}")

    # 统计
    success = sum(1 for r in results if r.get('status') == 'success')
    print(f"Success: {success}/{len(results)}")


if __name__ == "__main__":
    asyncio.run(main())
