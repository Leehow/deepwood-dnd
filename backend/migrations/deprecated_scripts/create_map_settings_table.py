"""Create map_settings table"""
import asyncio
from sqlalchemy import text
from app.db.session import engine


async def create_table():
    """Create map_settings table"""
    async with engine.begin() as conn:
        # Check if table exists
        result = await conn.execute(text("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_name='map_settings'
        """))
        
        if result.fetchone() is None:
            # Create table
            await conn.execute(text("""
                CREATE TABLE map_settings (
                    id SERIAL PRIMARY KEY,
                    campaign_id INTEGER NOT NULL,
                    map_url VARCHAR(500) NOT NULL,
                    scale FLOAT DEFAULT 1.0,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE,
                    UNIQUE(campaign_id, map_url)
                )
            """))
            
            # Create index
            await conn.execute(text("""
                CREATE INDEX idx_map_settings_campaign_id ON map_settings(campaign_id)
            """))
            
            print("✅ Created map_settings table")
        else:
            print("ℹ️  map_settings table already exists")


if __name__ == "__main__":
    asyncio.run(create_table())

