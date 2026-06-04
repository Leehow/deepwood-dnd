"""add_active_effects_and_class_feature_uses

Revision ID: 6b1683639c9a
Revises: change_feature_columns_to_json
Create Date: 2026-01-19 17:04:24.505880

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '6b1683639c9a'
down_revision: Union[str, None] = 'change_feature_columns_to_json'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add active_effects column to tokens table
    op.add_column('tokens', sa.Column('active_effects', sa.JSON(), nullable=True))

    # Add class_feature_uses column to characters table
    op.add_column('characters', sa.Column('class_feature_uses', sa.JSON(), nullable=True))


def downgrade() -> None:
    # Remove columns
    op.drop_column('tokens', 'active_effects')
    op.drop_column('characters', 'class_feature_uses')
