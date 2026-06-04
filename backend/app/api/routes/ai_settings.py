from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, cast, Enum as SQLEnum, text
from sqlalchemy.orm import selectinload
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
import json
import re
import httpx
import base64

from app.db.session import get_db
from app.models.ai_settings import AIAPISettings, AIModelConfig, ModelType
from app.schemas.ai_settings import (
    AIAPISettingsCreate,
    AIAPISettingsUpdate,
    AIAPISettingsResponse,
    AIModelConfigCreate,
    ModelInfo
)
from app.utils.permissions import require_admin


# ============= Helper Functions =============

# Regex to extract data URI from Markdown image syntax: ![...](data:image/...)
_MD_IMAGE_RE = re.compile(r'!\[.*?\]\((data:image/[^)]+)\)')


def _crop_image_to_square(image_bytes: bytes) -> bytes:
    """Center-crop image to 1:1 aspect ratio, return as PNG bytes."""
    from PIL import Image
    import io

    img = Image.open(io.BytesIO(image_bytes))
    w, h = img.size
    if w == h:
        return image_bytes  # Already square

    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    img = img.crop((left, top, left + side, top + side))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _extract_image_data(raw: str) -> str:
    """Extract actual image data from various response formats.

    Handles:
    - Markdown image: ![image](data:image/png;base64,...)
    - Raw data URI: data:image/png;base64,...
    - Raw base64 string
    """
    if not raw:
        return raw
    m = _MD_IMAGE_RE.search(raw)
    if m:
        return m.group(1)
    return raw

async def get_model_config(
    db: AsyncSession,
    model_type: ModelType,
    user_id: str = "global"
) -> AIModelConfig:
    """
    Get model configuration for a specific model type

    Args:
        db: Database session
        model_type: Type of model to retrieve
        user_id: User ID (default: "global")

    Returns:
        AIModelConfig object

    Raises:
        HTTPException: If config not found or not properly configured
    """
    # Ensure model_type is a ModelType enum
    if isinstance(model_type, str):
        model_type = ModelType(model_type)

    model_type_value = model_type.value if isinstance(model_type, ModelType) else model_type

    # Use text() to avoid PostgreSQL enum type casting issues
    stmt = text("""
        SELECT ai_model_configs.*
        FROM ai_model_configs
        JOIN ai_api_settings ON ai_api_settings.id = ai_model_configs.settings_id
        WHERE ai_api_settings.user_id = :user_id
        AND ai_model_configs.model_type = :model_type
    """)
    result = await db.execute(stmt, {"user_id": user_id, "model_type": model_type_value})
    row = result.fetchone()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{model_type.value} model not configured. Please configure it in API settings."
        )

    # Convert row to AIModelConfig object
    config = AIModelConfig(
        id=row[0],
        settings_id=row[1],
        model_type=row[2],
        api_url=row[3],
        api_key=row[4],
        model_name=row[5],
        created_at=row[6],
        updated_at=row[7]
    )

    if not config.api_url or not config.api_key or not config.model_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{model_type.value} model not fully configured. Please set API URL, Key, and Model Name."
        )

    return config


async def get_all_settings(
    db: AsyncSession,
    user_id: str = "global"
) -> AIAPISettings:
    """
    Get all AI API settings with model configs

    Args:
        db: Database session
        user_id: User ID (default: "global")

    Returns:
        AIAPISettings object with model_configs

    Raises:
        HTTPException: If settings not found
    """
    stmt = (
        select(AIAPISettings)
        .options(selectinload(AIAPISettings.model_configs))
        .where(AIAPISettings.user_id == user_id)
    )
    result = await db.execute(stmt)
    settings = result.scalar_one_or_none()

    if not settings:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="AI settings not found. Please contact admin to configure."
        )

    return settings


async def update_or_create_model_config(
    db: AsyncSession,
    settings_id: int,
    model_type: ModelType,
    api_url: Optional[str],
    api_key: Optional[str],
    model_name: Optional[str]
) -> AIModelConfig:
    """
    Update existing or create new model config

    Args:
        db: Database session
        settings_id: Parent settings ID
        model_type: Type of model
        api_url: API URL
        api_key: API Key
        model_name: Model name

    Returns:
        Created or updated AIModelConfig
    """
    # Ensure model_type is a ModelType enum
    if isinstance(model_type, str):
        model_type = ModelType(model_type)

    # Check if config already exists - use enum comparison
    stmt = select(AIModelConfig).where(
        (AIModelConfig.settings_id == settings_id) &
        (cast(AIModelConfig.model_type, SQLEnum(ModelType)) == model_type)
    )
    result = await db.execute(stmt)
    existing = result.scalar_one_or_none()

    if existing:
        # Update existing
        if api_url is not None:
            existing.api_url = api_url
        if api_key is not None:
            existing.api_key = api_key
        if model_name is not None:
            existing.model_name = model_name
        return existing
    else:
        # Create new
        new_config = AIModelConfig(
            settings_id=settings_id,
            model_type=model_type,
            api_url=api_url,
            api_key=api_key,
            model_name=model_name
        )
        db.add(new_config)
        return new_config
from app.schemas.character import (
    CharacterBackgroundRequest,
    CharacterBackgroundResponse,
    FullDescriptionRequest,
    FullDescriptionResponse,
    AppearanceRequest,
    AppearanceResponse,
    PersonalityRequest,
    PersonalityResponse,
    BackstoryRequest,
    AvatarGenerationRequest,
    AvatarGenerationResponse
)
from app.services.ai_service import AIService
from app.services.character_generator import CharacterGenerator
from app.utils.races import get_race_age_range
from app.utils.image_storage import save_base64_image_async
from app.core.security import require_auth

router = APIRouter(prefix="/ai-settings", tags=["AI Settings"])


