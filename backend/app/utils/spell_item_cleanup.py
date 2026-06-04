"""
Cleanup spell-generated items when spell buff effects are removed.

When a spell with `has_generated_items=True` in its visual buff is removed
(manual, duration expiry, dispel, etc.), this utility removes the corresponding
items from the character's equipment.
"""
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.token import Token
from app.models.character import Character
from app.services.websocket_manager import manager

logger = logging.getLogger(__name__)


async def cleanup_spell_generated_items(
    db: AsyncSession,
    removed_effects: list[dict],
    token: Token,
    campaign_id: int | str,
) -> bool:
    """
    When spell buff effects are removed, delete any items they generated.
    Matches items by `spellGenerated=True` and `spellId` in character equipment.

    Returns True if any items were cleaned up.
    """
    if not token.character_id:
        return False

    # Collect spell_ids from removed spell_buff effects that have generated_items
    spell_ids = set()
    for eff in removed_effects:
        if eff.get("spell_buff") and eff.get("has_generated_items"):
            sid = eff.get("spell_id")
            if sid:
                spell_ids.add(sid)

    if not spell_ids:
        return False

    char = await db.get(Character, token.character_id)
    if not char or not char.equipment:
        return False

    equipment = list(char.equipment)
    new_equipment = [
        item for item in equipment
        if not (item.get("spellGenerated") and item.get("spellId") in spell_ids)
    ]

    removed_count = len(equipment) - len(new_equipment)
    if removed_count == 0:
        return False

    char.equipment = new_equipment
    flag_modified(char, "equipment")
    await db.flush()

    # Broadcast equipment update
    await manager.broadcast_to_campaign(
        {
            "type": "character_equipment_updated",
            "character_id": token.character_id,
            "equipment": new_equipment,
        },
        str(campaign_id),
    )
    logger.info(
        f"Cleaned up {removed_count} spell-generated item(s) "
        f"(spells: {spell_ids}) for character {token.character_id}"
    )
    return True
