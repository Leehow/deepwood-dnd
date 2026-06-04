"""
Database migration to add flexible campaign storage tables.

Usage:
    cd backend
    python migrations/add_flexible_campaign_storage.py
"""

import asyncio
import sys
from pathlib import Path
from datetime import datetime

# Add parent directory to path to import app modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text
from app.db.session import async_session_maker


async def run_migration():
    """Run the migration to add flexible campaign storage tables."""

    migration_steps = [
        # Step 1: Update campaigns table - add new columns
        """
        DO $$
        BEGIN
            -- Add campaign_code column if not exists
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'campaigns'
                AND column_name = 'campaign_code'
            ) THEN
                ALTER TABLE campaigns
                ADD COLUMN campaign_code VARCHAR(10) UNIQUE;

                -- Generate unique codes for existing campaigns
                UPDATE campaigns
                SET campaign_code = UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 6))
                WHERE campaign_code IS NULL;

                ALTER TABLE campaigns ALTER COLUMN campaign_code SET NOT NULL;

                RAISE NOTICE 'Column campaign_code added to campaigns';
            END IF;

            -- Add visibility column
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'campaigns'
                AND column_name = 'visibility'
            ) THEN
                ALTER TABLE campaigns
                ADD COLUMN visibility VARCHAR(20) DEFAULT 'private'
                CHECK (visibility IN ('public', 'private', 'friends_only'));

                RAISE NOTICE 'Column visibility added to campaigns';
            END IF;

            -- Add rule_system column
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'campaigns'
                AND column_name = 'rule_system'
            ) THEN
                ALTER TABLE campaigns
                ADD COLUMN rule_system VARCHAR(50) DEFAULT 'dnd_5e';

                RAISE NOTICE 'Column rule_system added to campaigns';
            END IF;

            -- Add primary_module_id column
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'campaigns'
                AND column_name = 'primary_module_id'
            ) THEN
                ALTER TABLE campaigns
                ADD COLUMN primary_module_id VARCHAR(100);

                RAISE NOTICE 'Column primary_module_id added to campaigns';
            END IF;

            -- Add module_config column
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'campaigns'
                AND column_name = 'module_config'
            ) THEN
                ALTER TABLE campaigns
                ADD COLUMN module_config JSONB DEFAULT '{}';

                RAISE NOTICE 'Column module_config added to campaigns';
            END IF;

            -- Add game_settings column
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'campaigns'
                AND column_name = 'game_settings'
            ) THEN
                ALTER TABLE campaigns
                ADD COLUMN game_settings JSONB DEFAULT '{}';

                RAISE NOTICE 'Column game_settings added to campaigns';
            END IF;

            -- Add world_state column
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'campaigns'
                AND column_name = 'world_state'
            ) THEN
                ALTER TABLE campaigns
                ADD COLUMN world_state JSONB DEFAULT '{}';

                RAISE NOTICE 'Column world_state added to campaigns';
            END IF;

            -- Add campaign_data column
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'campaigns'
                AND column_name = 'campaign_data'
            ) THEN
                ALTER TABLE campaigns
                ADD COLUMN campaign_data JSONB DEFAULT '{}';

                RAISE NOTICE 'Column campaign_data added to campaigns';
            END IF;
        END $$;
        """,

        # Step 2: Create campaign_storage table
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

            -- Data storage
            data JSONB NOT NULL,

            -- Metadata
            source VARCHAR(50) DEFAULT 'custom',
            source_id VARCHAR(100),
            visibility VARCHAR(20) DEFAULT 'dm_only'
                CHECK (visibility IN ('dm_only', 'all_players', 'specific_players')),

            -- State tracking
            is_active BOOLEAN DEFAULT true,
            version INTEGER DEFAULT 1,

            -- Timestamps
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            created_by VARCHAR(50) NOT NULL,
            updated_by VARCHAR(50),

            -- Unique constraint
            UNIQUE (campaign_id, object_type, object_id)
        );
        """,

        # Step 3: Create indexes for campaign_storage
        """
        DO $$
        BEGIN
            -- Index for campaign + type queries
            IF NOT EXISTS (
                SELECT 1 FROM pg_indexes
                WHERE indexname = 'idx_campaign_type'
            ) THEN
                CREATE INDEX idx_campaign_type ON campaign_storage(campaign_id, object_type);
                RAISE NOTICE 'Index idx_campaign_type created';
            END IF;

            -- Index for campaign + category queries
            IF NOT EXISTS (
                SELECT 1 FROM pg_indexes
                WHERE indexname = 'idx_campaign_category'
            ) THEN
                CREATE INDEX idx_campaign_category ON campaign_storage(campaign_id, category);
                RAISE NOTICE 'Index idx_campaign_category created';
            END IF;

            -- GIN index for tags array
            IF NOT EXISTS (
                SELECT 1 FROM pg_indexes
                WHERE indexname = 'idx_storage_tags'
            ) THEN
                CREATE INDEX idx_storage_tags ON campaign_storage USING GIN(tags);
                RAISE NOTICE 'Index idx_storage_tags created';
            END IF;

            -- GIN index for JSONB data
            IF NOT EXISTS (
                SELECT 1 FROM pg_indexes
                WHERE indexname = 'idx_storage_data'
            ) THEN
                CREATE INDEX idx_storage_data ON campaign_storage USING GIN(data);
                RAISE NOTICE 'Index idx_storage_data created';
            END IF;
        END $$;
        """,

        # Step 4: Create campaign_sessions table
        """
        CREATE TABLE IF NOT EXISTS campaign_sessions (
            id SERIAL PRIMARY KEY,
            campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
            session_number INTEGER NOT NULL,

            -- Session info
            title VARCHAR(200),
            scheduled_at TIMESTAMPTZ,
            started_at TIMESTAMPTZ,
            ended_at TIMESTAMPTZ,
            duration_minutes INTEGER,

            -- Session data
            summary TEXT,
            notes JSONB DEFAULT '{}',
            events JSONB DEFAULT '[]',

            -- Game state snapshots
            world_state_snapshot JSONB,
            character_states JSONB,

            -- Participants
            participants JSONB DEFAULT '[]',

            -- Timestamps
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        """,

        # Step 5: Create index for campaign_sessions
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_indexes
                WHERE indexname = 'idx_campaign_session'
            ) THEN
                CREATE INDEX idx_campaign_session ON campaign_sessions(campaign_id, session_number);
                RAISE NOTICE 'Index idx_campaign_session created';
            END IF;
        END $$;
        """,

        # Step 6: Create campaign_changelog table
        """
        CREATE TABLE IF NOT EXISTS campaign_changelog (
            id SERIAL PRIMARY KEY,
            campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,

            -- Change info
            change_type VARCHAR(50) NOT NULL,
            object_type VARCHAR(50),
            object_id VARCHAR(100),

            -- Change details
            change_data JSONB NOT NULL,
            previous_data JSONB,

            -- Metadata
            user_id VARCHAR(50) NOT NULL,
            user_role VARCHAR(20),
            session_id INTEGER REFERENCES campaign_sessions(id),

            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        """,

        # Step 7: Create indexes for campaign_changelog
        """
        DO $$
        BEGIN
            -- Index for campaign + time queries
            IF NOT EXISTS (
                SELECT 1 FROM pg_indexes
                WHERE indexname = 'idx_campaign_time'
            ) THEN
                CREATE INDEX idx_campaign_time ON campaign_changelog(campaign_id, created_at DESC);
                RAISE NOTICE 'Index idx_campaign_time created';
            END IF;

            -- Index for object queries
            IF NOT EXISTS (
                SELECT 1 FROM pg_indexes
                WHERE indexname = 'idx_changelog_object'
            ) THEN
                CREATE INDEX idx_changelog_object ON campaign_changelog(campaign_id, object_type, object_id);
                RAISE NOTICE 'Index idx_changelog_object created';
            END IF;
        END $$;
        """,

        # Step 8: Create specialized indexes for common queries
        """
        DO $$
        BEGIN
            -- Index for NPC location queries
            IF NOT EXISTS (
                SELECT 1 FROM pg_indexes
                WHERE indexname = 'idx_npc_location'
            ) THEN
                CREATE INDEX idx_npc_location ON campaign_storage((data->'current_state'->>'location'))
                WHERE object_type = 'npc';
                RAISE NOTICE 'Index idx_npc_location created';
            END IF;

            -- Index for quest status queries
            IF NOT EXISTS (
                SELECT 1 FROM pg_indexes
                WHERE indexname = 'idx_quest_status'
            ) THEN
                CREATE INDEX idx_quest_status ON campaign_storage((data->'stages'->0->>'status'))
                WHERE object_type = 'quest';
                RAISE NOTICE 'Index idx_quest_status created';
            END IF;

            -- Index for item rarity queries
            IF NOT EXISTS (
                SELECT 1 FROM pg_indexes
                WHERE indexname = 'idx_item_rarity'
            ) THEN
                CREATE INDEX idx_item_rarity ON campaign_storage((data->'properties'->>'rarity'))
                WHERE object_type = 'item';
                RAISE NOTICE 'Index idx_item_rarity created';
            END IF;
        END $$;
        """,

        # Step 9: Add indexes for campaigns table
        """
        DO $$
        BEGIN
            -- Index for campaign_code
            IF NOT EXISTS (
                SELECT 1 FROM pg_indexes
                WHERE indexname = 'idx_campaign_code'
            ) THEN
                CREATE UNIQUE INDEX idx_campaign_code ON campaigns(campaign_code);
                RAISE NOTICE 'Index idx_campaign_code created';
            END IF;

            -- Index for status
            IF NOT EXISTS (
                SELECT 1 FROM pg_indexes
                WHERE indexname = 'idx_campaign_status'
            ) THEN
                CREATE INDEX idx_campaign_status ON campaigns(status);
                RAISE NOTICE 'Index idx_campaign_status created';
            END IF;
        END $$;
        """
    ]

    async with async_session_maker() as db:
        try:
            print("Running database migration for flexible campaign storage...")
            print("=" * 60)

            # Execute each step
            for i, sql in enumerate(migration_steps, 1):
                print(f"Step {i}/{len(migration_steps)}: Executing migration step...")
                await db.execute(text(sql))

            await db.commit()

            print("✅ Migration completed successfully!")
            print("=" * 60)

        except Exception as e:
            print(f"❌ Migration failed: {e}")
            await db.rollback()
            raise