@router.post("", response_model=AIAPISettingsResponse, status_code=status.HTTP_201_CREATED)
async def create_ai_settings(
    settings: AIAPISettingsCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Create global AI API settings with model configs (Admin only)"""
    await require_admin(current_user["user_id"], db)

    # Check if global settings already exist
    result = await db.execute(
        select(AIAPISettings).where(AIAPISettings.user_id == "global")
    )
    existing = result.scalar_one_or_none()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Global AI settings already exist. Use PUT to update."
        )

    # Create new global settings
    db_settings = AIAPISettings(user_id="global")
    db.add(db_settings)
    await db.flush()  # Get settings.id

    # Create model configs
    for model_config in settings.model_configs:
        db_model_config = AIModelConfig(
            settings_id=db_settings.id,
            model_type=model_config.model_type,
            api_url=model_config.api_url,
            api_key=model_config.api_key,
            model_name=model_config.model_name
        )
        db.add(db_model_config)

    await db.commit()
    await db.refresh(db_settings)

    return db_settings


@router.get("", response_model=AIAPISettingsResponse)
async def get_ai_settings(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Get global AI API settings with model configs (Admin only)"""
    await require_admin(current_user["user_id"], db)
    settings = await get_all_settings(db, user_id="global")
    return settings


@router.put("", response_model=AIAPISettingsResponse)
async def update_ai_settings(
    settings_update: AIAPISettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Update global AI API settings and model configs (Admin only)"""
    await require_admin(current_user["user_id"], db)

    # Get or create settings
    result = await db.execute(
        select(AIAPISettings).where(AIAPISettings.user_id == "global")
    )
    settings = result.scalar_one_or_none()

    if not settings:
        # Create if not exists
        settings = AIAPISettings(user_id="global")
        db.add(settings)
        await db.flush()

    # Update or create model configs
    for model_config in settings_update.model_configs:
        await update_or_create_model_config(
            db=db,
            settings_id=settings.id,
            model_type=model_config.model_type,
            api_url=model_config.api_url,
            api_key=model_config.api_key,
            model_name=model_config.model_name
        )

    await db.commit()

    # Reload with model_configs
    settings = await get_all_settings(db, user_id="global")
    return settings


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ai_settings(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Delete global AI API settings (CASCADE deletes model configs) (Admin only)"""
    await require_admin(current_user["user_id"], db)

    result = await db.execute(
        select(AIAPISettings).where(AIAPISettings.user_id == "global")
    )
    settings = result.scalar_one_or_none()

    if not settings:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Global AI settings not found"
        )

    await db.delete(settings)  # CASCADE will delete related model_configs
    await db.commit()

    return None


@router.post("/fetch-models")
async def fetch_models(
    api_url: str,
    api_key: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Fetch available models from specified API (Admin only)"""
    await require_admin(current_user["user_id"], db)

    try:
        models = await AIService.fetch_models(api_url, api_key)
        return {
            "success": True,
            "models": models
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to fetch models: {str(e)}"
        )


@router.post("/test-connection")
async def test_connection(
    api_url: str,
    api_key: str
):
    """Test API connection without saving settings"""
    try:
        models = await AIService.fetch_models(api_url, api_key)
        return {
            "success": True,
            "models_count": len(models),
            "models": models
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to connect: {str(e)}"
        )


@router.post("/test-model")
async def test_model(
    api_url: str = Query(...),
    api_key: str = Query(...),
    model: str = Query(...)
):
    """Stream a test prompt, measure TTFT and tokens/s"""
    import time

    prompt = (
        "Write a short creative paragraph (around 80 words) about "
        "a mysterious tavern in a D&D fantasy world. "
        "Include vivid sensory details."
    )

    try:
        t_start = time.monotonic()
        ttft = None
        token_count = 0
        chunks: list[str] = []

        async for chunk in AIService.generate_completion_stream(
            api_url=api_url,
            api_key=api_key,
            model=model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=300,
        ):
            if ttft is None:
                ttft = time.monotonic() - t_start
            token_count += 1
            chunks.append(chunk)

        total_time = time.monotonic() - t_start
        # tokens/s based on generation phase only (exclude TTFT)
        gen_time = total_time - (ttft or 0)
        tps = token_count / gen_time if gen_time > 0 else 0

        return {
            "success": True,
            "response": "".join(chunks).strip(),
            "ttft": round((ttft or 0) * 1000),          # ms
            "tokens": token_count,
            "tokens_per_second": round(tps, 1),
            "total_time": round(total_time * 1000),      # ms
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Model test failed: {str(e)}"
        )


@router.post("/test-image-model")
async def test_image_model(
    api_url: str = Query(...),
    api_key: str = Query(...),
    model: str = Query(...)
):
    """Generate a test image and measure generation time"""
    import time

    prompt = "A small fantasy treasure chest with golden coins, D&D style icon, simple background"

    try:
        t_start = time.monotonic()

        # Create a minimal config-like object for AvatarService
        class _FakeConfig:
            def __init__(self, url, key, name):
                self.api_url = url
                self.api_key = key
                self.model_name = name

        fake_config = _FakeConfig(api_url, api_key, model)

        from app.services.avatar_service import AvatarService
        svc = AvatarService()
        result = await svc._call_image_api(fake_config, prompt)

        total_time = time.monotonic() - t_start

        if not result:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Image generation returned empty result"
            )

        # Determine if result is a URL or base64
        is_url = isinstance(result, str) and (
            result.startswith("http") or result.startswith("DASHSCOPE_URL:")
        )
        is_data_uri = isinstance(result, str) and result.startswith("data:image")

        if is_url:
            image_data = result.replace("DASHSCOPE_URL:", "")
        elif is_data_uri:
            image_data = result
        else:
            # Raw base64 - wrap as data URI
            image_data = f"data:image/png;base64,{result}"

        return {
            "success": True,
            "image_url": image_data,
            "total_time": round(total_time * 1000),  # ms
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Image model test failed: {str(e)}"
        )


@router.post("/generate-character-background", response_model=CharacterBackgroundResponse)
async def generate_character_background(
    request: CharacterBackgroundRequest,
    db: AsyncSession = Depends(get_db)
):
    """Generate character background using AI with translation support"""
    # Get model config via usage config
    model_type = await _get_usage_model_type(db, "character_background")
    config = await get_model_config(db, model_type)

    try:
        if request.generate_full:
            # Generate complete character including name, age, gender
            # Get age range from race data
            age_range = get_race_age_range(request.race)

            result = await CharacterGenerator.generate_full_character(
                api_url=config.api_url,
                api_key=config.api_key,
                model=config.model_name,
                race=request.race,
                subrace=request.subrace,
                character_class=request.character_class,
                alignment=request.alignment,
                age_range=age_range
            )
        else:
            # Generate only background and personality
            result = await CharacterGenerator.generate_background_only(
                api_url=config.api_url,
                api_key=config.api_key,
                model=config.model_name,
                race=request.race,
                subrace=request.subrace,
                character_class=request.character_class,
                alignment=request.alignment,
                name=request.name,
                age=request.age,
                gender=request.gender
            )

        return CharacterBackgroundResponse(**result)

    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to parse AI response as JSON: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate character background: {str(e)}"
        )


@router.post("/generate-race-image")
async def generate_race_image(
    race_name: str = Query(..., description="Race name in English"),
    race_name_cn: str = Query(..., description="Race name in Chinese"),
    db: AsyncSession = Depends(get_db)
):
    """Generate background image for a D&D race using configured image generation model"""

    # Get image model config
    config = await get_model_config(db, ModelType.ADVANCED_IMAGE)

    try:
        # Create prompt for race background image with unified dark fantasy style
        prompt = f"A majestic D&D {race_name} ({race_name_cn}) character in dark fantasy style, dramatic lighting with warm amber and golden highlights, mysterious atmosphere, detailed fantasy art, cinematic composition, dark background with glowing amber accents, epic fantasy illustration"

        # Call image generation API
        api_url = config.api_url.rstrip("/")
        model_name = config.model_name or ""

        headers = {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json"
        }

        # Determine API format based on model name
        # Gemini image-text models use chat/completions format
        is_gemini_image_text = (
            "gemini" in model_name and "image" in model_name
        )
        is_aionly_format = "aiionly.com" in api_url and not is_gemini_image_text

        if is_gemini_image_text:
            # Use chat/completions format for Gemini image-text models
            chat_url = api_url if api_url.endswith("/chat/completions") else f"{api_url}/chat/completions"
            prompt_chat = f"Generate a fantasy race illustration: {prompt}"
            payload = {
                "stream": False,
                "model": model_name,
                "messages": [{"role": "user", "content": prompt_chat}],
            }

            async with httpx.AsyncClient(timeout=300.0) as client:
                response = await client.post(chat_url, headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()

                b64_image = None
                if "choices" in data and data["choices"]:
                    message = data["choices"][0].get("message", {})
                    msg_content = message.get("content")
                    if "images" in message and message["images"]:
                        image_url = message["images"][0].get("image_url", {}).get("url", "")
                        if image_url:
                            b64_image = image_url
                    elif isinstance(msg_content, list):
                        for part in msg_content:
                            if isinstance(part, dict):
                                if part.get("type") == "image_url":
                                    b64_image = part.get("image_url", {}).get("url", "")
                                    if b64_image:
                                        break
                                elif "image_url" in part:
                                    b64_image = part["image_url"].get("url", "")
                                    if b64_image:
                                        break
                                elif "inline_data" in part:
                                    mime = part["inline_data"].get("mime_type", "image/png")
                                    b64 = part["inline_data"].get("data", "")
                                    if b64:
                                        b64_image = f"data:{mime};base64,{b64}"
                                        break
                    elif isinstance(msg_content, str):
                        cleaned = msg_content.replace("```", "").strip()
                        if cleaned:
                            b64_image = cleaned

                if b64_image:
                    b64_image = _extract_image_data(b64_image)
                    # If it's already a data URI, return as-is
                    if b64_image.startswith("data:image"):
                        return {
                            "success": True,
                            "image": b64_image,
                            "race": race_name
                        }
                    return {
                        "success": True,
                        "image": f"data:image/png;base64,{b64_image}",
                        "race": race_name
                    }
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="No image data returned from Gemini API"
                )

        elif is_aionly_format:
            # Use aionly.com API format
            # According to docs/aionly.md, parameters field with size is REQUIRED for successful generation
            payload = {
                "model": config.model_name,
                "input": {
                    "prompt": prompt
                },
                "parameters": {
                    "size": "1024x1024"
                },
                "format": "base64"  # Explicitly request base64 format
            }
        else:
            # Use OpenAI standard format
            payload = {
                "model": config.model_name,
                "prompt": prompt,
                "n": 1,
                "size": "512x512",  # Suitable for card backgrounds
                "response_format": "b64_json"  # Get base64 encoded image
            }

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(api_url, headers=headers, json=payload)
            response.raise_for_status()

            data = response.json()

            # Extract base64 image based on API format
            b64_image = None

            if is_aionly_format:
                # aionly.com response format: {"code": 200, "data": [{"base64": "...", "url": "..."}]}
                if "code" in data and data["code"] == 200:
                    if "data" in data and len(data["data"]) > 0:
                        image_data = data["data"][0]

                        # Try base64 field first
                        if "base64" in image_data:
                            b64_image = image_data["base64"]
                            # Remove data URI prefix if present
                            if b64_image.startswith("data:image"):
                                b64_image = b64_image.split(",", 1)[1] if "," in b64_image else b64_image

                        # Fallback to url field
                        elif "url" in image_data:
                            image_url = image_data["url"]
                            img_resp = await client.get(image_url)
                            img_resp.raise_for_status()
                            b64_image = base64.b64encode(img_resp.content).decode('utf-8')
            else:
                # OpenAI standard format
                if "data" in data and len(data["data"]) > 0:
                    b64_image = data["data"][0].get("b64_json")

            if b64_image:
                return {
                    "success": True,
                    "image": f"data:image/png;base64,{b64_image}",
                    "race": race_name
                }

            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="No image data returned from API"
            )

    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate image: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate race image: {str(e)}"
        )


@router.post("/generate-full-description", response_model=FullDescriptionResponse)
async def generate_full_description(
    request: FullDescriptionRequest,
    db: AsyncSession = Depends(get_db)
):
    """Generate complete character description using configured model"""
    # Get model config via usage config
    model_type = await _get_usage_model_type(db, "character_description")
    config = await get_model_config(db, model_type)

    try:
        # Get age range from race data
        age_range = get_race_age_range(request.race)

        result = await CharacterGenerator.generate_full_description(
            api_url=config.api_url,
            api_key=config.api_key,
            model=config.model_name,
            race=request.race,
            subrace=request.subrace,
            character_class=request.character_class,
            background=request.background,
            age_range=age_range
        )

        return FullDescriptionResponse(**result)

    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to parse AI response as JSON: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate full description: {str(e)}"
        )


@router.post("/generate-appearance", response_model=AppearanceResponse)
async def generate_appearance(
    request: AppearanceRequest,
    db: AsyncSession = Depends(get_db)
):
    """Generate character appearance using configured model"""
    # Get model config via usage config
    model_type = await _get_usage_model_type(db, "character_appearance")
    config = await get_model_config(db, model_type)

    try:
        # Get age range from race data
        age_range = get_race_age_range(request.race)

        result = await CharacterGenerator.generate_appearance_only(
            api_url=config.api_url,
            api_key=config.api_key,
            model=config.model_name,
            race=request.race,
            subrace=request.subrace,
            character_class=request.character_class,
            background=request.background,
            gender=request.gender,
            age_range=age_range
        )

        return AppearanceResponse(**result)

    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to parse AI response as JSON: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate appearance: {str(e)}"
        )


@router.post("/generate-personality", response_model=PersonalityResponse)
async def generate_personality(
    request: PersonalityRequest,
    db: AsyncSession = Depends(get_db)
):
    """Generate character personality using configured model"""
    # Get model config via usage config
    model_type = await _get_usage_model_type(db, "character_background")
    config = await get_model_config(db, model_type)

    try:
        result = await CharacterGenerator.generate_personality_only(
            api_url=config.api_url,
            api_key=config.api_key,
            model=config.model_name,
            race=request.race,
            subrace=request.subrace,
            character_class=request.character_class,
            background=request.background,
            alignment=request.alignment
        )

        return PersonalityResponse(**result)

    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to parse AI response as JSON: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate personality: {str(e)}"
        )


@router.post("/generate-backstory-stream")
async def generate_backstory_stream(
    request: BackstoryRequest,
    db: AsyncSession = Depends(get_db)
):
    """Generate character backstory using configured model with streaming"""
    # Get model config via usage config
    model_type = await _get_usage_model_type(db, "character_background")
    config = await get_model_config(db, model_type)

    try:
        # Generate backstory stream
        stream = CharacterGenerator.generate_backstory_stream(
            api_url=config.api_url,
            api_key=config.api_key,
            model=config.model_name,
            race=request.race,
            subrace=request.subrace,
            character_class=request.character_class,
            background=request.background,
            name=request.name,
            age=request.age,
            gender=request.gender,
            alignment=request.alignment,
            personality_traits=request.personality_traits,
            ideals=request.ideals,
            bonds=request.bonds,
            flaws=request.flaws
        )

        return StreamingResponse(
            stream,
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            }
        )

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate backstory: {str(e)}"
        )


# Cache for avatar descriptions
_avatar_descriptions_cache: Optional[Dict[str, Any]] = None

def _load_avatar_descriptions() -> Dict[str, Any]:
    """Load avatar descriptions for races and classes"""
    global _avatar_descriptions_cache
    if _avatar_descriptions_cache is not None:
        return _avatar_descriptions_cache

    from app.utils.rules_cache import get_avatar_descriptions_data
    try:
        _avatar_descriptions_cache = get_avatar_descriptions_data()
    except Exception:
        _avatar_descriptions_cache = {"races": {}, "classes": {}}
    return _avatar_descriptions_cache


def _get_race_avatar_description(race_id: str, subrace_id: Optional[str] = None) -> str:
    """Get avatar description for a race, preferring subrace if available"""
    descriptions = _load_avatar_descriptions()
    races = descriptions.get("races", {})

    # Try subrace first
    if subrace_id and subrace_id in races:
        return races[subrace_id].get("avatarDescription", "")

    # Fall back to main race
    if race_id in races:
        return races[race_id].get("avatarDescription", "")

    return ""


def _get_class_avatar_description(class_id: str) -> str:
    """Get avatar description for a class"""
    descriptions = _load_avatar_descriptions()
    classes = descriptions.get("classes", {})

    if class_id in classes:
        return classes[class_id].get("avatarDescription", "")

    return ""


def _get_race_display_name(race_id: str, subrace_id: Optional[str] = None) -> tuple[str, str]:
    """Get display names (English, Chinese) for a race from avatar-descriptions.json.
    Returns (english_name, chinese_name). Falls back to formatted ID if not found."""
    descriptions = _load_avatar_descriptions()
    races = descriptions.get("races", {})

    lookup_id = subrace_id if (subrace_id and subrace_id in races) else race_id
    if lookup_id in races:
        cn_name = races[lookup_id].get("name", "")
        # Convert ID to readable English: half_orc -> Half-Orc
        en_name = lookup_id.replace("_", "-").title()
        return en_name, cn_name

    en_name = race_id.replace("_", "-").title()
    return en_name, ""


def _get_class_display_name(class_id: str) -> tuple[str, str]:
    """Get display names (English, Chinese) for a class."""
    descriptions = _load_avatar_descriptions()
    classes = descriptions.get("classes", {})

    if class_id in classes:
        cn_name = classes[class_id].get("name", "")
        en_name = class_id.replace("_", "-").title()
        return en_name, cn_name

    return class_id.replace("_", "-").title(), ""


@router.post("/generate-avatar", response_model=AvatarGenerationResponse)
async def generate_character_avatar(
    request: AvatarGenerationRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Generate character avatar using configured Avatar model

    Creates a portrait image based on character's race, class, appearance, and personality.
    Uses avatar_player usage config to determine which model to use.
    """
    # Determine usage key: equipment regen uses its own config
    is_equip_regen_request = bool(request.reference_image and request.equipment_description)
    usage_key = "avatar_equip_regen" if is_equip_regen_request else "avatar_player"
    model_type = await _get_usage_model_type(db, usage_key)
    config = await get_model_config(db, model_type)

    try:
        # Build detailed prompt for avatar generation
        prompt_parts = []

        # Get display names for race and class
        race_en, _ = _get_race_display_name(request.race, request.subrace)
        class_en, _ = _get_class_display_name(request.character_class)

        # Base description with readable names (e.g., "Half-Orc Barbarian" instead of "half_orc barbarian")
        prompt_parts.append(f"A detailed D&D fantasy character portrait of a {race_en} {class_en}")

        # Add gender if provided
        if request.gender:
            prompt_parts.append(f"{request.gender}")

        # Add apparent age based on race lifespan
        if request.age and request.race:
            from app.utils.races import get_race_age_range
            # Try exact race_id first, then parent race (e.g. high_elf -> elf)
            mature_age, max_age = get_race_age_range(request.race)
            if mature_age == 20 and max_age == 100 and request.race != "human":
                # Likely a subrace that wasn't found, try parent race
                parent_race = request.race.split("_")[-1] if "_" in request.race else request.race
                m2, x2 = get_race_age_range(parent_race)
                if not (m2 == 20 and x2 == 100):
                    mature_age, max_age = m2, x2
            lifespan = max_age - mature_age if max_age > mature_age else 80
            age_ratio = (request.age - mature_age) / lifespan if lifespan > 0 else 0.5
            if age_ratio < 0:
                apparent = "youthful, not yet fully mature"
            elif age_ratio < 0.15:
                apparent = "young adult"
            elif age_ratio < 0.4:
                apparent = "in their prime, mature"
            elif age_ratio < 0.7:
                apparent = "middle-aged, experienced"
            else:
                apparent = "elderly, weathered by time"
            prompt_parts.append(f"Apparent age: {apparent} (age {request.age} for a {race_en})")

        # Inject race visual description — put it early and emphasize for non-human races
        race_visual = _get_race_avatar_description(request.race, request.subrace)
        if race_visual:
            prompt_parts.append(f"IMPORTANT race features (must be clearly visible): {race_visual}")

        # Inject class visual description (armor, equipment, bearing)
        class_visual = _get_class_avatar_description(request.character_class)
        if class_visual:
            prompt_parts.append(f"Class appearance: {class_visual}")

        # Add user-provided appearance details (supplements race defaults)
        if request.appearance_description:
            prompt_parts.append(f"Additional details: {request.appearance_description}")

        # Add personality hints
        if request.personality_traits and len(request.personality_traits) > 0:
            traits_str = ", ".join(request.personality_traits[:2])  # Use first 2 traits
            prompt_parts.append(f"Personality: {traits_str}")

        # Add expression / mood if provided — insert near beginning for emphasis
        if request.expression_description:
            print(f"[Avatar] Expression description received: {request.expression_description}", flush=True)
            # Insert right after the base description (index 1) so it's prominent
            prompt_parts.insert(1, f"IMPORTANT - Character's facial expression and mood: {request.expression_description}")

        # Add background context
        if request.background:
            prompt_parts.append(f"Background: {request.background}")

        # Add equipment description if provided (for equipment-based regen)
        if request.equipment_description:
            prompt_parts.append(f"Currently wearing/wielding equipment: {request.equipment_description}")

        # Style instructions
        is_equipment_regen = bool(request.reference_image and request.equipment_description)
        if is_equipment_regen:
            prompt_parts.append("Epic fantasy art style, detailed character portrait, professional digital art, dramatic lighting, high quality, centered composition, looking at viewer. IMPORTANT: Keep the character's face, body type and identity the same as the reference image, only change their equipment and outfit to match the equipment description. CRITICAL: Do NOT draw any text, labels, stat blocks, numbers, watermarks or UI overlays on the image - pure artwork only")
        else:
            prompt_parts.append("Epic fantasy art style, detailed character portrait, professional digital art, dramatic lighting with warm amber highlights, dark fantasy atmosphere, high quality, centered composition, looking at viewer")

        # Determine if we have a race reference image (for soft visual guidance)
        has_race_ref = bool(request.race_reference_image and not is_equipment_regen)

        prompt = ", ".join(prompt_parts)

        # Call image generation API
        api_url = config.api_url.rstrip("/")
        model_name = config.model_name or ""

        headers = {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json"
        }

        # Determine API format based on URL and model name
        is_dashscope = "dashscope.aliyuncs.com" in api_url
        is_z_image_model = model_name.startswith("z-image") or model_name in ("wanx-v1", "wanx2.1-t2i-turbo")
        is_qwen_image_model = model_name.startswith("qwen-image")
        is_gemini_image_text = (
            "gemini" in model_name and "image" in model_name
        )
        is_aionly_format = "aiionly.com" in api_url and not is_gemini_image_text
        print(f"[Avatar] api_url={api_url[:80]}, model={model_name}, is_dashscope={is_dashscope}, is_z_image={is_z_image_model}, is_qwen_image={is_qwen_image_model}, is_equip_regen={is_equipment_regen}, ref_image={'yes' if request.reference_image else 'no'}", flush=True)

        b64_image = None

        async with httpx.AsyncClient(timeout=300.0) as client:  # 5 min timeout for image gen
            if is_dashscope or is_z_image_model or is_qwen_image_model:
                # DashScope native API for z-image-turbo
                dashscope_url = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
                # Build English prompt for DashScope
                race_visual_part = ""
                if race_visual:
                    race_visual_part = f"\nIMPORTANT race features (must be clearly visible): {race_visual}"
                equip_part = ""
                if request.equipment_description:
                    equip_part = f"\nCurrently wearing/wielding: {request.equipment_description}"
                ref_note = ""
                if is_equipment_regen:
                    ref_note = "\nThe attached image is the character's CURRENT portrait. Keep the character's face, body type and identity exactly the same. Only change their equipment and outfit to match the equipment description. Do NOT add any text, numbers, or labels."
                elif has_race_ref:
                    ref_note = "\nThe attached image is a SOFT REFERENCE for racial features only. Do NOT copy it directly. Create a unique character based on the description below. Player's appearance settings take priority."
                expression_part = ""
                if request.expression_description:
                    expression_part = f"\nFacial expression: {request.expression_description}. The character MUST show this expression clearly."
                dnd_prompt = (
                    f"D&D fantasy character portrait, front-facing, dark background, square composition. Oil painting style, realistic and detailed, epic fantasy.\n"
                    f"Race: {race_en}, Class: {class_en}.{expression_part}{race_visual_part}{equip_part}{ref_note}\n\n{prompt}"
                )
                print(f"[Avatar] DashScope prompt (first 300): {dnd_prompt[:300]}", flush=True)
                # Build content array - include reference image for equipment regen or race ref
                content_items = []
                if is_equipment_regen and request.reference_image:
                    ref_url = request.reference_image
                    try:
                        if ref_url.startswith("data:image"):
                            # Already base64 data URI
                            content_items.append({"image": ref_url})
                            print(f"[Avatar] Including equipment ref image (base64 data URI)")
                        elif ref_url.startswith("http"):
                            img_resp = await client.get(ref_url)
                            img_resp.raise_for_status()
                            cropped_bytes = _crop_image_to_square(img_resp.content)
                            ref_b64 = base64.b64encode(cropped_bytes).decode("utf-8")
                            content_items.append({"image": f"data:image/png;base64,{ref_b64}"})
                            print(f"[Avatar] Including equipment ref image (cropped to 1:1): {ref_url[:80]}...")
                    except Exception as e:
                        print(f"[Avatar] Failed to include equipment ref image: {e}")
                elif has_race_ref:
                    ref_url = request.race_reference_image
                    try:
                        img_resp = await client.get(ref_url)
                        img_resp.raise_for_status()
                        cropped_bytes = _crop_image_to_square(img_resp.content)
                        ref_b64 = base64.b64encode(cropped_bytes).decode("utf-8")
                        content_items.append({"image": f"data:image/png;base64,{ref_b64}"})
                        print(f"[Avatar] Including race ref image (cropped to 1:1): {ref_url[:80]}...")
                    except Exception as e:
                        print(f"[Avatar] Failed to crop race ref image, using URL directly: {e}")
                        content_items.append({"image": ref_url})
                content_items.append({"text": dnd_prompt})
                payload = {
                    "model": model_name or "z-image-turbo",
                    "input": {
                        "messages": [{"role": "user", "content": content_items}]
                    },
                    "parameters": {"prompt_extend": False, "size": "512*512"}
                }
                print(f"[Avatar] POST {dashscope_url} model={model_name} DashScope format, content_items count={len(content_items)}, has_image={'image' in str(content_items[0]) if content_items else 'empty'}", flush=True)
                response = await client.post(dashscope_url, headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()
                output = data.get("output", {})
                choices = output.get("choices", [])
                if choices:
                    content = choices[0].get("message", {}).get("content", [])
                    for item in content:
                        if "image" in item:
                            b64_image = item["image"]  # This is a URL
                            break

            elif is_aionly_format:
                # aionly.com API format
                payload = {
                    "model": model_name,
                    "input": {"prompt": prompt},
                    "parameters": {"size": "1024x1024"},
                    "format": "base64"
                }
                print(f"[Avatar] POST {api_url} model={model_name} aionly format")
                response = await client.post(api_url, headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()
                if data.get("code") == 200 and "data" in data and data["data"]:
                    image_data = data["data"][0]
                    if "base64" in image_data:
                        b64_image = image_data["base64"]
                        if b64_image.startswith("data:image"):
                            b64_image = b64_image.split(",", 1)[1] if "," in b64_image else b64_image
                    elif "url" in image_data:
                        img_resp = await client.get(image_data["url"])
                        img_resp.raise_for_status()
                        b64_image = base64.b64encode(img_resp.content).decode('utf-8')

            elif is_gemini_image_text:
                # Gemini image models: try OpenAI-compat first, fallback to native format
                chat_url = api_url if api_url.endswith("/chat/completions") else f"{api_url}/chat/completions"
                base_url = api_url.rstrip("/")
                if base_url.endswith("/v1"):
                    base_url = base_url[:-3]
                gemini_native_url = f"{base_url}/v1beta/models/{model_name}:generateContent"

                # Prepare reference image data (shared by both formats)
                ref_b64_data = None  # raw base64 bytes
                if is_equipment_regen and request.reference_image:
                    ref_url = request.reference_image
                    if ref_url.startswith("http://") or ref_url.startswith("https://"):
                        try:
                            img_resp = await client.get(ref_url)
                            img_resp.raise_for_status()
                            cropped_bytes = _crop_image_to_square(img_resp.content)
                            ref_b64_data = base64.b64encode(cropped_bytes).decode("utf-8")
                            print(f"[Avatar] Downloaded & cropped equipment ref image to 1:1")
                        except Exception as e:
                            print(f"[Avatar] Failed to download reference image: {e}")
                elif has_race_ref:
                    ref_url = request.race_reference_image
                    if ref_url.startswith("http://") or ref_url.startswith("https://"):
                        try:
                            img_resp = await client.get(ref_url)
                            img_resp.raise_for_status()
                            cropped_bytes = _crop_image_to_square(img_resp.content)
                            ref_b64_data = base64.b64encode(cropped_bytes).decode("utf-8")
                            print(f"[Avatar] Downloaded & cropped race ref image to 1:1")
                        except Exception as e:
                            print(f"[Avatar] Failed to download race reference image: {e}")

                # Build text prompt
                if is_equipment_regen and request.reference_image:
                    text_prompt = (
                        f"Based on this character portrait, regenerate with updated equipment. "
                        f"Keep face, body shape, identity the same. "
                        f"Only change outfit/equipment to match: {request.equipment_description}. "
                        f"Do NOT include any text, numbers, stat blocks, labels or UI elements in the image. Pure artwork only. "
                        f"Output 1:1 square image. Character info: {prompt}"
                    )
                elif has_race_ref and ref_b64_data:
                    text_prompt = (
                        f"Use the attached image as a SOFT REFERENCE for racial features only. "
                        f"Create a unique character portrait. Player's appearance takes priority. "
                        f"Output 1:1 square image. Character details: {prompt}"
                    )
                else:
                    text_prompt = f"Generate a fantasy character portrait in 1:1 square aspect ratio: {prompt}"

                # --- Attempt 1: OpenAI-compatible format ---
                if ref_b64_data:
                    ref_data_uri = f"data:image/png;base64,{ref_b64_data}"
                    openai_content = [
                        {"type": "image_url", "image_url": {"url": ref_data_uri}},
                        {"type": "text", "text": text_prompt}
                    ]
                else:
                    openai_content = text_prompt

                openai_payload = {
                    "model": model_name,
                    "messages": [{"role": "user", "content": openai_content}],
                    "response_modalities": ["Text", "Image"],
                }

                print(f"[Avatar] Trying OpenAI-compat: POST {chat_url} model={model_name}")
                response = await client.post(chat_url, headers=headers, json=openai_payload)

                if response.status_code == 200:
                    data = response.json()
                    if "choices" in data and data["choices"]:
                        message = data["choices"][0].get("message", {})
                        content = message.get("content")
                        # Parse image from various response formats
                        if isinstance(content, str) and "data:image" in content:
                            b64_image = _extract_image_data(content.replace("```", "").strip())
                        elif isinstance(content, list):
                            for part in content:
                                if isinstance(part, dict):
                                    if part.get("type") == "image_url":
                                        b64_image = part.get("image_url", {}).get("url", "")
                                    elif "image_url" in part:
                                        b64_image = part["image_url"].get("url", "")
                                    elif "inline_data" in part:
                                        mime = part["inline_data"].get("mime_type", "image/png")
                                        b64 = part["inline_data"].get("data", "")
                                        if b64:
                                            b64_image = f"data:{mime};base64,{b64}"
                                    if b64_image:
                                        break
                        elif isinstance(content, str):
                            cleaned = _extract_image_data(content.replace("```", "").strip())
                            if cleaned:
                                b64_image = cleaned
                    print(f"[Avatar] OpenAI-compat result: has_image={bool(b64_image)}")

                if not b64_image:
                    # --- Attempt 2: Gemini native format ---
                    print(f"[Avatar] OpenAI-compat failed (status={response.status_code}), trying Gemini native format")
                    native_parts = []
                    if ref_b64_data:
                        native_parts.append({"inlineData": {"mimeType": "image/png", "data": ref_b64_data}})
                    native_parts.append({"text": text_prompt})

                    native_payload = {
                        "contents": [{"parts": native_parts}],
                        "generationConfig": {"responseModalities": ["Text", "Image"]}
                    }

                    print(f"[Avatar] POST {gemini_native_url} model={model_name} Gemini native format")
                    response = await client.post(gemini_native_url, headers=headers, json=native_payload)
                    print(f"[Avatar] Gemini native response status: {response.status_code}")
                    response.raise_for_status()
                    data = response.json()

                    candidates = data.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        for part in parts:
                            if "inlineData" in part:
                                mime = part["inlineData"].get("mimeType", "image/png")
                                b64 = part["inlineData"].get("data", "")
                                if b64:
                                    b64_image = f"data:{mime};base64,{b64}"
                                    break
                    print(f"[Avatar] Gemini native result: has_image={bool(b64_image)}")
            else:
                # Use OpenAI standard image generation format
                payload = {
                    "model": model_name,
                    "prompt": prompt,
                    "n": 1,
                    "size": "512x512",
                    "response_format": "b64_json"
                }

                print(f"[Avatar] POST {api_url} model={model_name} standard image mode")
                response = await client.post(api_url, headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()

                if "data" in data and len(data["data"]) > 0:
                    b64_image = data["data"][0].get("b64_json")

            if b64_image:
                b64_image = _extract_image_data(b64_image)
                # Check if it's a URL (from DashScope) or base64
                if b64_image.startswith("http://") or b64_image.startswith("https://"):
                    # DashScope returns URL - download and upload to OSS
                    print(f"[Avatar] DashScope URL detected, downloading and uploading to OSS")
                    try:
                        img_resp = await client.get(b64_image)
                        img_resp.raise_for_status()
                        image_data = img_resp.content

                        from app.domain.parsing.oss_storage import get_oss_storage
                        from datetime import datetime

                        # Generate unique ID for this avatar (character doesn't exist yet)
                        unique_id = int(datetime.now().timestamp() * 1000) % 10000000

                        try:
                            oss = get_oss_storage()
                            result = await oss.upload_avatar_async(image_data, "character", unique_id, "")
                            if result:
                                small_url, large_url = result
                                print(f"[Avatar] Uploaded to OSS: {large_url}")
                                return AvatarGenerationResponse(
                                    success=True,
                                    image=large_url,  # Use large URL for character display
                                    prompt=prompt
                                )
                        except ValueError as e:
                            print(f"[Avatar] OSS not configured: {e}")
                    except Exception as e:
                        print(f"[Avatar] Failed to download/upload DashScope image: {e}")

                    # Fallback to DashScope URL if OSS upload fails
                    return AvatarGenerationResponse(
                        success=True,
                        image=b64_image,
                        prompt=prompt
                    )

                # Save base64 image to OSS (preferred) or local file (fallback)
                try:
                    from app.domain.parsing.oss_storage import get_oss_storage
                    from datetime import datetime

                    # Generate unique ID for this avatar
                    unique_id = int(datetime.now().timestamp() * 1000) % 10000000

                    try:
                        # Decode base64 to bytes
                        if b64_image.startswith("data:image"):
                            _, encoded = b64_image.split(",", 1)
                        else:
                            encoded = b64_image
                        image_data = base64.b64decode(encoded)

                        oss = get_oss_storage()
                        result = await oss.upload_avatar_async(image_data, "character", unique_id, "")
                        if result:
                            small_url, large_url = result
                            print(f"[Avatar] Uploaded base64 to OSS: {large_url}")
                            return AvatarGenerationResponse(
                                success=True,
                                image=large_url,
                                prompt=prompt
                            )
                    except ValueError as e:
                        print(f"[Avatar] OSS not configured, using local storage: {e}")

                    # Fallback to local storage
                    prefix = f"character_{request.race}_{request.character_class}".replace(" ", "_").lower()
                    saved_url = await save_base64_image_async(b64_image, image_type="avatars", prefix=prefix)

                    return AvatarGenerationResponse(
                        success=True,
                        image=saved_url,
                        prompt=prompt
                    )
                except Exception as save_error:
                    print(f"Failed to save avatar image: {save_error}")
                    # Fallback to base64 if save fails
                    return AvatarGenerationResponse(
                        success=True,
                        image=f"data:image/png;base64,{b64_image}",
                        prompt=prompt
                    )

            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="No image data returned from API"
            )

    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate avatar: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate avatar: {str(e)}"
        )


@router.post("/generate-dc")
async def generate_dc(
    request: dict,
    db: AsyncSession = Depends(get_db)
):
    """
    Generate DC value using AI based on description

    Request body:
    - description: str - The description of the check
    - user_id: str - User ID (default: "global")

    Returns:
    - dc: int - Suggested DC value
    - reason: str - Explanation for the DC value
    """
    description = request.get("description", "").strip()
    user_id = request.get("user_id", "global")

    if not description:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Description is required"
        )

    # Get model config via usage config (rules_chat for DC generation)
    model_type = await _get_usage_model_type(db, "rules_chat")
    config = await get_model_config(db, model_type, user_id)

    # Prepare prompt for AI
    prompt = f"""根据以下D&D 5E检定描述，建议一个合适的DC难度值（5-30之间）。

描述：{description}

请参考以下DC难度标准：
- DC 5: 非常简单
- DC 10: 简单
- DC 15: 中等
- DC 20: 困难
- DC 25: 非常困难
- DC 30: 几乎不可能

请以JSON格式返回：
{{
  "dc": <数字>,
  "reason": "<简短解释为什么选择这个DC值>"
}}"""

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{config.api_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {config.api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": config.model_name,
                    "messages": [
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.7,
                    "response_format": {"type": "json_object"}
                }
            )
            response.raise_for_status()

            data = response.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "{}")

            # Parse JSON response
            result = json.loads(content)
            dc = result.get("dc", 15)
            reason = result.get("reason", "AI建议的DC值")

            # Validate DC range
            if not isinstance(dc, int) or dc < 5 or dc > 30:
                dc = 15
                reason = "DC值超出范围，使用默认值15"

            return {
                "dc": dc,
                "reason": reason
            }

    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI请求失败: {str(e)}"
        )
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="AI返回的JSON格式无效"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"生成DC失败: {str(e)}"
        )


