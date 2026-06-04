"""
WebSocket Message Handler Base Classes
Provides abstract base for implementing message type handlers
"""
from abc import ABC, abstractmethod
from typing import Dict, Any
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession


class MessageHandler(ABC):
    """Abstract base class for WebSocket message handlers"""

    @abstractmethod
    async def handle(
        self,
        message: Dict[str, Any],
        websocket: WebSocket,
        campaign_id: str,
        user_id: str,
        role: str,
        db: AsyncSession
    ) -> None:
        """
        Handle a specific message type

        Args:
            message: The parsed message data
            websocket: The WebSocket connection
            campaign_id: Campaign identifier
            user_id: User identifier
            role: User role ('dm' or 'player')
            db: Database session
        """
        pass

    async def broadcast_to_campaign(
        self,
        message: Dict[str, Any],
        campaign_id: str,
        exclude_websocket: WebSocket = None
    ) -> None:
        """Broadcast message to all connections in a campaign"""
        from app.services.websocket_manager import manager
        await manager.broadcast_to_campaign(message, campaign_id, exclude_websocket)

    async def broadcast_to_users(
        self,
        message: Dict[str, Any],
        campaign_id: str,
        user_ids: list[str]
    ) -> None:
        """Broadcast message to specific users in a campaign"""
        from app.services.websocket_manager import manager
        await manager.send_to_users(message, campaign_id, user_ids)

    async def send_to_websocket(
        self,
        message: Dict[str, Any],
        websocket: WebSocket
    ) -> None:
        """Send message to a specific websocket"""
        try:
            from app.services.websocket_manager import normalize_ws_message

            await websocket.send_json(normalize_ws_message(message))
        except Exception:
            # WebSocket may be disconnected
            pass
