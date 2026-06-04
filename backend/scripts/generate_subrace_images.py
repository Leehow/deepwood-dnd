#!/usr/bin/env python3
"""Generate subrace portrait images using Yunwu AI (Gemini chat completions)."""
import os
import sys
import re
import time
import base64
import requests
from pathlib import Path

API_URL = "https://yunwu.ai/v1/chat/completions"
API_KEY = "REDACTED_API_KEY"
MODEL = "gemini-3-pro-image-preview"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "frontend/public/images/races"

STYLE_PREFIX = (
    "Generate an image: Dark fantasy portrait, D&D 5E character bust shot, "
    "dark moody background with glowing amber/gold magical runes and energy swirls, "
    "detailed fantasy armor, dramatic lighting, digital painting, highly detailed, "
    "concept art style, 16:9 wide aspect ratio. "
)

SUBRACES = [
    ("hill_dwarf", "Hill Dwarf, sturdy dwarf with warm ruddy complexion, thick braided brown beard with gold rings, wearing practical chainmail and earth-toned cloak, gentle wise eyes, rolling hills faintly behind"),
    ("mountain_dwarf", "Mountain Dwarf, powerfully built dwarf with stern face, dark iron-grey beard with silver clasps, wearing heavy plate armor with mountain engravings, battle-scarred, rocky mountain peaks behind"),
    ("high_elf", "High Elf, tall elegant elf with pale luminous skin, long silver-white hair, piercing blue eyes, wearing ornate mithril armor with arcane gemstones, magical constellation patterns behind"),
    ("wood_elf", "Wood Elf, athletic elf with copper-tan skin, wild auburn hair with leaves woven in, green eyes, wearing leather armor of bark and vines, carrying a longbow, ancient forest behind"),
    ("dark_elf", "Dark Elf Drow, sleek elf with obsidian-dark skin, stark white hair, glowing violet eyes, wearing spider-silk black armor with purple accents, Underdark cavern with bioluminescent fungi behind"),
    ("lightfoot", "Lightfoot Halfling, small cheerful halfling with bright hazel eyes, curly sandy-blonde hair, rosy cheeks and mischievous grin, wearing colorful vest and traveler cloak, moonlit road behind"),
    ("stout", "Stout Halfling, stocky small halfling with ruddy complexion, thick curly brown hair and sideburns, determined expression, wearing sturdy leather armor with iron buckler, warm tavern glow behind"),
    ("black_dragon", "Black Dragonborn, reptilian humanoid with glossy black scales, curved horns, glowing acid-green eyes, dark spiked armor, swamp mist behind"),
    ("blue_dragon", "Blue Dragonborn, reptilian humanoid with deep sapphire-blue scales, single large horn, crackling lightning-blue eyes, blue steel armor, desert storm with lightning behind"),
    ("brass_dragon", "Brass Dragonborn, reptilian humanoid with warm brass-golden scales, swept-back ridged horns, friendly amber eyes, light desert robes, sandy dunes behind"),
    ("bronze_dragon", "Bronze Dragonborn, reptilian humanoid with shimmering bronze scales, swept-back horns, sea-green eyes, naval armor with trident, ocean waves behind"),
    ("copper_dragon", "Copper Dragonborn, reptilian humanoid with warm reddish-copper scales, backwards-curving horns, mischievous orange eyes, light adventurer gear, rocky canyon behind"),
    ("gold_dragon", "Gold Dragonborn, reptilian humanoid with magnificent golden scales, twin whisker-like horns, radiant golden eyes, resplendent golden plate armor with sun emblems, divine light behind"),
    ("green_dragon", "Green Dragonborn, reptilian humanoid with forest-green scales, single nasal horn, cunning emerald eyes, dark leather armor, dense poisonous forest behind"),
    ("red_dragon", "Red Dragonborn, reptilian humanoid with crimson-red scales, large swept-back horns, blazing orange eyes, black iron armor with flame motifs, volcanic lava behind"),
    ("silver_dragon", "Silver Dragonborn, reptilian humanoid with gleaming silver-white scales, elegant backward-sweeping horns, icy pale-blue eyes, polished silver armor, snow-capped peaks behind"),
    ("white_dragon", "White Dragonborn, reptilian humanoid with pure white frost-covered scales, small sharp horns, cold ice-blue eyes, fur-lined frost armor, blizzard and glacial ice behind"),
    ("forest_gnome", "Forest Gnome, tiny gnome with rosy cheeks, wild mossy-green hair, bright curious eyes, wearing clothes of leaves and bark, tiny fox on shoulder, enchanted mushroom forest behind"),
    ("rock_gnome", "Rock Gnome, small gnome with tinkerer goggles on forehead, wild reddish hair with soot, excited bright eyes, leather apron with gears and tools, clockwork machinery behind"),
]


def extract_image_from_content(content: str) -> bytes | None:
    """Extract base64 image data from markdown response."""
    m = re.search(r'data:image/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)', content)
    if m:
        return base64.b64decode(m.group(1))
    # Try raw base64
    m = re.search(r'([A-Za-z0-9+/]{100,}={0,2})', content)
    if m:
        try:
            return base64.b64decode(m.group(1))
        except Exception:
            pass
    return None


def generate_image(subrace_id: str, description: str) -> bool:
    output_path = OUTPUT_DIR / f"{subrace_id}.png"
    if output_path.exists():
        print(f"  [SKIP] {subrace_id}.png already exists")
        return True

    prompt = STYLE_PREFIX + description
    print(f"  [GEN] {subrace_id} ...")

    try:
        resp = requests.post(
            API_URL,
            headers={
                "Authorization": f"Bearer {API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
            },
            timeout=120,
        )
        resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"]

        img_bytes = extract_image_from_content(content)
        if not img_bytes:
            print(f"  [ERR] {subrace_id}: no image found in response")
            return False

        output_path.write_bytes(img_bytes)
        print(f"  [OK]  {subrace_id}.png ({len(img_bytes)//1024}KB)")
        return True

    except Exception as e:
        print(f"  [ERR] {subrace_id}: {e}")
        return False


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Output: {OUTPUT_DIR}")
    print(f"Generating {len(SUBRACES)} subrace images...\n")

    success = 0
    failed = []
    for subrace_id, desc in SUBRACES:
        ok = generate_image(subrace_id, desc)
        if ok:
            success += 1
        else:
            failed.append(subrace_id)
        time.sleep(2)

    print(f"\nDone: {success}/{len(SUBRACES)} succeeded")
    if failed:
        print(f"Failed: {', '.join(failed)}")
        print("\nRetrying failed ones...")
        for subrace_id in list(failed):
            desc = dict(SUBRACES)[subrace_id]
            time.sleep(3)
            if generate_image(subrace_id, desc):
                failed.remove(subrace_id)
        if failed:
            print(f"Still failed: {', '.join(failed)}")
        else:
            print("All retries succeeded!")


if __name__ == "__main__":
    main()
