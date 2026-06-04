from __future__ import annotations

from typing import Any

from app.db.session import async_session_maker
from app.models.monster_instance import MonsterInstance
from app.models.shop import Shop
from app.services.avatar_service import avatar_service
from app.services.realtime_publisher import realtime_publisher


async def _generate_entity_avatar_background(
    *,
    model: Any,
    entity_id: int,
    campaign_id: int,
    name: str,
    appearance: str,
    avatar_entity_type: str,
    broadcast_entity_type: str,
) -> None:
    async with async_session_maker() as db:
        entity = await db.get(model, entity_id)
        if not entity:
            return

        small_url, large_url = await avatar_service.generate_avatar(
            db=db,
            entity_type=avatar_entity_type,
            entity_id=entity_id,
            name=name,
            appearance=appearance,
        )

        entity.avatar_url = small_url
        entity.avatar_url_large = large_url
        entity.has_avatar = True
        await db.commit()

        await realtime_publisher.publish_avatar_generated(
            campaign_id,
            entity_type=broadcast_entity_type,
            entity_id=entity_id,
            avatar_url=large_url,
            has_avatar=True,
            name=name,
        )


async def generate_module_monster_avatar_background(
    monster_instance_id: int,
    campaign_id: int,
    name: str,
    appearance: str,
) -> None:
    await _generate_entity_avatar_background(
        model=MonsterInstance,
        entity_id=monster_instance_id,
        campaign_id=campaign_id,
        name=name,
        appearance=appearance,
        avatar_entity_type="monster",
        broadcast_entity_type="npc",
    )


async def generate_module_shop_avatar_background(
    shop_id: int,
    campaign_id: int,
    name: str,
    appearance: str,
) -> None:
    await _generate_entity_avatar_background(
        model=Shop,
        entity_id=shop_id,
        campaign_id=campaign_id,
        name=name,
        appearance=appearance,
        avatar_entity_type="shop",
        broadcast_entity_type="shop",
    )
