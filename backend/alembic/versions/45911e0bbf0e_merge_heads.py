"""merge_heads

Revision ID: 45911e0bbf0e
Revises: add_aura_fields_20260124, add_wild_shape_data
Create Date: 2026-01-24 16:46:07.704480

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '45911e0bbf0e'
down_revision: Union[str, None] = ('add_aura_fields_20260124', 'add_wild_shape_data')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
