"""add global_terrain to map_settings

Revision ID: c0cf1d33541e
Revises: 4bbe896e8197
Create Date: 2026-03-10
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c0cf1d33541e'
down_revision: Union[str, None] = '4bbe896e8197'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('map_settings', sa.Column('global_terrain', sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column('map_settings', 'global_terrain')
