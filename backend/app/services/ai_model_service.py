"""
AI Model Service Layer
Handles all AI model configuration and settings management
"""

from dataclasses import dataclass
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload
from typing import Optional, List, Dict, Any
from fastapi import HTTPException, status

from app.models.ai_settings import AIAPISettings, AIModelConfig, ModelType
from app.schemas.ai_settings import AIModelConfigCreate, ModelInfo


# Complete default usage configs - must match ai_settings.py DEFAULT_USAGE_CONFIGS
DEFAULT_USAGE_CONFIGS = {
    # Module related
    "module_chat_query": "CHAT",
    "module_map_analysis": "ADVANCED",  # 多模态模型，用于分析模组地图
    "module_analyze_entities": "FAST",
    "module_extract_monsters": "FAST",  # Changed from ADVANCED due to API instability
    "module_extract_items": "FAST",  # Changed from ADVANCED due to API instability
    "module_refresh_toc": "ADVANCED",
    "module_title_generation": "FAST",
    # Character related
    "character_description": "FAST",
    "character_background": "CHAT",
    "character_appearance": "CHAT",
    "character_translation": "CHAT",
    # Resource/Rules related
    "resource_chat": "CHAT",
    "rules_chat": "CHAT",
    "equipment_pack_parse": "FAST",
    # Custom creation
    "custom_creation": "FAST",
    "prompt_expansion": "FAST",
    # In-game
    "websocket_chat": "CHAT",
    "dice_analyze": "CHAT",
    "token_move_narrative": "CHAT",
    "map_update_narrative": "CHAT",
    "transformation_narrative": "FAST",  # 野性形态变形描述
    "combat_attack_narrative": "FAST",
    "combat_spell_narrative": "FAST",
    "combat_extra_effect": "FAST",
    "race_combat_effects_parse": "FAST",
    "scene_generation": "ADVANCED",  # 多模态模型，用于分析地图图片
    # Image/Avatar generation
    "avatar_player": "MEDIUM_IMAGE",
    "avatar_monster": "FAST_IMAGE",
    "avatar_npc": "FAST_IMAGE",
    "avatar_item": "FAST_IMAGE",
    "avatar_shop": "FAST_IMAGE",
    "map_generation": "ADVANCED_IMAGE",
    # Other
    "avatar_appearance": "FAST",
    "translation_service": "TRANSLATION",
    "image_classification": "VISION",
    "chapter_agent": "CHAT",
}

# Default parameters (temperature, max_tokens) for each usage point
# For text generation: temperature, max_tokens
# For image generation: image_size
DEFAULT_USAGE_PARAMS = {
    # Module related (text)
    "module_chat_query": {"temperature": 0.6, "max_tokens": 2000},
    "module_map_analysis": {"temperature": 0.3, "max_tokens": 4000},  # 地图分析需要较低温度和足够tokens输出位置JSON
    "module_analyze_entities": {"temperature": 0.1, "max_tokens": 200000},
    "module_extract_monsters": {"temperature": 0.1, "max_tokens": 16000},
    "module_extract_items": {"temperature": 0.1, "max_tokens": 16000},
    "module_refresh_toc": {"temperature": 0.1, "max_tokens": 8000},
    "module_title_generation": {"temperature": 0.3, "max_tokens": 100},
    # Character related (text)
    "character_description": {"temperature": 0.7, "max_tokens": 500},
    "character_background": {"temperature": 0.8, "max_tokens": 1000},
    "character_appearance": {"temperature": 0.8, "max_tokens": 800},
    "character_translation": {"temperature": 0.3, "max_tokens": 500},
    # Resource/Rules related (text)
    "resource_chat": {"temperature": 0.7, "max_tokens": 1500},
    "rules_chat": {"temperature": 0.5, "max_tokens": 1500},
    "equipment_pack_parse": {"temperature": 0.3, "max_tokens": 1000},
    # Custom creation (text)
    "custom_creation": {"temperature": 0.7, "max_tokens": 2000},
    "prompt_expansion": {"temperature": 0.8, "max_tokens": 500},
    # In-game (text)
    "websocket_chat": {"temperature": 0.7, "max_tokens": 800},
    "dice_analyze": {"temperature": 0.2, "max_tokens": 300},
    "token_move_narrative": {"temperature": 0.7, "max_tokens": 200},
    "map_update_narrative": {"temperature": 0.7, "max_tokens": 300},
    "transformation_narrative": {"temperature": 0.9, "max_tokens": 300},  # 野性形态变形描述
    "combat_attack_narrative": {"temperature": 0.7, "max_tokens": 2000},
    "combat_spell_narrative": {"temperature": 0.7, "max_tokens": 2000},
    "combat_extra_effect": {"temperature": 0.3, "max_tokens": 500},
    "race_combat_effects_parse": {"temperature": 0.1, "max_tokens": 500},
    "scene_generation": {"temperature": 0.7, "max_tokens": 8000},
    # Image/Avatar generation (image)
    "avatar_player": {"image_size": "1024x1024"},
    "avatar_monster": {"image_size": "512x512"},
    "avatar_npc": {"image_size": "512x512"},
    "avatar_item": {"image_size": "512x512"},
    "avatar_shop": {"image_size": "512x512"},
    "map_generation": {"image_size": "1024x1024"},
    # Other (text)
    "avatar_appearance": {"temperature": 0.7, "max_tokens": 300},
    "translation_service": {"temperature": 0.1, "max_tokens": 4000},
    "image_classification": {"temperature": 0.1, "max_tokens": 100},
    "chapter_agent": {"temperature": 0.7, "max_tokens": 4000},
}

