#!/usr/bin/env python3
"""
Generate avatars for preset NPCs using AI image generation.
Uses yunwu.ai's gemini-3-pro-image-preview model.
"""

import os
import sys
import json
import base64
import re
import requests
from pathlib import Path
from PIL import Image
from io import BytesIO

# Configuration
API_URL = "https://yunwu.ai/v1/chat/completions"
API_KEY = os.environ.get("YUNWU_API_KEY", "")
MODEL = "gemini-3-pro-image-preview"

# Paths
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
NPC_JSON_PATH = PROJECT_ROOT / "frontend/public/rules/npc-templates.json"
OUTPUT_DIR = PROJECT_ROOT / "frontend/public/assets/npc-avatars"

# NPC appearance descriptions (English for better AI image generation)
NPC_APPEARANCES = {
    "commoner": "A humble medieval peasant, wearing simple brown linen clothes, weathered face from outdoor labor, middle-aged human",
    "guard": "A city guard in chainmail armor with a round shield, wearing a helmet with a crest, stern expression, holding a spear",
    "bandit": "A rugged outlaw in worn leather armor, scarred face, unkempt hair, holding a curved scimitar, dangerous look",
    "bandit_captain": "A charismatic bandit leader in studded leather armor, confident smirk, multiple weapons at belt, dark cloak",
    "knight": "A noble knight in shining plate armor, wearing a surcoat with heraldic symbols, dignified posture, holding a greatsword",
    "veteran": "A battle-hardened warrior with gray-streaked hair, wearing splint armor, multiple scars, wise and weathered eyes",
    "mage": "An arcane wizard in flowing purple robes, holding a glowing staff, mystical symbols on clothes, wise elderly face",
    "priest": "A holy priest in white and gold vestments, wearing a religious symbol pendant, kind face, holding a sacred mace",
    "acolyte": "A young temple apprentice in simple white robes, carrying sacred texts, youthful innocent face, humble posture",
    "noble": "An aristocrat in fine silk clothes with gold embroidery, wearing a breastplate, elegant rapier at side, proud bearing",
    "spy": "A mysterious agent in dark practical clothes, shadowy hood partially covering face, alert watchful eyes, subtle pose",
    "assassin": "A deadly killer in black studded leather, masked face with cold calculating eyes, twin daggers ready",
    "thug": "A brutal enforcer with a shaved head, muscular build, leather armor, menacing expression, heavy mace",
    "cult_fanatic": "A zealous cult leader in dark robes with occult symbols, wild fanatical eyes, holding a ritual dagger",
    "cultist": "A hooded cultist in dark tattered robes, half-hidden face, sinister aura, curved blade",
    "scout": "A wilderness tracker in green-brown leather armor, carrying a longbow, alert keen eyes, forest camouflage",
    "berserker": "A fierce barbarian warrior with wild hair, wearing fur and hide armor, battle rage in eyes, massive greataxe",
    "tribal_warrior": "A primitive tribal fighter with tribal tattoos, wearing animal hide armor, carrying a wooden spear, fierce",
    "druid": "A nature priest in earth-tone robes with leaf patterns, wooden staff with living vines, serene wise expression"
}


def sanitize_filename(name: str) -> str:
    """Remove special characters from filename."""
    return re.sub(r'[/\\:*?"<>|\s]', '_', name)


def extract_base64_from_response(content: str) -> str | None:
    """Extract base64 image data from various response formats."""
    # Format 1: Markdown format ![image](data:image/...;base64,...)
    md_match = re.search(r'!\[.*?\]\(data:image/[^;]+;base64,([A-Za-z0-9+/=]+)\)', content)
    if md_match:
        return md_match.group(1)

    # Format 2: Direct base64 string
    b64_match = re.search(r'([A-Za-z0-9+/]{100,}={0,2})', content)
    if b64_match:
        return b64_match.group(1)

    return None


