"""
Generate missing D&D god icons using Yunwu AI (gemini-3-pro-image-preview)
"""
import os
import re
import httpx
import base64
import asyncio
import json
from pathlib import Path

API_KEY = "REDACTED_API_KEY"
API_BASE = "https://yunwu.ai/v1"
MODEL = "gemini-3-pro-image-preview"

ICONS_DIR = Path(__file__).parent.parent / "frontend/public/assets/god-icons"

STYLE_SUFFIX = (
    "divine deity portrait, full body majestic god figure, glowing divine halo, "
    "dark mystical background, D&D fantasy style, highly detailed, "
    "dramatic lighting, powerful godly presence, ornate divine armor or robes, "
    "digital painting, square composition, centered figure"
)

B64_PATTERN = re.compile(
    r'data:image/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)'
)


def load_missing_gods():
    json_path = (
        Path(__file__).parent.parent / "frontend/app/data/rules/gods.json"
    )
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    existing = set(
        f.replace('.png', '').replace('.jpg', '')
        for f in os.listdir(ICONS_DIR)
        if f.endswith(('.png', '.jpg'))
    )

    gods = {}
    for pantheon in data.get("pantheons", []):
        for deity in pantheon.get("deities", []):
            god_id = deity["id"]
            if god_id in existing:
                continue

            name_en = deity["nameEn"]
            title_en = deity["titleEn"]
            symbol = deity.get("symbol", "divine symbol")
            alignment = deity.get("alignment", "N")

            if alignment.startswith("L") and "G" in alignment:
                aura = "radiant golden light and holy aura"
                armor = "shining golden plate armor"
            elif alignment.startswith("C") and "G" in alignment:
                aura = "silver and blue celestial glow"
                armor = "elegant silver armor with nature motifs"
            elif "E" in alignment:
                aura = "dark purple and red ominous energy"
                armor = "menacing dark armor with spikes"
            elif alignment == "N":
                aura = "balanced mystical energy"
                armor = "neutral robes with natural elements"
            else:
                aura = "mystical blue and silver light"
                armor = "ornate ceremonial armor"

            if "goddess" in title_en.lower():
                gender = "beautiful goddess, feminine divine figure"
            else:
                gender = "powerful god, masculine divine figure"

            desc = (
                f"{name_en}, {title_en}, {gender}, "
                f"wearing {armor}, surrounded by {aura}, "
                f"holding or displaying {symbol}"
            )
            gods[god_id] = desc

    return gods


def extract_image_from_response(result):
    """Extract base64 image data from various response formats."""
    choices = result.get("choices", [])
    if not choices:
        return None

    msg = choices[0].get("message", {})
    content = msg.get("content", "")

    # Format 1: text with markdown image ![...](data:image/...;base64,...)
    if isinstance(content, str):
        match = B64_PATTERN.search(content)
        if match:
            return base64.b64decode(match.group(1))

    # Format 2: structured content array
    if isinstance(content, list):
        for part in content:
            if part.get("type") == "image_url":
                url = part["image_url"]["url"]
                if url.startswith("data:"):
                    match = B64_PATTERN.search(url)
                    if match:
                        return base64.b64decode(match.group(1))

    return None


async def generate_icon(client, headers, god_id, description, index, total):
    prompt = f"{description}, {STYLE_SUFFIX}"
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "max_tokens": 8192
    }

    print(f"[{index}/{total}] {god_id}...", flush=True)

    for attempt in range(3):
        try:
            response = await client.post(
                f"{API_BASE}/chat/completions",
                headers=headers,
                json=payload
            )

            if response.status_code == 200:
                result = response.json()
                image_data = extract_image_from_response(result)
                if image_data:
                    output_path = ICONS_DIR / f"{god_id}.png"
                    output_path.write_bytes(image_data)
                    size_kb = len(image_data) // 1024
                    print(f"  [OK] {size_kb}KB", flush=True)
                    return True
                else:
                    print(
                        f"  [WARN] No image found (attempt {attempt+1})",
                        flush=True
                    )
            elif response.status_code == 429:
                print(f"  [RATE] waiting...", flush=True)
                await asyncio.sleep(10)
            else:
                print(
                    f"  [ERR] HTTP {response.status_code}",
                    flush=True
                )

        except Exception as e:
            print(f"  [ERR] {e} (attempt {attempt+1})", flush=True)

        await asyncio.sleep(3)

    print(f"  [FAIL] {god_id}", flush=True)
    return False


async def generate():
    gods = load_missing_gods()
    if not gods:
        print("All god icons present!")
        return

    print(f"Missing: {len(gods)} icons")
    print(f"Output:  {ICONS_DIR}")
    print("=" * 50, flush=True)

    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }

    success = 0
    total = len(gods)

    async with httpx.AsyncClient(timeout=180.0) as client:
        for i, (god_id, desc) in enumerate(gods.items(), 1):
            ok = await generate_icon(
                client, headers, god_id, desc, i, total
            )
            if ok:
                success += 1
            await asyncio.sleep(1.5)

    print("=" * 50)
    print(f"Done: {success}/{total}", flush=True)


if __name__ == "__main__":
    asyncio.run(generate())