async def verify_schema():
    """Verify the new schema was created correctly."""

    verify_queries = [
        ("campaigns", """
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'campaigns'
            AND column_name IN ('campaign_code', 'visibility', 'rule_system',
                              'primary_module_id', 'module_config', 'game_settings',
                              'world_state', 'campaign_data')
            ORDER BY ordinal_position;
        """),

        ("campaign_storage", """
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'campaign_storage'
            ORDER BY ordinal_position;
        """),

        ("campaign_sessions", """
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'campaign_sessions'
            ORDER BY ordinal_position;
        """),

        ("campaign_changelog", """
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'campaign_changelog'
            ORDER BY ordinal_position;
        """),

        ("indexes", """
            SELECT tablename, indexname
            FROM pg_indexes
            WHERE tablename IN ('campaigns', 'campaign_storage', 'campaign_sessions', 'campaign_changelog')
            ORDER BY tablename, indexname;
        """)
    ]

    async with async_session_maker() as db:
        print("\nVerifying schema changes:")
        print("=" * 60)

        for table_name, query in verify_queries:
            print(f"\n📋 {table_name}:")
            print("-" * 40)

            result = await db.execute(text(query))
            rows = result.fetchall()

            if not rows:
                print(f"  ⚠️  No data found for {table_name}")
            else:
                for row in rows:
                    if table_name == "indexes":
                        print(f"  {row[0]:<30} {row[1]}")
                    else:
                        nullable = 'NULL' if row[2] == 'YES' else 'NOT NULL'
                        print(f"  {row[0]:<30} {row[1]:<20} {nullable}")

        print("=" * 60)