@router.post("/analyze-check")
async def analyze_check(
    request: dict,
    db: AsyncSession = Depends(get_db)
):
    """
    Analyze description using AI to determine check type(s) and DC

    Request body:
    - description: str - The description of the situation
    - user_id: str - User ID (default: "global")
    - module_id: str | null - Optional module ID for RAG context

    Returns:
    - checks: list - Array of check objects, each containing:
      - check_type: str - Type of check (ability_check, skill_check, saving_throw, attack_roll)
      - ability: str - Associated ability (strength, dexterity, etc.)
      - skill: str | null - Associated skill if skill_check
      - dc: int - Suggested DC value
    - reason: str - Overall explanation
    """
    description = request.get("description", "").strip()
    user_id = request.get("user_id", "global")
    module_id = request.get("module_id")

    if not description:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Description is required"
        )

    # Get model config via usage config (dice_analyze for check analysis)
    model_type = await _get_usage_model_type(db, "dice_analyze")
    config = await get_model_config(db, model_type, user_id)

    # 如果提供了 module_id，使用 RAG 搜索模组上下文
    module_context = ""
    if module_id:
        try:
            from app.services.module_embedding_service import ModuleEmbeddingService
            embedding_service = ModuleEmbeddingService(db)
            results = await embedding_service.search_module_content(
                module_id=module_id,
                query=description,
                top_k=5,
                similarity_threshold=0.25,
                use_rerank=True
            )
            if results:
                chunks = []
                for r in results[:5]:
                    title = r.get("chapter_title", "")
                    content = r.get("content", "")
                    if title:
                        chunks.append(f"【{title}】{content}")
                    else:
                        chunks.append(content)
                module_context = "\n\n".join(chunks)
        except Exception:
            pass  # 模组搜索失败不影响主流程

    # Prepare prompt for AI
    module_section = ""
    if module_context:
        module_section = f"""
以下是与该场景相关的模组内容，请参考这些信息来更准确地判断检定类型和DC：

{module_context}

---
"""

    prompt = f"""根据以下D&D 5E场景描述，分析应该进行什么类型的检定。
一个场景可能需要一个或多个检定（例如"攀爬悬崖并躲避落石"需要运动检定+敏捷豁免）。
{module_section}
场景描述：{description}

检定类型：
1. 属性检定 (ability_check) - 纯属性检定，如力量检定推门
2. 技能检定 (skill_check) - 使用特定技能，如察觉、隐匿、说服等
3. 豁免检定 (saving_throw) - 抵抗效果，如躲避陷阱、抵抗毒素
4. 攻击检定 (attack_roll) - 攻击动作

技能列表（按属性分类）：
- 力量(STR): 运动(athletics)
- 敏捷(DEX): 杂技(acrobatics), 巧手(sleight_of_hand), 隐匿(stealth)
- 智力(INT): 奥秘(arcana), 历史(history), 调查(investigation), 自然(nature), 宗教(religion)
- 感知(WIS): 驯兽(animal_handling), 洞悉(insight), 医药(medicine), 察觉(perception), 求生(survival)
- 魅力(CHA): 欺瞒(deception), 威吓(intimidation), 表演(performance), 说服(persuasion)

DC难度参考：DC 5非常简单, DC 10简单, DC 15中等, DC 20困难, DC 25非常困难, DC 30几乎不可能

请以JSON格式返回（checks数组包含1-3个检定）：
{{
  "checks": [
    {{
      "check_type": "ability_check" | "skill_check" | "saving_throw" | "attack_roll",
      "ability": "strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" | "charisma",
      "skill": null | "技能英文ID",
      "dc": <数字5-30>
    }}
  ],
  "reason": "<简短解释为什么选择这些检定>"
}}"""

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{config.api_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {config.api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": config.model_name,
                    "messages": [
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.7,
                    "response_format": {"type": "json_object"}
                }
            )
            response.raise_for_status()

            data = response.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "{}")

            # Parse JSON response
            result = json.loads(content)

            checks_raw = result.get("checks", [])
            reason = result.get("reason", "AI建议的检定")

            # Validate and normalize checks
            valid_check_types = ["ability_check", "skill_check", "saving_throw", "attack_roll"]
            valid_abilities = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]

            checks = []
            for c in checks_raw[:3]:  # Max 3 checks
                check_type = c.get("check_type", "ability_check")
                ability = c.get("ability", "strength")
                skill = c.get("skill")
                dc = c.get("dc", 15)

                if check_type not in valid_check_types:
                    check_type = "ability_check"
                if ability not in valid_abilities:
                    ability = "strength"
                if not isinstance(dc, int) or dc < 5 or dc > 30:
                    dc = 15

                checks.append({
                    "check_type": check_type,
                    "ability": ability,
                    "skill": skill,
                    "dc": dc
                })

            # Ensure at least one check
            if not checks:
                checks = [{"check_type": "ability_check", "ability": "strength", "skill": None, "dc": 15}]

            return {
                "checks": checks,
                "reason": reason
            }

    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI请求失败: {str(e)}"
        )
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="AI返回的JSON格式无效"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"分析检定失败: {str(e)}"
        )


