"""add_death_saves_to_tokens

Revision ID: 1fce4e86b373
Revises: add_temp_hp_to_tokens_20260227
Create Date: 2026-03-01 00:41:54.652542

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1fce4e86b373'
down_revision: Union[str, None] = 'add_temp_hp_to_tokens_20260227'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tokens', sa.Column('death_saves', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('tokens', 'death_saves')
