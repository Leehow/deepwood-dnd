"""add avatar_url_large to models

Revision ID: 89349d5be2f1
Revises: d5d1917c662f
Create Date: 2026-01-08 00:35:21.130210

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '89349d5be2f1'
down_revision: Union[str, None] = 'd5d1917c662f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add avatar_url_large column to monster_instances
    op.add_column('monster_instances', sa.Column('avatar_url_large', sa.Text(), nullable=True))

    # Add avatar_url_large column to items
    op.add_column('items', sa.Column('avatar_url_large', sa.Text(), nullable=True))

    # Add avatar_url_large column to shops
    op.add_column('shops', sa.Column('avatar_url_large', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('shops', 'avatar_url_large')
    op.drop_column('items', 'avatar_url_large')
    op.drop_column('monster_instances', 'avatar_url_large')
