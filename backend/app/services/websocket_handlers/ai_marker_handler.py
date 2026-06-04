"""
AI Marker Visibility Handler
Handles AI marker visibility toggle and syncs to all players
"""
from typing import Dict, Any
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from .base import MessageHandler
from app.models.campaign import Campaign


class AIMarkerHandler(MessageHandler):
    """Handler for AI marker visibility operations"""

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
        Handle AI marker visibility toggle

        Only DM can toggle visibility, state is persisted to campaign.meta
        and broadcast to all players
        """
        # Only DM can toggle AI marker visibility
        if role != "dm":
            await self.send_to_websocket(
                {"type": "error", "data": {"message": "Only DM can toggle AI marker visibility"}},
                websocket
            )
            return

        data = message.get("data", {})
        show_ai_markers = data.get("show_ai_markers", True)

        # Update campaign meta in database
        try:
            result = await db.execute(
                select(Campaign).where(Campaign.id == int(campaign_id))
            )
            campaign = result.scalar_one_or_none()

            if campaign:
                # Update meta field
                meta = campaign.meta or {}
                meta["show_ai_markers"] = show_ai_markers

                await db.execute(
                    update(Campaign)
                    .where(Campaign.id == int(campaign_id))
                    .values(meta=meta)
                )
                await db.commit()

                print(f"[AIMarkerHandler] Updated show_ai_markers={show_ai_markers} for campaign {campaign_id}")
        except Exception as e:
            print(f"[AIMarkerHandler] Error updating campaign meta: {e}")
            await db.rollback()

        # Broadcast to all players in campaign (including sender for confirmation)
        await self.broadcast_to_campaign(
            {
                "type": "ai_marker_visibility",
                "data": {
                    "show_ai_markers": show_ai_markers,
                    "user_id": user_id,
                },
            },
            campaign_id,
        )
        print(f"[AIMarkerHandler] Broadcasting ai_marker_visibility={show_ai_markers} from {user_id}")
