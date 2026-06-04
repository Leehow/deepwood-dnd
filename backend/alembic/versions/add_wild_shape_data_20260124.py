"""Add wild_shape_data column to tokens table

Revision ID: add_wild_shape_data
Revises:
Create Date: 2026-01-24

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_wild_shape_data'
down_revision: Union[str, None] = 'update_embedding_dim'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add wild_shape_data column for druid wild shape transformation
    op.add_column('tokens', sa.Column('wild_shape_data', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('tokens', 'wild_shape_data')
