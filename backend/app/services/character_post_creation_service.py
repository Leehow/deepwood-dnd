"""
Character Post-Creation Service
Handles async post-processing after character creation:
- Equipment normalization (expand packs, standardize IDs)
- Avatar generation
- WebSocket notifications
"""
import asyncio
import logging
from typing import Any, Dict, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.character import Character
from app.models.user_avatar import UserAvatar
from app.services.websocket_manager import manager
from app.utils.item_payload_normalizer import normalize_character_equipment_payloads

logger = logging.getLogger(__name__)


async def process_character_post_creation(
    character_id: int,
    campaign_id: Optional[int],
    db_url: str
):
    """
    Async background task to process character after creation.
    Creates its own DB session since this runs in background.

    Args:
        character_id: The newly created character's ID
        campaign_id: Campaign ID for WebSocket broadcast (if any)
        db_url: Database URL to create new session
    """
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession as AS
    from sqlalchemy.orm import sessionmaker

    engine = create_async_engine(db_url, echo=False)
    async_session = sessionmaker(engine, class_=AS, expire_on_commit=False)

    async with async_session() as db:
        try:
            # Get character
            result = await db.execute(select(Character).where(Character.id == character_id))
            character = result.scalar_one_or_none()
            if not character:
                logger.warning("Post-creation target character %s not found", character_id)
                return

            logger.info(
                "Starting post-creation processing for character %s (%s)",
                character_id,
                character.name,
            )

            # 1. Equipment Normalization
            equipment_updated = False
            if character.equipment and len(character.equipment) > 0:
                try:
                    normalized_result = await normalize_equipment_async(db, character.equipment)
                    if normalized_result:
                        character.equipment = normalized_result['items']
                        # Add extracted currency
                        if normalized_result.get('currency_extracted'):
                            curr = character.currency or {}
                            for key in ['cp', 'sp', 'ep', 'gp', 'pp']:
                                curr[key] = (curr.get(key) or 0) + normalized_result['currency_extracted'].get(key, 0)
                            character.currency = curr
                        await db.commit()
                        equipment_updated = True
                        logger.info("Equipment normalized for character %s", character_id)
                except Exception:
                    logger.exception("Equipment normalization failed for character %s", character_id)

            # 2. Avatar Generation (only if no avatar yet)
            avatar_updated = False
            if not character.avatar:
                try:
                    avatar_result = await generate_avatar_async(db, character)
                    if avatar_result:
                        character.avatar = avatar_result[0]
                        character.avatar_large = avatar_result[1]
                        # Save to avatar library
                        if character.user_id:
                            existing = await db.execute(
                                select(UserAvatar).where(
                                    UserAvatar.user_id == character.user_id,
                                    UserAvatar.avatar_url == avatar_result[0]
                                )
                            )
                            if not existing.scalar_one_or_none():
                                db.add(UserAvatar(
                                    user_id=character.user_id,
                                    avatar_url=avatar_result[0],
                                    avatar_url_large=avatar_result[1],
                                ))
                        await db.commit()
                        avatar_updated = True
                        logger.info("Avatar generated for character %s", character_id)
                except Exception:
                    logger.exception("Avatar generation failed for character %s", character_id)

            # 3. WebSocket broadcast if anything changed
            if (equipment_updated or avatar_updated) and campaign_id:
                await manager.broadcast_to_campaign(
                    {
                        "type": "character_post_creation_complete",
                        "character_id": character_id,
                        "equipment_updated": equipment_updated,
                        "avatar_updated": avatar_updated,
                        "avatar": character.avatar,
                        "avatar_large": character.avatar_large,
                    },
                    campaign_id
                )
                logger.info("Post-creation broadcast sent to campaign %s", campaign_id)

            logger.info("Post-creation processing completed for character %s", character_id)

        except Exception:
            logger.exception("Post-creation processing failed for character %s", character_id)
        finally:
            await engine.dispose()