def generate_avatar(npc_id: str, appearance: str) -> bytes | None:
    """Generate an avatar image using AI."""
    prompt = f"""Generate a fantasy RPG character portrait for a D&D 5E NPC.

Character: {appearance}

Style requirements:
- Digital fantasy art style, high quality
- Portrait composition (head and upper body)
- Dark atmospheric background
- Dramatic lighting
- Detailed facial features and equipment
- Medieval fantasy aesthetic"""

    try:
        response = requests.post(
            API_URL,
            headers={
                "Authorization": f"Bearer {API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": MODEL,
                "messages": [{"role": "user", "content": prompt}]
            },
            timeout=120
        )
        response.raise_for_status()

        data = response.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

        if not content:
            print(f"  [ERROR] Empty response for {npc_id}")
            return None

        # Extract base64 data
        b64_data = extract_base64_from_response(content)
        if not b64_data:
            print(f"  [ERROR] No image data found for {npc_id}")
            print(f"  Response preview: {content[:200]}...")
            return None

        return base64.b64decode(b64_data)

    except Exception as e:
        print(f"  [ERROR] Failed to generate for {npc_id}: {e}")
        return None


def process_image(image_data: bytes, size: int) -> bytes:
    """Resize image and convert to WebP."""
    img = Image.open(BytesIO(image_data))

    # Convert to RGB if necessary
    if img.mode in ('RGBA', 'P'):
        img = img.convert('RGB')

    # Resize with high quality
    img = img.resize((size, size), Image.Resampling.LANCZOS)

    # Save as WebP
    output = BytesIO()
    img.save(output, format='WEBP', quality=90)
    return output.getvalue()


def main():
    print("=" * 60)
    print("NPC Avatar Generation Script")
    print("=" * 60)

    # Create output directory
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Load NPC data
    with open(NPC_JSON_PATH, 'r', encoding='utf-8') as f:
        npc_data = json.load(f)

    npcs = npc_data.get("npcs", [])
    print(f"Found {len(npcs)} NPCs to process")
    print()

    # Track results
    success_count = 0
    failed = []

    for i, npc in enumerate(npcs):
        npc_id = npc.get("id", "")
        name = npc.get("name", "")
        name_en = npc.get("nameEn", "")

        print(f"[{i+1}/{len(npcs)}] Processing: {name} ({name_en})")

        # Check if already has avatar
        safe_id = sanitize_filename(npc_id)
        small_path = OUTPUT_DIR / f"{safe_id}_128.webp"
        large_path = OUTPUT_DIR / f"{safe_id}_512.webp"

        if small_path.exists() and large_path.exists():
            print(f"  [SKIP] Already has avatars")
            # Update JSON anyway
            npc["defaultAvatarSmall"] = f"/assets/npc-avatars/{safe_id}_128.webp"
            npc["defaultAvatarLarge"] = f"/assets/npc-avatars/{safe_id}_512.webp"
            success_count += 1
            continue

        # Get appearance description
        appearance = NPC_APPEARANCES.get(npc_id)
        if not appearance:
            # Generate from description
            appearance = f"A medieval fantasy {name_en.lower()}, {npc.get('description', '')[:100]}"

        print(f"  Generating avatar...")
        image_data = generate_avatar(npc_id, appearance)

        if not image_data:
            failed.append(npc_id)
            continue

        try:
            # Process and save images
            small_data = process_image(image_data, 128)
            large_data = process_image(image_data, 512)

            with open(small_path, 'wb') as f:
                f.write(small_data)
            with open(large_path, 'wb') as f:
                f.write(large_data)

            # Update NPC data
            npc["defaultAvatarSmall"] = f"/assets/npc-avatars/{safe_id}_128.webp"
            npc["defaultAvatarLarge"] = f"/assets/npc-avatars/{safe_id}_512.webp"

            print(f"  [OK] Saved: {safe_id}_128.webp, {safe_id}_512.webp")
            success_count += 1

        except Exception as e:
            print(f"  [ERROR] Failed to process image: {e}")
            failed.append(npc_id)

    # Save updated JSON
    with open(NPC_JSON_PATH, 'w', encoding='utf-8') as f:
        json.dump(npc_data, f, ensure_ascii=False, indent=2)

    print()
    print("=" * 60)
    print(f"Complete! Success: {success_count}/{len(npcs)}")
    if failed:
        print(f"Failed NPCs: {', '.join(failed)}")
    print("=" * 60)


if __name__ == "__main__":
    main()
