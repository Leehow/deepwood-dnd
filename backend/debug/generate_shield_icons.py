#!/usr/bin/env python
"""
Generate shield icons for newly added shield variants.
Run from backend directory: python debug/generate_shield_icons.py
"""
import asyncio
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import async_session_maker
from app.services.avatar_service import avatar_service
import httpx


# Shield definitions with descriptions for icon generation
SHIELDS = [
    {
        "id": "buckler",
        "name": "Buckler (小圆盾)",
        "description": "A small round metal shield, about 30cm in diameter, held by a central grip",
        "category": "armor",
        "subcategory": "shield"
    },
    {
        "id": "wooden_shield",
        "name": "Wooden Shield (木盾)",
        "description": "A round wooden shield with leather covering, natural wood grain visible, simple iron boss in center",
        "category": "armor",
        "subcategory": "shield"
    },
    {
        "id": "iron_shield",
        "name": "Iron Shield (铁盾)",
        "description": "A sturdy kite-shaped iron shield with riveted construction, slightly weathered metal surface",
        "category": "armor",
        "subcategory": "shield"
    },
    {
        "id": "steel_shield",
        "name": "Steel Shield (钢盾)",
        "description": "A polished steel heater shield with elegant design, shiny reflective surface, knight's quality",
        "category": "armor",
        "subcategory": "shield"
    },
    {
        "id": "tower_shield",
        "name": "Tower Shield (塔盾)",
        "description": "A large rectangular tower shield, nearly body-height, reinforced with metal bands, defensive fortress-like design",
        "category": "armor",
        "subcategory": "shield"
    }
]

OUTPUT_DIR = "/Users/haoli/leehow/code/dw/frontend/public/assets/equipment-icons"


async def generate_shield_icon(shield: dict) -> str:
    """Generate a single shield icon"""
    print(f"\n{'='*50}")
    print(f"Generating icon for: {shield['name']}")
    print(f"{'='*50}")

    async with async_session_maker() as db:
        try:
            # Use avatar service to generate item icon
            small_url, large_url = await avatar_service.generate_avatar(
                db=db,
                entity_type='item',
                entity_id=0,  # Dummy ID since we just need the image
                name=shield['name'],
                description=shield['description'],
                category=shield['category'],
                subcategory=shield['subcategory']
            )

            print(f"Generated URLs:")
            print(f"  Small: {small_url}")
            print(f"  Large: {large_url}")

            # Download the large image and save locally
            output_path = os.path.join(OUTPUT_DIR, f"{shield['id']}.png")

            # Use the large URL for better quality
            url_to_download = large_url or small_url

            if url_to_download:
                async with httpx.AsyncClient(timeout=60.0) as client:
                    response = await client.get(url_to_download)
                    if response.status_code == 200:
                        with open(output_path, 'wb') as f:
                            f.write(response.content)
                        print(f"Saved to: {output_path}")
                        return output_path
                    else:
                        print(f"Failed to download: HTTP {response.status_code}")

            return ""

        except Exception as e:
            print(f"Error generating icon for {shield['name']}: {e}")
            import traceback
            traceback.print_exc()
            return ""


async def main():
    print("Shield Icon Generator")
    print("=" * 60)
    print(f"Output directory: {OUTPUT_DIR}")
    print(f"Shields to generate: {len(SHIELDS)}")
    print()

    # Ensure output directory exists
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    results = []
    for shield in SHIELDS:
        output_path = os.path.join(OUTPUT_DIR, f"{shield['id']}.png")

        # Check if icon already exists
        if os.path.exists(output_path):
            print(f"\nSkipping {shield['id']}.png - already exists")
            results.append((shield['id'], "skipped"))
            continue

        result = await generate_shield_icon(shield)
        results.append((shield['id'], "success" if result else "failed"))

        # Small delay between requests
        await asyncio.sleep(2)

    print("\n" + "=" * 60)
    print("Summary:")
    print("=" * 60)
    for shield_id, status in results:
        print(f"  {shield_id}: {status}")


if __name__ == "__main__":
    asyncio.run(main())