async def normalize_equipment_async(db: AsyncSession, equipment: list) -> Optional[Dict[str, Any]]:
    """
    Normalize equipment items (expand packs, standardize IDs, extract currency).
    Reuses logic from equipment.py route.
    """
    from app.utils.rules_cache import get_equipment_data as _get_eq
    import re

    # Load equipment data
    equipment_data = _get_eq()

    def get_all_valid_item_ids() -> set:
        valid_ids = set()
        # From adventuringGear
        for category, items in equipment_data.get("adventuringGear", {}).items():
            if isinstance(items, list):
                for item in items:
                    if isinstance(item, dict) and "id" in item:
                        valid_ids.add(item["id"])
        # From packs
        for pack in equipment_data.get("packs", []):
            if "id" in pack:
                valid_ids.add(pack["id"])
            for content in pack.get("contents", []):
                if "item" in content:
                    valid_ids.add(content["item"])
        # From armor
        for tier in ["light", "medium", "heavy", "shield"]:
            for item in equipment_data.get("armor", {}).get(tier, []):
                if isinstance(item, dict) and "id" in item:
                    valid_ids.add(item["id"])
        # From weapons
        for category in ["simple", "martial"]:
            cat_data = equipment_data.get("weapons", {}).get(category, {})
            for weapon_type in ["melee", "ranged"]:
                for weapon in cat_data.get(weapon_type, []):
                    if isinstance(weapon, dict) and "id" in weapon:
                        valid_ids.add(weapon["id"])
        # From tools (dict with subcategories)
        tools_data = equipment_data.get("tools", {})
        if isinstance(tools_data, dict):
            for category in ["artisansTools", "specializedTools", "gamingSets", "musicalInstruments"]:
                for item in tools_data.get(category, []):
                    if isinstance(item, dict) and "id" in item:
                        valid_ids.add(item["id"])
        # From backgroundItems
        bg_items = equipment_data.get("backgroundItems", [])
        if isinstance(bg_items, list):
            for item in bg_items:
                if isinstance(item, dict) and "id" in item:
                    valid_ids.add(item["id"])
        return valid_ids

    def get_item_metadata(item_id: str):
        normalized_id = item_id.lower().strip()
        # Check adventuringGear
        for category, items in equipment_data.get("adventuringGear", {}).items():
            if isinstance(items, list):
                for item in items:
                    if isinstance(item, dict) and item.get("id") == normalized_id:
                        return item
        # Check armor
        for tier in ["light", "medium", "heavy", "shield"]:
            for item in equipment_data.get("armor", {}).get(tier, []):
                if isinstance(item, dict) and item.get("id") == normalized_id:
                    return item
        # Check weapons
        for category in ["simple", "martial"]:
            cat_data = equipment_data.get("weapons", {}).get(category, {})
            for weapon_type in ["melee", "ranged"]:
                for weapon in cat_data.get(weapon_type, []):
                    if isinstance(weapon, dict) and weapon.get("id") == normalized_id:
                        return weapon
        # Check packs
        for pack in equipment_data.get("packs", []):
            if pack.get("id") == normalized_id:
                return pack
        # Check tools (dict with subcategories)
        tools_data = equipment_data.get("tools", {})
        if isinstance(tools_data, dict):
            for category in ["artisansTools", "specializedTools", "gamingSets", "musicalInstruments"]:
                for item in tools_data.get(category, []):
                    if isinstance(item, dict) and item.get("id") == normalized_id:
                        return item
        # Check backgroundItems (incense, vestments, etc.)
        bg_items = equipment_data.get("backgroundItems", [])
        if isinstance(bg_items, list):
            for item in bg_items:
                if isinstance(item, dict) and item.get("id") == normalized_id:
                    return item
        return None

    def get_pack_contents(pack_id: str):
        for pack in equipment_data.get("packs", []):
            if pack.get("id") == pack_id:
                return pack.get("contents", [])
        return []

    def normalize_item_id(item_id: str) -> str:
        mappings = {
            "leather_armor": "leather",
            "studded_leather_armor": "studded_leather",
            "chain_shirt_armor": "chain_shirt",
        }
        normalized = item_id.lower().strip()
        return mappings.get(normalized, normalized)

    valid_ids = get_all_valid_item_ids()
    normalized_items = []
    currency_extracted = {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}

    for item in equipment:
        item_id = item.get("id", "")
        normalized_id = normalize_item_id(item_id)

        # Check if it's a pack that needs expansion
        pack_contents = get_pack_contents(normalized_id)
        if pack_contents:
            # Find container in pack
            container_in_pack = None
            for content in pack_contents:
                content_id = content.get("item")
                if content_id in ["backpack", "pouch", "sack"]:
                    container_in_pack = content_id
                    break

            # Add container first
            if container_in_pack:
                container_meta = get_item_metadata(container_in_pack)
                container_item = {
                    "id": container_in_pack,
                    "name": container_meta.get("name", container_in_pack) if container_meta else container_in_pack,
                    "quantity": 1,
                    "equipped": False,
                }
                # Add full metadata for container
                if container_meta:
                    if container_meta.get("nameEn"):
                        container_item["nameEn"] = container_meta["nameEn"]
                    if container_meta.get("description"):
                        container_item["description"] = container_meta["description"]
                    if container_meta.get("iconPath"):
                        container_item["iconPath"] = container_meta["iconPath"]
                    if container_meta.get("weight") is not None:
                        container_item["weight"] = container_meta["weight"]
                    if container_meta.get("cost"):
                        container_item["cost"] = container_meta["cost"]
                normalized_items.append(container_item)

            # Add contents
            for content in pack_contents:
                content_id = content.get("item")
                if content_id == container_in_pack:
                    continue
                content_meta = get_item_metadata(content_id)
                expanded_item = {
                    "id": content_id,
                    "name": content_meta.get("name", content_id) if content_meta else content_id,
                    "quantity": content.get("quantity", 1) * item.get("quantity", 1),
                    "equipped": False,
                }
                # Add full metadata
                if content_meta:
                    if content_meta.get("nameEn"):
                        expanded_item["nameEn"] = content_meta["nameEn"]
                    if content_meta.get("description"):
                        expanded_item["description"] = content_meta["description"]
                    if content_meta.get("iconPath"):
                        expanded_item["iconPath"] = content_meta["iconPath"]
                    if content_meta.get("weight") is not None:
                        expanded_item["weight"] = content_meta["weight"]
                    if content_meta.get("cost"):
                        expanded_item["cost"] = content_meta["cost"]
                if container_in_pack:
                    expanded_item["containerId"] = container_in_pack
                normalized_items.append(expanded_item)
            continue

        # Check if normalized ID is valid
        if normalized_id in valid_ids:
            new_item = {**item, "id": normalized_id}
            meta = get_item_metadata(normalized_id)
            if meta:
                # Update name if needed
                current_name = new_item.get("name", "")
                is_english = all(ord(c) < 128 for c in current_name if c.isalpha())
                if not current_name or "_" in current_name or is_english:
                    if meta.get("name"):
                        new_item["name"] = meta["name"]
                # Add full metadata
                if meta.get("nameEn") and not new_item.get("nameEn"):
                    new_item["nameEn"] = meta["nameEn"]
                if meta.get("description") and not new_item.get("description"):
                    new_item["description"] = meta["description"]
                if meta.get("iconPath") and not new_item.get("iconPath"):
                    new_item["iconPath"] = meta["iconPath"]
                if meta.get("weight") is not None and new_item.get("weight") is None:
                    new_item["weight"] = meta["weight"]
                if meta.get("cost") and not new_item.get("cost"):
                    new_item["cost"] = meta["cost"]
                # Add weapon properties
                if meta.get("damage"):
                    new_item["damage"] = meta["damage"]
                if meta.get("damageType"):
                    new_item["damageType"] = meta["damageType"]
                if meta.get("properties"):
                    new_item["properties"] = meta["properties"]
                if meta.get("range"):
                    new_item["range"] = meta["range"]
                # Add armor properties
                if meta.get("ac"):
                    new_item["ac"] = meta["ac"]
                if meta.get("acFormula"):
                    new_item["acFormula"] = meta["acFormula"]
                if meta.get("acBonus"):
                    new_item["acBonus"] = meta["acBonus"]
            normalized_items.append(new_item)
            continue

        # Keep as-is if can't normalize
        normalized_items.append(item)

    normalized_items, extra_currency, _ = normalize_character_equipment_payloads(normalized_items)
    for coin_type, amount in extra_currency.items():
        currency_extracted[coin_type] = currency_extracted.get(coin_type, 0) + int(amount or 0)

    return {
        "items": normalized_items,
        "currency_extracted": currency_extracted,
    }


