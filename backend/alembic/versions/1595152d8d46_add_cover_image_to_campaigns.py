"""add_cover_image_to_campaigns

Revision ID: 1595152d8d46
Revises: 92dc04a09de1
Create Date: 2026-01-16 22:51:47.147718

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '1595152d8d46'
down_revision: Union[str, None] = '92dc04a09de1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('campaigns', sa.Column('cover_image', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('campaigns', 'cover_image')
