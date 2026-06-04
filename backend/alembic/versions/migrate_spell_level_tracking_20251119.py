"""migrate spell data to level tracking format

Revision ID: migrate_spell_level_tracking_20251119
Revises: add_character_spell_slots_state_20251114
Create Date: 2025-11-19

This migration converts selected_spells and selected_cantrips from simple arrays
to objects with level_learned tracking.
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "migrate_spell_level_tracking_20251119"
down_revision: Union[str, None] = "add_character_spell_slots_state_20251114"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Convert spell arrays from simple format to level-tracked format.

    Before: selected_spells = ["spell_1", "spell_2"]
    After:  selected_spells = [
              {"id": "spell_1", "level_learned": 1, "source": "migration"},
              {"id": "spell_2", "level_learned": 1, "source": "migration"}
            ]
    """
    connection = op.get_bind()

    # Get all characters with spells
    result = connection.execute(
        sa.text("SELECT id, selected_spells, selected_cantrips, class_id FROM characters")
    )

    for row in result:
        char_id = row[0]
        old_spells = row[1] or []
        old_cantrips = row[2] or []
        class_id = row[3] or "unknown"

        # Skip if already in new format
        if old_spells and len(old_spells) > 0:
            if isinstance(old_spells[0], dict):
                continue  # Already migrated

        # Convert spells to new format
        new_spells = []
        for spell_id in old_spells:
            if isinstance(spell_id, str):  # Only convert strings
                new_spells.append({
                    "id": spell_id,
                    "level_learned": 1,  # Conservative: assume learned at level 1
                    "source": class_id or "migration"
                })
            elif isinstance(spell_id, dict):  # Already in new format
                new_spells.append(spell_id)

        # Convert cantrips to new format
        new_cantrips = []
        for cantrip_id in old_cantrips:
            if isinstance(cantrip_id, str):
                new_cantrips.append({
                    "id": cantrip_id,
                    "level_learned": 1,
                    "source": class_id or "migration"
                })
            elif isinstance(cantrip_id, dict):
                new_cantrips.append(cantrip_id)

        # Update the character
        connection.execute(
            sa.text(
                "UPDATE characters SET selected_spells = :spells, selected_cantrips = :cantrips WHERE id = :id"
            ),
            {"spells": sa.JSON.NULL if not new_spells else new_spells,
             "cantrips": sa.JSON.NULL if not new_cantrips else new_cantrips,
             "id": char_id}
        )

    print(f"✅ Migrated spell data to level tracking format")


def downgrade() -> None:
    """
    Convert spell arrays back to simple format.

    Before: selected_spells = [{"id": "spell_1", "level_learned": 1, "source": "wizard"}]
    After:  selected_spells = ["spell_1"]
    """
    connection = op.get_bind()

    result = connection.execute(
        sa.text("SELECT id, selected_spells, selected_cantrips FROM characters")
    )

    for row in result:
        char_id = row[0]
        new_spells = row[1] or []
        new_cantrips = row[2] or []

        # Convert back to simple arrays
        old_spells = []
        for spell in new_spells:
            if isinstance(spell, dict):
                old_spells.append(spell.get("id"))
            else:
                old_spells.append(spell)

        old_cantrips = []
        for cantrip in new_cantrips:
            if isinstance(cantrip, dict):
                old_cantrips.append(cantrip.get("id"))
            else:
                old_cantrips.append(cantrip)

        # Update the character
        connection.execute(
            sa.text(
                "UPDATE characters SET selected_spells = :spells, selected_cantrips = :cantrips WHERE id = :id"
            ),
            {"spells": sa.JSON.NULL if not old_spells else old_spells,
             "cantrips": sa.JSON.NULL if not old_cantrips else old_cantrips,
             "id": char_id}
        )

    print(f"✅ Reverted spell data to simple format")
