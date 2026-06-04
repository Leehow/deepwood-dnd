"""add quick_spells to characters

Revision ID: 2372be9dccf2
Revises: 04d91784b671
Create Date: 2026-01-16 15:30:29.314645

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '2372be9dccf2'
down_revision: Union[str, None] = '04d91784b671'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add quick_spells column to characters table
    op.add_column('characters', sa.Column('quick_spells', sa.JSON(), nullable=True))


def downgrade() -> None:
    # Remove quick_spells column from characters table
    op.drop_column('characters', 'quick_spells')
