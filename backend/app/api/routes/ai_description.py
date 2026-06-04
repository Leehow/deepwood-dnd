from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import httpx
import os
import json

from app.core.security import require_auth

router = APIRouter()

class DescriptionRequest(BaseModel):
    data: dict
    data_type: str  # "class", "race", "spell", "rule", etc.

class DescriptionResponse(BaseModel):
    description: str

@router.post("/generate-description", response_model=DescriptionResponse)
async def generate_description(
    request: DescriptionRequest,
    current_user: dict = Depends(require_auth),
):
    """Generate a human-readable description from JSON data using Infini GPT-5"""

    # Get API credentials from environment
    api_key = os.getenv("INIFINI_API_KEY")
    api_url = os.getenv("INIFINI_API_URL")

    if not api_key or not api_url:
        raise HTTPException(status_code=500, detail="Infini API credentials not configured")

    # Build prompt based on data type
    data_json = json.dumps(request.data, ensure_ascii=False, indent=2)

    prompt_templates = {
        "class": f"请用简洁的中文描述这个D&D 5E职业的核心特点和玩法风格（3-5句话）：\n\n{data_json}",
        "race": f"请用简洁的中文描述这个D&D 5E种族的特点和适合的职业（2-4句话）：\n\n{data_json}",
        "spell": f"请用简洁的中文描述这个D&D 5E法术的效果和用途（2-3句话）：\n\n{data_json}",
        "rule": f"请用简洁的中文解释这条D&D 5E规则（2-4句话）：\n\n{data_json}",
        "default": f"请用简洁的中文描述以下D&D 5E数据（2-4句话）：\n\n{data_json}"
    }

    prompt = prompt_templates.get(request.data_type, prompt_templates["default"])

    # Call Infini API (OpenAI-compatible)
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.post(
                f"{api_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "gpt-5",
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are a D&D 5E expert. Provide concise Chinese descriptions."
                        },
                        {
                            "role": "user",
                            "content": prompt
                        }
                    ],
                    "temperature": 0.7,
                    "max_tokens": 1000,  # GPT-5 uses tokens for reasoning, need higher limit
                    "stream": False
                }
            )
            response.raise_for_status()
            result = response.json()

            description = result["choices"][0]["message"]["content"].strip()
            return DescriptionResponse(description=description)

        except httpx.HTTPError as e:
            raise HTTPException(status_code=500, detail=f"Infini API error: {str(e)}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error generating description: {str(e)}")
