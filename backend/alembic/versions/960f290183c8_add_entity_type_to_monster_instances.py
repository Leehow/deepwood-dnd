"""add entity_type to monster_instances

Revision ID: 960f290183c8
Revises: 2372be9dccf2
Create Date: 2026-01-16 15:48:08.216773

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '960f290183c8'
down_revision: Union[str, None] = '2372be9dccf2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add entity_type column to monster_instances table
    op.add_column('monster_instances', sa.Column('entity_type', sa.String(20), server_default='monster', nullable=True))


def downgrade() -> None:
    # Remove entity_type column from monster_instances table
    op.drop_column('monster_instances', 'entity_type')
