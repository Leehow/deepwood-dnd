"""
Migrate user IDs from 'user_X' format to 'X' format in campaign_members table
"""
import asyncio
from sqlalchemy import text
from app.db.session import async_session_maker

async def migrate_campaign_members_user_ids():
    """Update user_id from user_X to X format in campaign_members"""
    print("Migrating user IDs in campaign_members table...")

    async with async_session_maker() as session:
        # Get all campaign members
        result = await session.execute(
            text("SELECT id, campaign_id, user_id, role FROM campaign_members")
        )
        members = result.fetchall()

        print(f"\nFound {len(members)} campaign members")

        updated = 0
        for member_id, campaign_id, user_id, role in members:
            if user_id and user_id.startswith("user_"):
                # Extract number from "user_X"
                new_id = user_id.replace("user_", "")

                print(f"  Member {member_id} (Campaign {campaign_id}, {role}): {user_id} -> {new_id}")

                await session.execute(
                    text("UPDATE campaign_members SET user_id = :new_id WHERE id = :member_id"),
                    {"new_id": new_id, "member_id": member_id}
                )
                updated += 1
            else:
                print(f"  Member {member_id} (Campaign {campaign_id}, {role}): {user_id} - no change needed")

        await session.commit()
        print(f"\n✅ Updated {updated} campaign members")
        print(f"📊 Skipped {len(members) - updated} members (no migration needed)")

if __name__ == "__main__":
    asyncio.run(migrate_campaign_members_user_ids())
