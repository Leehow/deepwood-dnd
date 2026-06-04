"""add avatar_large to characters

Revision ID: d16139a978d2
Revises: 89349d5be2f1
Create Date: 2026-01-08 02:26:09.958180

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd16139a978d2'
down_revision: Union[str, None] = '89349d5be2f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('characters', sa.Column('avatar_large', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('characters', 'avatar_large')
