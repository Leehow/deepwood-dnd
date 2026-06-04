"""
WebSocket Handler Registry
Manages registration and dispatching of message type handlers
"""
from typing import Dict
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from .base import MessageHandler


class HandlerRegistry:
    """Registry for WebSocket message handlers"""

    def __init__(self):
        self._handlers: Dict[str, MessageHandler] = {}

    def register(self, message_type: str, handler: MessageHandler) -> None:
        """Register a handler for a specific message type"""
        self._handlers[message_type] = handler

    def register_multiple(self, handlers: Dict[str, MessageHandler]) -> None:
        """Register multiple handlers at once"""
        self._handlers.update(handlers)

    async def dispatch(
        self,
        message: dict,
        websocket: WebSocket,
        campaign_id: str,
        user_id: str,
        role: str,
        db: AsyncSession
    ) -> None:
        """
        Dispatch a message to the appropriate handler

        Args:
            message: The parsed message data
            websocket: The WebSocket connection
            campaign_id: Campaign identifier
            user_id: User identifier
            role: User role ('dm' or 'player')
            db: Database session
        """
        message_type = message.get('type')

        if not message_type:
            await websocket.send_json({
                "type": "error",
                "data": {"message": "Message type is required"},
            })
            return

        handler = self._handlers.get(message_type)

        if handler:
            try:
                await handler.handle(message, websocket, campaign_id, user_id, role, db)
            except Exception as e:
                import traceback
                traceback.print_exc()
                await websocket.send_json({
                    "type": "error",
                    "data": {"message": f"Error handling {message_type}: {str(e)}"},
                })
        else:
            await websocket.send_json({
                "type": "error",
                "data": {"message": f"Unknown message type: {message_type}"},
            })


# Global registry instance
registry = HandlerRegistry()
