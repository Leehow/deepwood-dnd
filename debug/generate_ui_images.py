import os
import requests
import base64
import json
import sys

# Add backend venv site-packages to path just in case, though we'll run with the venv python
sys.path.append(os.path.join(os.getcwd(), "backend/venv/lib/python3.11/site-packages"))

API_KEY = "REDACTED_API_KEY"
API_URL = "https://api.aiionly.com/v1/chat/completions"
MODEL = "gemini-3-pro-image-preview-text"

OUTPUT_DIR = "frontend/public/images/ui"
os.makedirs(OUTPUT_DIR, exist_ok=True)

IMAGES_TO_GEN = [
    {
        "name": "character-bg.jpg",
        "prompt": "Fantasy tavern interior background, dim lighting, wooden furniture, role playing game atmosphere, high quality, 8k resolution, wide angle, no text."
    },
    {
        "name": "spells-bg.jpg",
        "prompt": "Magical library background, wizard tower, glowing spellbooks, mystical runes, purple and blue lighting, high quality, 8k resolution, wide angle, no text."
    },
    {
        "name": "modules-bg.jpg",
        "prompt": "Old fantasy map on a wooden table background, compass, candle, adventure planning, parchment texture, high quality, 8k resolution, wide angle, no text."
    }
]

def generate_image(name, prompt):
    print(f"Generating {name}...")
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}"
    }
    data = {
        "model": MODEL,
        "messages": [
            {"role": "user", "content": prompt}
        ]
    }
    
    try:
        response = requests.post(API_URL, headers=headers, json=data, timeout=120)
        
        if response.status_code != 200:
            print(f"Error: {response.status_code} - {response.text}")
            return

        result = response.json()
        
        if "choices" not in result or len(result["choices"]) == 0:
            print("No choices in response")
            return
            
        content = result["choices"][0]["message"]["content"]
        
        print(f"  Content received (first 50 chars): {content[:50]}...")
        
        # Heuristic to find base64 image
        # If it contains "base64,", split it
        img_data = None
        
        if "base64," in content:
            base64_str = content.split("base64,")[1].split('"')[0].split("'")[0].strip()
            img_data = base64.b64decode(base64_str)
        elif len(content) > 1000: # Assume it's raw base64 if it's long
            # Try to clean up any potential markdown code blocks
            clean_content = content.replace("```", "").replace("base64", "").strip()
            try:
                img_data = base64.b64decode(clean_content)
            except Exception as e:
                print(f"  Base64 decode error: {e}")
                # Try to find the largest contiguous alphanumeric string
                import re
                candidates = re.findall(r'[A-Za-z0-9+/=]{100,}', content)
                if candidates:
                    longest = max(candidates, key=len)
                    print(f"  Found candidate base64 string of length {len(longest)}")
                    img_data = base64.b64decode(longest)
        
        if img_data:
            with open(os.path.join(OUTPUT_DIR, name), "wb") as f:
                f.write(img_data)
            print(f"  Successfully saved to {os.path.join(OUTPUT_DIR, name)}")
        else:
            print("  Could not extract image data from response")

    except Exception as e:
        print(f"  Failed to generate {name}: {e}")

if __name__ == "__main__":
    for item in IMAGES_TO_GEN:
        generate_image(item["name"], item["prompt"])
