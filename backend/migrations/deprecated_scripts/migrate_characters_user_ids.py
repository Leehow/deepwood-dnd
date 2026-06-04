"""
Migrate user IDs from 'user_X' format to 'X' format in characters table
"""
import asyncio
from sqlalchemy import text
from app.db.session import async_session_maker

async def migrate_characters_user_ids():
    """Update user_id from user_X to X format in characters table"""
    print("Migrating user IDs in characters table...")

    async with async_session_maker() as session:
        # Get all characters with user_X format
        result = await session.execute(
            text("SELECT id, user_id, name FROM characters WHERE user_id LIKE 'user_%'")
        )
        characters = result.fetchall()

        print(f"\nFound {len(characters)} characters to migrate")

        updated = 0
        for char_id, user_id, name in characters:
            # Extract number from "user_X"
            new_id = user_id.replace("user_", "")

            print(f"  Character {char_id} ({name}): {user_id} -> {new_id}")

            await session.execute(
                text("UPDATE characters SET user_id = :new_id WHERE id = :char_id"),
                {"new_id": new_id, "char_id": char_id}
            )
            updated += 1

        await session.commit()
        print(f"\n✅ Updated {updated} characters")

if __name__ == "__main__":
    asyncio.run(migrate_characters_user_ids())
