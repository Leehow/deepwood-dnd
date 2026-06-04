"""
System Notice Handler
Broadcasts ephemeral campaign-wide notices without persistence.
"""
from typing import Any, Dict

from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from .base import MessageHandler


class SystemNoticeHandler(MessageHandler):
    """Broadcast campaign-wide ephemeral notices."""

    async def handle(
        self,
        message: Dict[str, Any],
        websocket: WebSocket,
        campaign_id: str,
        user_id: str,
        role: str,
        db: AsyncSession,
    ) -> None:
        data = message.get("data") or {}
        notice = {
            "type": "system_notice",
            "data": {
                "message": str(data.get("message") or "").strip(),
                "level": data.get("level") or "info",
                "duration": data.get("duration"),
            },
        }
        if not notice["data"]["message"]:
            return
        await self.broadcast_to_campaign(notice, campaign_id)