@router.post("/parse-monster-stats")
async def parse_monster_stats(
    request: dict,
    db: AsyncSession = Depends(get_db)
):
    """
    Parse monster stats from description text using Fast Language Model
    Extracts full structured data including abilities, actions, etc.
    """
    description = request.get("description", "").strip()
    name = request.get("name", "")
    actions_text = request.get("actions_text", "").strip()

    if not description and not actions_text:
        return {
            "ac": None, "hp": None, "hp_formula": None, "cr": None,
            "size": None, "type": None, "alignment": None, "speed": None,
            "ability_scores": None
        }

    # Get model config via usage config
    model_type = await _get_usage_model_type(db, "custom_creation")
    config = await get_model_config(db, model_type)

    # Build input text sections
    input_sections = f"## 基础属性\n{description}" if description else ""
    if actions_text:
        input_sections += f"\n\n## 能力与动作\n{actions_text}"

    prompt = f"""从以下D&D 5E怪物描述中提取完整的结构化数据。怪物名称：{name}

{input_sections}

请提取以下信息并以JSON格式返回（如果信息不存在则返回null）：
{{
  "ac": <护甲等级数字>,
  "acDesc": "<护甲类型描述，如天生护甲、皮甲>",
  "hp": <生命值数字>,
  "hp_formula": "<生命骰公式，如4d6+8>",
  "cr": "<挑战等级，如1/4或2>",
  "xp": <经验值数字>,
  "size": "<体型，如中型/大型>",
  "type": "<生物类型，如龙类/野兽>",
  "alignment": "<阵营，如守序邪恶>",
  "speed": {{
    "walk": <步行速度数字>,
    "fly": <飞行速度或null>,
    "swim": <游泳速度或null>,
    "climb": <攀爬速度或null>,
    "burrow": <掘地速度或null>
  }},
  "abilityScores": {{
    "str": <力量>, "strMod": <力量调整值>,
    "dex": <敏捷>, "dexMod": <敏捷调整值>,
    "con": <体质>, "conMod": <体质调整值>,
    "int": <智力>, "intMod": <智力调整值>,
    "wis": <感知>, "wisMod": <感知调整值>,
    "cha": <魅力>, "chaMod": <魅力调整值>
  }},
  "savingThrows": {{"wis": 3, "cha": 2}},
  "skills": {{"隐匿": 4, "察觉": 3}},
  "senses": "<感官描述，如黑暗视觉60尺，被动察觉12>",
  "languages": "<语言，如通用语，龙语>",
  "damageImmunities": "<伤害免疫>",
  "damageResistances": "<伤害抗性>",
  "conditionImmunities": "<状态免疫>",
  "specialAbilities": [
    {{"name": "能力名称", "description": "能力描述"}}
  ],
  "spellcasting": {{
    "level": <施法者等级>,
    "ability": "<施法关键属性>",
    "dc": <法术豁免DC>,
    "attackBonus": <法术攻击加值>,
    "spells": {{
      "cantrips": ["<戏法名>"],
      "1st": {{"slots": <法术位数>, "spells": ["<法术名>"]}},
      "2nd": {{"slots": <法术位数>, "spells": ["<法术名>"]}},
      "3rd": {{"slots": <法术位数>, "spells": ["<法术名>"]}},
      "4th": {{"slots": <法术位数>, "spells": ["<法术名>"]}},
      "5th": {{"slots": <法术位数>, "spells": ["<法术名>"]}}
    }}
  }} 或 null,
  "actions": [
    {{"name": "动作名称", "description": "动作描述，包含攻击骰和伤害", "attack_bonus": <攻击加值或null>, "damage": "<伤害骰或null>"}}
  ],
  "reactions": [
    {{"name": "反应名称", "description": "反应描述"}}
  ],
  "legendaryActions": [
    {{"name": "传奇动作名称", "description": "传奇动作描述"}}
  ]
}}

重要分类说明：
- specialAbilities: 被动能力，如"精美血统"、"鱼群战术"、"魔法抗性"等不需要消耗动作的能力
- spellcasting: 施法能力和法术列表
- actions: 需要消耗动作的攻击或能力，如"多重攻击"、"喷吐武器"、近战/远程攻击等

重要：
1. 数值字段必须是数字，不是字符串
2. 调整值根据属性计算：(属性-10)/2向下取整
3. 技能和豁免的值是加值数字
4. 没有的字段返回null或空数组
5. 只返回JSON，不要其他解释"""

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{config.api_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {config.api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": config.model_name,
                    "messages": [
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.1,
                    "max_tokens": 4000
                }
            )
            response.raise_for_status()

            data = response.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "{}")

            # Try to extract JSON from response
            import re
            json_match = re.search(r'\{[\s\S]*\}', content)
            if json_match:
                content = json_match.group(0)

            result = json.loads(content)

            # Build complete response
            return {
                "ac": result.get("ac") if isinstance(result.get("ac"), int) else None,
                "acDesc": result.get("acDesc") if isinstance(result.get("acDesc"), str) else None,
                "hp": result.get("hp") if isinstance(result.get("hp"), int) else None,
                "hp_formula": result.get("hp_formula") if isinstance(result.get("hp_formula"), str) else None,
                "cr": str(result.get("cr")) if result.get("cr") is not None else None,
                "xp": result.get("xp") if isinstance(result.get("xp"), int) else None,
                "size": result.get("size") if isinstance(result.get("size"), str) else None,
                "type": result.get("type") if isinstance(result.get("type"), str) else None,
                "alignment": result.get("alignment") if isinstance(result.get("alignment"), str) else None,
                "speed": result.get("speed") if isinstance(result.get("speed"), dict) else None,
                "abilityScores": result.get("abilityScores") if isinstance(result.get("abilityScores"), dict) else None,
                "savingThrows": result.get("savingThrows") if isinstance(result.get("savingThrows"), dict) else None,
                "skills": result.get("skills") if isinstance(result.get("skills"), dict) else None,
                "senses": result.get("senses") if isinstance(result.get("senses"), (str, dict)) else None,
                "languages": result.get("languages") if isinstance(result.get("languages"), (str, list)) else None,
                "damageImmunities": result.get("damageImmunities") if isinstance(result.get("damageImmunities"), (str, list)) else None,
                "damageResistances": result.get("damageResistances") if isinstance(result.get("damageResistances"), (str, list)) else None,
                "conditionImmunities": result.get("conditionImmunities") if isinstance(result.get("conditionImmunities"), (str, list)) else None,
                "specialAbilities": result.get("specialAbilities") if isinstance(result.get("specialAbilities"), list) else None,
                "spellcasting": result.get("spellcasting") if isinstance(result.get("spellcasting"), dict) else None,
                "actions": result.get("actions") if isinstance(result.get("actions"), list) else None,
                "reactions": result.get("reactions") if isinstance(result.get("reactions"), list) else None,
                "legendaryActions": result.get("legendaryActions") if isinstance(result.get("legendaryActions"), list) else None,
            }

    except httpx.HTTPError as e:
        print(f"[parse-monster-stats] AI request failed: {e}")
        return {
            "ac": None, "hp": None, "hp_formula": None, "cr": None,
            "size": None, "type": None, "alignment": None, "speed": None,
            "abilityScores": None
        }
    except json.JSONDecodeError as e:
        print(f"[parse-monster-stats] Failed to parse AI response: {e}")
        return {
            "ac": None, "hp": None, "hp_formula": None, "cr": None,
            "size": None, "type": None, "alignment": None, "speed": None,
            "abilityScores": None
        }
    except Exception as e:
        print(f"[parse-monster-stats] Error: {e}")
        return {
            "ac": None, "hp": None, "hp_formula": None, "cr": None,
            "size": None, "type": None, "alignment": None, "speed": None,
            "abilityScores": None
        }


