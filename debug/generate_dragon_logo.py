#!/usr/bin/env python3
"""Generate dragon logos using Gemini image generation API."""

import requests
import base64
import os
from datetime import datetime

API_URL = "https://yunwu.ai/v1/chat/completions"
API_KEY = "REDACTED_API_KEY"
MODEL = "gemini-3-pro-image-preview"
OUTPUT_DIR = "/Users/haoli/leehow/code/dw/dnd-platform/pic"

# Logo design prompts - simple flat style with dragon
LOGO_PROMPTS = [
    {
        "name": "dragon_shield",
        "prompt": "Minimalist flat vector logo design, a stylized dragon head silhouette inside a shield shape, golden dragon on dark background, simple geometric shapes, suitable for small icon display, clean lines, no gradients, D&D fantasy style"
    },
    {
        "name": "dragon_d20",
        "prompt": "Minimalist flat vector logo, a dragon coiled around a D20 dice, simple flat colors gold and dark purple, geometric style, clean silhouette, works at small sizes, tabletop gaming aesthetic"
    },
    {
        "name": "dragon_flame",
        "prompt": "Simple flat logo design, dragon breathing fire forming a circular emblem, golden/amber color palette on dark background, minimalist style, bold shapes, readable at small sizes, fantasy RPG theme"
    },
    {
        "name": "dragon_wing",
        "prompt": "Flat minimalist logo, stylized dragon wings forming a 'V' or 'W' shape, single color golden silhouette, simple elegant design, scalable for small icons, D&D inspired"
    },
    {
        "name": "dragon_eye",
        "prompt": "Minimalist flat logo, a dragon eye with vertical slit pupil inside a diamond shape, gold and dark colors, simple bold design, works at favicon size, fantasy gaming style"
    },
    {
        "name": "dragon_initial",
        "prompt": "Flat vector logo, letter 'D' stylized as a dragon with small wings and tail, golden color on dark background, simple readable design, suitable for app icon, clean geometric lines"
    }
]


def generate_logo(prompt_config: dict) -> str | None:
    """Generate a single logo image."""
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": MODEL,
        "messages": [
            {
                "role": "user",
                "content": prompt_config["prompt"]
            }
        ]
    }

    print(f"\n生成 {prompt_config['name']}...")
    print(f"Prompt: {prompt_config['prompt'][:80]}...")

    try:
        response = requests.post(API_URL, headers=headers, json=payload, timeout=120)
        response.raise_for_status()

        result = response.json()

        # Extract image from response
        if "choices" in result and len(result["choices"]) > 0:
            message = result["choices"][0].get("message", {})
            content = message.get("content", [])

            # Handle different response formats
            if isinstance(content, list):
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "image_url":
                        image_data = item.get("image_url", {}).get("url", "")
                        if image_data.startswith("data:image"):
                            # Extract base64 data
                            base64_data = image_data.split(",")[1]
                            return base64_data
            elif isinstance(content, str):
                # Check if response contains base64 image data
                if "data:image" in content:
                    base64_data = content.split(",")[1].split('"')[0]
                    return base64_data

        print(f"响应格式: {result}")
        return None

    except Exception as e:
        print(f"生成失败: {e}")
        return None


def save_image(base64_data: str, name: str) -> str:
    """Save base64 image data to file."""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"logo_{name}_{timestamp}.png"
    filepath = os.path.join(OUTPUT_DIR, filename)

    image_data = base64.b64decode(base64_data)
    with open(filepath, "wb") as f:
        f.write(image_data)

    print(f"✓ 已保存: {filename}")
    return filepath


def main():
    """Generate multiple logo variations."""
    print("=" * 50)
    print("Dragon Logo Generator for Deepwood")
    print("=" * 50)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    generated = []
    for prompt_config in LOGO_PROMPTS:
        image_data = generate_logo(prompt_config)
        if image_data:
            filepath = save_image(image_data, prompt_config["name"])
            generated.append(filepath)
        else:
            print(f"✗ 跳过 {prompt_config['name']}")

    print("\n" + "=" * 50)
    print(f"生成完成! 共 {len(generated)}/{len(LOGO_PROMPTS)} 个logo")
    print(f"保存位置: {OUTPUT_DIR}")
    print("=" * 50)


if __name__ == "__main__":
    main()
