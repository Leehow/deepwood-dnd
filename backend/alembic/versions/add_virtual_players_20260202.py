"""add virtual player fields to campaign_members

Revision ID: f7e8d9c0b1a2
Revises: 694b5e7ab9d2
Create Date: 2026-02-02
"""
from alembic import op
import sqlalchemy as sa

revision = 'f7e8d9c0b1a2'
down_revision = '694b5e7ab9d2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('campaign_members', sa.Column('is_virtual', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('campaign_members', sa.Column('display_name', sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column('campaign_members', 'display_name')
    op.drop_column('campaign_members', 'is_virtual')
