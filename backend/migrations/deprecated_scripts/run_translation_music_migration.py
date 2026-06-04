#!/usr/bin/env python3
"""
Run migration to add translation and music model settings
"""
import asyncio
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text
from app.db.session import engine


async def run_migration():
    """Run the migration"""
    print("=" * 80)
    print("Adding translation and music model settings to ai_api_settings table")
    print("=" * 80)

    # SQL statements to execute separately
    sql_statements = [
        # Advanced Translation Model fields
        """
        ALTER TABLE ai_api_settings
        ADD COLUMN IF NOT EXISTS translation_api_url VARCHAR(500)
        """,
        """
        ALTER TABLE ai_api_settings
        ADD COLUMN IF NOT EXISTS translation_api_key TEXT
        """,
        """
        ALTER TABLE ai_api_settings
        ADD COLUMN IF NOT EXISTS translation_model VARCHAR(100)
        """,
        # Music Generation Model fields
        """
        ALTER TABLE ai_api_settings
        ADD COLUMN IF NOT EXISTS music_api_url VARCHAR(500)
        """,
        """
        ALTER TABLE ai_api_settings
        ADD COLUMN IF NOT EXISTS music_api_key TEXT
        """,
        """
        ALTER TABLE ai_api_settings
        ADD COLUMN IF NOT EXISTS music_model VARCHAR(100)
        """
    ]

    # Execute migration
    async with engine.begin() as conn:
        print("\n🚀 Executing migration...")
        for i, sql in enumerate(sql_statements, 1):
            print(f"  [{i}/{len(sql_statements)}] {sql.strip()[:60]}...")
            await conn.execute(text(sql))
        print("✅ Migration completed successfully!")

    print("\n" + "=" * 80)
    print("Migration finished!")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(run_migration())

