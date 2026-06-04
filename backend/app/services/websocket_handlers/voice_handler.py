"""
Voice Chat Handler
Handles voice chat state broadcasting for LiveKit integration
"""
from typing import Dict, Any
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from .base import MessageHandler


class VoiceHandler(MessageHandler):
    """Handler for voice chat state messages"""

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
        Handle voice chat state messages

        Supports:
        - voice_join: User joined voice chat
        - voice_leave: User left voice chat
        """
        message_type = message.get("type")
        data = message.get("data", {})

        if message_type == "voice_join":
            # Broadcast that user joined voice to all players
            await self.broadcast_to_campaign({
                "type": "voice_join",
                "data": {"user_id": user_id}
            }, campaign_id)

        elif message_type == "voice_leave":
            # Broadcast that user left voice to all players
            await self.broadcast_to_campaign({
                "type": "voice_leave",
                "data": {"user_id": user_id}
            }, campaign_id)
