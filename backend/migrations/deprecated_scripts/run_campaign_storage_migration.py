"""
Run DDL to create campaign_storage and campaign_storage_acl tables (idempotent).

Usage:
    cd backend
    python migrations/run_campaign_storage_migration.py

This script aligns database schema with:
- app.models.campaign_storage.CampaignStorage
- app.models.campaign_storage_acl.CampaignStorageACL
"""
import asyncio
import sys
from pathlib import Path
# Ensure backend package on path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import os
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

DDL_STEPS = [
    # Create campaign_storage table if not exists (matches ORM model)
    text(
        """
        CREATE TABLE IF NOT EXISTS campaign_storage (
            id SERIAL PRIMARY KEY,
            campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,

            -- Object identification
            object_type VARCHAR(50) NOT NULL,
            object_id VARCHAR(100) NOT NULL,
            object_name VARCHAR(200) NOT NULL,

            -- Categorization
            category VARCHAR(100),
            tags TEXT[],

            -- Flexible data
            data JSONB NOT NULL,

            -- Metadata
            source VARCHAR(50) DEFAULT 'custom',
            source_id VARCHAR(100),
            visibility VARCHAR(20) DEFAULT 'dm_only'
                CHECK (visibility IN ('dm_only', 'all_players', 'specific_players')),

            -- State tracking
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            version INTEGER NOT NULL DEFAULT 1,

            -- Timestamps & audit
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ,
            created_by VARCHAR(50) NOT NULL,
            updated_by VARCHAR(50)
        );
        """
    ),
    # Add unique constraint if missing
    text(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints tc
                WHERE tc.table_name = 'campaign_storage'
                  AND tc.constraint_type = 'UNIQUE'
                  AND tc.constraint_name = 'uq_campaign_storage_obj'
            ) THEN
                ALTER TABLE campaign_storage
                ADD CONSTRAINT uq_campaign_storage_obj UNIQUE (campaign_id, object_type, object_id);
            END IF;
        END$$;
        """
    ),
    # Indexes for campaign_storage
    text("CREATE INDEX IF NOT EXISTS ix_campaign_storage_campaign_type ON campaign_storage(campaign_id, object_type);"),
    text("CREATE INDEX IF NOT EXISTS ix_campaign_storage_campaign_category ON campaign_storage(campaign_id, category);"),
    text("CREATE INDEX IF NOT EXISTS ix_campaign_storage_tags ON campaign_storage USING GIN(tags);") ,
    text("CREATE INDEX IF NOT EXISTS ix_campaign_storage_data ON campaign_storage USING GIN(data);") ,

    # Create campaign_storage_acl table if not exists
    text(
        """
        CREATE TABLE IF NOT EXISTS campaign_storage_acl (
            id SERIAL PRIMARY KEY,
            storage_id INTEGER NOT NULL REFERENCES campaign_storage(id) ON DELETE CASCADE,
            user_id VARCHAR(50) NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        """
    ),
    # Add unique constraint on (storage_id, user_id)
    text(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints tc
                WHERE tc.table_name = 'campaign_storage_acl'
                  AND tc.constraint_type = 'UNIQUE'
                  AND tc.constraint_name = 'uq_campaign_storage_acl_su'
            ) THEN
                ALTER TABLE campaign_storage_acl
                ADD CONSTRAINT uq_campaign_storage_acl_su UNIQUE (storage_id, user_id);
            END IF;
        END$$;
        """
    ),
    # Indexes for campaign_storage_acl
    text("CREATE INDEX IF NOT EXISTS ix_campaign_storage_acl_user ON campaign_storage_acl(user_id);"),
    text("CREATE INDEX IF NOT EXISTS ix_campaign_storage_acl_storage ON campaign_storage_acl(storage_id);")
]

VERIFY_QUERIES = [
    ("campaign_storage columns", text(
        """
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'campaign_storage'
        ORDER BY ordinal_position;
        """
    )),
    ("campaign_storage indexes", text(
        """
        SELECT indexname FROM pg_indexes WHERE tablename = 'campaign_storage' ORDER BY indexname;
        """
    )),
    ("campaign_storage_acl columns", text(
        """
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'campaign_storage_acl'
        ORDER BY ordinal_position;
        """
    )),
    ("campaign_storage_acl indexes", text(
        """
        SELECT indexname FROM pg_indexes WHERE tablename = 'campaign_storage_acl' ORDER BY indexname;
        """
    )),
]

async def main():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL env var is required to run this migration")

    engine = create_async_engine(database_url, echo=False, future=True)
    async with engine.begin() as conn:
        try:
            print("Running DDL for campaign_storage and campaign_storage_acl...")
            print("=" * 80)
            for i, ddl in enumerate(DDL_STEPS, 1):
                print(f"Step {i}/{len(DDL_STEPS)}: executing...")
                await conn.execute(ddl)
            print("✅ DDL applied successfully")

            print("\nVerifying schema...")
            print("-" * 80)
            for title, query in VERIFY_QUERIES:
                print(f"\n{title}:")
                res = await conn.execute(query)
                rows = res.fetchall()
                if not rows:
                    print("  (no rows)")
                else:
                    for r in rows:
                        print("  ", tuple(r))
            print("=" * 80)
        except Exception as e:
            print(f"❌ Migration failed: {e}")
            raise
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())

