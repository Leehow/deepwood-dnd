"""add spell_slots_state to characters

Revision ID: add_character_spell_slots_state_20251114
Revises: add_character_current_hp_20251114
Create Date: 2025-11-14

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "add_character_spell_slots_state_20251114"
down_revision: Union[str, None] = "add_character_current_hp_20251114"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "characters",
        sa.Column("spell_slots_state", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("characters", "spell_slots_state")

