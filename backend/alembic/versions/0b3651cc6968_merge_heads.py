"""merge heads

Revision ID: 0b3651cc6968
Revises: add_user_maps_table, dce6c82fc975
Create Date: 2026-01-12 00:15:06.787257

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0b3651cc6968'
down_revision: Union[str, None] = ('add_user_maps_table', 'dce6c82fc975')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
