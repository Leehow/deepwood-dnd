"""
Map Generation Service
Generates tactical D&D battle maps using AI image models
"""
import asyncio
import base64
import re
import uuid
import httpx
from typing import Optional, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from fastapi import HTTPException

from app.models.ai_settings import AIAPISettings, AIModelConfig, ModelType


# Global semaphore to prevent concurrent map generation
MAP_GENERATION_SEMAPHORE: asyncio.Semaphore = asyncio.Semaphore(1)

# Environment type descriptions for prompt building
# Based on D&D 5E DMG Chapter 5 - Adventure Environments
ENV_DESCRIPTIONS = {
    # Basic environments
    "forest": "dense trees, undergrowth, natural forest paths, fallen logs, clearings",
    "dungeon": "stone walls, flickering torches, dark corridors, ancient doors, rubble and debris",
    "town": "cobblestone streets, timber buildings, market stalls, wells, town square",
    "cave": "rocky walls, stalactites and stalagmites, underground pools, narrow passages",
    "castle": "grand stone floors, massive pillars, tapestries, arrow slits, ornate halls",
    "battlefield": "trenches, defensive barriers, scattered debris, fortifications, open ground",
    "tavern": "wooden floors, bar counter, tables and chairs, fireplace, barrels and kegs",
    "temple": "sacred altars, religious symbols, stone columns, ceremonial spaces, offering bowls",
    "ruins": "crumbling walls, overgrown vegetation, broken pillars, ancient debris, weathered stone",
    # Wilderness environments (from wilderness.json)
    "swamp": "murky water, twisted trees, moss-covered logs, fog, treacherous footing",
    "desert": "sand dunes, rocky outcrops, oasis, ancient weathered stones, heat shimmer",
    "mountain": "rocky terrain, cliff faces, narrow paths, snow-capped peaks, alpine meadows",
    "jungle": "dense canopy, vines, exotic plants, humid atmosphere, ancient overgrown ruins",
    "arctic": "ice sheets, snowdrifts, frozen lakes, glacial formations, aurora borealis",
    "coast": "sandy beaches, tide pools, rocky cliffs, sea caves, shipwrecks",
    "grassland": "rolling hills, tall grass, scattered trees, ancient standing stones",
    # Dungeon purpose types (from dungeons.json)
    "lair": "monster dwelling, food storage, nest materials, territorial markings",
    "mine": "mine shafts, cart tracks, support beams, ore veins, abandoned equipment",
    "tomb": "sarcophagi, burial chambers, grave goods, undead guardians, funerary art",
    "maze": "dead ends, similar corridors, confusing turns, no clear exit",
    "stronghold": "defensive fortifications, military layout, barracks, armory, throne room",
    "vault": "heavy doors, magical wards, treasure chests, complex traps, guardian constructs",
    # Settlement types (from settlements.json)
    "village": "small cottages, farmland, village green, simple inn, local shrine",
    "city": "grand buildings, busy streets, merchant quarters, city walls, guild halls",
    "port": "docks, warehouses, ships, sailor taverns, fish markets, lighthouse",
    "outpost": "watchtower, palisade walls, guard posts, supply depot, signal fire",
}

# Lighting descriptions
LIGHTING_DESCRIPTIONS = {
    "bright": "well-lit, clear visibility, natural daylight or bright torchlight",
    "dim": "partially lit, shadows in corners, atmospheric torch or candlelight",
    "dark": "minimal lighting, deep shadows, only faint light sources",
    "magical": "ethereal glow, bioluminescent fungi, magical crystals, floating lights",
    "firelight": "warm flickering flames, dancing shadows, campfire or brazier light",
}

# Dungeon creator styles (from dungeons.json dungeon_creator)
CREATOR_STYLES = {
    "dwarf": "精美的石雕, sturdy construction, grand halls, geometric patterns",
    "elf": "elegant curves, nature-integrated design, magical illumination, organic shapes",
    "human": "practical design, varied styles, functional layout",
    "giant": "massive doorways, tall stairs, grand proportions, oversized furniture",
    "mindflayer": "organic curves, slime-covered surfaces, alien architecture",
    "undead": "bone decorations, dark magic symbols, crypts, eternal flames",
    "cult": "ritual chambers, religious symbols, altars, hidden passages",
    "natural": "irregular shapes, natural tunnels, stalactites, underground streams",
}

# Weather effects for outdoor maps (from wilderness.json)
WEATHER_EFFECTS = {
    "clear": "bright sunshine, clear skies, long shadows",
    "rain": "wet surfaces, puddles, grey skies, dripping water",
    "storm": "lightning, dark clouds, wind-blown debris, flooding",
    "snow": "snow-covered ground, icicles, frost patterns, white landscape",
    "fog": "low visibility, mysterious atmosphere, silhouettes in mist",
}


