"""
Bulk map data endpoint - returns all map-related data in a single request.
Replaces 8+ individual API calls with one DB session.
"""
import logging
from typing import List, Optional, Any, Dict
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.core.dependencies import resolve_campaign_member_context
from app.core.security import require_auth
from app.db.session import get_db_readonly
from app.models.map_marker import MapMarker
from app.models.ai_map_marker import AIMapMarker
from app.models.drawing import Drawing
from app.models.ruler import Ruler
from app.models.fog_of_war import FogOfWar
from app.models.map_terrain import MapTerrain
from app.models.map_settings import MapSettings
from app.models.map_view_state import MapViewState
from app.models.token import Token
from app.models.character import Character
from app.models.monster_instance import MonsterInstance
from app.models.shop import Shop
from app.models.chest import Chest
from app.services.spell_runtime_service import build_token_spell_projection_map
from app.utils.classes import get_class_by_name
from app.utils.item_payload_normalizer import normalize_loot_bag_data, normalize_token_item_fields

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/campaigns", tags=["map-bulk-data"])


class MapBulkDataResponse(BaseModel):
    tokens: List[dict]
    fog: dict
    terrain: dict
    rulers: List[dict]
    drawings: List[dict]
    markers: List[dict]
    ai_markers: Optional[dict] = None
    map_settings: Optional[dict] = None
    view_state: Optional[dict] = None


def _resolve_item_token_avatar(item_data: dict | None) -> tuple[str | None, str | None]:
    if not item_data:
        return None, None

    avatar = item_data.get("icon") or item_data.get("avatar_url") or item_data.get("iconPath")
    avatar_large = item_data.get("avatar_url_large") or avatar

    if isinstance(avatar, str) and avatar.startswith("assets/"):
        avatar = f"/{avatar}"
    if isinstance(avatar_large, str) and avatar_large.startswith("assets/"):
        avatar_large = f"/{avatar_large}"

    return avatar, avatar_large


