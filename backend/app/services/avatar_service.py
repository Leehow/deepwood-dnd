"""
Avatar Generation Service
Unified service for generating entity avatars using AI image models

Consolidates avatar generation logic from:
- monster_instances.py
- items.py
- shops.py
- characters (future)
"""
import asyncio
import base64
import httpx
import re
from typing import Optional, Literal, Dict, Any, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from fastapi import HTTPException

from app.models.ai_settings import ModelType, AIAPISettings

# Global semaphore to limit concurrent AI image generation (allow up to 3)
AVATAR_GENERATION_SEMAPHORE: asyncio.Semaphore = asyncio.Semaphore(3)

# Default model type mapping for avatar generation usage keys
DEFAULT_AVATAR_USAGE_CONFIGS = {
    "avatar_player": "MEDIUM_IMAGE",
    "avatar_monster": "FAST_IMAGE",
    "avatar_npc": "FAST_IMAGE",
    "avatar_item": "FAST_IMAGE",
    "avatar_shop": "FAST_IMAGE",
    "avatar_illusion": "FAST_IMAGE",
}

# Sensitive words that may trigger content moderation in Chinese image APIs
# Replace with neutral alternatives for D&D fantasy context
SENSITIVE_WORD_REPLACEMENTS = {
    "邪教徒": "狂信者",
    "邪教": "秘密教团",
    "Cultist": "Fanatic",
    "Cult": "Secret Order",
    "恶魔": "魔族",
    "魔鬼": "炼狱生物",
    "Demon": "Fiend",
    "Devil": "Infernal",
}


def sanitize_prompt_for_api(prompt: str) -> str:
    """Sanitize prompt by replacing sensitive words with neutral alternatives"""
    result = prompt
    for sensitive, replacement in SENSITIVE_WORD_REPLACEMENTS.items():
        result = result.replace(sensitive, replacement)
    return result


_MD_IMAGE_RE = re.compile(r'!\[.*?\]\((data:image/[^)]+)\)')


def _extract_image_data(raw: str) -> str:
    """Extract actual image data from Markdown image syntax or return as-is."""
    if not raw:
        return raw
    m = _MD_IMAGE_RE.search(raw)
    if m:
        return m.group(1)
    return raw


