"""
WebSocket Handlers Package
Message handler registry pattern for WebSocket message processing

Usage:
    from app.services.websocket_handlers import registry
    from app.services.websocket_handlers.chat_handler import ChatHandler

    # Register handlers
    registry.register('chat', ChatHandler())

    # Dispatch messages
    await registry.dispatch(message, websocket, campaign_id, user_id, role, db)
"""

from .base import MessageHandler
from .registry import HandlerRegistry, registry
from .chat_handler import ChatHandler
from .map_handler import MapHandler
from .fog_handler import FogHandler
from .ruler_handler import RulerHandler
from .drawing_handler import DrawingHandler
from .dice_handler import DiceHandler
from .rest_handler import RestHandler, RestClaimHandler
from .reward_handler import RewardHandler, RewardClaimHandler
from .character_selection_handler import CharacterSelectionHandler
from .voice_handler import VoiceHandler
from .ai_marker_handler import AIMarkerHandler
from .consumable_handler import ConsumableHandler
from .trade_handler import TradeHandler
from .time_handler import TimeHandler
from .terrain_handler import TerrainHandler
from .system_notice_handler import SystemNoticeHandler

__all__ = [
    'MessageHandler',
    'HandlerRegistry',
    'registry',
    'ChatHandler',
    'MapHandler',
    'FogHandler',
    'RulerHandler',
    'DrawingHandler',
    'DiceHandler',
    'RestHandler',
    'RestClaimHandler',
    'RewardHandler',
    'RewardClaimHandler',
    'CharacterSelectionHandler',
    'VoiceHandler',
    'AIMarkerHandler',
    'ConsumableHandler',
    'TradeHandler',
    'TimeHandler',
    'TerrainHandler',
    'SystemNoticeHandler',
]
