"""add campaign_storage table with indexes

Revision ID: add_campaign_storage
Revises: add_campaigns_metadata_jsonb
Create Date: 2025-11-07 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'add_campaign_storage'
down_revision = 'add_campaigns_metadata_jsonb'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent table creation with FK and defaults
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS campaign_storage (
            id SERIAL PRIMARY KEY,
            campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
            object_type VARCHAR(50) NOT NULL,
            object_id VARCHAR(100) NOT NULL,
            object_name VARCHAR(200) NOT NULL,
            category VARCHAR(100),
            tags TEXT[] NULL,
            data JSONB NOT NULL,
            source VARCHAR(50) DEFAULT 'custom',
            source_id VARCHAR(100),
            visibility VARCHAR(20) DEFAULT 'dm_only',
            is_active BOOLEAN NOT NULL DEFAULT true,
            version INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ NULL,
            created_by VARCHAR(50) NOT NULL,
            updated_by VARCHAR(50)
        );
        """
    )

    # Ensure unique constraint exists
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'uq_campaign_storage_obj'
            ) THEN
                ALTER TABLE campaign_storage
                ADD CONSTRAINT uq_campaign_storage_obj UNIQUE (campaign_id, object_type, object_id);
            END IF;
        END $$;
        """
    )

    # Helpful indexes (idempotent)
    op.execute("CREATE INDEX IF NOT EXISTS ix_campaign_storage_campaign_type ON campaign_storage(campaign_id, object_type);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_campaign_storage_campaign_category ON campaign_storage(campaign_id, category);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_campaign_storage_tags ON campaign_storage USING GIN (tags);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_campaign_storage_data ON campaign_storage USING GIN (data);")


def downgrade() -> None:
    # Idempotent drops
    op.execute('DROP INDEX IF EXISTS ix_campaign_storage_data;')
    op.execute('DROP INDEX IF EXISTS ix_campaign_storage_tags;')
    op.execute('DROP INDEX IF EXISTS ix_campaign_storage_campaign_category;')
    op.execute('DROP INDEX IF EXISTS ix_campaign_storage_campaign_type;')
    op.execute("ALTER TABLE campaign_storage DROP CONSTRAINT IF EXISTS uq_campaign_storage_obj;")
    op.execute('DROP TABLE IF EXISTS campaign_storage;')

