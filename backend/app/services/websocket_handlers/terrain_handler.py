"""
Terrain Handler
Handles terrain update and clear operations
"""
from typing import Dict, Any
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from .base import MessageHandler


class TerrainHandler(MessageHandler):
    """Handler for terrain operations"""

    async def handle(
        self,
        message: Dict[str, Any],
        websocket: WebSocket,
        campaign_id: str,
        user_id: str,
        role: str,
        db: AsyncSession
    ) -> None:
        message_type = message.get("type")
        data = message.get("data", {})

        if message_type == "terrain_update":
            await self.broadcast_to_campaign(
                {
                    "type": "terrain_update",
                    "data": {**(data or {}), "user_id": user_id},
                },
                campaign_id,
            )
            print(f"[TerrainHandler] Broadcasting terrain update from {user_id}")

        elif message_type == "terrain_clear_all":
            await self.broadcast_to_campaign(
                {
                    "type": "terrain_clear_all",
                    "data": {**(data or {}), "user_id": user_id},
                },
                campaign_id,
            )
            print(f"[TerrainHandler] Broadcasting terrain clear all from {user_id}")

        elif message_type == "terrain_visibility":
            await self.broadcast_to_campaign(
                {
                    "type": "terrain_visibility",
                    "data": {**(data or {}), "user_id": user_id},
                },
                campaign_id,
            )
            print(f"[TerrainHandler] Broadcasting terrain visibility={data.get('visible')} from {user_id}")
