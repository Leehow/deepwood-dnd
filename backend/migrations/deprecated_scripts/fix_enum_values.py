#!/usr/bin/env python3
"""Fix enum values to uppercase"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text
from app.db.session import engine


async def fix_enum_values():
    print("Updating model_type values to uppercase...")
    async with engine.begin() as conn:
        # Update all lowercase values to uppercase
        await conn.execute(text("""
            UPDATE ai_model_configs
            SET model_type = UPPER(model_type::text)::modeltype
        """))
        print("✅ Updated model_type values to uppercase")

        # Verify
        result = await conn.execute(text("SELECT id, model_type FROM ai_model_configs ORDER BY id"))
        configs = result.fetchall()
        print(f"\nVerification: {len(configs)} records")
        for config in configs:
            print(f"   ID {config[0]}: {config[1]}")


if __name__ == "__main__":
    asyncio.run(fix_enum_values())