async def generate_avatar_async(db: AsyncSession, character: Character) -> Optional[tuple]:
    """
    Generate avatar for character using AvatarService.
    Returns (small_url, large_url) or None if failed.
    """
    from app.services.avatar_service import AvatarService

    avatar_service = AvatarService()

    # Build appearance description from character data
    appearance_parts = []
    if character.appearance:
        app = character.appearance
        if app.get("hair"):
            appearance_parts.append(f"头发: {app['hair']}")
        if app.get("eyes"):
            appearance_parts.append(f"眼睛: {app['eyes']}")
        if app.get("skin"):
            appearance_parts.append(f"肤色: {app['skin']}")
        if app.get("distinguishing_features"):
            appearance_parts.append(app["distinguishing_features"])

    appearance = ", ".join(appearance_parts) if appearance_parts else ""

    # Get race and class names for better prompt
    description_parts = []
    if character.race_id:
        description_parts.append(f"Race: {character.race_id}")
    if character.class_id:
        description_parts.append(f"Class: {character.class_id}")

    # Load race visual description from avatar-descriptions.json
    try:
        from app.api.routes.ai_settings import _get_race_avatar_description
        race_visual = _get_race_avatar_description(
            character.race_id or "", character.subrace_id if hasattr(character, 'subrace_id') else None
        )
        if race_visual:
            description_parts.append(f"IMPORTANT race features: {race_visual}")
    except Exception:
        pass

    description = ", ".join(description_parts)

    try:
        result = await avatar_service.generate_avatar(
            db=db,
            entity_type='character',
            entity_id=character.id,
            name=character.name,
            description=description,
            appearance=appearance,
            usage_key="avatar_player",
            generate_appearance_with_ai=not appearance,  # Generate if no appearance provided
        )
        return result
    except Exception as e:
        print(f"[PostCreation] Avatar generation error: {e}", flush=True)
        return None
