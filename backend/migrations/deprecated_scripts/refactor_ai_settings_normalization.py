#!/usr/bin/env python3
"""
Refactor AI Settings to normalized structure (Third Normal Form)

This migration:
1. Creates new table ai_model_configs
2. Migrates data from flat structure to normalized structure
3. Drops old columns from ai_api_settings

IMPORTANT: This is a destructive migration. Backup your database before running!
"""
import asyncio
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text
from app.db.session import engine


async def run_migration(skip_confirmation: bool = False):
    """Run the complete migration"""
    print("=" * 80)
    print("AI Settings Normalization Migration")
    print("=" * 80)
    print("\nThis migration will:")
    print("  1. Create new table ai_model_configs")
    print("  2. Migrate existing data")
    print("  3. Drop old columns")
    print("\n⚠️  WARNING: This is a destructive migration!")
    print("   Make sure you have a database backup before proceeding.\n")

    # Confirm before proceeding
    if not skip_confirmation:
        response = input("Do you want to continue? (yes/no): ")
        if response.lower() != "yes":
            print("❌ Migration cancelled")
            return
    else:
        print("⚡ Skipping confirmation (--yes flag provided)")


    async with engine.begin() as conn:
        # ===== STEP 1: Create new table =====
        print("\n" + "=" * 80)
        print("STEP 1: Creating ai_model_configs table")
        print("=" * 80)

        create_table_sql = """
        CREATE TABLE IF NOT EXISTS ai_model_configs (
            id SERIAL PRIMARY KEY,
            settings_id INTEGER NOT NULL REFERENCES ai_api_settings(id) ON DELETE CASCADE,
            model_type VARCHAR(20) NOT NULL,
            api_url VARCHAR(500),
            api_key TEXT,
            model_name VARCHAR(100),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE,
            CONSTRAINT uq_settings_model_type UNIQUE (settings_id, model_type)
        )
        """

        print("Creating table...")
        await conn.execute(text(create_table_sql))

        # Create indexes
        print("Creating indexes...")
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_model_configs_settings_id ON ai_model_configs(settings_id)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_model_configs_model_type ON ai_model_configs(model_type)"
        ))

        print("✅ Table and indexes created successfully!")

        # ===== STEP 2: Migrate data =====
        print("\n" + "=" * 80)
        print("STEP 2: Migrating data from old structure to new")
        print("=" * 80)

        # Check if there's existing data
        result = await conn.execute(text("SELECT COUNT(*) FROM ai_api_settings"))
        count = result.scalar()

        if count == 0:
            print("ℹ️  No existing settings to migrate")
        else:
            print(f"Found {count} settings record(s) to migrate")

            # Fetch all existing settings
            result = await conn.execute(text("""
                SELECT
                    id,
                    chat_api_url, chat_api_key, chat_model,
                    fast_api_url, fast_api_key, fast_model,
                    advanced_api_url, advanced_api_key, advanced_model,
                    vision_api_url, vision_api_key, vision_model,
                    avatar_api_url, avatar_api_key, avatar_model,
                    image_api_url, image_api_key, image_model,
                    translation_api_url, translation_api_key, translation_model,
                    music_api_url, music_api_key, music_model
                FROM ai_api_settings
            """))

            settings = result.fetchall()

            # Model types to migrate
            model_types = ['chat', 'fast', 'advanced', 'vision', 'avatar', 'image', 'translation', 'music']

            for setting in settings:
                settings_id = setting[0]
                print(f"\n  Migrating settings_id={settings_id}...")

                # Migrate each model type
                for i, model_type in enumerate(model_types):
                    # Calculate column indices (id is 0, then 3 columns per model type)
                    base_idx = 1 + (i * 3)
                    api_url = setting[base_idx]
                    api_key = setting[base_idx + 1]
                    model_name = setting[base_idx + 2]

                    # Only insert if at least one field has data
                    if api_url or api_key or model_name:
                        await conn.execute(text("""
                            INSERT INTO ai_model_configs
                                (settings_id, model_type, api_url, api_key, model_name)
                            VALUES
                                (:settings_id, :model_type, :api_url, :api_key, :model_name)
                        """), {
                            'settings_id': settings_id,
                            'model_type': model_type,
                            'api_url': api_url,
                            'api_key': api_key,
                            'model_name': model_name
                        })
                        print(f"    ✓ Migrated {model_type} model config")
                    else:
                        print(f"    - Skipped {model_type} (no data)")

            print("\n✅ Data migration completed!")

        # ===== STEP 3: Drop old columns =====
        print("\n" + "=" * 80)
        print("STEP 3: Dropping old columns from ai_api_settings")
        print("=" * 80)

        model_types = ['chat', 'fast', 'advanced', 'vision', 'avatar', 'image', 'translation', 'music']

        for model_type in model_types:
            print(f"  Dropping {model_type}_* columns...")
            await conn.execute(text(f"ALTER TABLE ai_api_settings DROP COLUMN IF EXISTS {model_type}_api_url"))
            await conn.execute(text(f"ALTER TABLE ai_api_settings DROP COLUMN IF EXISTS {model_type}_api_key"))
            await conn.execute(text(f"ALTER TABLE ai_api_settings DROP COLUMN IF EXISTS {model_type}_model"))

        print("✅ Old columns dropped successfully!")

    print("\n" + "=" * 80)
    print("✅ Migration completed successfully!")
    print("=" * 80)
    print("\nNext steps:")
    print("  1. Verify data integrity: SELECT * FROM ai_model_configs;")
    print("  2. Restart your backend server")
    print("  3. Test API endpoints")


