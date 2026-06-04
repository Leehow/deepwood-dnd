"""add_favored_humanoid_races_column

Revision ID: 944ab818333d
Revises: add_hotbar_column_20260224
Create Date: 2026-02-24 16:40:07.575466

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '944ab818333d'
down_revision: Union[str, None] = 'add_hotbar_column_20260224'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('characters', sa.Column('favored_humanoid_races', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('characters', 'favored_humanoid_races')