@router.post("/parse-item-stats")
async def parse_item_stats(
    request: dict,
    db: AsyncSession = Depends(get_db)
):
    """
    Parse magic item stats from description text using Fast Language Model

    Request body:
    - description: str - The item description text
    - name: str - Item name (optional, for context)

    Returns structured item data extracted from description
    """
    description = request.get("description", "").strip()
    name = request.get("name", "")

    if not description:
        return {
            "category": None, "rarity": None, "requires_attunement": False,
            "attunement_by": None, "magic_bonus": None, "damage": None,
            "extra_damage": None, "abilities": None, "charges": None
        }

    # Get model config via usage config
    model_type = await _get_usage_model_type(db, "custom_creation")
    config = await get_model_config(db, model_type)

    prompt = f"""从以下D&D 5E魔法物品描述中提取结构化数据。物品名称：{name}

描述文本：
{description}

请提取以下信息并以JSON格式返回（如果信息不存在则返回null）：
{{
  "category": "<物品类别，如奇物/武器/护甲/戒指/魔杖/权杖/卷轴/药水>",
  "rarity": "<稀有度，必须是以下之一：common/uncommon/rare/very rare/legendary/artifact>",
  "requires_attunement": <是否需要同调，true或false>,
  "attunement_by": "<同调限制，如施法者/特定职业，如果无限制则null>",
  "magic_bonus": <魔法加值数字，如+1武器则为1，无则null>,
  "damage": {{
    "dice": "<伤害骰，如2d6>",
    "type": "<伤害类型，如火焰/冰冷/力场>"
  }},
  "extra_damage": {{
    "dice": "<额外伤害骰>",
    "type": "<额外伤害类型>"
  }},
  "charges": {{
    "max": <最大充能数>,
    "recharge": {{
      "time": "<恢复时机，如黎明>",
      "amount": "<恢复数量，如1d6+1>"
    }}
  }},
  "abilities": [
    {{
      "name": "<能力名称>",
      "type": "<类型：passive/active/rechargeable/triggered>",
      "description": "<能力描述>"
    }}
  ]
}}

稀有度对照：普通=common, 非普通/不常见=uncommon, 稀有=rare, 非常稀有/极稀有=very rare, 传奇=legendary, 神器=artifact
只返回JSON，不要其他解释。"""

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{config.api_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {config.api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": config.model_name,
                    "messages": [
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.1,
                    "response_format": {"type": "json_object"}
                }
            )
            response.raise_for_status()

            data = response.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "{}")

            # Parse JSON response
            result = json.loads(content)

            # Validate and clean the result
            valid_rarities = {"common", "uncommon", "rare", "very rare", "legendary", "artifact"}
            rarity = result.get("rarity")
            if rarity and isinstance(rarity, str):
                rarity = rarity.lower()
                if rarity not in valid_rarities:
                    rarity = None

            return {
                "category": result.get("category") if isinstance(result.get("category"), str) else None,
                "rarity": rarity,
                "requires_attunement": bool(result.get("requires_attunement")),
                "attunement_by": result.get("attunement_by") if isinstance(result.get("attunement_by"), str) else None,
                "magic_bonus": result.get("magic_bonus") if isinstance(result.get("magic_bonus"), int) else None,
                "damage": result.get("damage") if isinstance(result.get("damage"), dict) else None,
                "extra_damage": result.get("extra_damage") if isinstance(result.get("extra_damage"), dict) else None,
                "charges": result.get("charges") if isinstance(result.get("charges"), dict) else None,
                "abilities": result.get("abilities") if isinstance(result.get("abilities"), list) else None
            }

    except httpx.HTTPError as e:
        print(f"[parse-item-stats] AI request failed: {e}")
        return {
            "category": None, "rarity": None, "requires_attunement": False,
            "attunement_by": None, "magic_bonus": None, "damage": None,
            "extra_damage": None, "abilities": None, "charges": None
        }
    except json.JSONDecodeError as e:
        print(f"[parse-item-stats] Failed to parse AI response: {e}")
        return {
            "category": None, "rarity": None, "requires_attunement": False,
            "attunement_by": None, "magic_bonus": None, "damage": None,
            "extra_damage": None, "abilities": None, "charges": None
        }
    except Exception as e:
        print(f"[parse-item-stats] Error: {e}")
        return {
            "category": None, "rarity": None, "requires_attunement": False,
            "attunement_by": None, "magic_bonus": None, "damage": None,
            "extra_damage": None, "abilities": None, "charges": None
        }


# ============= Usage Configs =============

