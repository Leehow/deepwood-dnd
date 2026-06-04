"""
Module parsing service using new modular parser architecture
"""
import logging
from pathlib import Path
from typing import Dict, List, Any, Optional, Callable
import json

from app.domain.parsing.orchestrator import ParseOrchestrator


class ModuleParsingService:
    """Service for parsing D&D modules with progress tracking"""

    def __init__(
        self,
        ai_settings: Dict,
        output_dir: Path,
        logger: logging.Logger = None
    ):
        self.ai_settings = ai_settings
        self.output_dir = Path(output_dir)
        self.logger = logger or logging.getLogger(__name__)

        # Initialize orchestrator
        self.orchestrator = ParseOrchestrator(
            ai_settings=ai_settings,
            output_dir=output_dir,
            logger=self.logger
        )

    async def parse_module_file(
        self,
        markdown_path: Path,
        progress_callback: Optional[Callable] = None,
        skip_monsters: bool = False,
        skip_items: bool = False,
        toc_strategy: str = "regex_llm"
    ) -> Dict[str, Any]:
        """
        Parse a D&D module markdown file

        Args:
            markdown_path: Path to markdown file
            progress_callback: Async callback function(stage, message, progress)
            skip_monsters: Skip monster extraction
            skip_items: Skip item extraction

        Args:
            markdown_path: Path to markdown file
            progress_callback: Async callback function(stage, message, progress)
            skip_monsters: Skip monster extraction
            skip_items: Skip item extraction
            toc_strategy: 'regex_llm' | 'rules' | 'ai' (default: 'regex_llm')

        Returns:
            Dict containing parsed module data
        """
        self.logger.info(f"Parsing module: {markdown_path} (toc_strategy={toc_strategy})")

        # Read markdown content
        with open(markdown_path, 'r', encoding='utf-8') as f:
            markdown_content = f.read()

        # Setup progress callback wrapper
        if progress_callback:
            self.orchestrator.progress_callback = progress_callback

        # Parse module
        result = await self.orchestrator.parse_module(
            markdown_content,
            toc_strategy=toc_strategy,
            skip_content=False,
            skip_monsters=skip_monsters,
            skip_items=skip_items,
            skip_images=False
        )

        # Save intermediate results to files (for compatibility)
        await self._save_results_to_files(result)

        return result

    async def _save_results_to_files(self, result: Dict[str, Any]):
        """Save parsing results to JSON files"""
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Save chapter tree
        if result.get('chapters'):
            chapter_file = self.output_dir / 'chapter_tree_with_content.json'
            with open(chapter_file, 'w', encoding='utf-8') as f:
                json.dump(result['chapters'], f, ensure_ascii=False, indent=2)
            self.logger.info(f"Saved chapter tree: {chapter_file}")

        # Save monsters
        if result.get('monsters'):
            monsters_file = self.output_dir / 'monsters.json'
            with open(monsters_file, 'w', encoding='utf-8') as f:
                json.dump(result['monsters'], f, ensure_ascii=False, indent=2)
            self.logger.info(f"Saved monsters: {monsters_file}")

        # Save items
        if result.get('items'):
            items_file = self.output_dir / 'items.json'
            with open(items_file, 'w', encoding='utf-8') as f:
                json.dump(result['items'], f, ensure_ascii=False, indent=2)
            self.logger.info(f"Saved items: {items_file}")

        # Save images
        if result.get('images'):
            images_file = self.output_dir / 'images.json'
            with open(images_file, 'w', encoding='utf-8') as f:
                json.dump(result['images'], f, ensure_ascii=False, indent=2)
            self.logger.info(f"Saved images: {images_file}")

        # Save TOC
        if result.get('toc'):
            toc_file = self.output_dir / 'toc.json'
            with open(toc_file, 'w', encoding='utf-8') as f:
                json.dump(result['toc'], f, ensure_ascii=False, indent=2)
            self.logger.info(f"Saved TOC: {toc_file}")


def create_websocket_progress_callback(websocket, task_id: str, base_progress: int = 0):
    """
    Create a progress callback function for WebSocket updates

    Args:
        websocket: FastAPI WebSocket connection
        task_id: Task ID for tracking
        base_progress: Base progress offset (for PDF files starting at 60%)

    Returns:
        Async callback function
    """
    async def progress_callback(stage: str, message: str, progress: int):
        """Send progress update via WebSocket"""
        # Adjust progress based on base offset
        adjusted_progress = base_progress + int(progress * (100 - base_progress) / 100)

        await websocket.send_json({
            "type": "progress",
            "step": stage,
            "message": message,
            "progress": adjusted_progress,
            "task_id": task_id
        })

    return progress_callback


