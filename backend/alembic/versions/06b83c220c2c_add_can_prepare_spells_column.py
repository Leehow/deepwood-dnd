"""add can_prepare_spells column

Revision ID: 06b83c220c2c
Revises: a73e3f94fbef
Create Date: 2026-02-24

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '06b83c220c2c'
down_revision: Union[str, None] = 'a73e3f94fbef'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('characters', sa.Column('can_prepare_spells', sa.Boolean(), server_default='true', nullable=False))


def downgrade() -> None:
    op.drop_column('characters', 'can_prepare_spells')
