"""
Generate D&D action button images
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

OUTPUT_DIR = Path(__file__).parent.parent / "frontend/public/images/action-buttons_new"

STYLE_SUFFIX = (
    "digital art, dramatic lighting, dark background with vibrant energy effects, "
    "D&D fantasy style, iconic symbol, game UI button art, highly detailed"
)

# Action buttons with descriptions
ACTIONS = {
    "attack": "Crossed swords and battleaxe with fiery explosion, aggressive combat action, red and orange flames",
    "dash": "Speed lines and wind trails, running boots with motion blur, blue and white energy streaks",
    "disengage": "Figure leaping backward away from danger, defensive retreat, smoke and shadows",
    "dodge": "Agile figure in mid-roll dodge, arrows and attacks missing, green defensive aura",
    "encourage": "Raised fist with golden inspiring light, rallying cry symbol, warm yellow and gold energy",
    "give": "Open hands offering a glowing item, generous gesture, soft white and blue light",
    "greet": "Two hands in friendly handshake, welcoming gesture, warm amber glow",
    "hide": "Cloaked figure melting into shadows, stealth action, dark purple and black mist",
    "ready": "Warrior in defensive stance with shield raised, prepared for action, silver and steel glow",
    "search": "Magnifying glass with glowing eye symbol, investigation action, golden light beams",
    "steal": "Quick hand snatching a coin purse, sleight of hand, dark shadows with glinting gold",
    "talk": "Speech bubbles with diplomatic symbols, conversation action, soft blue communication aura",
    "use-item": "Glowing potion bottle and magical scroll, item activation, multicolored magical sparkles"
}

async def generate():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }

    print(f"Output: {OUTPUT_DIR}")
    print("=" * 50)

    success = 0
    async with httpx.AsyncClient(timeout=180.0) as client:
        for name, description in ACTIONS.items():
            prompt = f"{description}, {STYLE_SUFFIX}"
            payload = {
                "model": MODEL,
                "prompt": prompt,
                "n": 1,
                "size": "1600x896",
                "response_format": "b64_json"
            }

            print(f"Generating: {name}...")

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
                            output_path = OUTPUT_DIR / f"{name}.png"
                            output_path.write_bytes(image_data)
                            print(f"  [OK] {name}.png")
                            success += 1
                        else:
                            print(f"  [ERROR] No b64_json")
                else:
                    print(f"  [ERROR] {response.status_code}")

            except Exception as e:
                print(f"  [ERROR] {e}")

            await asyncio.sleep(1)

    print("=" * 50)
    print(f"Total: {success}/{len(ACTIONS)}")

if __name__ == "__main__":
    asyncio.run(generate())
