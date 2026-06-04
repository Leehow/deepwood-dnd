"""Character selection WebSocket handler.

Handles:
- character_selected: player selects an active character for the campaign.
"""

from typing import Any, Dict

from fastapi import WebSocket
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.campaign import CampaignMember
from app.models.character import Character
from app.models.monster_instance import MonsterInstance
from app.models.token import Token

from .base import MessageHandler


class CharacterSelectionHandler(MessageHandler):
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
        raw_character_id = data.get("character_id")

        try:
            character_id = int(raw_character_id)
        except Exception:
            await self.send_to_websocket(
                {"type": "error", "data": {"message": "Invalid character_id"}}, websocket
            )
            return

        char_result = await db.execute(select(Character).where(Character.id == character_id))
        character = char_result.scalar_one_or_none()
        if not character:
            await self.send_to_websocket(
                {"type": "error", "data": {"message": "Character not found"}}, websocket
            )
            return

        if getattr(character, "user_id", None) != user_id:
            await self.send_to_websocket(
                {"type": "error", "data": {"message": "Character does not belong to this user"}},
                websocket,
            )
            return

        member_result = await db.execute(
            select(CampaignMember)
            .where(
                CampaignMember.campaign_id == int(campaign_id),
                CampaignMember.user_id == user_id,
                CampaignMember.role == "player",
            )
            .limit(1)
        )
        member = member_result.scalar_one_or_none()
        if not member:
            member = CampaignMember(campaign_id=int(campaign_id), user_id=user_id, role="player")
            db.add(member)
            await db.flush()

        old_character_id = member.selected_character_id

        # Remove companion tokens of the old character from all maps
        if old_character_id and old_character_id != character_id:
            await self._dismiss_old_companion_tokens(
                db, int(campaign_id), old_character_id, campaign_id
            )

        member.selected_character_id = character_id
        member.character_name = character.name
        await db.commit()

        await self.broadcast_to_campaign(
            {
                "type": "character_selected",
                "data": {
                    "user_id": user_id,
                    "character_id": character_id,
                    "character_name": character.name,
                },
            },
            campaign_id,
            exclude_websocket=websocket,
        )

    async def _dismiss_old_companion_tokens(
        self,
        db: AsyncSession,
        campaign_id_int: int,
        old_character_id: int,
        campaign_id_str: str,
    ) -> None:
        """Remove companion tokens belonging to the old character."""
        mi_result = await db.execute(
            select(MonsterInstance.id).where(and_(
                MonsterInstance.campaign_id == campaign_id_int,
                MonsterInstance.controller_character_id == old_character_id,
                MonsterInstance.control_type == "companion",
            ))
        )
        companion_ids = [row[0] for row in mi_result.all()]
        if not companion_ids:
            return

        token_result = await db.execute(
            select(Token).where(and_(
                Token.campaign_id == campaign_id_int,
                Token.monster_instance_id.in_(companion_ids),
            ))
        )
        tokens = token_result.scalars().all()
        for t in tokens:
            token_id = t.id
            await db.delete(t)
            await db.flush()
            await self.broadcast_to_campaign(
                {"type": "token_removed", "token_id": token_id},
                campaign_id_str,
            )
