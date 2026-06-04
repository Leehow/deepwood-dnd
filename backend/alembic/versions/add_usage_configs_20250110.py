"""Add usage_configs JSONB field to ai_api_settings

Revision ID: add_usage_configs_20250110
Revises:
Create Date: 2025-01-10
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers
revision = 'add_usage_configs_20250110'
down_revision = '46901da6bc5f'
branch_labels = None
depends_on = None


def upgrade():
    # Add usage_configs JSONB column with default empty object
    op.add_column(
        'ai_api_settings',
        sa.Column('usage_configs', JSONB, nullable=False, server_default='{}')
    )


def downgrade():
    op.drop_column('ai_api_settings', 'usage_configs')