@router.get("/{campaign_id}/map-bulk-data")
async def get_map_bulk_data(
    campaign_id: int,
    map_url: str = Query(...),
    current_user: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db_readonly),
):
    """
    Return all map data in a single request, using one DB session.
    Replaces: tokens, fog-of-war, terrain, rulers, drawings, markers,
              ai-map-markers, map-settings, map-view-state
    """
    # Run all queries concurrently using asyncio.gather - they share the same session
    import asyncio
    context = await resolve_campaign_member_context(db, campaign_id, current_user)
    current_user_id = context.user_id

    async def fetch_tokens():
        result = await db.execute(
            select(Token).where(and_(
                Token.campaign_id == campaign_id,
                Token.map_url == map_url,
            ))
        )
        all_tokens = result.scalars().all()

        # Batch-load related entities to avoid N+1
        char_ids = {t.character_id for t in all_tokens if t.character_id}
        monster_ids = {t.monster_instance_id for t in all_tokens if t.monster_instance_id}
        shop_ids = {t.shop_id for t in all_tokens if t.shop_id}
        chest_ids = {t.chest_id for t in all_tokens if t.chest_id}

        chars, monsters, shops, chests = {}, {}, {}, {}
        if char_ids:
            r = await db.execute(select(Character).where(Character.id.in_(char_ids)))
            chars = {c.id: c for c in r.scalars().all()}
        if monster_ids:
            r = await db.execute(select(MonsterInstance).where(MonsterInstance.id.in_(monster_ids)))
            monsters = {m.id: m for m in r.scalars().all()}
        if shop_ids:
            r = await db.execute(select(Shop).where(Shop.id.in_(shop_ids)))
            shops = {s.id: s for s in r.scalars().all()}
        if chest_ids:
            r = await db.execute(select(Chest).where(Chest.id.in_(chest_ids)))
            chests = {ch.id: ch for ch in r.scalars().all()}
        projection_map = await build_token_spell_projection_map(
            db,
            campaign_id=campaign_id,
            token_ids=[token.id for token in all_tokens],
        )

        tokens_out = []
        for t in all_tokens:
            normalized_item_data, normalized_item_quantity, _ = normalize_token_item_fields(t.item_data, t.item_quantity)
            normalized_loot_bag_data, _ = normalize_loot_bag_data(t.loot_bag_data)
            td: Dict[str, Any] = {
                "id": t.id, "campaign_id": t.campaign_id,
                "character_id": t.character_id,
                "monster_instance_id": t.monster_instance_id,
                "item_data": normalized_item_data,
                "item_quantity": normalized_item_quantity if normalized_item_data is not None else t.item_quantity,
                "shop_id": t.shop_id, "chest_id": t.chest_id,
                "loot_bag_data": normalized_loot_bag_data,
                "user_id": t.user_id, "map_url": t.map_url,
                "position_x": t.position_x, "position_y": t.position_y,
                "token_size": t.token_size,
                "instance_name": t.instance_name,
                "current_hp": t.current_hp, "temp_hp": t.temp_hp,
                "active_effects": t.active_effects,
                "active_auras": t.active_auras,
                "faction": t.faction or "player",
                "concentration_spell": t.concentration_spell,
                "casting_in_progress": t.casting_in_progress,
                "transformation_data": t.transformation_data,
                "disguise_data": t.disguise_data,
            }

            if t.character_id and t.character_id in chars:
                c = chars[t.character_id]
                td["character_name"] = c.name
                td["character_race"] = c.race_id
                td["character_class"] = c.class_id
                td["character_level"] = c.level
                td["avatar"] = c.avatar
                td["avatar_large"] = c.avatar_large
                class_data = get_class_by_name(c.class_id)
                computed_max_hp = None
                if class_data:
                    hit_die_str = str(class_data.get("hitDie", 8))
                    hit_die = int(hit_die_str.replace("d", "")) if "d" in hit_die_str else int(hit_die_str)
                    con_mod = (c.ability_scores.get("constitution", 10) - 10) // 2 if c.ability_scores else 0
                    if c.level == 1:
                        computed_max_hp = hit_die + con_mod
                    else:
                        avg_per_level = (hit_die // 2) + 1
                        computed_max_hp = hit_die + con_mod + (c.level - 1) * (avg_per_level + con_mod)
                    td["max_hp"] = computed_max_hp
                if c.current_hp is not None:
                    td["current_hp"] = c.current_hp
                elif computed_max_hp is not None:
                    td["current_hp"] = computed_max_hp
            elif t.monster_instance_id and t.monster_instance_id in monsters:
                m = monsters[t.monster_instance_id]
                td["monster_name"] = m.name
                td["monster_name_cn"] = m.name_cn
                td["monster_type"] = m.type
                td["monster_size"] = m.size
                td["avatar"] = m.avatar_url
                td["avatar_large"] = m.avatar_url_large
                td["max_hp"] = m.hit_points
                td["controller_character_id"] = m.controller_character_id
                td["control_type"] = m.control_type
                td["entity_type"] = m.entity_type or ("npc" if (m.monster_data or {}).get("is_npc") else "monster")
            elif normalized_item_data:
                avatar, avatar_large = _resolve_item_token_avatar(normalized_item_data)
                td["avatar"] = avatar
                td["avatar_large"] = avatar_large
            elif t.shop_id and t.shop_id in shops:
                s = shops[t.shop_id]
                td["shop_name"] = s.name
                td["avatar"] = s.avatar_url
                td["avatar_large"] = s.avatar_url_large
            elif t.chest_id and t.chest_id in chests:
                ch = chests[t.chest_id]
                td["chest_name"] = ch.name
                td["chest_state"] = ch.state
                td["avatar"] = ch.avatar_url
                td["avatar_large"] = ch.avatar_url_large

            td.update(projection_map.get(t.id, {}))

            tokens_out.append(td)
        return tokens_out

    async def fetch_fog():
        r = await db.execute(select(FogOfWar).where(
            (FogOfWar.campaign_id == campaign_id) & (FogOfWar.map_url == map_url)
        ))
        rec = r.scalar_one_or_none()
        return {"mapUrl": map_url, "cells": rec.cells if rec else []}

    async def fetch_terrain():
        r = await db.execute(select(MapTerrain).where(
            (MapTerrain.campaign_id == campaign_id) & (MapTerrain.map_url == map_url)
        ))
        rec = r.scalar_one_or_none()
        return {"mapUrl": map_url, "cells": rec.cells if rec else []}

    async def fetch_rulers():
        r = await db.execute(select(Ruler).where(
            (Ruler.campaign_id == campaign_id) & (Ruler.map_url == map_url)
        ))
        return [
            {c.name: getattr(rec, c.name) for c in rec.__table__.columns}
            for rec in r.scalars().all()
        ]

    async def fetch_drawings():
        r = await db.execute(select(Drawing).where(
            (Drawing.campaign_id == campaign_id) & (Drawing.map_url == map_url)
        ))
        return [
            {c.name: getattr(rec, c.name) for c in rec.__table__.columns}
            for rec in r.scalars().all()
        ]

    async def fetch_markers():
        r = await db.execute(select(MapMarker).where(
            (MapMarker.campaign_id == campaign_id) & (MapMarker.map_url == map_url)
        ))
        return [
            {c.name: getattr(rec, c.name) for c in rec.__table__.columns}
            for rec in r.scalars().all()
        ]

    async def fetch_ai_markers():
        r = await db.execute(select(AIMapMarker).where(
            AIMapMarker.campaign_id == campaign_id,
            AIMapMarker.map_url == map_url,
        ))
        rec = r.scalar_one_or_none()
        if not rec:
            return None
        markers = getattr(rec, "markers", None)
        if markers is None:
            markers = getattr(rec, "markers_data", None)
        return {
            "campaign_id": rec.campaign_id,
            "map_url": rec.map_url,
            "markers": markers or [],
        }

    async def fetch_map_settings():
        r = await db.execute(select(MapSettings).where(
            (MapSettings.campaign_id == campaign_id) & (MapSettings.map_url == map_url)
        ))
        rec = r.scalar_one_or_none()
        if not rec:
            return None
        return {
            "id": rec.id, "campaign_id": rec.campaign_id,
            "map_url": rec.map_url, "scale": rec.scale,
            "grid_unit_length": rec.grid_unit_length,
            "anchor_x": rec.anchor_x, "anchor_y": rec.anchor_y,
            "global_terrain": rec.global_terrain,
        }

    async def fetch_view_state():
        if not current_user_id:
            return None
        r = await db.execute(
            select(MapViewState).where(and_(
                MapViewState.campaign_id == campaign_id,
                MapViewState.user_id == current_user_id,
                MapViewState.map_url == map_url,
            )).order_by(MapViewState.updated_at.desc())
        )
        rec = r.scalars().first()
        if not rec:
            return None
        return {
            "id": rec.id, "campaign_id": rec.campaign_id,
            "user_id": rec.user_id, "map_url": rec.map_url,
            "position_x": rec.position_x, "position_y": rec.position_y,
            "scale": rec.scale, "minimap_collapsed": rec.minimap_collapsed,
        }

    # Note: SQLAlchemy async sessions don't support true concurrent queries
    # on a single session, so we run them sequentially but in one session
    # (saving connection pool overhead of 8 separate sessions)
    tokens = await fetch_tokens()
    fog = await fetch_fog()
    terrain = await fetch_terrain()
    rulers = await fetch_rulers()
    drawings = await fetch_drawings()
    markers = await fetch_markers()
    ai_markers = await fetch_ai_markers()
    map_settings = await fetch_map_settings()
    view_state = await fetch_view_state()

    return {
        "tokens": tokens,
        "fog": fog,
        "terrain": terrain,
        "rulers": rulers,
        "drawings": drawings,
        "markers": markers,
        "ai_markers": ai_markers,
        "map_settings": map_settings,
        "view_state": view_state,
    }
