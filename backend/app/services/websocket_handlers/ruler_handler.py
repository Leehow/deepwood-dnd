"""
Ruler Tool Handler
Handles ruler tool operations for measuring distances
"""
from typing import Dict, Any
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from .base import MessageHandler


class RulerHandler(MessageHandler):
    """Handler for ruler tool operations"""

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
        Handle ruler tool messages

        Supports:
        - ruler_added: Add a new ruler measurement
        - ruler_removed: Remove a ruler measurement
        - rulers_cleared: Clear all rulers
        """
        message_type = message.get("type")
        data = message.get("data", {})

        if message_type == "ruler_added":
            # Broadcast ruler addition to all players
            await self.broadcast_to_campaign({
                "type": "ruler_added",
				"data": {**(data or {}), "user_id": user_id}
            }, campaign_id)

        elif message_type == "ruler_removed":
            # Broadcast ruler removal to all players
            await self.broadcast_to_campaign({
                "type": "ruler_removed",
				"data": {**(data or {}), "user_id": user_id}
            }, campaign_id)

        elif message_type == "rulers_cleared":
            # Broadcast rulers clear to all players
            await self.broadcast_to_campaign({
                "type": "rulers_cleared",
				"data": {**(data or {}), "user_id": user_id}
            }, campaign_id)