class MapGenerationService:
    """Tactical D&D battle map generation service"""

    def _build_prompt(self, map_data: dict) -> str:
        """Build prompt for map generation with rich DMG-based descriptions"""
        name = map_data.get("name", "Unknown Location")
        name_en = map_data.get("name_en", "")
        description = map_data.get("description", "A mysterious location")
        environment = map_data.get("environment", "dungeon")
        lighting = map_data.get("lighting", "dim")
        features = map_data.get("features", [])

        # New optional fields from creator knowledge base
        creator = map_data.get("creator")  # dwarf, elf, human, etc.
        weather = map_data.get("weather")  # clear, rain, storm, snow, fog
        purpose = map_data.get("purpose")  # lair, mine, tomb, etc.

        env_desc = ENV_DESCRIPTIONS.get(environment, ENV_DESCRIPTIONS["dungeon"])
        light_desc = LIGHTING_DESCRIPTIONS.get(lighting, LIGHTING_DESCRIPTIONS["dim"])

        # Build additional style hints
        style_hints = []
        if creator and creator in CREATOR_STYLES:
            style_hints.append(f"Architecture style: {CREATOR_STYLES[creator]}")
        if weather and weather in WEATHER_EFFECTS:
            style_hints.append(f"Weather atmosphere: {WEATHER_EFFECTS[weather]}")
        if purpose and purpose in ENV_DESCRIPTIONS:
            style_hints.append(f"Location purpose: {ENV_DESCRIPTIONS[purpose]}")

        features_text = ""
        if features:
            features_text = "\n".join(f"- {f}" for f in features[:5])

        scene_name = f"{name} ({name_en})" if name_en else name

        prompt = f"""Create a ZOOMED OUT aerial view D&D tactical battle map showing an ENTIRE DISTRICT of: {scene_name}

Scene description: {description}

CRITICAL SCALE requirements - THIS IS VERY IMPORTANT:
- Bird's eye / satellite view from HIGH ALTITUDE showing a LARGE AREA
- Show an ENTIRE NEIGHBORHOOD or DISTRICT, NOT just a single intersection or small area
- The map should cover at least 200x200 feet (60x60 meters) of terrain
- Include AT LEAST 6-10 different buildings or major structures visible
- Show MULTIPLE streets, paths, or corridors connecting different areas
- Think "city district map" or "village overview" - NOT a single room or crossroad

Visual style requirements:
- Top-down/overhead perspective looking straight down
- DO NOT draw any grid lines, squares, or tile overlays - completely gridless
- Include a SCALE BAR in one corner showing distance (e.g., "10 ft" or "20 ft" per segment)
- Fantasy RPG cartography style with rich details
- Warm parchment and earth-tone color palette
- Clear terrain features and obstacles
- No characters, creatures or tokens
- High contrast for token visibility
- {env_desc}
- {light_desc}

Environment: {environment}
"""

        if style_hints:
            prompt += f"""
Style details:
{chr(10).join(f"- {hint}" for hint in style_hints)}
"""

        if features_text:
            prompt += f"""
Key features to include:
{features_text}
"""

        prompt += """
Output: Professional WIDE-AREA D&D battle map showing a full neighborhood/district. Gridless. 1024x1024 resolution. Must show multiple buildings and streets from high above."""

        return prompt

    async def _get_image_config(self, db: AsyncSession):
        """Get image model config for map generation"""
        # Try to get config for map_generation usage first
        result = await db.execute(
            select(AIAPISettings).where(AIAPISettings.user_id == "global")
        )
        settings = result.scalar_one_or_none()

        if settings and settings.usage_configs:
            config_value = settings.usage_configs.get("map_generation")
            if config_value:
                # Handle both formats: string "ADVANCED_IMAGE" or dict {"model": "ADVANCED_IMAGE", ...}
                if isinstance(config_value, dict):
                    model_type_str = config_value.get("model", "ADVANCED_IMAGE")
                else:
                    model_type_str = config_value
            else:
                model_type_str = "ADVANCED_IMAGE"
        else:
            model_type_str = "ADVANCED_IMAGE"

        model_type = ModelType(model_type_str)

        # Get the model config
        if not settings:
            raise HTTPException(status_code=500, detail="AI settings not configured")

        config_result = await db.execute(
            select(AIModelConfig).where(
                (AIModelConfig.settings_id == settings.id) &
                (AIModelConfig.model_type == model_type)
            )
        )
        config = config_result.scalar_one_or_none()

        if not config or not config.api_url or not config.api_key:
            raise HTTPException(status_code=500, detail=f"{model_type.value} model not configured")

        return config

    async def _call_image_api(self, config, prompt: str, size: str = "1024x1024") -> Optional[bytes]:
        """
        Call AI image generation API and return image bytes

        Supports multiple API formats:
        - aiionly.com: Chat completions format with markdown image response
        - DashScope: Native async API
        - OpenAI: images/generations endpoint
        """
        api_url = (config.api_url or "").rstrip("/")
        model_name = config.model_name or ""

        headers = {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
        }

        # Detect API format
        is_dashscope = "dashscope.aliyuncs.com" in api_url
        is_z_image_model = model_name.startswith("z-image") or model_name in ("wanx-v1", "wanx2.1-t2i-turbo")
        is_aionly_format = "aiionly.com" in api_url

        # DashScope API
        if is_dashscope or is_z_image_model:
            return await self._call_dashscope_api(config, prompt, size)

        # aiionly.com API - uses chat completions format
        if is_aionly_format:
            endpoint = api_url + "/chat/completions"
            payload = {
                "model": model_name,
                "messages": [{"role": "user", "content": prompt}]
            }

            print(f"[MapGen] POST {endpoint} model={model_name} chat format", flush=True)

            async with httpx.AsyncClient(timeout=180.0) as client:
                resp = await client.post(endpoint, headers=headers, json=payload)
                resp.raise_for_status()
                data = resp.json()

                # Parse chat response with markdown image format
                if "choices" in data and data["choices"]:
                    content = data["choices"][0].get("message", {}).get("content", "")

                    # Parse markdown: ![image](data:image/png;base64,...)
                    match = re.search(r'data:image/[^;]+;base64,([A-Za-z0-9+/=]+)', content)
                    if match:
                        b64_data = match.group(1)
                        print(f"[MapGen] Extracted base64 from markdown response", flush=True)
                        return base64.b64decode(b64_data)

                    # Plain base64 string
                    if len(content) > 1000:
                        try:
                            return base64.b64decode(content)
                        except Exception:
                            pass

                    # URL response
                    if content.startswith("http"):
                        img_resp = await client.get(content)
                        img_resp.raise_for_status()
                        return img_resp.content

        # Standard OpenAI images/generations format (fallback)
        endpoint = api_url + "/images/generations"
        payload = {
            "model": model_name,
            "prompt": prompt,
            "n": 1,
            "size": size,
            "response_format": "b64_json"
        }

        print(f"[MapGen] POST {endpoint} model={model_name} OpenAI format", flush=True)

        async with httpx.AsyncClient(timeout=180.0) as client:
            resp = await client.post(endpoint, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()

            if "data" in data and data["data"]:
                b64 = data["data"][0].get("b64_json")
                if b64:
                    return base64.b64decode(b64)

        return None

    async def _call_dashscope_api(self, config, prompt: str, size: str = "1024*1024") -> Optional[bytes]:
        """Call DashScope API for image generation"""
        model_name = config.model_name or "wanx2.1-t2i-turbo"
        dashscope_size = size.replace("x", "*")

        headers = {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable"  # Use async mode for stability
        }

        payload = {
            "model": model_name,
            "input": {"prompt": prompt},
            "parameters": {"size": dashscope_size, "n": 1}
        }

        api_url = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis"

        print(f"[MapGen] POST DashScope model={model_name}", flush=True)

        async with httpx.AsyncClient(timeout=180.0) as client:
            resp = await client.post(api_url, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()

            # Async mode: poll for result
            if "output" in data and "task_id" in data["output"]:
                task_id = data["output"]["task_id"]
                return await self._poll_dashscope_task(config.api_key, task_id, client)

            # Sync mode: direct result
            if "output" in data and "results" in data["output"]:
                results = data["output"]["results"]
                if results and "url" in results[0]:
                    url = results[0]["url"]
                    img_resp = await client.get(url)
                    img_resp.raise_for_status()
                    return img_resp.content

        return None

    async def _poll_dashscope_task(self, api_key: str, task_id: str, client: httpx.AsyncClient) -> Optional[bytes]:
        """Poll DashScope async task until completion"""
        poll_url = f"https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}"
        headers = {"Authorization": f"Bearer {api_key}"}

        for _ in range(60):  # Max 60 polls (3 minutes)
            await asyncio.sleep(3)

            resp = await client.get(poll_url, headers=headers)
            resp.raise_for_status()
            data = resp.json()

            status = data.get("output", {}).get("task_status")
            if status == "SUCCEEDED":
                results = data.get("output", {}).get("results", [])
                if results and "url" in results[0]:
                    url = results[0]["url"]
                    img_resp = await client.get(url)
                    img_resp.raise_for_status()
                    return img_resp.content
                break
            elif status in ("FAILED", "CANCELED"):
                print(f"[MapGen] DashScope task {status}: {data}", flush=True)
                break

        return None

    async def generate_map(
        self,
        db: AsyncSession,
        campaign_id: int,
        module_id: str,
        map_data: dict,
        reference_map_url: Optional[str] = None,
        user_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Generate a tactical battle map

        Args:
            db: Database session
            campaign_id: Campaign ID to add map to
            module_id: Module ID
            map_data: Map entity data with name, description, environment, etc.
            reference_map_url: Optional reference map URL (for future style reference)
            user_id: User ID to save to map library

        Returns:
            {"map_id": str, "map_url": str, "map_name": str, "success": bool}
        """
        # Get image model config
        config = await self._get_image_config(db)

        # Build prompt
        prompt = self._build_prompt(map_data)
        print(f"[MapGen] Generating map: {map_data.get('name', 'Unknown')}", flush=True)

        # Acquire semaphore
        try:
            await asyncio.wait_for(MAP_GENERATION_SEMAPHORE.acquire(), timeout=30.0)
        except asyncio.TimeoutError:
            raise HTTPException(status_code=503, detail="Map generation service busy, please try again")

        try:
            # Call image API
            image_bytes = await asyncio.wait_for(
                self._call_image_api(config, prompt, "1024x1024"),
                timeout=180.0
            )

            if not image_bytes:
                raise HTTPException(status_code=502, detail="Image generation returned no data")

            # Upload to OSS
            map_id = str(uuid.uuid4())[:8]
            map_name = map_data.get("name", "未命名地图")

            from app.domain.parsing.oss_storage import get_oss_storage
            oss = get_oss_storage()
            map_url = await oss.upload_map_image_async(image_bytes, campaign_id, map_id, map_name)

            # Add to campaign's module maps
            await self._add_to_campaign_maps(
                db, campaign_id, module_id,
                map_id=map_id,
                map_name=map_name,
                map_url=map_url,
                map_data=map_data
            )

            # Save to user's map library
            if user_id:
                await self._add_to_user_map_library(
                    db, user_id,
                    map_name=map_name,
                    map_url=map_url,
                    map_data=map_data,
                    module_id=module_id,
                    campaign_id=campaign_id
                )

            print(f"[MapGen] SUCCESS: {map_name} -> {map_url}", flush=True)

            return {
                "map_id": map_id,
                "map_url": map_url,
                "map_name": map_name,
                "success": True
            }

        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="Map generation timed out")
        except HTTPException:
            raise
        except Exception as e:
            import traceback
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"Map generation failed: {e}")
        finally:
            MAP_GENERATION_SEMAPHORE.release()

    async def _add_to_campaign_maps(
        self,
        db: AsyncSession,
        campaign_id: int,
        module_id: str,
        map_id: str,
        map_name: str,
        map_url: str,
        map_data: dict
    ):
        """Add generated map to campaign's module maps"""
        from app.models.module_maps import ModuleMaps

        result = await db.execute(
            select(ModuleMaps).where(
                (ModuleMaps.campaign_id == campaign_id) &
                (ModuleMaps.module_id == module_id)
            )
        )
        record = result.scalar_one_or_none()

        new_map = {
            "id": f"gen_{map_id}",
            "name": map_name,
            "url": map_url,
            "chapter": "AI 生成",
            "metadata": {
                "generated": True,
                "environment": map_data.get("environment"),
                "source_description": map_data.get("description", "")[:200]
            }
        }

        if record:
            maps_list = list(record.maps) if record.maps else []
            maps_list.append(new_map)
            record.maps = maps_list
        else:
            record = ModuleMaps(
                campaign_id=campaign_id,
                module_id=module_id,
                maps=[new_map]
            )
            db.add(record)

        await db.commit()

    async def _add_to_user_map_library(
        self,
        db: AsyncSession,
        user_id: str,
        map_name: str,
        map_url: str,
        map_data: dict,
        module_id: str,
        campaign_id: int
    ):
        """Add generated map to user's map library"""
        from app.models.user_map import UserMap

        user_map = UserMap(
            user_id=user_id,
            name=map_name,
            url=map_url,
            source_type="ai_generated",
            source_module_id=module_id,
            source_campaign_id=campaign_id,
            environment=map_data.get("environment"),
            description=map_data.get("description", "")[:500],
            extra_data={
                "name_en": map_data.get("name_en"),
                "lighting": map_data.get("lighting"),
                "features": map_data.get("features", [])
            }
        )
        db.add(user_map)
        await db.commit()
        print(f"[MapGen] Saved to user {user_id}'s map library", flush=True)


# Global instance
map_generation_service = MapGenerationService()
