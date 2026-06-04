"""Add grid_unit_length column to map_settings table"""
import asyncio
from sqlalchemy import text
from app.db.session import engine


async def add_column():
    """Add grid_unit_length column to map_settings table"""
    async with engine.begin() as conn:
        # Check if column exists
        result = await conn.execute(text("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='map_settings' 
            AND column_name='grid_unit_length'
        """))
        
        if result.fetchone() is None:
            # Add column
            await conn.execute(text("""
                ALTER TABLE map_settings 
                ADD COLUMN grid_unit_length FLOAT DEFAULT 5.0
            """))
            
            print("✅ Added grid_unit_length column to map_settings table")
        else:
            print("ℹ️  grid_unit_length column already exists")


if __name__ == "__main__":
    asyncio.run(add_column())

