"""Generate NPC avatars using Yunwu AI (Gemini image generation) - 1:1 portrait style for map tokens."""
import asyncio
import base64
import httpx
import json
import sys
from pathlib import Path

API_URL = "https://yunwu.ai/v1/chat/completions"
API_KEY = "REDACTED_API_KEY"
MODEL = "gemini-3-pro-image-preview"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "frontend" / "public" / "assets" / "npc-avatars"

# NPC portrait prompts - face/bust focused for circular token display
NPC_PROMPTS = {
    "commoner": "A medieval fantasy commoner, middle-aged peasant man with weathered face, brown cloak and simple clothes, warm tavern lighting",
    "guard": "A medieval city guard in chain mail armor with a plumed helmet, holding a spear and shield, stern face, standing at a city gate at night with torch light",
    "bandit": "A scruffy bandit rogue with a scarred face, leather armor, hood pulled back, menacing grin, forest background",
    "bandit_captain": "A charismatic bandit captain with an eye patch, studded leather armor, red sash, confident smirk, dual wielding daggers",
    "knight": "A noble knight in polished plate armor with a heraldic tabard, strong jaw, honorable expression, castle courtyard background",
    "veteran": "A grizzled veteran soldier with grey stubble and battle scars, worn chainmail, experienced determined eyes, military camp background",
    "mage": "A scholarly mage in deep blue robes with arcane symbols, holding a glowing staff, wise elderly face with long beard, tower library background",
    "priest": "A benevolent priest in white and gold vestments, holy symbol around neck, kind gentle face, temple interior with stained glass",
    "acolyte": "A young temple acolyte in simple brown robes with a holy symbol, youthful earnest face, candle-lit temple background",
    "noble": "An aristocratic noble in fine velvet clothing with gold embroidery, jeweled rings, proud refined features, luxurious manor background",
    "spy": "A mysterious spy in dark elegant clothing, half-face in shadow, sharp calculating eyes, hooded cloak, moonlit alley background",
    "assassin": "A deadly assassin in black leather armor with a mask pulled down to chin, cold piercing eyes, dual daggers, dark rooftop background",
    "thug": "A brutish thug with a broken nose and muscular build, leather vest over bare arms, brass knuckles, dark alley background",
    "cult_fanatic": "A fanatical cult leader in dark purple robes with occult symbols, wild zealous eyes, raised hands emanating dark magic, ritual chamber",
    "cultist": "A hooded cultist in dark robes with a sinister mask, shadowy figure, candle-lit underground chamber with ritual circle",
    "scout": "A wilderness scout in green and brown ranger gear, sharp alert eyes, bow on back, forest edge at dawn",
    "berserker": "A fierce berserker warrior with war paint on face, fur-lined armor, wild hair, battle axe, raging expression, snowy battlefield",
    "tribal_warrior": "A tribal warrior with face tattoos and bone necklace, leather and fur armor, spear and shield, campfire in dense jungle",
    "druid": "A wise druid with leaf-woven hair, natural bark-like armor, glowing green eyes, staff with living vines, ancient forest grove",
}

STYLE_SUFFIX = (
    ". D&D 5E fantasy art style, detailed portrait bust shot centered on face and upper body, "
    "dark moody atmospheric lighting, painterly digital art, square 1:1 composition, "
    "character fills the frame, suitable for circular game token display."
)


