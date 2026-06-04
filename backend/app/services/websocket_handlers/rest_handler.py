"""
Rest Handler
Handles rest grant messages (short rest / long rest)
Supports pending rest that players must claim
"""
from typing import Dict, Any
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from datetime import datetime

from .base import MessageHandler
from app.models.chat_message import ChatMessage
from app.models.character import Character
from app.models.campaign import CampaignMember
from app.models.token import Token
from sqlalchemy.orm.attributes import flag_modified


class RestHandler(MessageHandler):
    """Handler for rest operations"""

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
        Handle rest-related messages

        Supports:
        - rest_grant: DM grants short/long rest to players
        """
        message_type = message.get("type")
        data = message.get("data", {})

        if message_type == "rest_grant":
            # Extract rest_type from message or data
            rest_type = (data or {}).get("rest_type") or "short"

            timestamp = int(datetime.utcnow().timestamp() * 1000)

            # Get all members with bound characters (players + DM if DM has a character)
            result = await db.execute(
                select(CampaignMember, Character)
                .outerjoin(Character, CampaignMember.selected_character_id == Character.id)
                .where(
                    CampaignMember.campaign_id == int(campaign_id),
                    CampaignMember.selected_character_id.isnot(None)
                )
            )
            rows = result.all()
            pending_characters = []
            for member, character in rows:
                if character:
                    pending_characters.append({
                        "id": character.id,
                        "user_id": member.user_id,
                        "name": character.name
                    })

            # Persist rest grant message to database
            rest_message = ChatMessage(
                campaign_id=int(campaign_id),
                sender_user_id=user_id,
                sender_role=role,
                sender_character_id=None,
                message_type="system",
                content=f"DM 发放：{'长休' if rest_type == 'long' else '短休'}",
                recipients=[],
                is_private=False,
                mentions=[],
                meta={
                    "restGrant": {"type": rest_type},
                    "pending_characters": pending_characters,
                    "claimed_by": [],
                    "requires_claim": True
                },
                reply_to_id=None,
            )
            db.add(rest_message)
            await db.commit()
            await db.refresh(rest_message)

            payload_data = {
                "id": rest_message.id,
                "user_id": user_id,
                "role": role,
                "rest_type": rest_type,
                "timestamp": timestamp,
                "created_at": rest_message.created_at.isoformat()
                if hasattr(rest_message, "created_at") and rest_message.created_at
                else None,
                "pending_characters": pending_characters,
                "claimed_by": [],
            }

            # Broadcast DM grant rest (short/long) to all, including sender
            await self.broadcast_to_campaign({"type": "rest_grant", "data": payload_data}, campaign_id)
            print(f"[WebSocket] Broadcasting rest_grant from {user_id}")


class RestClaimHandler(MessageHandler):
    """Handler for claiming rest"""

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
        Handle rest claim messages - updates the claimed_by list

        Message format:
        {
            "type": "rest_claim",
            "data": {
                "message_id": 123
            }
        }
        """
        data = message.get("data", {})
        message_id = data.get("message_id")
        # DM can claim on behalf of another user
        claim_user_id = data.get("claim_user_id") or user_id

        if not message_id:
            await self.send_to_websocket({
                "type": "error",
                "data": {"message": "Missing message_id"},
            }, websocket)
            return

        # Get the chat message
        result = await db.execute(
            select(ChatMessage).where(ChatMessage.id == message_id)
        )
        chat_msg = result.scalar_one_or_none()

        if not chat_msg:
            await self.send_to_websocket({
                "type": "error",
                "data": {"message": "Rest message not found"},
            }, websocket)
            return

        meta = chat_msg.meta or {}
        if not meta.get('restGrant'):
            await self.send_to_websocket({
                "type": "error",
                "data": {"message": "Not a rest grant message"},
            }, websocket)
            return

        # Check if target user already claimed
        claimed_by = meta.get('claimed_by', [])
        if claim_user_id in claimed_by:
            await self.send_to_websocket({
                "type": "error",
                "data": {"message": "This character has already claimed this rest"},
            }, websocket)
            return

        # Update claimed_by and rest_results
        claimed_by.append(claim_user_id)
        rest_result = data.get("rest_result")
        rest_results = meta.get('rest_results', {})
        if rest_result:
            rest_results[claim_user_id] = rest_result
        new_meta = {**meta, 'claimed_by': claimed_by, 'rest_results': rest_results}

        await db.execute(
            update(ChatMessage)
            .where(ChatMessage.id == message_id)
            .values(meta=new_meta)
        )

        # Long rest: allow spell preparation for the claiming user's character
        rest_type = meta.get('restGrant', {}).get('type', 'short')
        if rest_type == 'long':
            # Find the character bound to this user in this campaign
            member_result = await db.execute(
                select(CampaignMember)
                .where(
                    CampaignMember.campaign_id == int(campaign_id),
                    CampaignMember.user_id == claim_user_id,
                    CampaignMember.selected_character_id.isnot(None)
                )
            )
            member = member_result.scalar_one_or_none()
            if member and member.selected_character_id:
                await db.execute(
                    update(Character)
                    .where(Character.id == member.selected_character_id)
                    .values(can_prepare_spells=True)
                )

                # Decrement day-based spell effects on character's token
                token_result = await db.execute(
                    select(Token).where(
                        Token.campaign_id == int(campaign_id),
                        Token.character_id == member.selected_character_id,
                        Token.active_effects.isnot(None),
                    )
                )
                for token in token_result.scalars().all():
                    effs = token.active_effects or []
                    new_effs = []
                    expired = []
                    changed = False
                    for e in effs:
                        if e.get("duration_unit") == "day" and e.get("duration") is not None:
                            d = e["duration"] - 1
                            if d > 0:
                                new_effs.append({**e, "duration": d})
                            else:
                                expired.append(e)
                            changed = True
                        else:
                            new_effs.append(e)
                    if changed:
                        token.active_effects = new_effs if new_effs else None
                        flag_modified(token, "active_effects")
                        await self.broadcast_to_campaign(
                            {"type": "token_active_effects_update", "token_id": token.id,
                             "active_effects": new_effs},
                            campaign_id,
                        )
                        # Cleanup generated items from expired effects
                        if expired:
                            from app.utils.spell_item_cleanup import cleanup_spell_generated_items
                            await cleanup_spell_generated_items(db, expired, token, int(campaign_id))

        await db.commit()

        # Broadcast claim update
        await self.broadcast_to_campaign(
            {
                "type": "rest_claimed",
                "data": {
                    "user_id": claim_user_id,
                    "message_id": message_id,
                    "claimed_by": claimed_by,
                    "rest_result": rest_result,
                    "timestamp": datetime.utcnow().isoformat(),
                },
            },
            campaign_id,
        )

        print(f"[Rest] User {claim_user_id} claimed rest from message {message_id} (by {user_id})")

