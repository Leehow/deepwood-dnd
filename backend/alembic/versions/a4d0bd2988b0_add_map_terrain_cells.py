"""add_map_terrain_cells

Revision ID: a4d0bd2988b0
Revises: 1fce4e86b373
Create Date: 2026-03-06 14:11:17.837958

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a4d0bd2988b0'
down_revision: Union[str, None] = '1fce4e86b373'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('map_terrain_cells',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('campaign_id', sa.Integer(), nullable=False),
        sa.Column('map_url', sa.String(length=1024), nullable=False),
        sa.Column('cells', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['campaign_id'], ['campaigns.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_map_terrain_cells_id'), 'map_terrain_cells', ['id'], unique=False)
    op.create_index(op.f('ix_map_terrain_cells_campaign_id'), 'map_terrain_cells', ['campaign_id'], unique=False)
    op.create_index('ix_terrain_campaign_map', 'map_terrain_cells', ['campaign_id', 'map_url'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_terrain_campaign_map', table_name='map_terrain_cells')
    op.drop_index(op.f('ix_map_terrain_cells_campaign_id'), table_name='map_terrain_cells')
    op.drop_index(op.f('ix_map_terrain_cells_id'), table_name='map_terrain_cells')
    op.drop_table('map_terrain_cells')