async def rollback_migration():
    """Rollback the migration (emergency use only)"""
    print("=" * 80)
    print("AI Settings Migration ROLLBACK")
    print("=" * 80)
    print("\n⚠️  WARNING: This will restore the old structure!")
    print("   Data in ai_model_configs will be migrated back to flat structure.\n")

    response = input("Are you sure you want to rollback? (yes/no): ")
    if response.lower() != "yes":
        print("❌ Rollback cancelled")
        return

    async with engine.begin() as conn:
        # Restore old columns
        print("\nRestoring old columns...")
        model_types = ['chat', 'fast', 'advanced', 'vision', 'avatar', 'image', 'translation', 'music']

        for model_type in model_types:
            await conn.execute(text(f"ALTER TABLE ai_api_settings ADD COLUMN IF NOT EXISTS {model_type}_api_url VARCHAR(500)"))
            await conn.execute(text(f"ALTER TABLE ai_api_settings ADD COLUMN IF NOT EXISTS {model_type}_api_key TEXT"))
            await conn.execute(text(f"ALTER TABLE ai_api_settings ADD COLUMN IF NOT EXISTS {model_type}_model VARCHAR(100)"))

        # Migrate data back
        print("Migrating data back...")
        result = await conn.execute(text("SELECT DISTINCT settings_id FROM ai_model_configs"))
        settings_ids = [row[0] for row in result.fetchall()]

        for settings_id in settings_ids:
            for model_type in model_types:
                result = await conn.execute(text("""
                    SELECT api_url, api_key, model_name
                    FROM ai_model_configs
                    WHERE settings_id = :settings_id AND model_type = :model_type
                """), {'settings_id': settings_id, 'model_type': model_type})

                row = result.fetchone()
                if row:
                    await conn.execute(text(f"""
                        UPDATE ai_api_settings
                        SET {model_type}_api_url = :api_url,
                            {model_type}_api_key = :api_key,
                            {model_type}_model = :model_name
                        WHERE id = :settings_id
                    """), {
                        'api_url': row[0],
                        'api_key': row[1],
                        'model_name': row[2],
                        'settings_id': settings_id
                    })

        # Drop new table
        print("Dropping ai_model_configs table...")
        await conn.execute(text("DROP TABLE IF EXISTS ai_model_configs CASCADE"))

        print("✅ Rollback completed!")


if __name__ == "__main__":
    import sys

    # Check for --yes flag or --rollback flag
    if "--rollback" in sys.argv:
        asyncio.run(rollback_migration())
    else:
        # Check if --yes flag is provided to skip confirmation
        skip_confirmation = "--yes" in sys.argv or "-y" in sys.argv
        asyncio.run(run_migration(skip_confirmation=skip_confirmation))
