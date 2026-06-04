"""
Test script for map generation API formats
Tests different API call formats to find the correct one for aiionly.com
"""
import asyncio
import base64
import json
import httpx
from pathlib import Path
import sys

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

DATABASE_URL = "postgresql://haoli@localhost:5432/dnd_platform"

def get_image_config():
    """Get IMAGE model config from database"""
    engine = create_engine(DATABASE_URL)

    with Session(engine) as session:
        # Get ai_api_settings
        result = session.execute(
            text("SELECT id, usage_configs FROM ai_api_settings WHERE user_id = 'global'")
        )
        row = result.fetchone()
        if not row:
            print("[ERROR] No global AI settings found")
            return None

        settings_id = row[0]
        usage_configs = row[1] or {}

        # Get model type for map_generation
        model_type = usage_configs.get("map_generation", "ADVANCED_IMAGE")
        print(f"map_generation uses model type: {model_type}")

        # Get model config
        result = session.execute(
            text(f"SELECT api_url, api_key, model_name FROM ai_model_configs "
                 f"WHERE settings_id = {settings_id} AND model_type = '{model_type}'")
        )
        config = result.fetchone()
        if not config:
            print(f"[ERROR] No {model_type} config found")
            return None

        return {
            "api_url": config[0],
            "api_key": config[1],
            "model_name": config[2]
        }


async def test_chat_format(config, prompt):
    """Test chat completions format (user says this is correct)"""
    api_url = config["api_url"].rstrip("/")
    if not api_url.endswith("/chat/completions"):
        api_url = api_url + "/chat/completions"

    headers = {
        "Authorization": f"Bearer {config['api_key']}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": config["model_name"],
        "messages": [
            {"role": "user", "content": prompt}
        ]
    }

    print(f"\n[TEST 1] Chat Completions Format")
    print(f"URL: {api_url}")
    print(f"Model: {config['model_name']}")
    print(f"Payload: {json.dumps(payload, indent=2, ensure_ascii=False)[:500]}...")

    async with httpx.AsyncClient(timeout=180.0) as client:
        try:
            resp = await client.post(api_url, headers=headers, json=payload)
            print(f"Status: {resp.status_code}")

            if resp.status_code == 200:
                data = resp.json()
                print(f"Response keys: {data.keys()}")

                # Check for image in response
                if "choices" in data:
                    content = data["choices"][0].get("message", {}).get("content", "")
                    print(f"Content type: {type(content)}")
                    print(f"Content preview: {str(content)[:200]}...")

                    # Parse markdown image format: ![image](data:image/png;base64,...)
                    import re
                    match = re.search(r'data:image/[^;]+;base64,([A-Za-z0-9+/=]+)', content)
                    if match:
                        b64_data = match.group(1)
                        decoded = base64.b64decode(b64_data)
                        print(f"[SUCCESS] Extracted base64 from markdown, decoded {len(decoded)} bytes")
                        return decoded

                    # Plain base64 string
                    if isinstance(content, str) and len(content) > 1000:
                        try:
                            decoded = base64.b64decode(content)
                            print(f"[SUCCESS] Decoded {len(decoded)} bytes")
                            return decoded
                        except:
                            pass

                    # Check for image URL
                    if isinstance(content, str) and content.startswith("http"):
                        print(f"[SUCCESS] Got image URL: {content[:100]}...")
                        return content

                print(f"Full response: {json.dumps(data, indent=2, ensure_ascii=False)[:2000]}")
            else:
                print(f"Error: {resp.text[:500]}")

        except Exception as e:
            print(f"[ERROR] {type(e).__name__}: {e}")

    return None


async def test_aionly_format(config, prompt):
    """Test aionly.com specific format with input/parameters"""
    api_url = config["api_url"].rstrip("/")

    headers = {
        "Authorization": f"Bearer {config['api_key']}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": config["model_name"],
        "input": {"prompt": prompt},
        "parameters": {"size": "1024x1024"}
    }

    print(f"\n[TEST 2] AIONLY Format (input/parameters)")
    print(f"URL: {api_url}")
    print(f"Payload: {json.dumps(payload, indent=2, ensure_ascii=False)[:500]}...")

    async with httpx.AsyncClient(timeout=180.0) as client:
        try:
            resp = await client.post(api_url, headers=headers, json=payload)
            print(f"Status: {resp.status_code}")

            data = resp.json()
            print(f"Response: {json.dumps(data, indent=2, ensure_ascii=False)[:2000]}")

            if resp.status_code == 200:
                # Check various response formats
                if data.get("code") == 0 and "data" in data:
                    image_data = data["data"]
                    if isinstance(image_data, str):
                        if image_data.startswith("http"):
                            print(f"[SUCCESS] Got URL")
                            return image_data
                        else:
                            decoded = base64.b64decode(image_data)
                            print(f"[SUCCESS] Got base64, decoded {len(decoded)} bytes")
                            return decoded

        except Exception as e:
            print(f"[ERROR] {type(e).__name__}: {e}")

    return None


async def test_openai_images_format(config, prompt):
    """Test standard OpenAI images/generations format"""
    api_url = config["api_url"].rstrip("/")
    if "/images/generations" not in api_url:
        api_url = api_url + "/images/generations"

    headers = {
        "Authorization": f"Bearer {config['api_key']}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": config["model_name"],
        "prompt": prompt,
        "n": 1,
        "size": "1024x1024",
        "response_format": "b64_json"
    }

    print(f"\n[TEST 3] OpenAI Images Format")
    print(f"URL: {api_url}")
    print(f"Payload: {json.dumps(payload, indent=2, ensure_ascii=False)[:500]}...")

    async with httpx.AsyncClient(timeout=180.0) as client:
        try:
            resp = await client.post(api_url, headers=headers, json=payload)
            print(f"Status: {resp.status_code}")
            print(f"Response: {resp.text[:2000]}")

        except Exception as e:
            print(f"[ERROR] {type(e).__name__}: {e}")

    return None


async def main():
    print("=" * 60)
    print("Map Generation API Format Test")
    print("=" * 60)

    config = get_image_config()
    if not config:
        return

    print(f"\nConfig loaded:")
    print(f"  API URL: {config['api_url']}")
    print(f"  Model: {config['model_name']}")
    print(f"  Key: {config['api_key'][:20]}...")

    # Simple test prompt
    prompt = "A top-down D&D battle map of a forest clearing, fantasy style, grid layout"

    # Test format 1: Chat completions (user says this is correct)
    result = await test_chat_format(config, prompt)
    if result:
        print("\n[RESULT] Chat format works!")
        if isinstance(result, bytes):
            # Save test image
            with open("/tmp/test_map_chat.png", "wb") as f:
                f.write(result)
            print("Saved to /tmp/test_map_chat.png")
        return

    # Test format 2: AIONLY specific
    result = await test_aionly_format(config, prompt)
    if result:
        print("\n[RESULT] AIONLY format works!")
        return

    # Test format 3: OpenAI images
    await test_openai_images_format(config, prompt)

    print("\n" + "=" * 60)
    print("All tests completed")


if __name__ == "__main__":
    asyncio.run(main())
