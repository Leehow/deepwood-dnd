"""add_maneuvers_known_to_character

Revision ID: 9db373c951bd
Revises: add_monster_inventory_lootbag
Create Date: 2026-01-20 12:14:31.576359

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '9db373c951bd'
down_revision: Union[str, None] = 'add_monster_inventory_lootbag'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add maneuvers_known column to characters table for Battle Master maneuvers
    op.add_column('characters', sa.Column('maneuvers_known', postgresql.JSON(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('characters', 'maneuvers_known')
