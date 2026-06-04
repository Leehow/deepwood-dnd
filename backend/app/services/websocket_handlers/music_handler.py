"""
Music Handler
Handles background music control broadcasting for campaign sessions
"""
from typing import Dict, Any
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from .base import MessageHandler


class MusicHandler(MessageHandler):
    """Handler for background music control messages"""

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
        Handle music control messages (DM only)

        Supports:
        - music_play: DM starts/changes track -> broadcast to all players
        - music_pause: DM pauses -> broadcast to all players
        - music_volume: DM changes volume -> broadcast to all players
        """
        # Only DM can control music
        if role != "dm":
            await self.send_to_websocket({
                "type": "error",
                "data": {"message": "Only DM can control background music"}
            }, websocket)
            return

        message_type = message.get("type")
        data = message.get("data", {})

        if message_type == "music_play":
            await self.broadcast_to_campaign({
                "type": "music_play",
                "data": {
                    "trackIndex": data.get("trackIndex"),
                    "volume": data.get("volume", 0.3),
                }
            }, campaign_id, exclude_websocket=websocket)

        elif message_type == "music_pause":
            await self.broadcast_to_campaign({
                "type": "music_pause",
                "data": {}
            }, campaign_id, exclude_websocket=websocket)

        elif message_type == "music_volume":
            await self.broadcast_to_campaign({
                "type": "music_volume",
                "data": {
                    "volume": data.get("volume", 0.3),
                }
            }, campaign_id, exclude_websocket=websocket)