# Default model type mapping for each LLM usage point
DEFAULT_USAGE_CONFIGS = {
    # Module related
    "module_chat_query": "CHAT",
    "module_encounter_plan": "CHAT",  # Map encounter planning
    "module_ai_assist": "CHAT",  # Editor AI assist (/ command)
    "chapter_agent": "ADVANCED",  # Chapter agent with tool calling
    "module_analyze_entities": "FAST",
    "module_extract_monsters": "ADVANCED",
    "module_extract_items": "ADVANCED",
    "module_refresh_toc": "ADVANCED",
    "module_title_generation": "FAST",
    "note_title_generation": "FAST",
    # Character related
    "character_description": "FAST",
    "character_background": "CHAT",
    "character_appearance": "CHAT",
    "character_translation": "CHAT",
    "character_ai_generation": "FAST",
    "dm_character_generate": "FAST",  # DM high-level character generation
    "character_card_import": "ADVANCED",  # Character card import parsing
    # Resource/Rules related
    "resource_chat": "CHAT",
    "rules_chat": "CHAT",
    "equipment_pack_parse": "FAST",
    # Custom creation
    "custom_creation": "FAST",
    "prompt_expansion": "FAST",
    "npc_name_generate": "FAST",
    "npc_quick_generate": "FAST",
    "illusion_naming": "FAST",
    # In-game
    "websocket_chat": "CHAT",
    "dice_analyze": "CHAT",
    "token_move_narrative": "CHAT",
    "map_update_narrative": "CHAT",
    "combat_attack_narrative": "FAST",
    "combat_spell_narrative": "FAST",  # Spell combat narrative
    "combat_extra_effect": "FAST",  # Extra effects for critical/fumble
    "race_combat_effects_parse": "FAST",  # Parse race traits for combat effects
    "scene_generation": "VISION",  # Scene generation from map + chapter content
    # Speech-to-text (uses multimodal chat model)
    "voice_to_text": "CHAT",  # Voice input transcription via multimodal model
    # Text-to-speech
    "text_to_speech": "TTS",  # Text-to-speech synthesis
    # Image/Avatar generation
    "avatar_player": "MEDIUM_IMAGE",
    "avatar_monster": "FAST_IMAGE",
    "avatar_npc": "FAST_IMAGE",
    "avatar_item": "FAST_IMAGE",
    "avatar_shop": "FAST_IMAGE",
    "avatar_chest": "FAST_IMAGE",
    "avatar_equip_regen": "MEDIUM_IMAGE",
    "avatar_illusion": "FAST_IMAGE",
    "map_generation": "ADVANCED_IMAGE",
    "map_prompt_optimize": "FAST",
    "cover_image_generation": "ADVANCED_IMAGE",  # Campaign cover image generation
    # Other
    "avatar_appearance": "FAST",
    "translation_service": "TRANSLATION",
    "image_classification": "VISION",
    "terrain_detection": "VISION",
}

# Default parameters (temperature, max_tokens) for each usage point
# For text generation: temperature, max_tokens, use_temperature (whether to use temperature)
# For image generation: image_size (e.g., "512x512", "1024x1024")
DEFAULT_USAGE_PARAMS = {
    # Module related (text) - use_temperature defaults to False (not using temperature)
    "module_chat_query": {"temperature": 0.6, "max_tokens": 4000, "use_temperature": False},
    "module_analyze_entities": {"temperature": 0.1, "max_tokens": 8000, "use_temperature": False},
    "module_extract_monsters": {"temperature": 0.1, "max_tokens": 32000, "use_temperature": False},
    "module_extract_items": {"temperature": 0.1, "max_tokens": 32000, "use_temperature": False},
    "module_refresh_toc": {"temperature": 0.1, "max_tokens": 16000, "use_temperature": False},
    "module_title_generation": {"temperature": 0.3, "max_tokens": 1000, "use_temperature": False},
    "note_title_generation": {"temperature": 0.3, "max_tokens": 100, "use_temperature": False},
    # Character related (text)
    "character_description": {"temperature": 0.7, "max_tokens": 1000, "use_temperature": False},
    "character_background": {"temperature": 0.8, "max_tokens": 2000, "use_temperature": False},
    "character_appearance": {"temperature": 0.8, "max_tokens": 1600, "use_temperature": False},
    "character_translation": {"temperature": 0.3, "max_tokens": 1000, "use_temperature": False},
    "character_ai_generation": {"temperature": 0.4, "max_tokens": 1600, "use_temperature": False},
    "dm_character_generate": {"temperature": 0.5, "max_tokens": 2000, "use_temperature": False},
    "character_card_import": {"temperature": 0.1, "max_tokens": 4000, "use_temperature": False},
    # Resource/Rules related (text)
    "resource_chat": {"temperature": 0.7, "max_tokens": 3000, "use_temperature": False},
    "rules_chat": {"temperature": 0.5, "max_tokens": 3000, "use_temperature": False},
    "equipment_pack_parse": {"temperature": 0.3, "max_tokens": 2000, "use_temperature": False},
    # Custom creation (text)
    "custom_creation": {"temperature": 0.7, "max_tokens": 4000, "use_temperature": False},
    "prompt_expansion": {"temperature": 0.8, "max_tokens": 1000, "use_temperature": False},
    "npc_name_generate": {"temperature": 0.9, "max_tokens": 200, "use_temperature": False},
    "npc_quick_generate": {"temperature": 0.9, "max_tokens": 300, "use_temperature": False},
    "illusion_naming": {"temperature": 0.8, "max_tokens": 30, "use_temperature": False},
    # In-game (text)
    "websocket_chat": {"temperature": 0.7, "max_tokens": 1600, "use_temperature": False},
    "dice_analyze": {"temperature": 0.2, "max_tokens": 1000, "use_temperature": False},
    "token_move_narrative": {"temperature": 0.7, "max_tokens": 800, "use_temperature": False},
    "map_update_narrative": {"temperature": 0.7, "max_tokens": 1000, "use_temperature": False},
    "combat_attack_narrative": {"temperature": 0.7, "max_tokens": 2000, "use_temperature": False},
    "combat_spell_narrative": {"temperature": 0.7, "max_tokens": 2000, "use_temperature": False},
    "combat_extra_effect": {"temperature": 0.8, "max_tokens": 300, "use_temperature": False},
    "scene_generation": {"temperature": 0.7, "max_tokens": 8000, "use_temperature": False},
    # Image/Avatar generation (image)
    "avatar_player": {"image_size": "1024x1024"},
    "avatar_monster": {"image_size": "512x512"},
    "avatar_npc": {"image_size": "512x512"},
    "avatar_item": {"image_size": "512x512"},
    "avatar_shop": {"image_size": "512x512"},
    "avatar_chest": {"image_size": "512x512"},
    "map_generation": {"image_size": "1024x1024"},
    "map_prompt_optimize": {"temperature": 0.7, "max_tokens": 500, "use_temperature": False},
    "cover_image_generation": {"image_size": "1024x1024"},
    # Other (text)
    "avatar_appearance": {"temperature": 0.7, "max_tokens": 1000, "use_temperature": False},
    "translation_service": {"temperature": 0.1, "max_tokens": 8000, "use_temperature": False},
    "image_classification": {"temperature": 0.1, "max_tokens": 200, "use_temperature": False},
    "terrain_detection": {"temperature": 0.1, "max_tokens": 200, "use_temperature": False},
}

# Define which usage keys are for image generation (vs text generation)
IMAGE_GENERATION_KEYS = {
    "avatar_player", "avatar_monster", "avatar_npc",
    "avatar_item", "avatar_shop", "avatar_chest", "avatar_illusion",
    "map_generation", "cover_image_generation"
}

