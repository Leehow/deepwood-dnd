"""Add anchor_x and anchor_y to map_settings

Revision ID: add_map_anchor_20260202
Revises: add_tts_20260202
Create Date: 2026-02-02

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_map_anchor_20260202'
down_revision = 'add_tts_20260202'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('map_settings', sa.Column('anchor_x', sa.Integer(), nullable=True))
    op.add_column('map_settings', sa.Column('anchor_y', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('map_settings', 'anchor_y')
    op.drop_column('map_settings', 'anchor_x')
