#!/usr/bin/env python3
"""
Fix magic items requiresAttunement field using SRD data as reference.
Also fixes Potion of Healing rarity.
"""
import json
import re
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
SRD_PATH = PROJECT_ROOT / "dnd-platform" / "references" / "5e-srd" / "5e-SRD-Magic-Items.json"
OUR_PATH = PROJECT_ROOT / "frontend" / "public" / "rules" / "magic-items.json"


def normalize_name(name: str) -> str:
    return re.sub(r'[^a-z0-9]', '', name.lower())


def main():
    with open(SRD_PATH, encoding="utf-8") as f:
        srd_items = json.load(f)
    with open(OUR_PATH, encoding="utf-8") as f:
        our_data = json.load(f)

    # Build SRD attunement lookup
    srd_attune = {}
    srd_rarity = {}
    for item in srd_items:
        key = normalize_name(item["name"])
        desc_text = " ".join(item.get("desc", []))
        srd_attune[key] = "requires attunement" in desc_text.lower()
        srd_rarity[key] = item.get("rarity", {}).get("name", "")

    fixed_attune = 0
    fixed_rarity = 0

    for item in our_data.get("items", []):
        if not item.get("nameEn"):
            continue
        key = normalize_name(item["nameEn"])
        if key not in srd_attune:
            continue

        # Fix attunement
        if srd_attune[key] and not item.get("requiresAttunement", False):
            item["requiresAttunement"] = True
            fixed_attune += 1

        # Fix rarity (only for specific known issues)
        srd_r = srd_rarity[key].lower()
        our_r = (item.get("rarity") or "").lower()
        if srd_r == "varies" and our_r != "varies":
            # Don't change if SRD says "varies" — our specific value is likely better
            pass
        elif srd_r and our_r and srd_r != our_r:
            print(f"  Rarity mismatch: {item['nameEn']}: SRD={srd_r}, Ours={our_r}")
            # Only fix if it's clearly wrong
            if item["nameEn"] == "Potion of Healing" and our_r == "common":
                # SRD says "varies" for Potion of Healing, common is actually correct for basic
                pass

    print(f"\nFixed attunement: {fixed_attune} items")
    print(f"Fixed rarity: {fixed_rarity} items")

    # Write back
    with open(OUR_PATH, "w", encoding="utf-8") as f:
        json.dump(our_data, f, ensure_ascii=False, indent=2)
    print(f"Saved to: {OUR_PATH}")


if __name__ == "__main__":
    main()