class AvatarService:
    """Unified avatar generation service for all entity types"""

    async def _get_model_type_for_usage(
        self,
        db: AsyncSession,
        usage_key: str,
        user_id: str = "global"
    ) -> ModelType:
        """
        Get the configured model type for a usage key

        Args:
            db: Database session
            usage_key: The usage key (e.g., "avatar_player", "avatar_monster")
            user_id: User ID (default: "global")

        Returns:
            ModelType enum value
        """
        # Get global settings
        stmt = select(AIAPISettings).where(AIAPISettings.user_id == user_id)
        result = await db.execute(stmt)
        settings = result.scalar_one_or_none()

        # Get configured model type, fallback to default
        model_type_str = DEFAULT_AVATAR_USAGE_CONFIGS.get(usage_key, "FAST_IMAGE")
        if settings and settings.usage_configs:
            config_value = settings.usage_configs.get(usage_key)
            if config_value:
                # Handle both formats: string "FAST_IMAGE" or dict {"model": "FAST_IMAGE", ...}
                if isinstance(config_value, dict):
                    model_type_str = config_value.get("model", model_type_str)
                else:
                    model_type_str = config_value

        return ModelType(model_type_str)

    async def generate_avatar(
        self,
        db: AsyncSession,
        entity_type: Literal['monster', 'item', 'shop', 'character', 'chest'],
        entity_id: int,
        name: str,
        description: str = "",
        appearance: str = "",
        category: str = "",
        subcategory: str = "",
        size: str = "",
        entity_subtype: str = "",
        alignment: str = "",
        prompt_override: Optional[str] = None,
        generate_appearance_with_ai: bool = False,
        monster_attributes: Optional[Dict[str, Any]] = None,
        usage_key: Optional[str] = None,
        is_npc: bool = False
    ) -> Tuple[str, str]:
        """
        Generate avatar image for an entity using configured model

        For DashScope (z-image-turbo): Returns temp URL immediately, processes in background
        For other APIs: Uploads to OSS with two sizes: 128x128 (small) and 512x512 (large)

        Args:
            usage_key: Optional usage key to determine model type (e.g., "avatar_player", "avatar_monster")
                       If not provided, defaults based on entity_type
            is_npc: If True and entity_type is "monster", use avatar_npc config instead of avatar_monster

        Returns:
            Tuple[str, str]: (small_url, large_url) - 小图128x128, 大图512x512

        Raises:
            HTTPException: If generation fails
        """
        print(f"[AvatarService] START {entity_type}_id={entity_id}", flush=True)

        # Determine usage_key if not provided
        if not usage_key:
            if entity_type == "character":
                usage_key = "avatar_player"
            elif entity_type == "monster":
                usage_key = "avatar_npc" if is_npc else "avatar_monster"
            elif entity_type == "item":
                usage_key = "avatar_item"
            elif entity_type == "shop":
                usage_key = "avatar_shop"
            elif entity_type == "chest":
                usage_key = "avatar_item"  # Use item avatar config for chests
            else:
                usage_key = "avatar_monster"  # Default fallback

        # Get model type from usage config
        model_type = await self._get_model_type_for_usage(db, usage_key)
        print(f"[AvatarService] Using model type {model_type.value} for usage_key={usage_key}", flush=True)

        # Get model config from DB settings
        from app.services.ai_model_service import ai_model_service
        try:
            image_config = await ai_model_service.get_model_config(db, model_type)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to load {model_type.value} model config: {e}")

        # If appearance is missing and AI generation requested, generate it (with timeout)
        if generate_appearance_with_ai and (not appearance or not appearance.strip()):
            try:
                appearance = await asyncio.wait_for(
                    self._generate_appearance_description(db, name, monster_attributes or {}),
                    timeout=30.0
                )
            except asyncio.TimeoutError:
                print(f"[AvatarService] Appearance generation timed out for {name}, continuing without", flush=True)
                appearance = ""

        # Try to acquire semaphore with timeout
        print(f"[AvatarService] Waiting for semaphore...", flush=True)
        try:
            await asyncio.wait_for(AVATAR_GENERATION_SEMAPHORE.acquire(), timeout=120.0)
        except asyncio.TimeoutError:
            raise HTTPException(status_code=503, detail="Avatar generation busy, please try again later")

        try:
            # Build prompt based on entity type
            if prompt_override:
                prompt = prompt_override
            else:
                prompt = self._build_prompt(
                    entity_type=entity_type, name=name, description=description,
                    appearance=appearance, category=category, subcategory=subcategory,
                    size=size, entity_subtype=entity_subtype, alignment=alignment
                )

            # Call AI image generation API with timeout
            print(f"[AvatarService] Calling image API...", flush=True)
            result = await asyncio.wait_for(
                self._call_image_api(image_config, prompt),
                timeout=120.0
            )
            if not result:
                raise HTTPException(status_code=502, detail="No image data returned from AI provider")

            # Check if this is a DashScope URL (fast path)
            if result.startswith("DASHSCOPE_URL:"):
                temp_url = result[14:]  # Remove prefix
                print(f"[AvatarService] Fast path: returning DashScope URL immediately", flush=True)

                # Start background task for OSS upload
                asyncio.create_task(
                    self._background_upload_to_oss(
                        temp_url, entity_type, entity_id, name
                    )
                )

                # Return temp URL for both sizes (same image, 512x512)
                return (temp_url, temp_url)

            # Standard path: base64 image, upload to OSS
            b64_image = result
            from app.domain.parsing.oss_storage import get_oss_storage
            try:
                oss = get_oss_storage()
                upload_result = await oss.upload_avatar_base64_async(b64_image, entity_type, entity_id, name)
                if upload_result:
                    small_url, large_url = upload_result
                    print(f"[AvatarService] DONE {entity_type}_id={entity_id} -> small={small_url}, large={large_url}", flush=True)
                    return (small_url, large_url)
                else:
                    raise HTTPException(status_code=500, detail="OSS upload failed")
            except ValueError as e:
                # OSS not configured, fallback to local storage
                print(f"[AvatarService] OSS not available, using local storage: {e}", flush=True)
                from app.utils.image_storage import save_base64_image_async
                prefix = self._build_filename_prefix(entity_type, entity_id, name)
                image_type = f"{entity_type}s"
                saved_url = await save_base64_image_async(b64_image, image_type=image_type, prefix=prefix, target_size=(256, 256))
                return (saved_url, saved_url)  # Same URL for both sizes

        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="Avatar generation timed out")
        except HTTPException:
            raise
        except Exception as e:
            import traceback
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"Failed to generate {entity_type} avatar: {e}")
        finally:
            AVATAR_GENERATION_SEMAPHORE.release()
            print(f"[AvatarService] Semaphore released", flush=True)

    async def _background_upload_to_oss(
        self,
        image_url: str,
        entity_type: str,
        entity_id: int,
        name: str
    ):
        """
        Background task: Download image from temp URL, convert to WebP, upload to OSS, update DB
        """
        try:
            print(f"[AvatarService] Background: starting OSS upload for {entity_type}_id={entity_id}", flush=True)

            # Download image
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.get(image_url)
                resp.raise_for_status()
                image_data = resp.content

            # Upload to OSS (will convert to WebP)
            from app.domain.parsing.oss_storage import get_oss_storage
            oss = get_oss_storage()
            result = await oss.upload_avatar_async(image_data, entity_type, entity_id, name)

            if result:
                small_url, large_url = result
                print(f"[AvatarService] Background: OSS upload done -> small={small_url[:60]}...", flush=True)

                # Update database with permanent URLs
                await self._update_entity_avatar_urls(entity_type, entity_id, small_url, large_url)
            else:
                print(f"[AvatarService] Background: OSS upload failed for {entity_type}_id={entity_id}", flush=True)

        except Exception as e:
            print(f"[AvatarService] Background: error for {entity_type}_id={entity_id}: {e}", flush=True)
            import traceback
            traceback.print_exc()

    async def _update_entity_avatar_urls(
        self,
        entity_type: str,
        entity_id: int,
        small_url: str,
        large_url: str
    ):
        """Update entity's avatar URLs in database after background upload"""
        from app.db.session import async_session_maker
        from sqlalchemy import text

        # Map entity type to table and column names
        table_map = {
            'monster': ('monster_instances', 'avatar_url', 'avatar_url_large'),
            'item': ('items', 'avatar_url', 'avatar_url_large'),
            'shop': ('shops', 'avatar_url', 'avatar_url_large'),
            'character': ('characters', 'avatar', 'avatar_large'),
        }

        if entity_type not in table_map:
            print(f"[AvatarService] Unknown entity type: {entity_type}", flush=True)
            return

        table, small_col, large_col = table_map[entity_type]

        async with async_session_maker() as db:
            await db.execute(
                text(f"UPDATE {table} SET {small_col} = :small, {large_col} = :large WHERE id = :id"),
                {"small": small_url, "large": large_url, "id": entity_id}
            )
            await db.commit()
            print(f"[AvatarService] Background: DB updated for {entity_type}_id={entity_id}", flush=True)

    def _build_prompt(
        self,
        entity_type: str,
        name: str,
        description: str,
        appearance: str,
        category: str,
        subcategory: str,
        size: str,
        entity_subtype: str,
        alignment: str
    ) -> str:
        """Build image generation prompt based on entity type and attributes"""
        parts = []

        if entity_type == "monster":
            parts.append(f"A detailed D&D fantasy monster portrait of a {name}")
            if size and entity_subtype:
                parts.append(f"{size} {entity_subtype}")
            if appearance:
                parts.append(f"Appearance: {appearance[:200]}")
            # Do NOT use description as fallback - it often contains stat blocks/numbers
            # which AI models render as text on the image. Rely on AI-generated appearance instead.
            parts.append("Epic fantasy monster art style, detailed creature portrait, professional digital art, dramatic lighting with dark atmosphere, high quality, centered composition, menacing pose, NO TEXT, NO WORDS, NO NUMBERS, NO LABELS, NO UI ELEMENTS, NO STATS, pure artwork only")

        elif entity_type == "item":
            parts.append(f"A high quality fantasy item icon for D&D: {name}")
            if category:
                parts.append(f"Category: {category}")
            if subcategory:
                parts.append(f"Subtype: {subcategory}")
            if description:
                parts.append(f"Description: {description[:180]}")
            parts.append("Detailed, polished, centered, plain background, professional game inventory icon, 3/4 view, NO TEXT, NO WORDS, NO NUMBERS, NO LABELS, pure artwork only")

        elif entity_type == "shop":
            parts.append(f"A high quality fantasy shop sign/storefront icon for D&D: {name}")
            if appearance:
                parts.append(f"Appearance: {appearance[:180]}")
            elif description:
                parts.append(f"Description: {description[:180]}")
            parts.append("Detailed, polished, centered, plain background, professional token/logo icon, 3/4 view, NO TEXT, NO WORDS, NO NUMBERS, NO LABELS, pure artwork only")

        elif entity_type == "character":
            parts.append(f"A detailed D&D character portrait of {name}")
            # Race/class visual features from description (e.g. "IMPORTANT race features: green skin, tusks...")
            if description:
                parts.append(description)
            if appearance:
                parts.append(f"Appearance: {appearance[:200]}")
            parts.append("Epic fantasy character art style, detailed portrait, professional digital art, dramatic lighting, high quality, centered composition, NO TEXT, NO WORDS, NO NUMBERS, NO LABELS, NO UI ELEMENTS, NO STATS, pure artwork only")

        elif entity_type == "chest":
            parts.append(f"A detailed D&D treasure chest icon: {name}")
            if appearance:
                parts.append(f"Appearance: {appearance[:200]}")
            elif description:
                parts.append(f"Description: {description[:200]}")
            parts.append("Fantasy treasure chest, ornate wooden chest with metal fittings, detailed, polished, centered, plain dark background, professional game icon, 3/4 view, mysterious glow, NO TEXT, NO WORDS, NO NUMBERS, NO LABELS, pure artwork only")

        return ", ".join(parts)

    def _build_filename_prefix(self, entity_type: str, entity_id: int, name: str) -> str:
        """Build filename prefix for saved image"""
        safe_name = name.strip().replace(' ', '_').lower() if name else ''
        prefix = f"{entity_type}_{entity_id}"
        if safe_name:
            prefix = f"{prefix}_{safe_name}"
        return prefix[:40]  # Limit length

    async def _call_image_api(self, image_config, prompt: str) -> Optional[str]:
        """
        Call AI image generation API and return base64 image data

        Supports four API formats:
        1. OpenAI images/generations API (response_format=b64_json)
        2. Chat completions API (for Gemini image models)
        3. aionly.com API (input.prompt format with code/data response)
        4. DashScope native API (for z-image-turbo and other Alibaba models)
        """
        api_url = (image_config.api_url or "").rstrip("/")
        model_name = image_config.model_name or ""

        headers = {
            "Authorization": f"Bearer {image_config.api_key}",
            "Content-Type": "application/json",
        }

        # Determine API format based on URL path, domain, and model name
        is_dashscope = "dashscope.aliyuncs.com" in api_url
        is_z_image_model = model_name.startswith("z-image") or model_name in ("wanx-v1", "wanx2.1-t2i-turbo")
        is_chat_format = "/chat/completions" in api_url or "/completions" in api_url
        is_aionly_format = "aiionly.com" in api_url

        # Special case: Gemini image models - try OpenAI-compat first, fallback to native
        is_gemini_image_text = (
            "gemini" in model_name and "image" in model_name
        )

        if is_gemini_image_text:
            is_chat_format = False
            is_aionly_format = False

        # DashScope native API for z-image-turbo
        if is_dashscope or is_z_image_model:
            return await self._call_dashscope_api(image_config, prompt)

        if is_gemini_image_text:
            chat_url = api_url.rstrip("/")
            if not chat_url.endswith("/chat/completions"):
                chat_url = chat_url + "/chat/completions"
            base_url = api_url.rstrip("/")
            if base_url.endswith("/v1"):
                base_url = base_url[:-3]
            gemini_native_url = f"{base_url}/v1beta/models/{model_name}:generateContent"

            text_prompt = f"Generate a fantasy style icon/avatar in 1:1 square aspect ratio: {prompt}"

            # Attempt 1: OpenAI-compatible format
            openai_payload = {
                "model": model_name,
                "messages": [{"role": "user", "content": text_prompt}],
                "response_modalities": ["Text", "Image"],
            }
            print(f"[AvatarService] Trying OpenAI-compat: POST {chat_url} model={model_name}", flush=True)

            async with httpx.AsyncClient(timeout=300.0) as client:
                resp = await client.post(chat_url, headers=headers, json=openai_payload)
                result = None

                if resp.status_code == 200:
                    data = resp.json()
                    if "choices" in data and data["choices"]:
                        msg_content = data["choices"][0].get("message", {}).get("content")
                        if isinstance(msg_content, str) and "data:image" in msg_content:
                            result = _extract_image_data(msg_content.replace("```", "").strip())
                        elif isinstance(msg_content, list):
                            for part in msg_content:
                                if isinstance(part, dict):
                                    if part.get("type") == "image_url":
                                        result = part.get("image_url", {}).get("url", "")
                                    elif "image_url" in part:
                                        result = part["image_url"].get("url", "")
                                    elif "inline_data" in part:
                                        mime = part["inline_data"].get("mime_type", "image/png")
                                        b64 = part["inline_data"].get("data", "")
                                        if b64:
                                            result = f"data:{mime};base64,{b64}"
                                    if result:
                                        break
                        elif isinstance(msg_content, str):
                            cleaned = _extract_image_data(msg_content.replace("```", "").strip())
                            if cleaned:
                                result = cleaned
                    if result:
                        print(f"[AvatarService] OpenAI-compat succeeded", flush=True)
                        return result

                # Attempt 2: Gemini native format
                print(f"[AvatarService] OpenAI-compat failed (status={resp.status_code}), trying Gemini native", flush=True)
                native_payload = {
                    "contents": [{"parts": [{"text": text_prompt}]}],
                    "generationConfig": {"responseModalities": ["Text", "Image"]}
                }
                resp = await client.post(gemini_native_url, headers=headers, json=native_payload)
                resp.raise_for_status()
                data = resp.json()
                candidates = data.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    for part in parts:
                        if "inlineData" in part:
                            mime = part["inlineData"].get("mimeType", "image/png")
                            b64 = part["inlineData"].get("data", "")
                            if b64:
                                return f"data:{mime};base64,{b64}"

        elif is_chat_format:
            # Use chat/completions format (for Gemini image models)
            # Gemini image-text models generate images natively - simpler prompt works better
            prompt_chat = f"Generate a fantasy style icon/avatar in exactly 1:1 square aspect ratio (e.g. 1024x1024): {prompt}"
            payload = {
                "stream": False,
                "model": model_name,
                "messages": [{"role": "user", "content": prompt_chat}],
                "response_modalities": ["Text", "Image"],
            }

            print(f"[AvatarService] POST {api_url} model={model_name} chat image mode", flush=True)

            async with httpx.AsyncClient(timeout=300.0) as client:  # 5 min timeout for image gen
                resp = await client.post(api_url, headers=headers, json=payload)
                resp.raise_for_status()
                data = resp.json()

                if "choices" in data and data["choices"]:
                    message = data["choices"][0].get("message", {})
                    msg_content = message.get("content")

                    # Check for images field (Gemini format)
                    if "images" in message and message["images"]:
                        image_url = message["images"][0].get("image_url", {}).get("url", "")
                        if image_url:
                            return image_url

                    # Handle multipart content (list of parts)
                    if isinstance(msg_content, list):
                        for part in msg_content:
                            if isinstance(part, dict):
                                if part.get("type") == "image_url":
                                    url = part.get("image_url", {}).get("url", "")
                                    if url:
                                        return url
                                elif "image_url" in part:
                                    url = part["image_url"].get("url", "")
                                    if url:
                                        return url
                                elif "inline_data" in part:
                                    mime = part["inline_data"].get("mime_type", "image/png")
                                    b64 = part["inline_data"].get("data", "")
                                    if b64:
                                        return f"data:{mime};base64,{b64}"

                    # Fallback to string content field
                    if isinstance(msg_content, str):
                        cleaned = _extract_image_data(msg_content.replace("```", "").strip())
                        if cleaned:
                            return cleaned

        elif is_aionly_format:
            # Use aionly.com API format (input.prompt with code/data response)
            # According to docs/aionly.md, parameters field with size is REQUIRED for successful generation
            payload = {
                "model": model_name,
                "input": {
                    "prompt": prompt
                },
                "parameters": {
                    "size": "1024x1024"
                },
                "format": "base64"  # Explicitly request base64 format
            }

            print(f"[AvatarService] POST {api_url} model={model_name} aionly.com format", flush=True)

            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(api_url, headers=headers, json=payload)
                resp.raise_for_status()
                data = resp.json()

                # aionly.com response format: {"code": 200, "data": [{"base64": "...", "url": "..."}], "usage": {...}}
                if "code" in data and data["code"] == 200:
                    if "data" in data and len(data["data"]) > 0:
                        image_data = data["data"][0]

                        # Try base64 field first
                        if "base64" in image_data:
                            b64_image = image_data["base64"]
                            # Remove data URI prefix if present
                            if b64_image.startswith("data:image"):
                                b64_image = b64_image.split(",", 1)[1] if "," in b64_image else b64_image
                            return b64_image

                        # Fallback to url field
                        elif "url" in image_data:
                            # If URL is provided, we need to download it and convert to base64
                            image_url = image_data["url"]
                            print(f"[AvatarService] Downloading image from URL: {image_url}", flush=True)

                            img_resp = await client.get(image_url)
                            img_resp.raise_for_status()

                            import base64
                            b64_image = base64.b64encode(img_resp.content).decode('utf-8')
                            return b64_image

        else:
            # Use images/generations format (OpenAI standard)
            payload = {
                "model": model_name,
                "prompt": prompt,
                "n": 1,
                "size": "256x256",
                "response_format": "b64_json",
            }

            print(f"[AvatarService] POST {api_url} model={model_name} size=256x256 response_format=b64_json", flush=True)

            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(api_url, headers=headers, json=payload)
                resp.raise_for_status()
                data = resp.json()

                if "data" in data and data["data"]:
                    return data["data"][0].get("b64_json")

        return None

    async def _call_dashscope_api(self, image_config, prompt: str) -> Optional[str]:
        """
        Call Alibaba DashScope native API for z-image-turbo and similar models
        Uses multimodal-generation endpoint with special request format

        Returns the raw image URL (not base64) for fast response
        """
        model_name = image_config.model_name or "z-image-turbo"

        # DashScope uses a fixed endpoint for image generation
        dashscope_url = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"

        headers = {
            "Authorization": f"Bearer {image_config.api_key}",
            "Content-Type": "application/json",
        }

        # Build D&D style prompt prefix based on entity type, then sanitize
        sanitized_prompt = sanitize_prompt_for_api(prompt)

        # Detect entity type from prompt keywords to use appropriate prefix
        prompt_lower = prompt.lower()
        if "character portrait" in prompt_lower:
            prefix = "D&D fantasy character avatar, front-facing portrait, dark background, square composition. Oil painting style, realistic and detailed, dark epic aesthetic, similar to official Player's Handbook character art. MUST strictly depict racial features (e.g. dragonborn MUST have a dragon head on humanoid body, half-orc MUST have green skin and tusks), do NOT draw as a regular human. Absolutely NO text, numbers, or labels in the image."
        elif "item icon" in prompt_lower:
            prefix = "D&D fantasy item icon, centered composition, clean background. Polished game inventory icon style. Absolutely NO text, numbers, or labels in the image."
        elif "shop" in prompt_lower:
            prefix = "D&D fantasy shop icon, centered composition, clean background. Polished game scene icon style. Absolutely NO text, numbers, or labels in the image."
        elif "treasure chest" in prompt_lower:
            prefix = "D&D fantasy treasure chest icon, centered composition, dark background. Polished game prop icon style. Absolutely NO text, numbers, or labels in the image."
        else:
            prefix = "D&D fantasy monster avatar, front-facing portrait, dark background, square composition. Oil painting style, realistic and detailed, dark epic aesthetic, similar to official Monster Manual illustrations. Absolutely NO text, numbers, or labels in the image."

        dnd_prompt = f"{prefix}\n\n{sanitized_prompt}"

        payload = {
            "model": model_name,
            "input": {
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"text": dnd_prompt}
                        ]
                    }
                ]
            },
            "parameters": {
                "prompt_extend": False,
                "size": "512*512"
            }
        }

        print(f"[AvatarService] POST {dashscope_url} model={model_name} DashScope native format", flush=True)

        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                resp = await client.post(dashscope_url, headers=headers, json=payload)
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 400:
                    # Content moderation or invalid request
                    error_detail = ""
                    try:
                        error_data = e.response.json()
                        error_detail = error_data.get("message", str(error_data))
                    except Exception:
                        error_detail = e.response.text[:200]
                    print(f"[AvatarService] DashScope 400 error (content moderation): {error_detail}", flush=True)
                    raise HTTPException(
                        status_code=400,
                        detail=f"图像生成被拒绝，可能包含敏感词汇。请尝试修改怪物名称后重试。"
                    )
                raise
            data = resp.json()

            # DashScope response format:
            # {"output": {"choices": [{"message": {"content": [{"image": "url"}, {"text": "..."}]}}]}}
            output = data.get("output", {})
            choices = output.get("choices", [])

            if choices:
                content = choices[0].get("message", {}).get("content", [])
                for item in content:
                    if "image" in item:
                        image_url = item["image"]
                        print(f"[AvatarService] DashScope returned image URL: {image_url[:80]}...", flush=True)
                        # Return URL directly with special prefix for fast response handling
                        return f"DASHSCOPE_URL:{image_url}"

        return None

    async def _generate_appearance_description(
        self,
        db: AsyncSession,
        name: str,
        attributes: Dict[str, Any]
    ) -> str:
        """
        Generate appearance description using FAST model
        (Used for monsters when appearance is missing)
        """
        from app.services.ai_model_service import ai_model_service
        try:
            usage_params = await ai_model_service.get_usage_params(db, "avatar_appearance")
            fast_config = usage_params.config
            temperature = usage_params.temperature
            max_tokens = usage_params.max_tokens
        except HTTPException:
            # Model not configured, skip AI generation
            return ""

        # Translate ability scores into visual traits for the prompt
        ability_scores = attributes.get("ability_scores") or {}
        visual_traits = []
        if ability_scores:
            str_score = ability_scores.get("str", 10)
            dex_score = ability_scores.get("dex", 10)
            con_score = ability_scores.get("con", 10)
            cha_score = ability_scores.get("cha", 10)
            if str_score >= 18:
                visual_traits.append("extremely muscular and powerfully built")
            elif str_score >= 14:
                visual_traits.append("strong and well-muscled")
            elif str_score <= 6:
                visual_traits.append("frail and thin-limbed")
            if dex_score >= 18:
                visual_traits.append("lithe and graceful with a sleek body")
            elif dex_score <= 6:
                visual_traits.append("clumsy-looking and stiff")
            if con_score >= 18:
                visual_traits.append("thick-skinned and hardy-looking")
            elif con_score <= 6:
                visual_traits.append("gaunt and sickly")
            if cha_score >= 18:
                visual_traits.append("strikingly beautiful or awe-inspiring")
            elif cha_score <= 6:
                visual_traits.append("hideous and repulsive in appearance")
            elif cha_score <= 8:
                visual_traits.append("ugly and unsettling to look at")

        # Build description prompt from monster attributes
        description_prompt = f"Generate a vivid physical appearance description for a D&D 5E creature.\n"
        description_prompt += f"Name: {name}\n"
        if "size" in attributes:
            description_prompt += f"Size category: {attributes['size']}\n"
        if "type" in attributes:
            description_prompt += f"Creature type: {attributes['type']}\n"
        if visual_traits:
            description_prompt += f"Physical traits based on abilities: {', '.join(visual_traits)}\n"

        description_prompt += "\nWrite a 100-150 word prose description of this creature's physical appearance, as if describing it in a fantasy novel. Focus on:\n"
        description_prompt += "- Body structure, proportions, and posture\n"
        description_prompt += "- Skin/scales/fur color and texture\n"
        description_prompt += "- Facial features and expression\n"
        description_prompt += "- Notable physical characteristics\n"
        description_prompt += "\nOUTPUT RULES: Write ONLY prose describing the creature's looks. No stats, no numbers, no labels, no game terms. The output will be used directly as an image generation prompt."

        # Call model API
        api_url = fast_config.api_url.rstrip("/")
        chat_url = f"{api_url}/chat/completions"

        headers = {
            "Authorization": f"Bearer {fast_config.api_key}",
            "Content-Type": "application/json"
        }

        payload = {
            "model": fast_config.model_name,
            "messages": [
                {
                    "role": "user",
                    "content": description_prompt
                }
            ],
            "max_tokens": max_tokens,
            "temperature": temperature
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(chat_url, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()

            if "choices" in data and len(data["choices"]) > 0:
                generated_desc = data["choices"][0].get("message", {}).get("content", "")
                if generated_desc:
                    print(f"[AvatarService] Generated appearance for {name}: {generated_desc[:100]}...")
                    return generated_desc.strip()

        return ""


# Global service instance
avatar_service = AvatarService()
