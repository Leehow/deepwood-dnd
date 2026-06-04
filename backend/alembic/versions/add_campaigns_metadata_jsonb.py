"""add campaigns.metadata JSONB column with GIN index

Revision ID: add_campaigns_metadata_jsonb
Revises: add_selected_character
Create Date: 2025-11-06 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'add_campaigns_metadata_jsonb'
down_revision = 'add_selected_character'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: add column and index only if not exists
    op.execute("""
    ALTER TABLE campaigns
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
    """)

    op.execute("""
    CREATE INDEX IF NOT EXISTS ix_campaigns_metadata
    ON campaigns USING GIN (metadata);
    """)


def downgrade() -> None:
    # Idempotent drops (safe if already absent)
    op.execute("DROP INDEX IF EXISTS ix_campaigns_metadata;")
    op.execute("ALTER TABLE campaigns DROP COLUMN IF EXISTS metadata;")

