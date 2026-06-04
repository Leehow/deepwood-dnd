import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv()

async def run_migration():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("ERROR: DATABASE_URL not found in environment")
        return

    # Fix URL format for asyncpg (remove +asyncpg suffix)
    database_url = database_url.replace("postgresql+asyncpg://", "postgresql://")

    # Read SQL file
    with open("migrations/create_monster_avatars_table.sql", "r") as f:
        sql = f.read()

    # Connect and execute
    conn = await asyncpg.connect(database_url)
    try:
        await conn.execute(sql)
        print("✅ Monster avatars table created successfully!")
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(run_migration())

