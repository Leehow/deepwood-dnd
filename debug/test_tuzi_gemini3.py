"""
Test script for Tuzi API gemini-3-pro-image-preview model
"""
import os
import sys
import httpx
import json
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

async def test_image_generation():
    """Test image generation with gemini-3-pro-image-preview"""
    print(f"Testing model: {MODEL}")
    print(f"API Base: {API_BASE}")
    print("-" * 50)

    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }

    # Test prompt
    prompt = "A cute dragon mascot for a D&D game, cartoon style, vibrant colors"

    payload = {
        "model": MODEL,
        "prompt": prompt,
        "n": 1,
        "size": "3840x2160"  # 4K resolution
    }

    print(f"Prompt: {prompt}")
    print(f"Request payload: {json.dumps(payload, indent=2)}")
    print("-" * 50)

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            response = await client.post(
                f"{API_BASE}/images/generations",
                headers=headers,
                json=payload
            )

            print(f"Status: {response.status_code}")

            if response.status_code == 200:
                result = response.json()
                print(f"Response: {json.dumps(result, indent=2, ensure_ascii=False)}")

                # Save image URL if available
                if "data" in result and len(result["data"]) > 0:
                    image_url = result["data"][0].get("url") or result["data"][0].get("b64_json")
                    if image_url and image_url.startswith("http"):
                        print(f"\nImage URL: {image_url}")
                    elif image_url:
                        print(f"\nReceived base64 image data (length: {len(image_url)})")

                print("\n[SUCCESS] Image generation test passed!")
            else:
                print(f"Error response: {response.text}")
                print("\n[FAILED] Image generation test failed")

        except Exception as e:
            print(f"[ERROR] {type(e).__name__}: {e}")
            raise

if __name__ == "__main__":
    import asyncio
    asyncio.run(test_image_generation())
