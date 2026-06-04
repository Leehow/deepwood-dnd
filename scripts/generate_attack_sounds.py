#!/usr/bin/env python3
"""
Generate attack sound effects using ElevenLabs API
"""

import os
import requests
import time
from pathlib import Path
from dotenv import load_dotenv

# Load .env from backend
env_path = Path(__file__).parent.parent / "backend" / ".env"
load_dotenv(env_path)

# ElevenLabs API
API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
API_URL = "https://api.elevenlabs.io/v1/sound-generation"

# Output directory
OUTPUT_DIR = Path(__file__).parent.parent / "frontend" / "public" / "sounds" / "attacks"

# Sound effect prompts - filename: description
SOUND_PROMPTS = {
    # Slashing (sword, axe)
    "slash_swing.mp3": "sword slashing through air, blade whoosh, fast swing sound, fantasy combat, 1.5 seconds",
    "slash_hit.mp3": "sword cutting into flesh, blade slicing impact, sharp metal hit, fantasy combat, 1.5 seconds",

    # Piercing (spear, arrow, dagger)
    "pierce_swing.mp3": "spear thrust through air, quick stabbing motion, piercing weapon sound, fantasy combat, 1.5 seconds",
    "pierce_hit.mp3": "blade piercing into body, stabbing impact, arrow hitting target, fantasy combat, 1.5 seconds",

    # Bludgeoning (hammer, mace, fist)
    "blunt_swing.mp3": "heavy blunt weapon swing, mace whoosh, hammer swinging through air, fantasy combat, 1.5 seconds",
    "blunt_hit.mp3": "heavy blunt impact, crushing blow, hammer smashing, bone crunching hit, fantasy combat, 1.5 seconds",

    # Bite (monster jaws)
    "bite_attack.mp3": "monster jaws snapping, beast opening mouth to bite, predator attack, fantasy creature, 1.5 seconds",
    "bite_hit.mp3": "teeth sinking into flesh, biting and tearing, monster bite impact, fantasy creature, 1.5 seconds",

    # Claw (monster claws)
    "claw_attack.mp3": "claws swiping through air, beast slashing motion, predator claw attack, fantasy creature, 1.5 seconds",
    "claw_hit.mp3": "claws raking across flesh, sharp talons tearing, monster claw impact, fantasy creature, 1.5 seconds",

    # Tail (dragon, beast)
    "tail_swing.mp3": "heavy tail swinging through air, massive appendage whoosh, dragon tail sweep, fantasy creature, 1.5 seconds",
    "tail_hit.mp3": "tail slamming into body, heavy appendage impact, dragon tail strike, fantasy creature, 1.5 seconds",

    # Slam (giant, golem)
    "slam_attack.mp3": "massive fist raising, heavy slam preparing, giant attack windup, fantasy creature, 1.5 seconds",
    "slam_hit.mp3": "massive impact crushing, heavy slam landing, giant fist smashing ground, fantasy creature, 1.5 seconds",

    # Sting (scorpion, insect)
    "sting_attack.mp3": "stinger preparing to strike, insect attack sound, scorpion tail raising, fantasy creature, 1.5 seconds",
    "sting_hit.mp3": "stinger piercing flesh, venomous injection, scorpion sting impact, fantasy creature, 1.5 seconds",

    # Tentacle (aberration, octopus)
    "tentacle_attack.mp3": "wet tentacle lashing out, slimy appendage strike, eldritch horror attack, fantasy creature, 1.5 seconds",
    "tentacle_hit.mp3": "tentacle wrapping around, slimy grip tightening, eldritch horror grab, fantasy creature, 1.5 seconds",

    # Ranged (bow, thrown)
    "arrow_loose.mp3": "bowstring release, arrow flying through air, projectile launch, fantasy combat, 1.5 seconds",
    "arrow_hit.mp3": "arrow striking target, projectile impact, arrowhead piercing, fantasy combat, 1.5 seconds",

    # Generic miss sound
    "attack_miss.mp3": "weapon swinging through empty air, attack missing target, whoosh without impact, fantasy combat, 1 second",

    # Critical hit emphasis
    "critical_hit.mp3": "devastating critical strike, powerful bone-crushing impact with dramatic emphasis, fantasy combat, 1.5 seconds",
}


def generate_sound(filename: str, prompt: str) -> bool:
    """Generate a single sound effect"""
    output_path = OUTPUT_DIR / filename

    # Skip if already exists
    if output_path.exists():
        print(f"  [SKIP] {filename} already exists")
        return True

    headers = {
        "xi-api-key": API_KEY,
        "Content-Type": "application/json"
    }

    data = {
        "text": prompt,
        "duration_seconds": 1.5,
        "prompt_influence": 0.3,
    }

    try:
        response = requests.post(API_URL, headers=headers, json=data, timeout=60)

        if response.status_code == 200:
            with open(output_path, "wb") as f:
                f.write(response.content)
            print(f"  [OK] {filename}")
            return True
        else:
            print(f"  [ERROR] {filename}: {response.status_code} - {response.text[:100]}")
            return False

    except Exception as e:
        print(f"  [ERROR] {filename}: {e}")
        return False


def main():
    print("=" * 60)
    print("Attack Sound Effects Generator")
    print("=" * 60)
    print(f"Output directory: {OUTPUT_DIR}")
    print(f"Total sounds to generate: {len(SOUND_PROMPTS)}")
    print()

    if not API_KEY:
        print("[ERROR] ELEVENLABS_API_KEY not found in .env")
        return

    # Ensure output directory exists
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    success = 0
    failed = 0

    for i, (filename, prompt) in enumerate(SOUND_PROMPTS.items(), 1):
        print(f"[{i}/{len(SOUND_PROMPTS)}] Generating {filename}...")

        if generate_sound(filename, prompt):
            success += 1
        else:
            failed += 1

        # Rate limiting
        if i < len(SOUND_PROMPTS):
            time.sleep(1)

    print()
    print("=" * 60)
    print(f"Done! Success: {success}, Failed: {failed}")
    print("=" * 60)


if __name__ == "__main__":
    main()
