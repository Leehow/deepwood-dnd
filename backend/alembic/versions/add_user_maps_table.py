"""add user_maps table for map library

Revision ID: add_user_maps_table
Revises:
Create Date: 2026-01-11

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'add_user_maps_table'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'user_maps',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.String(50), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('url', sa.Text(), nullable=False),
        sa.Column('thumbnail_url', sa.Text(), nullable=True),
        sa.Column('source_type', sa.String(50), default='manual'),
        sa.Column('source_module_id', sa.String(100), nullable=True),
        sa.Column('source_campaign_id', sa.Integer(), nullable=True),
        sa.Column('environment', sa.String(50), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('extra_data', postgresql.JSONB(astext_type=sa.Text()), default={}),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_user_maps_id', 'user_maps', ['id'])
    op.create_index('ix_user_maps_user_id', 'user_maps', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_user_maps_user_id', table_name='user_maps')
    op.drop_index('ix_user_maps_id', table_name='user_maps')
    op.drop_table('user_maps')
