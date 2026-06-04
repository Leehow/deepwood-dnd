"""add map_markers table

Revision ID: dce6c82fc975
Revises: add_analyzed_entities_20260110
Create Date: 2026-01-10 22:44:30.294986

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'dce6c82fc975'
down_revision: Union[str, None] = 'add_analyzed_entities_20260110'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('map_markers',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('campaign_id', sa.Integer(), nullable=False),
        sa.Column('map_url', sa.String(length=1024), nullable=False),
        sa.Column('position_x', sa.Float(), nullable=False),
        sa.Column('position_y', sa.Float(), nullable=False),
        sa.Column('icon', sa.String(length=20), nullable=True, server_default='📍'),
        sa.Column('label', sa.String(length=100), nullable=False),
        sa.Column('color', sa.String(length=20), nullable=True, server_default='#ef4444'),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('visible_to_players', sa.Integer(), nullable=True, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['campaign_id'], ['campaigns.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_map_markers_id', 'map_markers', ['id'], unique=False)
    op.create_index('ix_map_markers_campaign_id', 'map_markers', ['campaign_id'], unique=False)
    op.create_index('ix_campaign_map_markers', 'map_markers', ['campaign_id', 'map_url'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_campaign_map_markers', table_name='map_markers')
    op.drop_index('ix_map_markers_campaign_id', table_name='map_markers')
    op.drop_index('ix_map_markers_id', table_name='map_markers')
    op.drop_table('map_markers')
