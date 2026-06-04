"""add disguise_data to tokens

Revision ID: 5a2683fbf3c1
Revises: c0cf1d33541e
Create Date: 2026-03-10 18:20:16.616218

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '5a2683fbf3c1'
down_revision: Union[str, None] = 'c0cf1d33541e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tokens', sa.Column('disguise_data', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('tokens', 'disguise_data')
