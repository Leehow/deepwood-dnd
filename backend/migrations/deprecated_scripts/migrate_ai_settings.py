"""
Migration script to update ai_api_settings table for global configuration
Run this once to migrate from per-user to global settings
"""

import asyncio
from sqlalchemy import text
from app.db.session import engine


async def migrate():
    """Migrate ai_api_settings to global configuration"""
    async with engine.begin() as conn:
        # 1. Make user_id nullable
        await conn.execute(text("""
            ALTER TABLE ai_api_settings 
            ALTER COLUMN user_id DROP NOT NULL
        """))
        
        # 2. Set default value to 'global'
        await conn.execute(text("""
            ALTER TABLE ai_api_settings 
            ALTER COLUMN user_id SET DEFAULT 'global'
        """))
        
        # 3. Update existing records to use 'global' (if any exist)
        await conn.execute(text("""
            UPDATE ai_api_settings 
            SET user_id = 'global' 
            WHERE user_id IS NOT NULL
        """))
        
        print("✅ Migration completed successfully!")
        print("   - user_id column is now nullable")
        print("   - Default value set to 'global'")
        print("   - Existing records updated to 'global'")


if __name__ == "__main__":
    print("Starting migration...")
    asyncio.run(migrate())

