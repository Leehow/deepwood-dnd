"""
Drawing Tool Handler
Handles drawing operations on the map
"""
from typing import Dict, Any
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from .base import MessageHandler


class DrawingHandler(MessageHandler):
    """Handler for drawing tool operations"""

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
        Handle drawing tool messages

        Supports:
        - drawing_added: Add a new drawing
        - drawing_updated: Update an existing drawing
        - drawing_removed: Remove a drawing
        - drawings_cleared: Clear all drawings
        """
        message_type = message.get("type")
        data = message.get("data", {})

        if message_type == "drawing_added":
            # Broadcast drawing addition to all players
            await self.broadcast_to_campaign({
                "type": "drawing_added",
				"data": {**(data or {}), "user_id": user_id}
            }, campaign_id)

        elif message_type == "drawing_updated":
            # Broadcast drawing update to all players
            await self.broadcast_to_campaign({
                "type": "drawing_updated",
				"data": {**(data or {}), "user_id": user_id}
            }, campaign_id)

        elif message_type == "drawing_removed":
            # Broadcast drawing removal to all players
            await self.broadcast_to_campaign({
                "type": "drawing_removed",
				"data": {**(data or {}), "user_id": user_id}
            }, campaign_id)

        elif message_type == "drawings_cleared":
            # Broadcast drawings clear to all players
            await self.broadcast_to_campaign({
                "type": "drawings_cleared",
				"data": {**(data or {}), "user_id": user_id}
            }, campaign_id)
