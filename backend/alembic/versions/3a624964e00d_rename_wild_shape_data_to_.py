"""rename wild_shape_data to transformation_data

Revision ID: 3a624964e00d
Revises: e2fbf7a0a544
Create Date: 2026-03-12 17:05:54.758319

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '3a624964e00d'
down_revision: Union[str, None] = 'e2fbf7a0a544'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('tokens', 'wild_shape_data',
                    new_column_name='transformation_data')


def downgrade() -> None:
    op.alter_column('tokens', 'transformation_data',
                    new_column_name='wild_shape_data')
