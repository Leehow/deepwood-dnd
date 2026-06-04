"""
Reward Handler
Handles XP and currency reward grants from DM
Supports pending rewards that players must accept
"""
from typing import Dict, Any, List
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from datetime import datetime

from .base import MessageHandler
from app.models.character import Character
from app.models.reward_history import RewardHistory
from app.models.chat_message import ChatMessage
from app.services.realtime_publisher import realtime_publisher


class RewardHandler(MessageHandler):
    """Handler for reward (XP/currency) operations"""

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
        Handle reward grant messages

        Message format:
        {
            "type": "reward_grant",
            "campaign_id": "123",
            "data": {
                "reward_type": "xp" | "currency",
                "recipients": [1, 2, 3],  // character IDs
                "amount": 300,  // for XP
                "currency_changes": {"gp": 100},  // for currency
                "source": "Combat",
                "description": "Defeated goblin chief",
                "is_private": false
            }
        }
        """
        # Only DM can grant rewards
        if role != 'dm':
            await self.send_to_websocket({
                "type": "error",
                "message": "Only DM can grant rewards"
            }, websocket)
            return

        data = message.get("data", {})
        reward_type = data.get("reward_type")
        recipients = data.get("recipients", [])
        is_private = data.get("is_private", False)
        description = data.get("description", "")

        if not recipients:
            await self.send_to_websocket({
                "type": "error",
                "message": "No recipients specified"
            }, websocket)
            return

        if reward_type == "xp":
            await self._handle_xp_reward(
                data, recipients, campaign_id, user_id,
                description, is_private, db
            )
        elif reward_type == "currency":
            await self._handle_currency_reward(
                data, recipients, campaign_id, user_id,
                description, is_private, db
            )
        else:
            await self.send_to_websocket({
                "type": "error",
                "message": f"Unknown reward type: {reward_type}"
            }, websocket)

    async def _handle_xp_reward(
        self,
        data: Dict[str, Any],
        recipients: List[int],
        campaign_id: str,
        dm_id: str,
        description: str,
        is_private: bool,
        db: AsyncSession
    ):
        """Handle XP reward grant - creates pending reward for players to accept"""
        xp_amount = data.get("amount", 0)
        source = data.get("source", "Manual")

        if xp_amount <= 0:
            return

        # Get character info for all recipients
        pending_characters = []
        for character_id in recipients:
            result = await db.execute(
                select(Character).where(Character.id == character_id)
            )
            character = result.scalar_one_or_none()
            if character:
                pending_characters.append({
                    "id": character_id,
                    "user_id": character.user_id,
                    "name": character.name,
                    "current_xp": character.experience_points or 0
                })

        if not pending_characters:
            return

        # Create chat message with pending reward info
        source_map = {
            'Combat': '战斗',
            'Quest': '任务',
            'Roleplay': '角色扮演',
            'Exploration': '探索',
            'Puzzle': '谜题',
            'Social': '社交',
            'Manual': '手动'
        }
        source_text = source_map.get(source, source)
        char_names = ', '.join([char["name"] for char in pending_characters])

        message_content = f"{'🔒 ' if is_private else '⚡ '}DM发放了 {xp_amount} 点经验值（{source_text}）给 {char_names}"
        if description:
            message_content += f"：{description}"

        # Determine recipients for chat message
        chat_recipients = []
        if is_private:
            chat_recipients = [char["user_id"] for char in pending_characters]

        chat_msg = ChatMessage(
            campaign_id=int(campaign_id),
            sender_user_id=dm_id,
            sender_role='dm',
            message_type='system',
            content=message_content,
            recipients=chat_recipients,
            is_private=is_private,
            meta={
                'reward_type': 'xp',
                'amount': xp_amount,
                'source': source,
                'description': description,
                'character_ids': [char["id"] for char in pending_characters],
                'pending_characters': pending_characters,  # Characters who can claim
                'claimed_by': [],  # user_ids who have claimed
                'requires_claim': True  # Flag for frontend
            }
        )
        db.add(chat_msg)
        await db.commit()
        await db.refresh(chat_msg)

        # Broadcast pending reward
        broadcast_msg = {
            "type": "reward_pending",
            "reward_type": "xp",
            "campaign_id": campaign_id,
            "message_id": chat_msg.id,
            "created_at": chat_msg.created_at.isoformat() if getattr(chat_msg, "created_at", None) else datetime.utcnow().isoformat(),
            "data": {
                "characters": pending_characters,
                "amount": xp_amount,
                "source": source,
                "source_text": source_text,
                "description": description,
                "is_private": is_private,
                "awarded_by": dm_id,
                "claimed_by": [],
                "timestamp": datetime.utcnow().isoformat()
            }
        }

        if is_private:
            recipient_user_ids = [char["user_id"] for char in pending_characters]
            recipient_user_ids.append(dm_id)
            from app.services.websocket_manager import manager
            await manager.send_to_users(broadcast_msg, campaign_id, recipient_user_ids)
        else:
            await self.broadcast_to_campaign(broadcast_msg, campaign_id)

        print(f"[Reward] Created pending XP reward ({xp_amount}) for {len(pending_characters)} characters")

    async def _handle_currency_reward(
        self,
        data: Dict[str, Any],
        recipients: List[int],
        campaign_id: str,
        dm_id: str,
        description: str,
        is_private: bool,
        db: AsyncSession
    ):
        """Handle currency reward grant - creates pending reward for players to accept"""
        currency_changes = data.get("currency_changes", {})
        source = data.get("source", "Manual")

        if not any(amount != 0 for amount in currency_changes.values()):
            return

        # Get character info for all recipients
        pending_characters = []
        for character_id in recipients:
            result = await db.execute(
                select(Character).where(Character.id == character_id)
            )
            character = result.scalar_one_or_none()
            if character:
                pending_characters.append({
                    "id": character_id,
                    "user_id": character.user_id,
                    "name": character.name,
                    "current_currency": character.currency or {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}
                })

        if not pending_characters:
            return

        # Create chat message
        changes_text = ', '.join([f"{amt}{type}" for type, amt in currency_changes.items() if amt != 0])
        char_names = ', '.join([char["name"] for char in pending_characters])

        message_content = f"{'🔒 ' if is_private else '💰 '}DM发放了金币（{changes_text}）给 {char_names}"
        if description:
            message_content += f"：{description}"

        chat_recipients = []
        if is_private:
            chat_recipients = [char["user_id"] for char in pending_characters]

        chat_msg = ChatMessage(
            campaign_id=int(campaign_id),
            sender_user_id=dm_id,
            sender_role='dm',
            message_type='system',
            content=message_content,
            recipients=chat_recipients,
            is_private=is_private,
            meta={
                'reward_type': 'currency',
                'currency_changes': currency_changes,
                'source': source,
                'description': description,
                'character_ids': [char["id"] for char in pending_characters],
                'pending_characters': pending_characters,
                'claimed_by': [],
                'requires_claim': True
            }
        )
        db.add(chat_msg)
        await db.commit()
        await db.refresh(chat_msg)

        # Broadcast pending reward
        broadcast_msg = {
            "type": "reward_pending",
            "reward_type": "currency",
            "campaign_id": campaign_id,
            "message_id": chat_msg.id,
            "created_at": chat_msg.created_at.isoformat() if getattr(chat_msg, "created_at", None) else datetime.utcnow().isoformat(),
            "data": {
                "characters": pending_characters,
                "currency_changes": currency_changes,
                "changes_text": changes_text,
                "source": source,
                "description": description,
                "is_private": is_private,
                "awarded_by": dm_id,
                "claimed_by": [],
                "timestamp": datetime.utcnow().isoformat()
            }
        }

        if is_private:
            recipient_user_ids = [char["user_id"] for char in pending_characters]
            recipient_user_ids.append(dm_id)
            from app.services.websocket_manager import manager
            await manager.send_to_users(broadcast_msg, campaign_id, recipient_user_ids)
        else:
            await self.broadcast_to_campaign(broadcast_msg, campaign_id)

        print(f"[Reward] Created pending currency reward for {len(pending_characters)} characters")


class RewardClaimHandler(MessageHandler):
    """Handler for claiming pending rewards"""

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
        Handle reward claim messages

        Message format:
        {
            "type": "reward_claim",
            "data": {
                "message_id": 123,  // chat message ID containing the pending reward
                "character_id": 456  // character claiming the reward
            }
        }
        """
        data = message.get("data", {})
        message_id = data.get("message_id")
        character_id = data.get("character_id")
        # DM can claim on behalf of another user
        claim_user_id = data.get("claim_user_id") or user_id

        if not message_id or not character_id:
            await self.send_to_websocket({
                "type": "error",
                "message": "Missing message_id or character_id"
            }, websocket)
            return

        # Get the chat message with pending reward
        result = await db.execute(
            select(ChatMessage).where(ChatMessage.id == message_id)
        )
        chat_msg = result.scalar_one_or_none()

        if not chat_msg:
            await self.send_to_websocket({
                "type": "error",
                "message": "Reward not found"
            }, websocket)
            return

        meta = chat_msg.meta or {}
        if not meta.get('requires_claim'):
            await self.send_to_websocket({
                "type": "error",
                "message": "This reward does not require claiming"
            }, websocket)
            return

        # Check if target user already claimed
        claimed_by = meta.get('claimed_by', [])
        if claim_user_id in claimed_by:
            await self.send_to_websocket({
                "type": "error",
                "message": "This reward has already been claimed"
            }, websocket)
            return

        # Check if character is in pending list and belongs to target user
        pending_characters = meta.get('pending_characters', [])
        character_info = None
        for char in pending_characters:
            if char['id'] == character_id and char['user_id'] == claim_user_id:
                character_info = char
                break

        if not character_info:
            await self.send_to_websocket({
                "type": "error",
                "message": "Cannot claim this reward for this character"
            }, websocket)
            return

        # Get the character
        result = await db.execute(
            select(Character).where(Character.id == character_id)
        )
        character = result.scalar_one_or_none()

        if not character:
            await self.send_to_websocket({
                "type": "error",
                "message": "Character not found"
            }, websocket)
            return

        reward_type = meta.get('reward_type')
        dm_id = chat_msg.sender_user_id

        # Apply the reward
        if reward_type == 'xp':
            xp_amount = meta.get('amount', 0)
            old_xp = character.experience_points or 0
            new_xp = old_xp + xp_amount

            await db.execute(
                update(Character)
                .where(Character.id == character_id)
                .values(experience_points=new_xp)
            )

            # Create history entry
            history = RewardHistory(
                character_id=character_id,
                campaign_id=int(campaign_id),
                reward_type="xp",
                xp_amount=xp_amount,
                xp_source=meta.get('source', 'Manual'),
                description=meta.get('description', ''),
                is_private=chat_msg.is_private or False,
                awarded_by=dm_id
            )
            db.add(history)

        elif reward_type == 'currency':
            currency_changes = meta.get('currency_changes', {})
            old_currency = character.currency or {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}
            new_currency = old_currency.copy()

            for currency_type, amount in currency_changes.items():
                if currency_type in new_currency:
                    new_currency[currency_type] = max(0, new_currency[currency_type] + amount)

            await db.execute(
                update(Character)
                .where(Character.id == character_id)
                .values(currency=new_currency)
            )

            # Create history entry
            history = RewardHistory(
                character_id=character_id,
                campaign_id=int(campaign_id),
                reward_type="currency",
                currency_changes=currency_changes,
                currency_source=meta.get('source', 'Manual'),
                description=meta.get('description', ''),
                is_private=chat_msg.is_private or False,
                awarded_by=dm_id
            )
            db.add(history)

        # Update claimed_by in chat message meta
        claimed_by.append(claim_user_id)
        new_meta = {**meta, 'claimed_by': claimed_by}

        await db.execute(
            update(ChatMessage)
            .where(ChatMessage.id == message_id)
            .values(meta=new_meta)
        )

        await db.commit()

        # Refresh character to get updated values
        await db.refresh(character)

        # Broadcast claim update
        broadcast_msg = {
            "type": "reward_claimed",
            "campaign_id": campaign_id,
            "message_id": message_id,
            "data": {
                "user_id": claim_user_id,
                "character_id": character_id,
                "character_name": character.name,
                "reward_type": reward_type,
                "claimed_by": claimed_by,
                "timestamp": datetime.utcnow().isoformat()
            }
        }

        # Broadcast to all (so everyone sees who claimed)
        await self.broadcast_to_campaign(broadcast_msg, campaign_id)

        # Broadcast character update so UI refreshes
        await realtime_publisher.publish_character_updated(
            campaign_id,
            data={
                "character_id": character_id,
                "user_id": claim_user_id,
                "updates": {
                    "experience_points": character.experience_points,
                    "currency": character.currency,
                },
                "reason": f"reward_claimed_{reward_type}",
            },
        )

        print(f"[Reward] {character.name} claimed {reward_type} reward from message {message_id} (by {user_id})")
