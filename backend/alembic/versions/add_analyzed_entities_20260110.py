"""Add analyzed_entities JSONB field to module_chat_messages

Revision ID: add_analyzed_entities_20260110
Revises: add_usage_configs_20250110
Create Date: 2026-01-10
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers
revision = 'add_analyzed_entities_20260110'
down_revision = 'add_usage_configs_20250110'
branch_labels = None
depends_on = None


def upgrade():
    # Add analyzed_entities JSONB column for caching entity analysis results
    op.add_column(
        'module_chat_messages',
        sa.Column('analyzed_entities', JSONB, nullable=True)
    )


def downgrade():
    op.drop_column('module_chat_messages', 'analyzed_entities')
