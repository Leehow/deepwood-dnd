"""
Consumable Use Handler
Handles consumable item usage messages (potions, antidotes, etc.)
Persists to chat history and broadcasts to all players
"""
from typing import Dict, Any
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime

from .base import MessageHandler
from app.models.chat_message import ChatMessage


class ConsumableHandler(MessageHandler):
    """Handler for consumable item usage events"""

    async def handle(
        self,
        message: Dict[str, Any],
        websocket: WebSocket,
        campaign_id: str,
        user_id: str,
        role: str,
        db: AsyncSession
    ) -> None:
        data = message.get("data", {})
        character_name = data.get("character_name", "角色")
        item_name = data.get("item_name", "消耗品")
        result_text = data.get("result_text", "")
        timestamp = int(datetime.utcnow().timestamp() * 1000)

        # Persist as system chat message
        chat_msg = ChatMessage(
            campaign_id=int(campaign_id),
            sender_user_id=user_id,
            sender_role=role,
            message_type="system",
            content=result_text,
            recipients=[],
            is_private=False,
            meta={"consumable_use": {
                "character_name": character_name,
                "item_name": item_name,
                "dice_rolls": data.get("dice_rolls"),
                "dice_bonus": data.get("dice_bonus"),
                "dice_total": data.get("dice_total"),
                "healing": data.get("healing"),
            }},
        )
        db.add(chat_msg)
        await db.commit()
        await db.refresh(chat_msg)

        # Broadcast to all players in campaign
        await self.broadcast_to_campaign({
            "type": "consumable_use",
            "data": {
                "id": chat_msg.id,
                "user_id": user_id,
                "character_name": character_name,
                "item_name": item_name,
                "result_text": result_text,
                "dice_rolls": data.get("dice_rolls"),
                "dice_bonus": data.get("dice_bonus"),
                "dice_total": data.get("dice_total"),
                "healing": data.get("healing"),
                "timestamp": timestamp,
                "created_at": chat_msg.created_at.isoformat(),
            },
        }, campaign_id)
