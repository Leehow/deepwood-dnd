from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from contextlib import asynccontextmanager
import asyncio
import logging
import signal

# Configure application-level logging so logger.info() works
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s"
)
logger = logging.getLogger(__name__)

from app.core.config import settings
from app.core.errors import AppError, app_error_handler
from app.db.session import engine, Base
from app.db.redis import init_redis, close_redis
from app.api.routes import ai_settings, websocket_simplified, campaigns, races, ai_description, characters, modules, quest_progress, map_settings, tokens, items, monster_instances, monster_avatars, fog_of_war, map_terrain, map_view_state, rulers, drawings, module_maps, campaign_storage, users, chat, equipment, shops, auth, rules_chat, rules_embedding, module_chat, module_chat_sessions, module_notes, resource_chat, map_markers, map_library, combat, cover_library, voice, ai_map_markers, chests, custom_modules, chapter_agent, campaign_templates, character_drafts, spell_cast, ai_sessions, map_bulk_data, media_proxy, qa

# Global shutdown event for graceful termination
shutdown_event = asyncio.Event()

# Import models to register them with Base.metadata
from app.models.character import Character
from app.models.campaign import Campaign
from app.models.ai_settings import AIAPISettings
from app.models.map_settings import MapSettings
from app.models.token import Token
from app.models.item import Item
from app.models.monster_instance import MonsterInstance
from app.models.fog_of_war import FogOfWar
from app.models.map_view_state import MapViewState
from app.models.ruler import Ruler
from app.models.drawing import Drawing
from app.models.module_maps import ModuleMaps
from app.models.user import User

from app.models.shop import Shop
from app.models.shop_inventory import ShopInventory
from app.models.chest import Chest
from app.models.chest_inventory import ChestInventory

from app.models.campaign_storage import CampaignStorage
from app.models.campaign_storage_acl import CampaignStorageACL
from app.models.chat_message import ChatMessage
from app.models.raw_module_file import RawModuleFile
from app.models.parsed_module import ParsedModule
from app.models.module_parse_task import ModuleParseTask
from app.models.rules_chat import RulesChatMessage
from app.models.rules_embedding import RulesEmbedding
from app.models.module_chat import ModuleChatMessage
from app.models.module_chat_session import ModuleChatSession
from app.models.module_note import ModuleNote
from app.models.resource_chat import ResourceChatMessage
from app.models.map_marker import MapMarker
from app.models.ai_map_marker import AIMapMarker
from app.models.user_map import UserMap
from app.models.user_avatar import UserAvatar
from app.models.campaign_template import CampaignTemplate
from app.models.character_draft import CharacterDraft
from app.models.map_terrain import MapTerrain
from app.models.ai_chat_session import AiChatSession
from app.models.spell_runtime_instance import SpellRuntimeInstance



@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan event handler for startup and shutdown"""
    # Startup
    logger.info("Starting up")

    # Reset shutdown event at startup
    shutdown_event.clear()

    # Initialize database tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Initialize Redis
    await init_redis()
    logger.info("Database and Redis initialized")

    yield

    # Shutdown - signal all pending requests to cancel
    logger.info("Shutting down, signaling pending requests to cancel")
    shutdown_event.set()

    # Give pending requests a moment to cancel gracefully
    await asyncio.sleep(0.5)

    await close_redis()
    await engine.dispose()
    logger.info("Shutdown complete")


# Create FastAPI app
app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    debug=settings.DEBUG,
    lifespan=lifespan,
    redirect_slashes=False  # Disable 307 redirects for trailing slashes
)


# Middleware to strip trailing slashes
class TrailingSlashMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path != "/" and request.url.path.endswith("/"):
            # Strip trailing slash from path
            scope = request.scope
            scope["path"] = request.url.path.rstrip("/")
            request = Request(scope, request.receive)
        return await call_next(request)


app.add_middleware(TrailingSlashMiddleware)

# Register structured app error handler (English-canonical envelope)
app.add_exception_handler(AppError, app_error_handler)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(ai_settings.router, prefix="/api")
app.include_router(ai_description.router, prefix="/api")
app.include_router(campaigns.router, prefix="/api")
app.include_router(races.router, prefix="/api")
app.include_router(characters.router, prefix="/api")
app.include_router(modules.router)
app.include_router(quest_progress.router)
app.include_router(map_settings.router)
app.include_router(tokens.router, prefix="/api")
app.include_router(items.router)
app.include_router(monster_instances.router)
app.include_router(monster_avatars.router)
app.include_router(fog_of_war.router)
app.include_router(map_terrain.router)
app.include_router(module_maps.router)
app.include_router(map_view_state.router)
app.include_router(rulers.router)
app.include_router(map_markers.router)
app.include_router(ai_map_markers.router)
app.include_router(drawings.router)
app.include_router(map_bulk_data.router)

app.include_router(campaign_storage.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(ai_sessions.router, prefix="/api")
app.include_router(shops.router)
app.include_router(chests.router)
app.include_router(custom_modules.router)

app.include_router(equipment.router)

app.include_router(websocket_simplified.router)
app.include_router(auth.router)
app.include_router(rules_chat.router, prefix="/api")
app.include_router(rules_embedding.router, prefix="/api")
app.include_router(media_proxy.router)
app.include_router(module_chat.router)
app.include_router(module_chat_sessions.router)
app.include_router(module_notes.router)
app.include_router(resource_chat.router)
app.include_router(chapter_agent.router)
app.include_router(map_library.router)
app.include_router(cover_library.router)
app.include_router(campaign_templates.router, prefix="/api")
app.include_router(combat.router, prefix="/api/combat")
app.include_router(voice.router)
app.include_router(character_drafts.router)
app.include_router(spell_cast.router, prefix="/api")
app.include_router(qa.router, prefix="/api")


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "DND 5E Platform API",
        "version": settings.VERSION,
        "status": "running"
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.API_HOST,
        port=settings.API_PORT,
        reload=settings.DEBUG
    )
