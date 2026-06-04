"""add user preferences jsonb column

Revision ID: add_user_preferences_20260125
Revises: add_module_embeddings_20260124
Create Date: 2026-01-25

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_user_preferences_20260125'
down_revision = 'add_module_embeddings_20260124'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add preferences JSONB column with default empty object
    op.execute(
        """
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}';
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS preferences;")
