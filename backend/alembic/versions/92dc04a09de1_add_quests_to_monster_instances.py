"""add quests to monster_instances

Revision ID: 92dc04a09de1
Revises: 960f290183c8
Create Date: 2026-01-16 16:24:28.592555

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '92dc04a09de1'
down_revision: Union[str, None] = '960f290183c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add quests column to monster_instances table
    op.add_column('monster_instances', sa.Column('quests', sa.JSON(), nullable=True))


def downgrade() -> None:
    # Remove quests column from monster_instances table
    op.drop_column('monster_instances', 'quests')
