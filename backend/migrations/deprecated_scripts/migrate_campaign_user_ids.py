"""
Migrate user IDs from 'user_X' format to 'X' format in campaigns table
"""
import asyncio
from sqlalchemy import text
from app.db.session import async_session_maker

async def migrate_user_ids():
    """Update dm_user_id from user_X to X format"""
    print("Migrating user IDs in campaigns table...")

    async with async_session_maker() as session:
        # Get all campaigns
        result = await session.execute(text("SELECT id, dm_user_id FROM campaigns"))
        campaigns = result.fetchall()

        print(f"\nFound {len(campaigns)} campaigns")

        updated = 0
        for campaign_id, dm_user_id in campaigns:
            if dm_user_id and dm_user_id.startswith("user_"):
                # Extract number from "user_X"
                new_id = dm_user_id.replace("user_", "")

                print(f"  Campaign {campaign_id}: {dm_user_id} -> {new_id}")

                await session.execute(
                    text("UPDATE campaigns SET dm_user_id = :new_id WHERE id = :campaign_id"),
                    {"new_id": new_id, "campaign_id": campaign_id}
                )
                updated += 1

        await session.commit()
        print(f"\n✅ Updated {updated} campaigns")

if __name__ == "__main__":
    asyncio.run(migrate_user_ids())
