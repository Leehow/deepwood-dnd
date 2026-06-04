"""
Batch generate D&D class and race images using Tuzi API gemini-3-pro-image-preview
Style: Digital art, semi-realistic fantasy, dark moody background with magical lighting
"""
import os
import sys
import httpx
import json
import base64
import asyncio
import random
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)

API_KEY = os.getenv("TUZI_API_KEY")
API_BASE = "https://api.tu-zi.com/v1"
MODEL = "gemini-3-pro-image-preview"

if not API_KEY:
    print("[ERROR] TUZI_API_KEY not found in .env")
    sys.exit(1)

# Output directories
OUTPUT_BASE = Path(__file__).parent.parent / "frontend/public/images"
CLASSES_OUTPUT = OUTPUT_BASE / "classes_new"
RACES_OUTPUT = OUTPUT_BASE / "races_new"

# Style prompt suffix
STYLE_SUFFIX = (
    "digital art, semi-realistic fantasy style, dark moody background, "
    "magical glowing effects, dramatic lighting, upper body portrait, "
    "highly detailed, D&D 5e aesthetic, cinematic composition"
)

# Race descriptions for random assignment
RACE_FEATURES = {
    "human": "human with determined expression",
    "elf": "elf with pointed ears and long flowing hair",
    "dwarf": "dwarf with magnificent braided beard and stout build",
    "halfling": "halfling with small stature and cheerful features",
    "dragonborn": "dragonborn with scaled skin and dragon head",
    "gnome": "gnome with wild hair and twinkling eyes",
    "half-elf": "half-elf with subtle pointed ears and graceful features",
    "half-orc": "half-orc with tusks and green-tinted skin",
    "tiefling": "tiefling with horns, tail, and reddish skin"
}

# D&D Classes with descriptions (race will be randomly assigned)
CLASSES = {
    "barbarian": "A fierce {race} barbarian warrior with tribal tattoos and primal rage in their eyes, wielding a greataxe",
    "bard": "A charismatic {race} bard with elegant clothing, holding a lute, surrounded by musical notes and magical aura",
    "cleric": "A divine {race} cleric in holy armor, wielding a glowing mace and shield, with radiant light emanating from them",
    "druid": "A nature {race} druid with wild hair adorned with leaves and flowers, surrounded by swirling nature magic",
    "fighter": "A battle-hardened {race} fighter in plate armor, scarred face, wielding sword and shield with determination",
    "monk": "A serene {race} monk in simple robes, in a martial arts stance, with ki energy flowing around their fists",
    "paladin": "A noble {race} paladin in shining golden armor, wielding a glowing holy sword, with divine light behind them",
    "ranger": "A skilled {race} ranger in forest clothing with a hooded cloak, bow drawn, with a wolf companion nearby",
    "rogue": "A cunning {race} rogue in dark leather armor, holding daggers, emerging from shadows with a sly smirk",
    "sorcerer": "A powerful {race} sorcerer with glowing eyes, arcane energy crackling around their hands, wild magic aura",
    "warlock": "A mysterious {race} warlock with eldritch symbols, dark purple energy swirling, patron's influence visible",
    "wizard": "A wise {race} wizard holding a glowing staff and spellbook, arcane runes floating around"
}

# D&D Races with descriptions
RACES = {
    "human": "A noble human adventurer with determined expression, versatile appearance, wearing practical armor",
    "elf": "An elegant elf with pointed ears, long flowing hair, golden eyes, wearing ornate elven armor with nature motifs",
    "dwarf": "A stout dwarf with magnificent braided beard, stern expression, wearing heavy armor with dwarven runes",
    "halfling": "A cheerful halfling with curly hair, bright eyes, small stature, wearing comfortable traveling clothes",
    "dragonborn": "A proud dragonborn with scaled skin and dragon head, breathing elemental energy, in warrior gear",
    "gnome": "A curious gnome with wild hair and twinkling eyes, surrounded by mechanical gadgets and inventions",
    "half_elf": "A graceful half-elf combining human and elven features, elegant yet practical, with dual heritage visible",
    "half_orc": "A powerful half-orc with tusks and green-tinted skin, fierce but noble expression, battle-ready",
    "tiefling": "A striking tiefling with horns, tail, and reddish skin, infernal heritage evident, mysterious aura"
}


async def generate_image(client: httpx.AsyncClient, name: str, description: str, output_dir: Path):
    """Generate a single image and save as PNG"""
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }

    prompt = f"{description}, {STYLE_SUFFIX}"

    payload = {
        "model": MODEL,
        "prompt": prompt,
        "n": 1,
        "size": "1600x896",  # 16:9 ratio matching original 800x450
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
            if "data" in result and len(result["data"]) > 0:
                b64_data = result["data"][0].get("b64_json")
                if b64_data:
                    # Decode and save
                    image_data = base64.b64decode(b64_data)
                    output_path = output_dir / f"{name}.png"
                    output_path.write_bytes(image_data)
                    print(f"  [OK] Saved: {output_path}")
                    return True
                else:
                    print(f"  [WARN] No b64_json in response for {name}")
        else:
            print(f"  [ERROR] {name}: {response.status_code} - {response.text[:200]}")

    except Exception as e:
        print(f"  [ERROR] {name}: {type(e).__name__}: {e}")

    return False


async def main():
    """Generate all class and race images"""
    # Create output directories
    CLASSES_OUTPUT.mkdir(parents=True, exist_ok=True)
    RACES_OUTPUT.mkdir(parents=True, exist_ok=True)

    print(f"Model: {MODEL}")
    print(f"Classes output: {CLASSES_OUTPUT}")
    print(f"Races output: {RACES_OUTPUT}")
    print("=" * 60)

    async with httpx.AsyncClient(timeout=180.0) as client:
        # Generate classes with random races
        print("\n[Classes]")
        class_success = 0
        race_list = list(RACE_FEATURES.keys())
        random.shuffle(race_list)  # Shuffle to ensure variety

        for i, (name, desc_template) in enumerate(CLASSES.items()):
            # Assign race (cycle through shuffled list)
            race_key = race_list[i % len(race_list)]
            race_desc = RACE_FEATURES[race_key]
            desc = desc_template.format(race=race_desc)
            print(f"  -> {name} will be a {race_key}")

            if await generate_image(client, name, desc, CLASSES_OUTPUT):
                class_success += 1
            await asyncio.sleep(1)  # Rate limiting

        # Generate races
        print("\n[Races]")
        race_success = 0
        for name, desc in RACES.items():
            if await generate_image(client, name, desc, RACES_OUTPUT):
                race_success += 1
            await asyncio.sleep(1)  # Rate limiting

    print("\n" + "=" * 60)
    print(f"Classes: {class_success}/{len(CLASSES)} generated")
    print(f"Races: {race_success}/{len(RACES)} generated")
    print(f"Total: {class_success + race_success}/{len(CLASSES) + len(RACES)}")


if __name__ == "__main__":
    asyncio.run(main())