# Usage config categories for frontend display
USAGE_CONFIG_CATEGORIES = {
    "module": {
        "label": "模组相关",
        "items": [
            {"key": "module_chat_query", "label": "模组 AI 询问", "desc": [
                "模组详情页 → AI 标签页的主对话功能",
                "根据模组内容回答 DM 的问题，支持 RAG 检索增强"
            ]},
            {"key": "module_encounter_plan", "label": "规划地图遭遇", "desc": [
                "模组 AI 标签页 →「预设功能」→「规划地图遭遇」",
                "根据当前地图和章节内容，自动规划遭遇配置和怪物放置建议"
            ]},
            {"key": "module_ai_assist", "label": "编辑器 AI 助手", "desc": [
                "模组章节编辑器中输入「/」触发 AI 辅助创作",
                "根据当前章节上下文生成 NPC、地点描述、遭遇等内容"
            ]},
            {"key": "chapter_agent", "label": "章节AI Agent", "desc": [
                "模组编辑模式 → AI Chat 侧边栏",
                "带工具调用的 AI 编辑助手，可搜索模组/规则，生成编辑操作供确认"
            ]},
            {"key": "module_map_analysis", "label": "模组地图分析", "desc": [
                "1. 模组 AI 对话时勾选「分析地图」复选框，会用多模态模型分析当前战役地图来辅助回答",
                "2. AI 地图标注功能：自动识别地图中的重要位置（入口、房间、NPC位置等），生成带坐标的标记点",
                "⚠️ 需要支持视觉的多模态模型（如 GPT-4V、Gemini Pro Vision）"
            ]},
            {"key": "module_analyze_entities", "label": "实体分析提取", "desc": [
                "AI 回复后自动分析内容，提取可创建的实体",
                "识别 NPC、商店、物品、遭遇、BOSS战、地图场景等，生成「创建 XXX」按钮"
            ]},
            {"key": "module_extract_monsters", "label": "导入怪物", "desc": [
                "模组解析流程中的怪物提取步骤",
                "从模组文本中识别怪物数据块，提取属性值（AC、HP、攻击等）存入数据库"
            ]},
            {"key": "module_extract_items", "label": "导入物品", "desc": [
                "模组解析流程中的物品提取步骤",
                "从模组文本中识别魔法物品、装备、宝藏等，提取属性存入数据库"
            ]},
            {"key": "module_refresh_toc", "label": "TOC 刷新", "desc": [
                "模组详情页 →「刷新目录」按钮",
                "重新分析模组内容，更新章节目录结构"
            ]},
            {"key": "module_title_generation", "label": "模组标题生成", "desc": [
                "上传模组文件后自动生成中英文标题",
                "根据模组内容摘要生成简洁的标题"
            ]},
            {"key": "note_title_generation", "label": "笔记标题生成", "desc": [
                "收入笔记时自动生成简短标题",
                "AI 根据笔记内容生成一行标题作为笔记首行"
            ]},
        ]
    },
    "character": {
        "label": "角色相关",
        "items": [
            {"key": "character_description", "label": "角色描述创建", "desc": [
                "角色创建向导 → 第5步「角色描述」",
                "根据已选择的种族、职业、背景等生成角色的性格和故事概述"
            ]},
            {"key": "character_background", "label": "角色背景生成", "desc": [
                "角色创建向导 → 第5步「背景故事」",
                "生成详细的角色成长经历、关键事件、人际关系等"
            ]},
            {"key": "character_appearance", "label": "角色外观生成", "desc": [
                "角色创建向导 → 第5步「外观描述」",
                "生成角色的外貌特征描述，用于后续生成头像图片"
            ]},
            {"key": "character_translation", "label": "角色翻译", "desc": [
                "将角色名称、描述等在中英文之间互相翻译",
                "保持 D&D 风格的翻译质量"
            ]},
            {"key": "character_ai_generation", "label": "AI一键生成角色", "desc": [
                "角色创建向导 →「AI 一键生成」按钮",
                "根据用户输入的简单描述，自动选择种族、职业、分配属性、生成背景故事等"
            ]},
            {"key": "dm_character_generate", "label": "DM生成高等级角色", "desc": [
                "DM 在战役中为玩家快速生成高等级角色",
                "自动计算升级后的属性、选择职业特性、分配法术等"
            ]},
            {"key": "character_card_import", "label": "角色卡导入解析", "desc": [
                "角色页面 →「导入角色卡」按钮",
                "上传角色卡文件（PDF/DOCX/MD等），AI 解析并提取角色数据"
            ]},
        ]
    },
    "image_generation": {
        "label": "图像生成",
        "items": [
            {"key": "avatar_player", "label": "玩家角色头像", "desc": [
                "角色卡 →「生成头像」按钮",
                "根据角色外观描述生成立绘风格的头像图片"
            ]},
            {"key": "avatar_equip_regen", "label": "换装头像", "desc": [
                "装备面板 →「换装头像」按钮",
                "基于当前头像 + 装备信息做图生图，保持角色一致性",
                "⚠️ 需要支持图生图的模型（如 Gemini Image、qwen-image-2.0-pro）"
            ]},
            {"key": "avatar_monster", "label": "怪物头像", "desc": [
                "资源库 → 添加怪物时自动生成头像",
                "根据怪物类型和描述生成符合 D&D 风格的怪物图片"
            ]},
            {"key": "avatar_npc", "label": "NPC 头像", "desc": [
                "资源库 → 添加 NPC 时自动生成头像",
                "根据 NPC 外观描述生成人物立绘"
            ]},
            {"key": "avatar_item", "label": "物品图标", "desc": [
                "资源库 → 添加物品时自动生成图标",
                "根据物品类型和描述生成装备/道具图标"
            ]},
            {"key": "avatar_shop", "label": "商店图标", "desc": [
                "资源库 → 添加商店时自动生成图标",
                "根据商店类型（武器店、药水店等）生成店铺图片"
            ]},
            {"key": "avatar_chest", "label": "宝箱图标", "desc": [
                "资源库 → 添加宝箱时自动生成图标",
                "生成各种风格的宝箱图片"
            ]},
            {"key": "avatar_illusion", "label": "幻象图片", "desc": [
                "施放幻影类法术时生成幻象图片",
                "根据玩家描述生成半透明、魔法风格的幻象 token 图片"
            ]},
            {"key": "map_generation", "label": "战术地图生成", "desc": [
                "模组 AI 标签页 → 创建地图场景时生成战术地图",
                "根据场景描述生成适合战斗的俯视角地图图片"
            ]},
            {"key": "map_prompt_optimize", "label": "地图描述优化", "desc": [
                "地图管理 → AI生成 → 点击「AI优化」按钮",
                "将简短的地图描述扩展为详细的场景描述"
            ]},
            {"key": "cover_image_generation", "label": "战役封面图生成", "desc": [
                "创建战役对话框 →「AI 生成封面」按钮",
                "根据战役名称和模组主题生成封面图片"
            ]},
        ]
    },
    "resource": {
        "label": "资源/规则",
        "items": [
            {"key": "resource_chat", "label": "资源聊天", "desc": [
                "战役页面 → 资源库面板 → AI 标签页",
                "针对战役资源库中的怪物、物品等进行 AI 对话咨询"
            ]},
            {"key": "rules_chat", "label": "规则聊天", "desc": [
                "战役页面 → 规则面板 → AI 问答",
                "查询 D&D 5E 规则、法术效果、职业特性等"
            ]},
            {"key": "equipment_pack_parse", "label": "装备包解析", "desc": [
                "角色创建向导 → 选择装备包时自动解析内容",
                "将装备包（如探险者套装）展开为具体物品列表"
            ]},
            {"key": "custom_creation", "label": "自定义创建", "desc": [
                "资源库 → 添加怪物/NPC/物品/商店 → 输入描述创建",
                "根据用户输入的自然语言描述，AI 生成完整的实体数据"
            ]},
            {"key": "prompt_expansion", "label": "描述扩展生成", "desc": [
                "将用户输入的简短描述扩展为详细的创建提示",
                "例如「火焰巨人」→ 详细的外观、能力、背景描述"
            ]},
            {"key": "npc_name_generate", "label": "NPC名字生成", "desc": [
                "资源库 → 添加自定义NPC → 名字输入框旁的「AI生成」按钮",
                "根据NPC描述或随机生成符合D&D风格的NPC名字"
            ]},
            {"key": "npc_quick_generate", "label": "NPC快速生成", "desc": [
                "资源库 → NPC标签页 →「快速生成」按钮",
                "根据当前地图和章节上下文快速生成非战斗剧情NPC"
            ]},
            {"key": "illusion_naming", "label": "幻象命名", "desc": [
                "施放幻象法术（如无声幻影）时为幻象生成自然名称",
                "根据玩家描述生成简短的中文名称，避免暴露幻象本质"
            ]},
        ]
    },
    "game": {
        "label": "游戏中",
        "items": [
            {"key": "websocket_chat", "label": "WebSocket 聊天", "desc": [
                "战役地图页面 → 聊天面板的实时对话",
                "DM 和玩家在游戏中的即时通讯，支持 AI 辅助回复"
            ]},
            {"key": "dice_analyze", "label": "骰子检定分析", "desc": [
                "骰子检定完成后的结果分析",
                "根据检定类型、DC、结果等生成叙事性描述"
            ]},
            {"key": "token_move_narrative", "label": "Token 移动叙事", "desc": [
                "Token 在地图上移动时触发",
                "根据移动路径、地形、角色状态生成移动描述（如「小心翼翼地穿过走廊」）"
            ]},
            {"key": "map_update_narrative", "label": "地图更新叙事", "desc": [
                "DM 切换到新地图时触发",
                "根据新场景的环境、光线、氛围生成入场描述"
            ]},
            {"key": "combat_attack_narrative", "label": "战斗攻击叙事", "desc": [
                "战斗中执行攻击动作时触发",
                "根据攻击者、目标、武器、伤害等生成战斗描述"
            ]},
            {"key": "combat_spell_narrative", "label": "战斗法术叙事", "desc": [
                "战斗中施放法术时触发",
                "根据施法者、目标、法术效果等生成法术战斗描述"
            ]},
            {"key": "combat_extra_effect", "label": "暴击/大失败额外效果", "desc": [
                "攻击掷出自然 20（暴击）或自然 1（大失败）时触发",
                "生成额外的戏剧性效果描述，增加游戏趣味性"
            ]},
            {"key": "scene_generation", "label": "场景生成", "desc": [
                "根据当前地图和模组章节信息生成场景描述",
                "帮助 DM 快速获取当前场景的环境描述和叙事文本"
            ]},
            {"key": "voice_to_text", "label": "语音转文字", "desc": [
                "聊天面板 → 语音输入功能",
                "将玩家/DM 的语音消息转换为文字"
            ]},
            {"key": "text_to_speech", "label": "文字转语音 (TTS)", "desc": [
                "将 AI 回复或场景描述转换为语音播放",
                "使用 DashScope CosyVoice 克隆音色合成"
            ]},
        ]
    },
    "other": {
        "label": "其他",
        "items": [
            {"key": "avatar_appearance", "label": "头像外观描述生成", "desc": [
                "生成头像前的预处理步骤",
                "将角色信息转换为适合图像生成模型的外观描述 prompt"
            ]},
            {"key": "translation_service", "label": "翻译服务", "desc": [
                "通用的文本翻译功能",
                "用于各处需要中英文互译的场景"
            ]},
            {"key": "image_classification", "label": "图片分类", "desc": [
                "模组解析流程中的图片识别步骤",
                "判断图片类型：地图、怪物插图、物品图、场景图等",
                "⚠️ 需要支持视觉的多模态模型"
            ]},
            {"key": "terrain_detection", "label": "地图地形识别", "desc": [
                "切换地图时自动识别全局地形类型（森林、沙漠、地下城等）",
                "⚠️ 需要支持视觉的多模态模型"
            ]},
            {"key": "race_combat_effects_parse", "label": "种族战斗效果解析", "desc": [
                "解析种族特性中与战斗相关的效果",
                "如龙裔的龙息、矮人的毒素抗性等，用于战斗系统"
            ]},
        ]
    }
}


