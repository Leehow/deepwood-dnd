"""
Run database migration for drawings table
"""
import asyncio
import asyncpg
import os
import sys
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

async def run_migration(sql_file: str):
    """Execute the migration SQL"""
    # Read the migration SQL file
    with open(sql_file, 'r') as f:
        sql = f.read()

    # Get database URL from environment
    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        raise ValueError("DATABASE_URL not found in environment variables")

    # Remove +asyncpg suffix if present (asyncpg doesn't support it)
    database_url = database_url.replace('postgresql+asyncpg://', 'postgresql://')

    # Connect to database
    conn = await asyncpg.connect(database_url)

    try:
        # Execute migration
        migration_name = os.path.basename(sql_file).replace('.sql', '')
        print(f"Running migration: {migration_name}...")
        await conn.execute(sql)
        print("✅ Migration completed successfully!")
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        raise
    finally:
        await conn.close()

if __name__ == "__main__":
    sql_file = os.path.join(os.path.dirname(__file__), 'add_drawings_table.sql')
    asyncio.run(run_migration(sql_file))
