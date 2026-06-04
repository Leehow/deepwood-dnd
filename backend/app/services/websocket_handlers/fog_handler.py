"""
Fog of War Handler
Handles fog of war updates and operations
"""
from typing import Dict, Any
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from .base import MessageHandler


class FogHandler(MessageHandler):
    """Handler for fog of war operations"""

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
        Handle fog of war messages

        Supports:
        - fog_update: Update fog state
        - fog_fill_all: Fill entire map with fog
        - fog_clear_all: Clear all fog from map
        """
        message_type = message.get("type")
        data = message.get("data", {})

        if message_type == "fog_update":
            # Broadcast fog updates to all players
            await self.broadcast_to_campaign(
                {
                    "type": "fog_update",
					"data": {**(data or {}), "user_id": user_id},
                },
                campaign_id,
            )
            print(f"[FogHandler] Broadcasting fog update from {user_id}")

        elif message_type == "fog_fill_all":
            # Broadcast fill all fog to all players
            await self.broadcast_to_campaign(
                {
                    "type": "fog_fill_all",
					"data": {**(data or {}), "user_id": user_id},
                },
                campaign_id,
            )
            print(f"[FogHandler] Broadcasting fog fill all from {user_id}")

        elif message_type == "fog_clear_all":
            # Broadcast clear all fog to all players
            await self.broadcast_to_campaign(
                {
                    "type": "fog_clear_all",
					"data": {**(data or {}), "user_id": user_id},
                },
                campaign_id,
            )
            print(f"[FogHandler] Broadcasting fog clear all from {user_id}")
