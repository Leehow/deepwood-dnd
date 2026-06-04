"""add campaign_storage_acl table

Revision ID: add_campaign_storage_acl2
Revises: add_campaign_storage
Create Date: 2025-11-07 00:12:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_campaign_storage_acl2'
down_revision = 'add_campaign_storage'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create table if not exists
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS campaign_storage_acl (
            id SERIAL PRIMARY KEY,
            storage_id INTEGER NOT NULL REFERENCES campaign_storage(id) ON DELETE CASCADE,
            user_id VARCHAR(50) NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        """
    )

    # Ensure unique constraint exists
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'uq_campaign_storage_acl_su'
            ) THEN
                ALTER TABLE campaign_storage_acl
                ADD CONSTRAINT uq_campaign_storage_acl_su UNIQUE (storage_id, user_id);
            END IF;
        END $$;
        """
    )

    # Ensure helpful indexes exist
    op.execute("CREATE INDEX IF NOT EXISTS ix_campaign_storage_acl_user ON campaign_storage_acl(user_id);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_campaign_storage_acl_storage ON campaign_storage_acl(storage_id);")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_campaign_storage_acl_storage;")
    op.execute("DROP INDEX IF EXISTS ix_campaign_storage_acl_user;")
    op.execute("ALTER TABLE campaign_storage_acl DROP CONSTRAINT IF EXISTS uq_campaign_storage_acl_su;")
    op.execute("DROP TABLE IF EXISTS campaign_storage_acl;")

