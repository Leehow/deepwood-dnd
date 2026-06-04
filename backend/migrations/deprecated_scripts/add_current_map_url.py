"""
Add current_map_url and selected_module_id columns to campaigns table
"""
import asyncio
from sqlalchemy import text
from app.db.session import engine


async def add_columns():
    """Add current_map_url and selected_module_id columns to campaigns table"""
    async with engine.begin() as conn:
        # Check if current_map_url column exists
        result = await conn.execute(text("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name='campaigns' AND column_name='current_map_url'
        """))

        if result.fetchone() is None:
            # Column doesn't exist, add it
            await conn.execute(text("""
                ALTER TABLE campaigns
                ADD COLUMN current_map_url TEXT
            """))
            print("✅ Added current_map_url column to campaigns table")
        else:
            print("ℹ️  Column current_map_url already exists")

        # Check if selected_module_id column exists
        result = await conn.execute(text("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name='campaigns' AND column_name='selected_module_id'
        """))

        if result.fetchone() is None:
            # Column doesn't exist, add it
            await conn.execute(text("""
                ALTER TABLE campaigns
                ADD COLUMN selected_module_id VARCHAR(100)
            """))
            print("✅ Added selected_module_id column to campaigns table")
        else:
            print("ℹ️  Column selected_module_id already exists")


if __name__ == "__main__":
    asyncio.run(add_columns())
    print("Migration complete!")