# Define which usage keys are for image generation
IMAGE_GENERATION_KEYS = {
    "avatar_player", "avatar_monster", "avatar_npc",
    "avatar_item", "avatar_shop", "map_generation"
}


@dataclass
class UsageParams:
    """Complete configuration for a usage point including model and parameters"""
    config: AIModelConfig  # Model configuration (api_url, api_key, model_name)
    temperature: Optional[float]  # None for CHAT model type
    max_tokens: int
    model_type: str  # The model type string (e.g., "CHAT", "FAST")


class AIModelService:
    """Service class for AI model configuration management"""

    @staticmethod
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

    @staticmethod
    async def get_config_for_usage(
        db: AsyncSession,
        usage_key: str,
        user_id: str = "global"
    ) -> AIModelConfig:
        """
        Get model config based on usage key from usage_configs

        Args:
            db: Database session
            usage_key: The usage key (e.g., "websocket_chat", "dice_analyze")
            user_id: User ID (default: "global")

        Returns:
            AIModelConfig for the configured model type
        """
        # Get settings to check usage_configs
        settings = await AIModelService.get_all_settings(db, user_id)

        # Get configured model type, fallback to default
        model_type_str = DEFAULT_USAGE_CONFIGS.get(usage_key, "CHAT")
        if settings and settings.usage_configs:
            config_value = settings.usage_configs.get(usage_key)
            if config_value:
                # Handle both old format (string) and new format (dict)
                if isinstance(config_value, str):
                    model_type_str = config_value
                elif isinstance(config_value, dict):
                    model_type_str = config_value.get("model", model_type_str)

        model_type = ModelType(model_type_str)
        return await AIModelService.get_model_config(db, model_type, user_id)

    @staticmethod
    async def get_usage_params(
        db: AsyncSession,
        usage_key: str,
        user_id: str = "global"
    ) -> UsageParams:
        """
        Get complete usage parameters including model config and LLM parameters

        Args:
            db: Database session
            usage_key: The usage key (e.g., "websocket_chat", "dice_analyze")
            user_id: User ID (default: "global")

        Returns:
            UsageParams containing config, temperature, and max_tokens
        """
        # Get settings to check usage_configs
        settings = await AIModelService.get_all_settings(db, user_id)

        # Get defaults
        default_model = DEFAULT_USAGE_CONFIGS.get(usage_key, "CHAT")
        default_params = DEFAULT_USAGE_PARAMS.get(usage_key, {"temperature": 0.7, "max_tokens": 1000})

        # Initialize with defaults
        model_type_str = default_model
        temperature = default_params["temperature"]
        max_tokens = default_params["max_tokens"]

        # Override with user settings if available
        if settings and settings.usage_configs:
            config_value = settings.usage_configs.get(usage_key)
            if config_value:
                if isinstance(config_value, str):
                    # Old format: just model type
                    model_type_str = config_value
                elif isinstance(config_value, dict):
                    # New format: model + temperature + max_tokens
                    model_type_str = config_value.get("model", model_type_str)
                    temperature = config_value.get("temperature", temperature)
                    max_tokens = config_value.get("max_tokens", max_tokens)

        # Get the model config
        model_type = ModelType(model_type_str)
        config = await AIModelService.get_model_config(db, model_type, user_id)

        # For CHAT model type, don't use temperature (set to None)
        final_temperature = None if model_type_str == "CHAT" else float(temperature)

        return UsageParams(
            config=config,
            temperature=final_temperature,
            max_tokens=int(max_tokens),
            model_type=model_type_str
        )

    @staticmethod
    async def get_all_settings(
        db: AsyncSession,
        user_id: str = "global"
    ) -> Optional[AIAPISettings]:
        """
        Get all AI API settings with model configs

        Args:
            db: Database session
            user_id: User ID (default: "global")

        Returns:
            AIAPISettings object or None if not found
        """
        stmt = select(AIAPISettings).where(
            AIAPISettings.user_id == user_id
        ).options(
            selectinload(AIAPISettings.model_configs)
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    @staticmethod
    async def validate_model_config(config: AIModelConfig) -> bool:
        """
        Validate that a model configuration has all required fields

        Args:
            config: AIModelConfig to validate

        Returns:
            True if valid, raises exception otherwise
        """
        if not config.api_url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="API URL is required"
            )
        if not config.api_key:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="API Key is required"
            )
        if not config.model_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Model Name is required"
            )
        return True

    @staticmethod
    async def get_model_by_type_and_user(
        db: AsyncSession,
        model_type: ModelType,
        user_id: str = "global"
    ) -> Optional[AIModelConfig]:
        """
        Get model configuration by type and user ID

        Args:
            db: Database session
            model_type: Type of model
            user_id: User ID

        Returns:
            AIModelConfig or None
        """
        stmt = select(AIModelConfig).join(
            AIAPISettings, AIModelConfig.settings_id == AIAPISettings.id
        ).where(
            AIAPISettings.user_id == user_id,
            AIModelConfig.model_type == model_type
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    @staticmethod
    async def list_available_models(
        db: AsyncSession,
        user_id: str = "global"
    ) -> List[ModelInfo]:
        """
        List all available models for a user

        Args:
            db: Database session
            user_id: User ID

        Returns:
            List of ModelInfo objects
        """
        stmt = select(AIModelConfig).join(
            AIAPISettings, AIModelConfig.settings_id == AIAPISettings.id
        ).where(
            AIAPISettings.user_id == user_id
        )
        result = await db.execute(stmt)
        configs = result.scalars().all()

        return [
            ModelInfo(
                model_type=config.model_type,
                model_name=config.model_name,
                api_url=config.api_url,
                is_configured=bool(config.api_url and config.api_key and config.model_name)
            )
            for config in configs
        ]

    @staticmethod
    async def create_or_update_model_config(
        db: AsyncSession,
        settings_id: int,
        model_type: ModelType,
        config_data: AIModelConfigCreate
    ) -> AIModelConfig:
        """
        Create or update a model configuration

        Args:
            db: Database session
            settings_id: Parent settings ID
            model_type: Type of model
            config_data: Configuration data

        Returns:
            Created or updated AIModelConfig
        """
        existing_config = await db.execute(
            select(AIModelConfig).where(
                AIModelConfig.settings_id == settings_id,
                AIModelConfig.model_type == model_type
            )
        )
        config = existing_config.scalar_one_or_none()

        if config:
            # Update existing configuration
            for key, value in config_data.dict(exclude_unset=True).items():
                setattr(config, key, value)
        else:
            # Create new configuration
            config = AIModelConfig(
                settings_id=settings_id,
                model_type=model_type,
                **config_data.dict()
            )
            db.add(config)

        await db.commit()
        await db.refresh(config)
        return config


# Singleton instance for easy import
ai_model_service = AIModelService()