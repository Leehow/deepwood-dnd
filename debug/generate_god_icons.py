"""
Generate D&D god icons based on their symbols
"""
import os
import sys
import httpx
import base64
import asyncio
import json
from pathlib import Path
from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)

API_KEY = os.getenv("TUZI_API_KEY")
API_BASE = "https://api.tu-zi.com/v1"
MODEL = "gemini-3-pro-image-preview"

OUTPUT_DIR = Path(__file__).parent.parent / "frontend/public/assets/god-icons_new"

STYLE_SUFFIX = (
    "divine deity portrait, full body majestic god figure, glowing divine halo, "
    "dark mystical background, D&D fantasy style, highly detailed, "
    "dramatic lighting, powerful godly presence, ornate divine armor or robes"
)

# Load gods from JSON
def load_gods():
    json_path = Path(__file__).parent.parent / "dnd-platform/configs/rules/gods.json"
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    gods = {}
    for pantheon in data.get("pantheons", []):
        for deity in pantheon.get("deities", []):
            god_id = deity["id"]
            name_en = deity["nameEn"]
            title_en = deity["titleEn"]
            symbol = deity.get("symbol", "divine symbol")
            alignment = deity.get("alignment", "N")
            domains = deity.get("domains", [])

            # Determine appearance based on alignment and domains
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

            # Gender hint from title
            if "goddess" in title_en.lower():
                gender = "beautiful goddess, feminine divine figure"
            else:
                gender = "powerful god, masculine divine figure"

            # Build description with symbol as held item or motif
            desc = f"{name_en}, {title_en}, {gender}, wearing {armor}, surrounded by {aura}, holding or displaying {symbol}"
            gods[god_id] = desc

    return gods

async def generate():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    gods = load_gods()
    print(f"Loaded {len(gods)} gods")
    print(f"Output: {OUTPUT_DIR}")
    print("=" * 50)

    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }

    success = 0
    total = len(gods)

    async with httpx.AsyncClient(timeout=180.0) as client:
        for i, (god_id, description) in enumerate(gods.items(), 1):
            prompt = f"{description}, {STYLE_SUFFIX}"
            payload = {
                "model": MODEL,
                "prompt": prompt,
                "n": 1,
                "size": "1024x1024",  # 1:1 ratio
                "response_format": "b64_json"
            }

            print(f"[{i}/{total}] {god_id}...")

            try:
                response = await client.post(
                    f"{API_BASE}/images/generations",
                    headers=headers,
                    json=payload
                )

                if response.status_code == 200:
                    result = response.json()
                    if "data" in result and result["data"]:
                        b64_data = result["data"][0].get("b64_json")
                        if b64_data:
                            image_data = base64.b64decode(b64_data)
                            output_path = OUTPUT_DIR / f"{god_id}.png"
                            output_path.write_bytes(image_data)
                            print(f"  [OK]")
                            success += 1
                        else:
                            print(f"  [ERROR] No b64_json")
                else:
                    print(f"  [ERROR] {response.status_code}")

            except Exception as e:
                print(f"  [ERROR] {e}")

            await asyncio.sleep(0.5)  # Rate limiting

    print("=" * 50)
    print(f"Total: {success}/{total}")

if __name__ == "__main__":
    asyncio.run(generate())