async def generate_avatar(client: httpx.AsyncClient, npc_id: str, prompt: str, semaphore: asyncio.Semaphore):
    """Generate a single NPC avatar."""
    full_prompt = prompt + STYLE_SUFFIX
    async with semaphore:
        print(f"  Generating {npc_id}...")
        try:
            resp = await client.post(
                API_URL,
                headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
                json={
                    "model": MODEL,
                    "messages": [{"role": "user", "content": full_prompt}],
                },
                timeout=120,
            )
            resp.raise_for_status()
            data = resp.json()

            # Extract base64 image from response
            choices = data.get("choices", [])
            if not choices:
                print(f"  [FAIL] {npc_id}: no choices in response")
                return False

            content = choices[0].get("message", {}).get("content")
            # content can be a string or a list of parts
            image_b64 = None
            if isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "image_url":
                        url_data = part.get("image_url", {}).get("url", "")
                        if url_data.startswith("data:"):
                            image_b64 = url_data.split(",", 1)[1]
                            break
                    elif isinstance(part, dict) and part.get("type") == "image":
                        image_b64 = part.get("data") or part.get("image", "")
                        break
            elif isinstance(content, str):
                # Format: ![image](data:image/jpeg;base64,xxxx) or raw base64
                import re
                m = re.search(r'data:image/[^;]+;base64,([A-Za-z0-9+/=\s]+)', content)
                if m:
                    image_b64 = m.group(1)
                elif len(content) > 1000 and not content.startswith("!"):
                    image_b64 = content  # raw base64 fallback

            if not image_b64:
                # Try alternate response structure
                for choice in choices:
                    msg = choice.get("message", {})
                    # Check for inline_data style
                    parts = msg.get("parts", [])
                    for part in parts:
                        if "inline_data" in part:
                            image_b64 = part["inline_data"].get("data", "")
                            break

            if not image_b64:
                print(f"  [FAIL] {npc_id}: could not extract image. Response keys: {list(data.keys())}")
                # Save response for debugging
                debug_path = OUTPUT_DIR / f"{npc_id}_debug.json"
                with open(debug_path, "w") as f:
                    # Truncate large values
                    debug_data = json.dumps(data, ensure_ascii=False, default=str)
                    if len(debug_data) > 5000:
                        debug_data = debug_data[:5000] + "...(truncated)"
                    f.write(debug_data)
                return False

            # Clean and fix base64 padding
            image_b64 = image_b64.strip().replace("\n", "").replace("\r", "").replace(" ", "")
            missing_padding = len(image_b64) % 4
            if missing_padding:
                image_b64 += "=" * (4 - missing_padding)

            # Decode and convert to 512x512 and 128x128 webp using PIL
            img_bytes = base64.b64decode(image_b64)
            from PIL import Image
            import io
            img = Image.open(io.BytesIO(img_bytes))
            if img.mode not in ('RGB', 'RGBA'):
                img = img.convert('RGB')

            # Center crop to 1:1 if not square
            w, h = img.size
            if w != h:
                size = min(w, h)
                left = (w - size) // 2
                top = (h - size) // 2
                img = img.crop((left, top, left + size, top + size))

            # Save 512x512
            img_512 = img.resize((512, 512), Image.LANCZOS)
            img_512.save(OUTPUT_DIR / f"{npc_id}_512.webp", "WEBP", quality=90)

            # Save 128x128
            img_128 = img.resize((128, 128), Image.LANCZOS)
            img_128.save(OUTPUT_DIR / f"{npc_id}_128.webp", "WEBP", quality=85)

            print(f"  [OK] {npc_id}")
            return True
        except Exception as e:
            print(f"  [FAIL] {npc_id}: {e}")
            return False


async def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Filter to specific NPCs if args provided
    targets = sys.argv[1:] if len(sys.argv) > 1 else list(NPC_PROMPTS.keys())
    tasks_to_run = {k: v for k, v in NPC_PROMPTS.items() if k in targets}

    print(f"Generating {len(tasks_to_run)} NPC avatars...")
    semaphore = asyncio.Semaphore(2)  # Max 2 concurrent requests

    async with httpx.AsyncClient() as client:
        tasks = [
            generate_avatar(client, npc_id, prompt, semaphore)
            for npc_id, prompt in tasks_to_run.items()
        ]
        results = await asyncio.gather(*tasks)

    ok = sum(1 for r in results if r)
    fail = sum(1 for r in results if not r)
    print(f"\nDone: {ok} succeeded, {fail} failed")


if __name__ == "__main__":
    asyncio.run(main())
