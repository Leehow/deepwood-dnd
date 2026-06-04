"""
Map and Token Handler
Handles map updates, token movements, and scale changes
"""
import logging
from typing import Dict, Any, List
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from .base import MessageHandler
from app.models.campaign import Campaign, CampaignMember
from app.models.token import Token
from app.models.character import Character
from app.services import aura_service

logger = logging.getLogger(__name__)


class MapHandler(MessageHandler):
    """Handler for map and token operations"""

    async def handle(
        self,
        message: Dict[str, Any],
        websocket: WebSocket,
        campaign_id: str,
        user_id: str,
        role: str,
        db: AsyncSession
    ) -> None:
        """Handle map-related messages.

        Supports:
        - map_update: General map changes
        - token_move: Token position updates
        - map_scale_update: Map zoom/scale changes
        - token_params_update: Token parameter table updates
        - token_hp_update: HP updates (pass-through rebroadcast; authoritative update still via REST)
        """

        message_type = message.get("type")
        data = message.get("data") or {}

        if message_type == "map_update":
            # Persist the current map URL to database if provided
            map_url = data.get("map_url")
            if map_url:
                await self._update_campaign_map(db, campaign_id, map_url)
                # Auto-create tokens for all players with selected characters
                await self._create_player_tokens(db, campaign_id, map_url)

            # Broadcast map changes to all
            payload_data = data
            await self.broadcast_to_campaign(
                {
                    "type": "map_update",
                    "data": {"user_id": user_id, **payload_data},
                },
                campaign_id,
            )

        elif message_type == "token_move":
            # Broadcast token movement
            token_id = data.get("token_id")
            position = data.get("position")
            map_url = data.get("map_url")
            await self.broadcast_to_campaign(
                {
                    "type": "token_move",
                    "data": {"user_id": user_id, "token_id": token_id, "position": position},
                },
                campaign_id,
            )

            # Trigger aura recalculation after token move
            if token_id and map_url:
                try:
                    await aura_service.on_token_move(
                        token_id, int(campaign_id), map_url, db
                    )
                except Exception as e:
                    logger.warning(f"Aura recalculation failed for token {token_id}: {e}")

        elif message_type == "map_scale_update":
            # Broadcast map scale/zoom changes
            payload_data = data
            await self.broadcast_to_campaign(
                {
                    "type": "map_scale_update",
                    "data": {"user_id": user_id, **payload_data},
                },
                campaign_id,
            )

        elif message_type == "grid_unit_update":
            # Broadcast grid unit length changes (e.g., feet-per-grid)
            payload_data = data
            await self.broadcast_to_campaign(
                {
                    "type": "grid_unit_update",
                    "data": {"user_id": user_id, **payload_data},
                },
                campaign_id,
            )

        elif message_type == "token_params_update":
            # Broadcast token parameter table changes
            token_id = data.get("token_id")
            params = data.get("params")
            await self.broadcast_to_campaign(
                {
                    "type": "token_params_update",
                    "data": {"user_id": user_id, "token_id": token_id, "params": params},
                },
                campaign_id,
            )

        elif message_type == "token_hp_update":
            # Pass-through rebroadcast to reduce unknown type errors when client optimistically broadcasts
            payload: Dict[str, Any] = {
                "type": "token_hp_update",
                "data": {
                    "user_id": user_id,
                    "token_id": data.get("token_id"),
                    "current_hp": data.get("current_hp"),
                },
            }
            for k in ("max_hp", "temp_hp", "character_id", "hp_change", "target_defeated", "monster_instance_id", "active_effects"):
                if k in data:
                    payload["data"][k] = data.get(k)
            await self.broadcast_to_campaign(payload, campaign_id)

        elif message_type == "roll_modifier_update":
            # Broadcast roll modifier (advantage/disadvantage) changes from DM to all clients
            # This allows players to see when DM sets advantage/disadvantage for their next roll
            token_id = data.get("token_id")
            modifier = data.get("modifier")  # 'advantage', 'disadvantage', or null
            await self.broadcast_to_campaign(
                {
                    "type": "roll_modifier_update",
                    "data": {
                        "user_id": user_id,
                        "token_id": token_id,
                        "modifier": modifier,
                    },
                },
                campaign_id,
            )

        elif message_type == "anchor_update":
            # Broadcast anchor point changes to all clients
            await self.broadcast_to_campaign(
                {
                    "type": "anchor_update",
                    "data": {
                        "user_id": user_id,
                        "map_url": data.get("map_url"),
                        "anchor_x": data.get("anchor_x"),
                        "anchor_y": data.get("anchor_y"),
                    },
                },
                campaign_id,
            )

    async def _update_campaign_map(
        self,
        db: AsyncSession,
        campaign_id: str,
        map_url: str
    ) -> None:
        """Persist the current map URL to the campaign record."""
        try:
            result = await db.execute(
                select(Campaign).where(Campaign.id == int(campaign_id))
            )
            campaign = result.scalar_one_or_none()
            if campaign:
                campaign.current_map_url = map_url
                await db.commit()
        except Exception as e:
            logger.warning(f"Failed to persist map URL for campaign {campaign_id}: {e}")

    async def _create_player_tokens(
        self,
        db: AsyncSession,
        campaign_id: str,
        map_url: str
    ) -> None:
        """Auto-create tokens for all players with characters on the new map."""
        try:
            # Get all player campaign members
            result = await db.execute(
                select(CampaignMember).where(
                    and_(
                        CampaignMember.campaign_id == int(campaign_id),
                        CampaignMember.role == "player"
                    )
                )
            )
            members = result.scalars().all()

            created_tokens: List[Dict[str, Any]] = []
            for member in members:
                character = None
                character_id = member.selected_character_id

                if character_id:
                    # 有选中的角色
                    char_result = await db.execute(
                        select(Character).where(Character.id == character_id)
                    )
                    character = char_result.scalar_one_or_none()
                else:
                    # 没有选中角色，查询该用户拥有的角色，取第一个
                    char_result = await db.execute(
                        select(Character)
                        .where(Character.user_id == member.user_id)
                        .order_by(Character.created_at.desc())
                        .limit(1)
                    )
                    character = char_result.scalar_one_or_none()
                    if character:
                        # 自动设置 selected_character_id
                        member.selected_character_id = character.id
                        member.character_name = character.name
                        character_id = character.id
                        logger.info(f"Auto-selected character {character.id} for user {member.user_id}")

                if not character:
                    continue

                # Check if token already exists for this character on this map
                existing = await db.execute(
                    select(Token).where(
                        and_(
                            Token.campaign_id == int(campaign_id),
                            Token.character_id == character_id,
                            Token.map_url == map_url
                        )
                    )
                )
                if existing.scalar_one_or_none():
                    continue

                # 获取当前地图已有token的位置，避免重叠
                existing_tokens_result = await db.execute(
                    select(Token.position_x, Token.position_y).where(
                        and_(
                            Token.campaign_id == int(campaign_id),
                            Token.map_url == map_url
                        )
                    )
                )
                used_positions = {(r.position_x, r.position_y) for r in existing_tokens_result.all()}
                # 也把本次循环已创建的token位置加入
                for t in created_tokens:
                    used_positions.add((t["position_x"], t["position_y"]))

                # 查询锚点作为 token 生成中心点
                from app.models.map_settings import MapSettings
                anchor_result = await db.execute(
                    select(MapSettings).where(
                        and_(
                            MapSettings.campaign_id == int(campaign_id),
                            MapSettings.map_url == map_url
                        )
                    )
                )
                anchor_settings = anchor_result.scalar_one_or_none()
                if anchor_settings and anchor_settings.anchor_x is not None and anchor_settings.anchor_y is not None:
                    center_x, center_y = anchor_settings.anchor_x, anchor_settings.anchor_y
                else:
                    center_x, center_y = 15, 10
                # 螺旋搜索偏移量
                deltas = [
                    (0, 0), (1, 0), (0, 1), (-1, 0), (0, -1),
                    (1, 1), (-1, 1), (1, -1), (-1, -1),
                    (2, 0), (0, 2), (-2, 0), (0, -2),
                    (2, 1), (1, 2), (-1, 2), (-2, 1), (-2, -1), (-1, -2), (1, -2), (2, -1),
                    (2, 2), (-2, 2), (2, -2), (-2, -2),
                    (3, 0), (0, 3), (-3, 0), (0, -3),
                ]
                pos_x, pos_y = center_x, center_y
                for dx, dy in deltas:
                    candidate = (center_x + dx, center_y + dy)
                    if candidate not in used_positions:
                        pos_x, pos_y = candidate
                        break

                # Create token at center position
                token = Token(
                    campaign_id=int(campaign_id),
                    character_id=character_id,
                    user_id=member.user_id,
                    map_url=map_url,
                    position_x=pos_x,
                    position_y=pos_y,
                    token_size="1x1",
                    instance_name=character.name
                )
                db.add(token)
                await db.flush()  # Get the token ID

                # Build token data for broadcast
                token_data = {
                    "id": token.id,
                    "campaign_id": token.campaign_id,
                    "character_id": token.character_id,
                    "user_id": token.user_id,
                    "map_url": token.map_url,
                    "position_x": token.position_x,
                    "position_y": token.position_y,
                    "token_size": token.token_size,
                    "instance_name": token.instance_name,
                    "character_name": character.name,
                    "character_race": character.race_id,
                    "character_class": character.class_id,
                    "character_level": character.level,
                    "avatar": character.avatar,
                    "avatar_large": character.avatar_large,
                }
                created_tokens.append(token_data)

                # Auto-create companion/familiar/mount tokens for this character
                from app.models.monster_instance import MonsterInstance
                companion_result = await db.execute(
                    select(MonsterInstance).where(and_(
                        MonsterInstance.campaign_id == int(campaign_id),
                        MonsterInstance.controller_character_id == character_id,
                        MonsterInstance.control_type.in_(["companion", "familiar", "mount"])
                    ))
                )
                for companion in companion_result.scalars().all():
                    # Check if companion token already exists on this map
                    existing_comp = await db.execute(
                        select(Token).where(and_(
                            Token.campaign_id == int(campaign_id),
                            Token.monster_instance_id == companion.id,
                            Token.map_url == map_url
                        ))
                    )
                    if existing_comp.scalar_one_or_none():
                        continue

                    # Refresh used positions
                    for t in created_tokens:
                        used_positions.add((t["position_x"], t["position_y"]))

                    # Spiral search near owner
                    comp_deltas = [
                        (1, 0), (0, 1), (-1, 0), (0, -1),
                        (1, 1), (-1, 1), (1, -1), (-1, -1),
                        (2, 0), (0, 2), (-2, 0), (0, -2),
                    ]
                    comp_x, comp_y = pos_x + 1, pos_y
                    for dx, dy in comp_deltas:
                        candidate = (pos_x + dx, pos_y + dy)
                        if candidate not in used_positions:
                            comp_x, comp_y = candidate
                            break

                    comp_token = Token(
                        campaign_id=int(campaign_id),
                        monster_instance_id=companion.id,
                        user_id=member.user_id,
                        map_url=map_url,
                        position_x=comp_x,
                        position_y=comp_y,
                        token_size=companion.token_size or "1x1",
                        instance_name=companion.name_cn or companion.name,
                        faction="player",
                    )
                    db.add(comp_token)
                    await db.flush()

                    comp_token_data = {
                        "id": comp_token.id,
                        "campaign_id": comp_token.campaign_id,
                        "monster_instance_id": companion.id,
                        "user_id": member.user_id,
                        "map_url": map_url,
                        "position_x": comp_x,
                        "position_y": comp_y,
                        "token_size": companion.token_size or "1x1",
                        "instance_name": companion.name_cn or companion.name,
                        "monster_name": companion.name,
                        "monster_name_cn": companion.name_cn,
                        "avatar": companion.avatar_url,
                        "avatar_large": companion.avatar_url_large,
                        "faction": "player",
                        "current_hp": companion.current_hp,
                        "max_hp": companion.hit_points,
                        "controller_character_id": companion.controller_character_id,
                        "control_type": companion.control_type,
                    }
                    created_tokens.append(comp_token_data)

            if created_tokens:
                await db.commit()
                logger.info(f"Auto-created {len(created_tokens)} player tokens for campaign {campaign_id} on map {map_url}")

                # Broadcast token_placed for each created token
                for token_data in created_tokens:
                    await self.broadcast_to_campaign(
                        {"type": "token_placed", "token": token_data},
                        campaign_id
                    )

        except Exception as e:
            logger.warning(f"Failed to create player tokens for campaign {campaign_id}: {e}")