async def get_ai_settings_from_db(user_id: str = "global"):
    """
    Get AI settings from database

    Args:
        user_id: User ID (default: "global" for system-wide settings)

    Returns:
        Dict with AI settings including both legacy flat keys and a 'models' mapping.
    """
    from app.db.session import get_db
    from app.models.ai_settings import AIAPISettings, ModelType
    from sqlalchemy import select

    try:
        from sqlalchemy.orm import selectinload
        async for db in get_db():
            # Query AI settings for user, eager-load model_configs to avoid greenlet issues
            stmt = (
                select(AIAPISettings)
                .where(AIAPISettings.user_id == user_id)
                .options(selectinload(AIAPISettings.model_configs))
            )
            result = await db.execute(stmt)
            ai_settings = result.scalar_one_or_none()

            if not ai_settings:
                # Return default/mock settings if not configured
                return get_default_ai_settings()

            # Build settings dict (backward-compatible flat keys) and 'models' mapping
            settings: Dict[str, Any] = {}
            models_map: Dict[str, Dict[str, str]] = {}

            for config in (ai_settings.model_configs or []):
                # ModelType is an Enum; use its value (e.g., 'FAST') as key
                model_key = getattr(config.model_type, "value", str(config.model_type))

                models_map[model_key] = {
                    "api_url": config.api_url or "",
                    "api_key": config.api_key or "",
                    "model_name": config.model_name or "",
                }

                # Preserve legacy flat keys for components that still read them
                if config.model_type == ModelType.FAST:
                    settings['fast_api_url'] = config.api_url
                    settings['fast_api_key'] = config.api_key
                    settings['fast_model'] = config.model_name
                elif config.model_type == ModelType.ADVANCED:
                    settings['api_url'] = config.api_url
                    settings['api_key'] = config.api_key
                    settings['model'] = config.model_name

            # Attach the full models mapping for new components (orchestrator, translation, etc.)
            settings['models'] = models_map

            # Debug: show available model keys and FAST presence (no secrets)
            try:
                has_fast = "FAST" in models_map
                logging.getLogger(__name__).info(
                    f"AI settings models configured: keys={list(models_map.keys())}, has_FAST={has_fast}"
                )
            except Exception:
                pass
            try:
                print(f"[AI_SETTINGS] models keys={list(models_map.keys())}, has_FAST={has_fast}", flush=True)
                if "FAST" in models_map:
                    safe_fast = {
                        'api_url': models_map['FAST'].get('api_url'),
                        'model_name': models_map['FAST'].get('model_name')
                    }
                    print(f"[AI_SETTINGS] FAST cfg summary={safe_fast}", flush=True)
            except Exception:
                pass

            # Keep convenience fallback so content parser can reuse FAST when ADVANCED is absent
            if 'api_url' not in settings and 'fast_api_url' in settings:
                settings['api_url'] = settings['fast_api_url']
                settings['api_key'] = settings['fast_api_key']
                settings['model'] = settings['fast_model']

            return settings

    except Exception as e:
        logging.getLogger(__name__).warning(f"Failed to load AI settings from DB: {e}")
        return get_default_ai_settings()


def get_default_ai_settings() -> Dict:
    """Get default AI settings (mock/fallback)

    Returns both legacy flat fields and the unified 'models' mapping so that
    all components (orchestrator, parsers) can work consistently.
    """
    import os
    from dotenv import load_dotenv

    load_dotenv()

    # Try to get from environment variables
    api_url = os.getenv('QWEN_API_URL', 'https://api.example.com')
    api_key = os.getenv('QWEN_API_KEY', 'test_key')
    model = os.getenv('QWEN_MODEL', 'qwen-max')

    return {
        'api_url': api_url,
        'api_key': api_key,
        'model': model,
        'fast_api_url': api_url,
        'fast_api_key': api_key,
        'fast_model': model,
        # Unified mapping used by orchestrator and translation helpers
        'models': {
            'FAST': {
                'api_url': api_url,
                'api_key': api_key,
                'model_name': model,
            },
            'ADVANCED': {
                'api_url': api_url,
                'api_key': api_key,
                'model_name': model,
            },
            'TRANSLATION': {
                'api_url': api_url,
                'api_key': api_key,
                'model_name': model,
            },
        },
    }
