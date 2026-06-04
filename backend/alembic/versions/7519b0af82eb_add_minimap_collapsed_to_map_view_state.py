"""add minimap_collapsed to map_view_state

Revision ID: 7519b0af82eb
Revises: add_campaign_templates_20260222
Create Date: 2026-02-22 23:41:05.044666

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '7519b0af82eb'
down_revision: Union[str, None] = 'add_campaign_templates_20260222'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('map_view_state', sa.Column('minimap_collapsed', sa.Boolean(), nullable=False, server_default=sa.text('false')))


def downgrade() -> None:
    op.drop_column('map_view_state', 'minimap_collapsed')
