"""Map Settings API Routes"""
import json
import logging
import re
import base64
import httpx
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_db, get_db_readonly, async_session_factory
from app.models.map_settings import MapSettings
from app.schemas.map_settings import MapSettingsCreate, MapSettingsUpdate, MapSettingsResponse
from app.core.dependencies import resolve_campaign_member_context
from app.core.security import require_auth
from app.utils.permission_checks import require_campaign_dm
from app.services.ai_model_service import ai_model_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/map-settings", tags=["map-settings"])

# Valid global terrain types (D&D 5E)
VALID_TERRAINS = {
    "arctic", "coast", "desert", "forest", "grassland", "hill",
    "mountain", "swamp", "underdark", "urban", "dungeon", "underwater",
}

TERRAIN_DETECT_PROMPT = """你是一个D&D地图分析专家。请分析这张地图图片，判断它最符合以下哪种全局地形类型：

- arctic（极地/冰雪）
- coast（海岸/沿海）
- desert（沙漠/荒漠）
- forest（森林/丛林）
- grassland（草原/平原）
- hill（丘陵）
- mountain（山地/高山）
- swamp（沼泽/湿地）
- underdark（幽暗地域/地下洞穴网络）
- urban（城镇/城市）
- dungeon（地下城/建筑内部/人工建筑）
- underwater（水下）

请只返回JSON，不要其他内容：
{"terrain": "类型名称", "confidence": "high/medium/low"}"""


def _fix_collapsed_url(url: str) -> str:
    """Fix URL scheme slashes collapsed by nginx/reverse-proxy path decoding.

    When a URL like https://example.com is passed as a path parameter,
    nginx or Starlette may collapse // to /, yielding https:/example.com.
    """
    return re.sub(r'^(https?:)/(?!/)', r'\1//', url)


@router.get("/{campaign_id}/{map_url:path}", response_model=MapSettingsResponse)
async def get_map_settings(
    campaign_id: int,
    map_url: str,
    db: AsyncSession = Depends(get_db_readonly),
    current_user: dict = Depends(require_auth),
):
    """Get map settings for a specific map in a campaign"""
    await resolve_campaign_member_context(db, campaign_id, current_user)
    map_url = _fix_collapsed_url(map_url)
    result = await db.execute(
        select(MapSettings).where(
            MapSettings.campaign_id == campaign_id,
            MapSettings.map_url == map_url
        )
    )
    settings = result.scalar_one_or_none()

    if not settings:
        # Return default settings if not found
        return MapSettingsResponse(
            id=0,
            campaign_id=campaign_id,
            map_url=map_url,
            scale=1.0,
            created_at=None,
            updated_at=None
        )
    
    return settings


