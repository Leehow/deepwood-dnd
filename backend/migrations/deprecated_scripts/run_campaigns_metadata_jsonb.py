"""
DEPRECATED: Use Alembic instead (preferred):
    cd backend && ./venv/bin/alembic upgrade head

This ad-hoc runner adds campaigns.metadata JSONB + GIN index with IF NOT EXISTS
and is kept only for emergency/dev purposes. Do NOT use in CI/production.

Usage (not recommended):
    cd backend && ./venv/bin/python migrations/run_campaigns_metadata_jsonb.py
"""

import asyncio
import sys
from pathlib import Path
# Ensure 'backend' is on sys.path so 'app' package can be imported
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text
from app.db.session import async_session_maker


async def run():
    steps = [
        # 1) Add column if not exists with NOT NULL and default {}
        """
        ALTER TABLE campaigns
        ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
        """,
        # 2) Create GIN index if not exists
        """
        CREATE INDEX IF NOT EXISTS ix_campaigns_metadata
        ON campaigns USING GIN (metadata);
        """,
    ]

    async with async_session_maker() as db:
        try:
            print("Running migration: add campaigns.metadata JSONB + GIN index")
            for i, sql in enumerate(steps, 1):
                print(f"Step {i}/{len(steps)}:\n{sql.strip()}\n---")
                await db.execute(text(sql))
            await db.commit()
            print("✅ Migration completed successfully")
        except Exception as e:
            print(f"❌ Migration failed: {e}")
            await db.rollback()
            raise


async def verify():
    verify_sql = text(
        """
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'campaigns' AND column_name = 'metadata'
        """
    )
    async with async_session_maker() as db:
        res = await db.execute(verify_sql)
        row = res.first()
        print("Verification:")
        if row:
            print(f"  metadata column -> type={row[1]}, nullable={row[2]}")
        else:
            print("  metadata column NOT FOUND")


async def main():
    await run()
    await verify()


if __name__ == "__main__":
    asyncio.run(main())

