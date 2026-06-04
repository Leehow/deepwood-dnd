"""add_ai_map_markers_table_manual

Revision ID: 5d792d070ea0
Revises: bc19d34f7c98
Create Date: 2026-01-21 14:31:22.716307

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '5d792d070ea0'
down_revision: Union[str, None] = 'bc19d34f7c98'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('ai_map_markers',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('campaign_id', sa.Integer(), nullable=False),
        sa.Column('map_url', sa.String(length=1024), nullable=False),
        sa.Column('markers', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['campaign_id'], ['campaigns.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_ai_map_markers_id', 'ai_map_markers', ['id'], unique=False)
    op.create_index('ix_ai_map_markers_campaign_id', 'ai_map_markers', ['campaign_id'], unique=False)
    op.create_index('ix_campaign_ai_map_markers', 'ai_map_markers', ['campaign_id', 'map_url'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_campaign_ai_map_markers', table_name='ai_map_markers')
    op.drop_index('ix_ai_map_markers_campaign_id', table_name='ai_map_markers')
    op.drop_index('ix_ai_map_markers_id', table_name='ai_map_markers')
    op.drop_table('ai_map_markers')
