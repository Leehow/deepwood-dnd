"""
Regenerate specific D&D images
"""
import os
import sys
import httpx
import base64
import asyncio
from pathlib import Path
from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)

API_KEY = os.getenv("TUZI_API_KEY")
API_BASE = "https://api.tu-zi.com/v1"
MODEL = "gemini-3-pro-image-preview"

STYLE_SUFFIX = (
    "digital art, semi-realistic fantasy style, dark moody background, "
    "magical glowing effects, dramatic lighting, upper body portrait, "
    "highly detailed, D&D 5e aesthetic, cinematic composition"
)

# Images to regenerate
REGENERATE = {
    "frontend/public/images/action-buttons_new/hide.png":
        "Cloaked figure melting into shadows, stealth action, dark purple and black mist, digital art, dramatic lighting, dark background with vibrant energy effects, D&D fantasy style, iconic symbol, game UI button art, highly detailed",
    "frontend/public/images/action-buttons_new/greet.png":
        "Two hands in friendly handshake, welcoming gesture, warm amber glow, digital art, dramatic lighting, dark background with vibrant energy effects, D&D fantasy style, iconic symbol, game UI button art, highly detailed"
}

async def regenerate():
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }

    async with httpx.AsyncClient(timeout=180.0) as client:
        for filepath, description in REGENERATE.items():
            output_path = Path(__file__).parent.parent / filepath
            name = output_path.stem

            prompt = f"{description}, {STYLE_SUFFIX}"
            payload = {
                "model": MODEL,
                "prompt": prompt,
                "n": 1,
                "size": "1600x896",
                "response_format": "b64_json"
            }

            print(f"Regenerating: {name}...")

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
                            output_path.write_bytes(image_data)
                            print(f"  [OK] Saved: {output_path}")
                        else:
                            print(f"  [ERROR] No b64_json")
                else:
                    print(f"  [ERROR] {response.status_code}")

            except Exception as e:
                print(f"  [ERROR] {e}")

            await asyncio.sleep(1)

if __name__ == "__main__":
    asyncio.run(regenerate())
