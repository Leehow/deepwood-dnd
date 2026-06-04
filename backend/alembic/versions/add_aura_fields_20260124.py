"""Add aura fields to tokens table

Revision ID: add_aura_fields_20260124
Revises: update_embedding_dim
Create Date: 2026-01-24

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSON

# revision identifiers, used by Alembic.
revision = 'add_aura_fields_20260124'
down_revision = 'update_embedding_dim'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add active_auras column
    op.add_column('tokens', sa.Column('active_auras', JSON, nullable=True))
    # Add faction column with default 'player'
    op.add_column('tokens', sa.Column('faction', sa.String(20), server_default='player', nullable=True))


def downgrade() -> None:
    op.drop_column('tokens', 'active_auras')
    op.drop_column('tokens', 'faction')