@router.get("/usage-configs")
async def get_usage_configs(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Get usage configs - model type and params for each feature (Admin only)
    For text generation: temperature, max_tokens
    For image generation: image_size

    Config format: {
        "usage_key": {
            "model": "CHAT",
            "temperature": 0.7,      # for text
            "max_tokens": 1000       # for text
        }
    } or {
        "usage_key": {
            "model": "FAST_IMAGE",
            "image_size": "512x512"  # for image
        }
    }
    """
    await require_admin(current_user["user_id"], db)
    # Get global settings
    result = await db.execute(
        select(AIAPISettings).where(AIAPISettings.user_id == "global")
    )
    settings = result.scalar_one_or_none()

    # Get current configs from DB
    current_configs = {}
    if settings and settings.usage_configs:
        current_configs = settings.usage_configs

    # Build merged configs with full structure (model + params)
    merged_configs = {}
    for key in DEFAULT_USAGE_CONFIGS:
        # Get default values
        default_model = DEFAULT_USAGE_CONFIGS[key]
        default_params = DEFAULT_USAGE_PARAMS.get(key, {"temperature": 0.7, "max_tokens": 1000, "use_temperature": False})
        is_image_gen = key in IMAGE_GENERATION_KEYS

        # Get current value (could be old string format or new dict format)
        current_value = current_configs.get(key)

        if current_value is None:
            # No custom config, use defaults
            if is_image_gen:
                merged_configs[key] = {
                    "model": default_model,
                    "image_size": default_params.get("image_size", "512x512")
                }
            else:
                merged_configs[key] = {
                    "model": default_model,
                    "temperature": default_params.get("temperature", 0.7),
                    "max_tokens": default_params.get("max_tokens", 1000),
                    "use_temperature": default_params.get("use_temperature", False)
                }
        elif isinstance(current_value, str):
            # Old format (just model type string), convert to new format
            if is_image_gen:
                merged_configs[key] = {
                    "model": current_value,
                    "image_size": default_params.get("image_size", "512x512")
                }
            else:
                merged_configs[key] = {
                    "model": current_value,
                    "temperature": default_params.get("temperature", 0.7),
                    "max_tokens": default_params.get("max_tokens", 1000),
                    "use_temperature": default_params.get("use_temperature", False)
                }
        elif isinstance(current_value, dict):
            # New format, merge with defaults
            if is_image_gen:
                merged_configs[key] = {
                    "model": current_value.get("model", default_model),
                    "image_size": current_value.get("image_size", default_params.get("image_size", "512x512"))
                }
            else:
                merged_configs[key] = {
                    "model": current_value.get("model", default_model),
                    "temperature": current_value.get("temperature", default_params.get("temperature", 0.7)),
                    "max_tokens": current_value.get("max_tokens", default_params.get("max_tokens", 1000)),
                    "use_temperature": current_value.get("use_temperature", default_params.get("use_temperature", False))
                }
        else:
            # Fallback to defaults
            if is_image_gen:
                merged_configs[key] = {
                    "model": default_model,
                    "image_size": default_params.get("image_size", "512x512")
                }
            else:
                merged_configs[key] = {
                    "model": default_model,
                    "temperature": default_params.get("temperature", 0.7),
                    "max_tokens": default_params.get("max_tokens", 1000),
                    "use_temperature": default_params.get("use_temperature", False)
                }

    # Get available model types from current settings
    available_model_types = []
    if settings:
        stmt = select(AIModelConfig).where(
            AIModelConfig.settings_id == settings.id
        )
        configs_result = await db.execute(stmt)
        model_configs = configs_result.scalars().all()
        available_model_types = [
            config.model_type.value if hasattr(config.model_type, 'value') else config.model_type
            for config in model_configs
            if config.api_url and config.api_key and config.model_name
        ]

    return {
        "configs": merged_configs,
        "categories": USAGE_CONFIG_CATEGORIES,
        "available_model_types": available_model_types,
        "all_model_types": [m.value for m in ModelType],
        "default_params": DEFAULT_USAGE_PARAMS,
        "image_generation_keys": list(IMAGE_GENERATION_KEYS)
    }


@router.put("/usage-configs")
async def update_usage_configs(
    configs: dict,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """
    Update usage configs - model type and params for each feature
    Admin only

    Expected format for text generation:
        {"model": "CHAT", "temperature": 0.7, "max_tokens": 1000, "use_temperature": true}
    Expected format for image generation:
        {"model": "FAST_IMAGE", "image_size": "512x512"}
    """
    await require_admin(current_user["user_id"], db)

    # Get or create global settings
    result = await db.execute(
        select(AIAPISettings).where(AIAPISettings.user_id == "global")
    )
    settings = result.scalar_one_or_none()

    if not settings:
        settings = AIAPISettings(user_id="global", usage_configs={})
        db.add(settings)
        await db.flush()

    # Validate configs
    valid_keys = set(DEFAULT_USAGE_CONFIGS.keys())
    valid_model_types = {m.value for m in ModelType}
    valid_image_sizes = {"256x256", "512x512", "1024x1024", "1024x768", "768x1024"}

    validated_configs = {}
    for key, value in configs.items():
        if key not in valid_keys:
            continue

        is_image_gen = key in IMAGE_GENERATION_KEYS

        if isinstance(value, dict):
            model = value.get("model")
            validated_value = {}

            # Validate model type
            if model and model in valid_model_types:
                validated_value["model"] = model

            if is_image_gen:
                # Validate image_size
                image_size = value.get("image_size")
                if image_size and image_size in valid_image_sizes:
                    validated_value["image_size"] = image_size
            else:
                # Validate use_temperature (boolean)
                use_temperature = value.get("use_temperature")
                if use_temperature is not None:
                    validated_value["use_temperature"] = bool(use_temperature)

                # Validate temperature (0.0 - 2.0)
                temperature = value.get("temperature")
                if temperature is not None:
                    try:
                        temp = float(temperature)
                        if 0.0 <= temp <= 2.0:
                            validated_value["temperature"] = temp
                    except (ValueError, TypeError):
                        pass

                # Validate max_tokens (1 - 128000)
                max_tokens = value.get("max_tokens")
                if max_tokens is not None:
                    try:
                        tokens = int(max_tokens)
                        if 1 <= tokens <= 128000:
                            validated_value["max_tokens"] = tokens
                    except (ValueError, TypeError):
                        pass

            if validated_value:
                validated_configs[key] = validated_value

        elif isinstance(value, str) and value in valid_model_types:
            # Old format (just model type), convert to new format
            validated_configs[key] = {"model": value}

    # Update usage_configs
    settings.usage_configs = validated_configs
    await db.commit()
    await db.refresh(settings)

    return {
        "success": True,
        "configs": validated_configs,
        "message": "Usage configs updated successfully"
    }


# ============= Prompt Expansion API =============

async def _get_usage_model_type(db: AsyncSession, usage_key: str) -> ModelType:
    """
    获取指定用途的模型类型配置

    Args:
        db: 数据库会话
        usage_key: 用途键名 (如 custom_creation, prompt_expansion)

    Returns:
        ModelType 枚举值
    """
    result = await db.execute(
        select(AIAPISettings).where(AIAPISettings.user_id == "global")
    )
    settings = result.scalar_one_or_none()

    # Get configured model type, fallback to default
    model_type_str = DEFAULT_USAGE_CONFIGS.get(usage_key, "FAST")
    if settings and settings.usage_configs:
        config_value = settings.usage_configs.get(usage_key)
        if config_value:
            # Handle both formats: string "FAST" or dict {"model": "FAST", ...}
            if isinstance(config_value, dict):
                model_type_str = config_value.get("model", model_type_str)
            else:
                model_type_str = config_value

    return ModelType(model_type_str)


class ExpandPromptRequest(BaseModel):
    """扩展描述请求"""
    description: str = ""  # 可以为空（随机生成时）
    entity_type: str  # monster, npc, item, shop
    random: bool = False  # True = 随机生成，False = 扩展现有描述
    categories: list[str] = []  # 物品种类提示，如 ["weapon", "magical"]


# 物品种类中文映射
ITEM_CATEGORY_LABELS = {
    "weapon": "武器",
    "armor": "护甲",
    "jewelry": "首饰（戒指、项链、护符等）",
    "adventuring": "冒险物品（工具、消耗品、杂物等）",
    "magical": "法术物品（法杖、魔杖、卷轴、奇物等）",
}


# 随机生成模板
RANDOM_GENERATE_TEMPLATES = {
    "monster": """你是D&D 5E怪物设计专家。请随机创造一个独特有趣的怪物描述。

要求：
- 创造一个有创意的怪物名称
- 体型和生物类型
- 独特的外观特征
- 战斗能力和攻击方式
- 特殊能力或魔法特性
- 挑战等级建议（CR 1/4 到 CR 10 之间）
- 简短的生态习性或背景

直接输出描述文字，不要输出JSON格式，不要加任何标题或前缀。保持200字以内。要有创意，避免常见的怪物类型。""",

    "npc": """你是D&D 5E NPC设计专家。请随机创造一个独特有趣的NPC描述。

要求：
- 创造一个有特色的名字
- 种族和年龄
- 独特的外观特征（服饰、体型、显著特征）
- 职业或身份
- 鲜明的性格特点
- 说话方式或口头禅
- 有趣的背景故事或秘密

直接输出描述文字，不要输出JSON格式，不要加任何标题或前缀。保持200字以内。要有创意，创造令人印象深刻的角色。""",

    "item": """你是D&D 5E魔法物品设计专家。请随机创造一个独特有趣的魔法物品描述。

要求：
- 创造一个有魔幻感的物品名称
- 物品类型（武器、护甲、奇物、药水等）
- 独特的外观描述（材质、颜色、装饰、铭文等）
- 稀有度（普通到传奇之间）
- 有趣的魔法效果或特殊能力
- 简短的历史背景或传说

直接输出描述文字，不要输出JSON格式，不要加任何标题或前缀。保持200字以内。要有创意，设计独特的物品效果。""",

    "shop": """你是D&D 5E世界观设计专家。请随机创造一个独特有趣的商店描述。

要求：
- 创造一个有特色的商店名称
- 店铺类型和主营商品
- 独特的外观描述（建筑风格、招牌、门面装饰）
- 店内氛围（光线、气味、陈设）
- 有个性的店主简介
- 商店的特色或卖点

直接输出描述文字，不要输出JSON格式，不要加任何标题或前缀。保持200字以内。要有创意，创造令人想去探索的商店。"""
}


EXPAND_PROMPT_TEMPLATES = {
    "monster": """你是D&D 5E怪物设计专家。用户提供了一个简短的怪物描述，请将其扩展为更详细、更有创意的描述。

用户输入：{description}

请扩展这个描述，包含以下方面（如适用）：
- 怪物名称（如果没有则创造一个有创意的名字）
- 体型和生物类型
- 外观特征（颜色、形态、特殊标记等）
- 战斗能力和攻击方式
- 特殊能力或魔法特性
- 挑战等级建议
- 生态习性或背景故事

直接输出扩展后的描述文字，不要输出JSON格式，不要加任何标题或前缀。保持200字以内。""",

    "npc": """你是D&D 5E NPC设计专家。用户提供了一个简短的NPC描述，请将其扩展为更详细、更有创意的描述。

用户输入：{description}

请扩展这个描述，包含以下方面（如适用）：
- NPC名字（如果没有则创造一个符合设定的名字）
- 种族和年龄
- 外观特征（服饰、体型、显著特征）
- 职业或身份
- 性格特点
- 说话方式或口头禅
- 背景故事或秘密
- 与玩家可能的互动方式

直接输出扩展后的描述文字，不要输出JSON格式，不要加任何标题或前缀。保持200字以内。""",

    "item": """你是D&D 5E魔法物品设计专家。用户提供了一个简短的物品描述，请将其扩展为更详细、更有创意的描述。

用户输入：{description}

请扩展这个描述，包含以下方面（如适用）：
- 物品名称（如果没有则创造一个有魔幻感的名字）
- 物品类型（武器、护甲、奇物等）
- 外观描述（材质、颜色、装饰、铭文等）
- 稀有度
- 魔法效果或特殊能力
- 历史背景或传说
- 同调要求（如有）

直接输出扩展后的描述文字，不要输出JSON格式，不要加任何标题或前缀。保持200字以内。""",

    "shop": """你是D&D 5E世界观设计专家。用户提供了一个简短的商店描述，请将其扩展为更详细、更有创意的描述。

用户输入：{description}

请扩展这个描述，包含以下方面（如适用）：
- 商店名称（如果没有则创造一个有特色的名字）
- 店铺类型和主营商品
- 外观描述（建筑风格、招牌、门面装饰）
- 店内氛围（光线、气味、陈设）
- 店主简介（如适用）
- 特色或卖点
- 大致价格定位

直接输出扩展后的描述文字，不要输出JSON格式，不要加任何标题或前缀。保持200字以内。""",

    "avatar_appearance": """你是一位视觉艺术描述专家。用户提供了一个生物/角色的简短描述，请将其扩展为适合AI图像生成的详细视觉外观描述。

用户输入：{description}

请扩展为详细的**纯视觉外观**描述，重点包括：
- 体型比例（高矮胖瘦、姿态）
- 皮肤/鳞片/毛发的颜色和纹理
- 面部特征（眼睛、嘴、表情）
- 四肢和身体结构的独特之处
- 服饰/铠甲/装饰物（如有）
- 周围的光效、气场、魔法效果（如有）

注意：
- 如果用户描述的是某个知名IP的角色（如战锤、魔戒等），请根据该IP的原设来描述其视觉外观
- 只描述外观，不要包含能力数值、战斗力、游戏机制等
- 使用英文输出，因为图像生成模型对英文效果更好
- 保持100-150词，简洁但具象

Output the visual description in English only, no titles or prefixes."""
}


@router.post("/expand-prompt")
async def expand_prompt(
    request: ExpandPromptRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    使用 AI 扩展用户的简短描述或随机生成描述。
    random=True 时随机生成，random=False 时扩展现有描述。
    """
    # 随机生成模式不需要描述，扩展模式需要
    if not request.random:
        if not request.description or len(request.description.strip()) < 2:
            raise HTTPException(status_code=400, detail="描述太短")

    if request.entity_type not in EXPAND_PROMPT_TEMPLATES:
        raise HTTPException(status_code=400, detail=f"不支持的实体类型: {request.entity_type}")

    # Get model config for prompt expansion
    try:
        model_type = await _get_usage_model_type(db, "prompt_expansion")
        config = await get_model_config(db, model_type)
    except Exception as e:
        print(f"[ExpandPrompt] Failed to get model config: {e}")
        raise HTTPException(status_code=500, detail="AI服务不可用")

    # 选择模板：随机生成 or 扩展
    if request.random:
        prompt = RANDOM_GENERATE_TEMPLATES[request.entity_type]
    else:
        prompt = EXPAND_PROMPT_TEMPLATES[request.entity_type].format(description=request.description)

    # 如果是 item 类型且选择了种类，追加种类约束
    if request.entity_type == "item" and request.categories:
        cat_labels = [ITEM_CATEGORY_LABELS.get(c, c) for c in request.categories if c in ITEM_CATEGORY_LABELS]
        if cat_labels:
            prompt += f"\n\n用户指定的物品种类：{', '.join(cat_labels)}。请围绕这些种类来设计物品。"

    endpoint = config.api_url.rstrip('/')
    if not endpoint.endswith('/chat/completions'):
        endpoint = endpoint + '/chat/completions'

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                endpoint,
                json={
                    "model": config.model_name,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 500,
                    "temperature": 0.9 if request.random else 0.7  # 随机生成用更高温度
                },
                headers={
                    "Authorization": f"Bearer {config.api_key}",
                    "Content-Type": "application/json",
                },
            )

        if resp.status_code != 200:
            print(f"[ExpandPrompt] LLM API error: {resp.status_code}")
            raise HTTPException(status_code=500, detail="AI调用失败")

        data = resp.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

        if not content:
            raise HTTPException(status_code=500, detail="AI返回空响应")

        return {"expanded_description": content.strip()}

    except HTTPException:
        raise
    except Exception as e:
        print(f"[ExpandPrompt] Error: {e}")
        raise HTTPException(status_code=500, detail=f"AI调用失败: {str(e)}")


class GenerateNPCNameRequest(BaseModel):
    """NPC名字生成请求"""
    description: str = ""  # NPC描述（可为空，随机生成）


@router.post("/generate-npc-name")
async def generate_npc_name(
    request: GenerateNPCNameRequest,
    db: AsyncSession = Depends(get_db)
):
    """使用FAST模型生成D&D风格的NPC名字"""
    try:
        model_type = await _get_usage_model_type(db, "npc_name_generate")
        config = await get_model_config(db, model_type)
    except Exception as e:
        print(f"[GenerateNPCName] Failed to get model config: {e}")
        raise HTTPException(status_code=500, detail="AI服务不可用")

    desc = request.description.strip()
    if desc:
        prompt = f"""为以下D&D NPC生成一个合适的名字。名字应该符合角色的种族、职业和背景。

NPC描述：{desc}

要求：
- 只输出一个名字（中文），不要加引号或其他文字
- 名字应有奇幻风格，2-5个字
- 如果描述中提到了种族，名字应符合该种族的命名风格"""
    else:
        prompt = """随机生成一个D&D奇幻风格的NPC名字。

要求：
- 只输出一个名字（中文），不要加引号或其他文字
- 名字应有奇幻风格，2-5个字
- 可以是任何种族风格（人类、精灵、矮人、半身人等）"""

    endpoint = config.api_url.rstrip('/')
    if not endpoint.endswith('/chat/completions'):
        endpoint = endpoint + '/chat/completions'

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                endpoint,
                json={
                    "model": config.model_name,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 50,
                    "temperature": 0.9,
                },
                headers={
                    "Authorization": f"Bearer {config.api_key}",
                    "Content-Type": "application/json",
                },
            )

        if resp.status_code != 200:
            raise HTTPException(status_code=500, detail="AI调用失败")

        data = resp.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        # 清理可能的引号、句号等
        content = content.strip('"\'「」""。，、')

        if not content:
            raise HTTPException(status_code=500, detail="AI返回空响应")

        return {"name": content}

    except HTTPException:
        raise
    except Exception as e:
        print(f"[GenerateNPCName] Error: {e}")
        raise HTTPException(status_code=500, detail=f"AI调用失败: {str(e)}")
