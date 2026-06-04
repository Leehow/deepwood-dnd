#!/usr/bin/env python3
"""Generate icons for D&D background items using tu-zi API with consistent style."""

import json
import os
import re
import time
import requests
from pathlib import Path

API_URL = "https://api.tu-zi.com/v1/chat/completions"
API_KEY = "REDACTED_API_KEY"
MODEL = "gemini-2.5-flash-image-vip"

# Output directory
ICON_DIR = Path("/Users/haoli/leehow/code/dw/frontend/public/assets/equipment-icons")
EQUIPMENT_JSON = Path("/Users/haoli/leehow/code/dw/frontend/app/data/rules/equipment.json")

# Style suffix for consistent look - matching existing icons
STYLE_SUFFIX = "flat design game icon, simple shapes, solid dark brown background color #5D4037, centered item, minimalist style, no transparency, warm color palette with orange and teal accents, clean vector art style"

# Icon prompts for each item (simple descriptions)
ITEM_PROMPTS = {
    "insignia_of_rank": "military medal badge with ribbon",
    "trophy_from_fallen_enemy": "broken sword blade trophy",
    "gaming_set_or_playing_cards": "dice and playing cards",
    "holy_symbol": "glowing holy amulet symbol",
    "prayer_book": "old leather prayer book",
    "incense": "burning incense sticks with smoke",
    "vestments": "religious ceremonial robe",
    "pouch_with_15gp": "leather coin pouch with gold coins",
    "dark_common_clothes_with_hood": "dark hooded cloak",
    "fine_clothes": "elegant noble clothing",
    "scroll_of_pedigree": "family tree scroll document",
    "bottle_of_ink": "glass ink bottle",
    "quill": "feather quill pen",
    "small_knife": "small utility knife",
    "letter_from_dead_colleague": "sealed letter with wax seal",
    "tools_of_con": "weighted dice and marked cards",
    "musical_instrument": "lute musical instrument",
    "admirer_favor": "love token ribbon with trinket",
    "costume": "theatrical performer costume",
    "artisan_tools": "craftsman hammer and tools",
    "letter_of_introduction_from_guild": "official guild letter with seal",
    "travelers_clothes": "practical travel outfit",
    "scroll_case_with_notes": "scroll case tube with papers",
    "winter_blanket": "thick wool blanket",
    "trophy_from_animal": "animal claw necklace trophy",
    "50_feet_silk_rope": "coiled silk rope",
    "belaying_pin": "wooden belaying pin",
    "lucky_charm": "rabbit foot lucky charm",
    "map_of_city": "hand-drawn city map",
    "pet_mouse": "cute small mouse",
    "token_of_parents": "family heirloom locket",
    "iron_pot": "cast iron cooking pot",
}

# Items that can share icons
SHARED_ICONS = {
    "pouch_with_10gp": "pouch_with_15gp",
    "pouch_with_25gp": "pouch_with_15gp",
    "pouch_with_5gp": "pouch_with_15gp",
}


def generate_icon(item_id: str, prompt: str) -> str | None:
    """Generate an icon using tu-zi API and return the image URL."""
    full_prompt = f"Create a {prompt}, {STYLE_SUFFIX}"

    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": MODEL,
        "messages": [
            {
                "role": "user",
                "content": full_prompt
            }
        ]
    }

    try:
        print(f"  Generating icon for {item_id}...")
        response = requests.post(API_URL, headers=headers, json=payload, timeout=120)
        response.raise_for_status()

        result = response.json()
        choices = result.get("choices", [])
        if not choices:
            print(f"  No choices in response for {item_id}")
            return None

        content = choices[0].get("message", {}).get("content", "")

        # Extract URL from markdown image format: ![Image](URL)
        match = re.search(r'!\[.*?\]\((https?://[^\)]+)\)', content)
        if match:
            return match.group(1)

        # Try to find any URL
        url_match = re.search(r'(https?://[^\s\)]+\.(png|jpg|jpeg|webp))', content)
        if url_match:
            return url_match.group(1)

        print(f"  No image URL found in response for {item_id}: {content[:200]}")
        return None

    except Exception as e:
        print(f"  Error generating icon for {item_id}: {e}")
        return None


def download_and_save_icon(item_id: str, image_url: str) -> str | None:
    """Download image from URL and save locally."""
    try:
        print(f"  Downloading {item_id}...")
        response = requests.get(image_url, timeout=30)
        response.raise_for_status()

        # Always save as PNG
        filepath = ICON_DIR / f"{item_id}.png"
        with open(filepath, "wb") as f:
            f.write(response.content)

        print(f"  Saved: {filepath.name} ({len(response.content)} bytes)")
        return f"/assets/equipment-icons/{item_id}.png"

    except Exception as e:
        print(f"  Error downloading icon for {item_id}: {e}")
        return None


def update_equipment_json(icon_paths: dict):
    """Update equipment.json with new icon paths."""
    with open(EQUIPMENT_JSON, "r") as f:
        data = json.load(f)

    updated = 0
    for item in data.get("backgroundItems", []):
        item_id = item.get("id")
        if item_id in icon_paths:
            item["iconPath"] = icon_paths[item_id]
            updated += 1

    with open(EQUIPMENT_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"\nUpdated {updated} items in {EQUIPMENT_JSON}")


def main():
    # Ensure output directory exists
    ICON_DIR.mkdir(parents=True, exist_ok=True)

    # Items to regenerate (all background items)
    items_to_generate = list(ITEM_PROMPTS.keys())

    print(f"Regenerating {len(items_to_generate)} icons with consistent style\n")

    icon_paths = {}
    generated_count = 0

    for item_id in items_to_generate:
        # Check if this item shares an icon with another
        if item_id in SHARED_ICONS:
            shared_with = SHARED_ICONS[item_id]
            if shared_with in icon_paths:
                icon_paths[item_id] = icon_paths[shared_with]
                print(f"  {item_id} shares icon with {shared_with}")
                continue

        # Get prompt for this item
        prompt = ITEM_PROMPTS.get(item_id)
        if not prompt:
            print(f"  No prompt defined for {item_id}, skipping")
            continue

        # Generate icon
        image_url = generate_icon(item_id, prompt)
        if image_url:
            icon_path = download_and_save_icon(item_id, image_url)
            if icon_path:
                icon_paths[item_id] = icon_path
                generated_count += 1

                # Also update shared icons
                for shared_id, shared_with in SHARED_ICONS.items():
                    if shared_with == item_id:
                        icon_paths[shared_id] = icon_path

        # Rate limiting - wait between requests
        time.sleep(2)

    # Update equipment.json
    if icon_paths:
        update_equipment_json(icon_paths)
        print(f"\nGenerated {generated_count} new icons")
        print(f"Total icon paths set: {len(icon_paths)}")
    else:
        print("\nNo icons generated")


if __name__ == "__main__":
    main()
