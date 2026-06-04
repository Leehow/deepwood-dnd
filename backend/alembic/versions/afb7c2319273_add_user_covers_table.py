"""add user_covers table

Revision ID: afb7c2319273
Revises: 1595152d8d46
Create Date: 2026-01-16 23:27:37.705404

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'afb7c2319273'
down_revision: Union[str, None] = '1595152d8d46'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create user_covers table
    op.create_table('user_covers',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.String(length=50), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('url', sa.Text(), nullable=False),
        sa.Column('thumbnail_url', sa.Text(), nullable=True),
        sa.Column('source_type', sa.String(length=50), nullable=True),
        sa.Column('source_module_id', sa.String(length=100), nullable=True),
        sa.Column('source_campaign_id', sa.Integer(), nullable=True),
        sa.Column('prompt', sa.Text(), nullable=True),
        sa.Column('extra_data', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_user_covers_id', 'user_covers', ['id'], unique=False)
    op.create_index('ix_user_covers_user_id', 'user_covers', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_user_covers_user_id', table_name='user_covers')
    op.drop_index('ix_user_covers_id', table_name='user_covers')
    op.drop_table('user_covers')
