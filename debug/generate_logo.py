import requests
import json
import os
import re
import sys
import base64

API_KEY = "REDACTED_API_KEY"
BASE_URL = "https://api.aiionly.com/v1"
MODEL = "gemini-3-pro-image-preview-text"

def generate_logo():
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }
    
    prompt = "Generate a DND style small octopus logo. It should be suitable for a website icon (top left corner). High quality, fantasy style, minimal background or transparent if possible."

    data = {
        "model": MODEL,
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "stream": False
    }
    
    print(f"Sending request to {BASE_URL}/chat/completions...")
    try:
        response = requests.post(f"{BASE_URL}/chat/completions", headers=headers, json=data, timeout=60)
        
        print(f"Status Code: {response.status_code}")
        if response.status_code == 200:
            result = response.json()
            
            if 'choices' in result and len(result['choices']) > 0:
                content = result['choices'][0]['message']['content']
                print(f"Content start: {content[:60]}...")
                
                # Check for base64 data URI
                # Allow whitespace in base64 string
                base64_match = re.search(r'data:image/(\w+);base64,([\s\S]+?)\)', content)
                
                if base64_match:
                    ext = base64_match.group(1)
                    if ext == 'jpeg': ext = 'jpg'
                    b64_data = base64_match.group(2)
                    
                    # Remove whitespace/newlines from base64 string
                    b64_data = re.sub(r'\s+', '', b64_data)
                    
                    print(f"Found Base64 Image (format: {ext})")
                    
                    try:
                        img_data = base64.b64decode(b64_data)
                        output_path = f"frontend/public/logo.{ext}"
                        with open(output_path, "wb") as f:
                            f.write(img_data)
                        print(f"SUCCESS: Image saved to {output_path}")
                        return
                    except Exception as e:
                        print(f"Error decoding base64: {e}")

                # Fallback
                print("No base64 image found via regex. Content might be different format.")
                
            else:
                print("No choices.")
        else:
            print(f"Error: {response.text}")
            
    except Exception as e:
        print(f"Exception: {e}")

if __name__ == "__main__":
    generate_logo()