@router.post("", response_model=MapSettingsResponse)
async def create_or_update_map_settings(
    settings: MapSettingsCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Create or update map settings"""
    await require_campaign_dm(settings.campaign_id, current_user, db)
    # Check if settings already exist
    result = await db.execute(
        select(MapSettings).where(
            MapSettings.campaign_id == settings.campaign_id,
            MapSettings.map_url == settings.map_url
        )
    )
    existing = result.scalar_one_or_none()
    
    if existing:
        # Update existing settings
        existing.scale = settings.scale
        existing.grid_unit_length = settings.grid_unit_length
        existing.anchor_x = settings.anchor_x
        existing.anchor_y = settings.anchor_y
        await db.commit()
        await db.refresh(existing)
        return existing
    else:
        # Create new settings
        new_settings = MapSettings(**settings.dict())
        db.add(new_settings)
        await db.commit()
        await db.refresh(new_settings)
        return new_settings


class TerrainDetectRequest(BaseModel):
    map_url: str


class TerrainDetectResponse(BaseModel):
    terrain: str | None
    confidence: str = "low"


async def _detect_terrain_background(campaign_id: int, map_url: str):
    """Background task to detect terrain from map image using AI vision."""
    async with async_session_factory() as db:
        try:
            vision_config = await ai_model_service.get_config_for_usage(db, "terrain_detection")

            # Download the map image
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(map_url)
                resp.raise_for_status()
                image_b64 = base64.b64encode(resp.content).decode()

            # Determine image MIME type
            content_type = resp.headers.get("content-type", "image/png")
            if "jpeg" in content_type or "jpg" in content_type:
                mime = "image/jpeg"
            elif "webp" in content_type:
                mime = "image/webp"
            else:
                mime = "image/png"

            image_url = f"data:{mime};base64,{image_b64}"

            # Call vision API
            headers = {
                "Authorization": f"Bearer {vision_config.api_key}",
                "Content-Type": "application/json",
            }
            payload = {
                "model": vision_config.model_name,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": TERRAIN_DETECT_PROMPT},
                        {"type": "image_url", "image_url": {"url": image_url}},
                    ],
                }],
                "temperature": 0.1,
                "max_tokens": 200,
            }

            async with httpx.AsyncClient(timeout=60) as client:
                ai_resp = await client.post(
                    f"{vision_config.api_url}/chat/completions",
                    headers=headers,
                    json=payload,
                )
                ai_resp.raise_for_status()
                result_text = ai_resp.json()["choices"][0]["message"]["content"]

            # Parse JSON from response
            result_text = result_text.strip()
            if result_text.startswith("```"):
                result_text = result_text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

            parsed = json.loads(result_text)
            terrain = parsed.get("terrain", "").lower()

            if terrain not in VALID_TERRAINS:
                logger.warning(f"AI returned invalid terrain '{terrain}' for map {map_url[:60]}")
                return

            # Save to DB
            result = await db.execute(
                select(MapSettings).where(
                    MapSettings.campaign_id == campaign_id,
                    MapSettings.map_url == map_url,
                )
            )
            settings = result.scalar_one_or_none()
            if settings:
                if not settings.global_terrain:
                    settings.global_terrain = terrain
            else:
                settings = MapSettings(
                    campaign_id=campaign_id,
                    map_url=map_url,
                    global_terrain=terrain,
                )
                db.add(settings)
            await db.commit()
            logger.info(f"Terrain detected: {terrain} for campaign={campaign_id}")

        except Exception as e:
            logger.error(f"Terrain detection failed: {e}")


@router.post("/{campaign_id}/detect-terrain", response_model=TerrainDetectResponse)
async def detect_terrain(
    campaign_id: int,
    req: TerrainDetectRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Trigger async terrain detection for a map image. Returns immediately."""
    await require_campaign_dm(campaign_id, current_user, db)

    # Check if terrain already exists
    result = await db.execute(
        select(MapSettings).where(
            MapSettings.campaign_id == campaign_id,
            MapSettings.map_url == req.map_url,
        )
    )
    settings = result.scalar_one_or_none()
    if settings and settings.global_terrain:
        return TerrainDetectResponse(terrain=settings.global_terrain, confidence="high")

    # Schedule background detection
    background_tasks.add_task(_detect_terrain_background, campaign_id, req.map_url)
    return TerrainDetectResponse(terrain=None, confidence="low")


@router.post("/{campaign_id}/{map_url:path}", response_model=MapSettingsResponse)
async def update_map_scale(
    campaign_id: int,
    map_url: str,
    update: MapSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_auth),
):
    """Update map scale"""
    await require_campaign_dm(campaign_id, current_user, db)
    map_url = _fix_collapsed_url(map_url)
    result = await db.execute(
        select(MapSettings).where(
            MapSettings.campaign_id == campaign_id,
            MapSettings.map_url == map_url
        )
    )
    settings = result.scalar_one_or_none()
    
    if not settings:
        # Create new settings if not found
        settings = MapSettings(
            campaign_id=campaign_id,
            map_url=map_url,
            scale=update.scale or 1.0,
            grid_unit_length=update.grid_unit_length or 5.0,
            anchor_x=update.anchor_x,
            anchor_y=update.anchor_y,
            global_terrain=update.global_terrain,
        )
        db.add(settings)
    else:
        # Update existing settings
        if update.scale is not None:
            settings.scale = update.scale
        if update.grid_unit_length is not None:
            settings.grid_unit_length = update.grid_unit_length
        # anchor_x/y: allow setting to None (clearing)
        if "anchor_x" in update.model_fields_set:
            settings.anchor_x = update.anchor_x
        if "anchor_y" in update.model_fields_set:
            settings.anchor_y = update.anchor_y
        if "global_terrain" in update.model_fields_set:
            settings.global_terrain = update.global_terrain

    await db.commit()
    await db.refresh(settings)
    return settings

