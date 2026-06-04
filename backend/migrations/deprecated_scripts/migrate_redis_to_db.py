"""
Migrate selected character data from Redis to PostgreSQL database.

This script reads all selected character data from Redis and writes it to the
campaign_members table in the database.

Usage:
    python migrate_redis_to_db.py
"""

import asyncio
import sys
from pathlib import Path

# Add parent directory to path to import app modules
sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy import select, update
from app.db.session import async_session_maker
from app.db.redis import init_redis
from app.models.campaign import CampaignMember
from app.core.config import settings


async def migrate_redis_to_db():
    """Migrate selected character data from Redis to database."""

    # Get Redis client
    redis = await init_redis()
    
    # Get database session
    async with async_session_maker() as db:
        try:
            # Get all campaign members
            result = await db.execute(select(CampaignMember))
            members = result.scalars().all()
            
            migrated_count = 0
            skipped_count = 0
            
            print(f"Found {len(members)} campaign members to check...")
            
            for member in members:
                # Check if already has selected_character_id in database
                if member.selected_character_id is not None:
                    print(f"  Skipping {member.user_id} in campaign {member.campaign_id} - already has selected character in DB")
                    skipped_count += 1
                    continue
                
                # Try to get from Redis
                redis_key = f"campaign:{member.campaign_id}:user:{member.user_id}:selected_character"
                redis_value = await redis.get(redis_key)
                
                if redis_value:
                    try:
                        character_id = int(redis_value)
                        
                        # Update database
                        member.selected_character_id = character_id
                        
                        print(f"  ✅ Migrated {member.user_id} in campaign {member.campaign_id}: character_id={character_id}")
                        migrated_count += 1
                        
                    except ValueError:
                        print(f"  ⚠️  Invalid Redis value for {member.user_id} in campaign {member.campaign_id}: {redis_value}")
                else:
                    print(f"  ⏭️  No Redis data for {member.user_id} in campaign {member.campaign_id}")
            
            # Commit all changes
            await db.commit()
            
            print(f"\n✅ Migration completed!")
            print(f"   Migrated: {migrated_count}")
            print(f"   Skipped (already in DB): {skipped_count}")
            print(f"   Total checked: {len(members)}")
            
        except Exception as e:
            print(f"\n❌ Migration failed: {e}")
            await db.rollback()
            raise
        finally:
            await redis.close()


async def verify_migration():
    """Verify the migration by comparing Redis and database data."""

    redis = await init_redis()
    
    async with async_session_maker() as db:
        try:
            result = await db.execute(select(CampaignMember))
            members = result.scalars().all()
            
            mismatches = []
            
            for member in members:
                redis_key = f"campaign:{member.campaign_id}:user:{member.user_id}:selected_character"
                redis_value = await redis.get(redis_key)
                
                if redis_value:
                    redis_id = int(redis_value)
                    db_id = member.selected_character_id
                    
                    if redis_id != db_id:
                        mismatches.append({
                            'user_id': member.user_id,
                            'campaign_id': member.campaign_id,
                            'redis': redis_id,
                            'db': db_id
                        })
            
            if mismatches:
                print(f"\n⚠️  Found {len(mismatches)} mismatches:")
                for m in mismatches:
                    print(f"   User {m['user_id']} in campaign {m['campaign_id']}: Redis={m['redis']}, DB={m['db']}")
            else:
                print(f"\n✅ Verification passed! All data matches between Redis and database.")
                
        finally:
            await redis.close()


async def main():
    """Main function."""
    print("=" * 60)
    print("Redis to Database Migration Script")
    print("=" * 60)
    print()
    
    # Run migration
    await migrate_redis_to_db()
    
    print()
    print("=" * 60)
    print("Verifying migration...")
    print("=" * 60)
    print()
    
    # Verify migration
    await verify_migration()
    
    print()
    print("=" * 60)
    print("Migration complete!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())