async def rollback_migration():
    """Rollback the migration if needed."""

    rollback_steps = [
        "DROP TABLE IF EXISTS campaign_changelog CASCADE;",
        "DROP TABLE IF EXISTS campaign_sessions CASCADE;",
        "DROP TABLE IF EXISTS campaign_storage CASCADE;",
        """
        ALTER TABLE campaigns
        DROP COLUMN IF EXISTS campaign_code,
        DROP COLUMN IF EXISTS visibility,
        DROP COLUMN IF EXISTS rule_system,
        DROP COLUMN IF EXISTS primary_module_id,
        DROP COLUMN IF EXISTS module_config,
        DROP COLUMN IF EXISTS game_settings,
        DROP COLUMN IF EXISTS world_state,
        DROP COLUMN IF EXISTS campaign_data;
        """
    ]

    async with async_session_maker() as db:
        try:
            print("Rolling back migration...")
            for sql in rollback_steps:
                await db.execute(text(sql))
            await db.commit()
            print("✅ Rollback completed!")
        except Exception as e:
            print(f"❌ Rollback failed: {e}")
            await db.rollback()
            raise


async def main():
    """Main function."""
    import argparse

    parser = argparse.ArgumentParser(description='Run flexible campaign storage migration')
    parser.add_argument('--rollback', action='store_true', help='Rollback the migration')
    parser.add_argument('--verify-only', action='store_true', help='Only verify schema without running migration')

    args = parser.parse_args()

    if args.rollback:
        await rollback_migration()
    elif args.verify_only:
        await verify_schema()
    else:
        await run_migration()
        await verify_schema()


if __name__ == "__main__":
    asyncio.run(main())