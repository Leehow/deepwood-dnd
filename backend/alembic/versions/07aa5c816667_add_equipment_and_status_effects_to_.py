"""add equipment and status_effects to monster_instances

Revision ID: 07aa5c816667
Revises: c8f4d2b1e591
Create Date: 2026-03-09 01:39:32.504102

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '07aa5c816667'
down_revision: Union[str, None] = 'c8f4d2b1e591'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('monster_instances', sa.Column('equipment', sa.JSON(), nullable=True))
    op.add_column('monster_instances', sa.Column('status_effects', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('monster_instances', 'status_effects')
    op.drop_column('monster_instances', 'equipment')
