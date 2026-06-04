#!/usr/bin/env python3
"""
Generate spell sound effects using ElevenLabs API
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
OUTPUT_DIR = Path(__file__).parent.parent / "frontend" / "public" / "sounds" / "spells"

# Sound effect prompts - filename: description
SOUND_PROMPTS = {
    # Fire damage
    "fire_cast.mp3": "magical fire spell casting, mystical flames igniting, fantasy RPG spell sound, 2 seconds",
    "fire_impact.mp3": "fiery explosion impact, flames bursting, magical fire blast hit, fantasy game sound, 2 seconds",

    # Ice/Cold damage
    "ice_cast.mp3": "ice magic spell casting, freezing crystals forming, mystical cold spell, fantasy RPG, 2 seconds",
    "ice_impact.mp3": "ice shattering impact, frozen crystals breaking, magical frost hit, fantasy game, 2 seconds",

    # Lightning damage
    "lightning_cast.mp3": "electric magic charging up, lightning spell casting, crackling energy, fantasy RPG, 2 seconds",
    "lightning_impact.mp3": "lightning bolt strike, electric shock impact, thunder zap hit, fantasy game, 2 seconds",

    # Thunder damage
    "thunder_cast.mp3": "deep rumbling thunder magic, sonic spell casting, powerful vibration, fantasy RPG, 2 seconds",
    "thunder_impact.mp3": "thunderous boom impact, sonic shockwave explosion, deep bass hit, fantasy game, 2 seconds",

    # Acid damage
    "acid_cast.mp3": "bubbling acid magic casting, corrosive spell sound, sizzling liquid, fantasy RPG, 2 seconds",
    "acid_sizzle.mp3": "acid burning and sizzling, corrosive liquid dissolving, chemical hiss, fantasy game, 2 seconds",

    # Poison damage
    "poison_cast.mp3": "toxic poison spell casting, venomous magic, dark bubbling, fantasy RPG, 2 seconds",
    "poison_effect.mp3": "poison spreading effect, toxic corruption, sickly magical sound, fantasy game, 2 seconds",

    # Necrotic damage
    "necrotic_cast.mp3": "dark necrotic magic casting, death energy gathering, ominous spell, fantasy RPG, 2 seconds",
    "necrotic_drain.mp3": "life force draining, soul sucking effect, dark energy absorption, fantasy game, 2 seconds",

    # Radiant damage
    "radiant_cast.mp3": "holy light magic casting, divine radiance gathering, blessed spell, fantasy RPG, 2 seconds",
    "radiant_burst.mp3": "brilliant light explosion, holy radiance burst, divine energy release, fantasy game, 2 seconds",

    # Force damage
    "force_cast.mp3": "pure magical force gathering, arcane energy charging, mystical power, fantasy RPG, 2 seconds",
    "force_impact.mp3": "magical force impact, invisible energy hit, arcane blast strike, fantasy game, 2 seconds",

    # Psychic damage
    "psychic_cast.mp3": "mind magic casting, psychic energy pulsing, mental spell, ethereal whispers, fantasy RPG, 2 seconds",
    "psychic_pulse.mp3": "psychic wave pulse, mind attack effect, mental energy burst, fantasy game, 2 seconds",

    # Charm control
    "charm_cast.mp3": "enchanting charm spell, mesmerizing magic, seductive mystical sound, fantasy RPG, 2 seconds",
    "charm_effect.mp3": "magical charm taking effect, dreamy enchantment, hypnotic success, fantasy game, 2 seconds",

    # Fear control
    "fear_cast.mp3": "terrifying fear spell casting, dreadful magic, ominous dark sound, fantasy RPG, 2 seconds",
    "fear_scream.mp3": "horrified scream of fear, terror effect, frightened reaction, fantasy game, 2 seconds",

    # Paralyze control
    "paralyze_cast.mp3": "paralyzing magic casting, freezing hold spell, binding energy, fantasy RPG, 2 seconds",
    "paralyze_freeze.mp3": "body freezing in place, paralysis taking hold, movement stopping, fantasy game, 2 seconds",

    # Restrain control
    "restrain_cast.mp3": "magical restraint spell, binding magic casting, entangling spell, fantasy RPG, 2 seconds",
    "vines_grow.mp3": "magical vines growing rapidly, roots entangling, nature binding, fantasy game, 2 seconds",

    # Sleep control
    "sleep_cast.mp3": "sleep spell casting, drowsy magic, lullaby enchantment, fantasy RPG, 2 seconds",
    "sleep_effect.mp3": "falling asleep effect, peaceful slumber, dreamy unconsciousness, fantasy game, 2 seconds",

    # Blind control
    "blind_cast.mp3": "blinding light spell casting, flash magic, brilliant flare, fantasy RPG, 2 seconds",
    "blind_effect.mp3": "vision obscured effect, darkness falling, sight lost, fantasy game, 2 seconds",

    # Incapacitate control
    "incapacitate_cast.mp3": "incapacitating spell casting, disabling magic, confusing enchantment, fantasy RPG, 2 seconds",
    "laugh_effect.mp3": "uncontrollable magical laughter, hysterical giggling, manic cackling, fantasy game, 2 seconds",

    # Healing
    "heal_cast.mp3": "healing magic casting, restorative spell, warm gentle energy, fantasy RPG, 2 seconds",
    "heal_chime.mp3": "healing complete chime, restoration success, magical recovery bell, fantasy game, 2 seconds",

    # Protection buff
    "shield_cast.mp3": "magical shield spell casting, protective barrier forming, defense magic, fantasy RPG, 2 seconds",
    "shield_up.mp3": "shield activated, protective barrier up, magical defense ready, fantasy game, 2 seconds",

    # Enhancement buff
    "enhance_cast.mp3": "enhancement spell casting, power boost magic, strengthening enchantment, fantasy RPG, 2 seconds",
    "power_up.mp3": "power up effect, strength surge, magical enhancement active, fantasy game, 2 seconds",

    # Inspiration buff
    "inspire_cast.mp3": "inspiring magic casting, bardic encouragement, uplifting spell, fantasy RPG, 2 seconds",
    "inspire_chime.mp3": "inspirational chime, motivating magical sound, confidence boost, fantasy game, 2 seconds",

    # Summon
    "summon_cast.mp3": "summoning spell casting, conjuration magic, calling forth energy, fantasy RPG, 2 seconds",
    "portal_open.mp3": "magical portal opening, dimensional rift, summoning gateway, fantasy game, 2 seconds",

    # Teleport
    "teleport_cast.mp3": "teleportation spell casting, spatial magic, dimension shift preparing, fantasy RPG, 2 seconds",
    "teleport_woosh.mp3": "teleport whoosh effect, instant movement, spatial displacement, fantasy game, 2 seconds",

    # Fog zone
    "fog_cast.mp3": "fog cloud spell casting, mist magic, obscuring vapor, fantasy RPG, 2 seconds",
    "fog_ambient.mp3": "thick fog ambient, mysterious mist, eerie vapor atmosphere, fantasy game, 3 seconds",

    # Elemental zone
    "zone_cast.mp3": "area spell casting, zone magic creating, persistent effect forming, fantasy RPG, 2 seconds",
    "elemental_ambient.mp3": "elemental energy ambient, magical zone humming, persistent spell atmosphere, fantasy game, 3 seconds",

    # Utility/Generic
    "magic_cast.mp3": "generic magic spell casting, mystical energy release, arcane spell sound, fantasy RPG, 2 seconds",
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
        "duration_seconds": 2.0,  # Short sound effects
        "prompt_influence": 0.3,  # Balance between prompt and model creativity
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
    print("Spell Sound Effects Generator")
    print("=" * 60)
    print(f"Output directory: {OUTPUT_DIR}")
    print(f"Total sounds to generate: {len(SOUND_PROMPTS)}")
    print()

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

        # Rate limiting - wait between requests
        if i < len(SOUND_PROMPTS):
            time.sleep(1)

    print()
    print("=" * 60)
    print(f"Done! Success: {success}, Failed: {failed}")
    print("=" * 60)


if __name__ == "__main__":
    main()
