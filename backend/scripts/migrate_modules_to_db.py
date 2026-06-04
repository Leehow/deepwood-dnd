"""
Migrate parsed modules and parse tasks from JSON files to database.
Run this script to migrate existing data.
"""
import asyncio
import json
from pathlib import Path
from datetime import datetime

# Add backend to path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select
from app.db.session import async_session_maker
from app.models.parsed_module import ParsedModule
from app.models.module_parse_task import ModuleParseTask


# Paths to JSON files
BASE_DIR = Path(__file__).parent.parent.parent / "dnd-platform"
PARSED_METADATA_FILE = BASE_DIR / "configs" / "modules" / "parsed_modules_metadata.json"
PARSE_TASKS_FILE = BASE_DIR / "upload" / "parse_tasks.json"


async def migrate_parsed_modules():
    """Migrate parsed modules from JSON to database"""
    if not PARSED_METADATA_FILE.exists():
        print(f"No parsed modules file found at {PARSED_METADATA_FILE}")
        return 0

    with open(PARSED_METADATA_FILE, "r", encoding="utf-8") as f:
        modules = json.load(f)

    migrated = 0
    async with async_session_maker() as session:
        for m in modules:
            # Check if already exists
            result = await session.execute(
                select(ParsedModule).where(ParsedModule.module_id == m["id"])
            )
            existing = result.scalar_one_or_none()

            if existing:
                print(f"  Skipping existing module: {m['id']} - {m.get('title', '')}")
                continue

            # Parse date fields
            parsed_date = None
            if m.get("parsed_date"):
                try:
                    parsed_date = datetime.fromisoformat(m["parsed_date"].replace("Z", "+00:00"))
                except:
                    pass

            # Create new module
            new_module = ParsedModule(
                module_id=m["id"],
                title=m.get("title", ""),
                title_en=m.get("title_en"),
                description=m.get("description"),
                chapters_count=m.get("chapters_count", 0),
                monsters_count=m.get("monsters_count", 0),
                items_count=m.get("items_count", 0),
                images_count=m.get("images_count", 0),
                source_file_id=m.get("source_file_id"),
                data_file=m.get("data_file"),
                created_by=m.get("created_by", "0"),
                is_shared=m.get("is_shared", False),
                original_module_id=m.get("original_module_id"),
                parsed_date=parsed_date
            )
            session.add(new_module)
            migrated += 1
            print(f"  Migrated module: {m['id']} - {m.get('title', '')}")

        await session.commit()

    return migrated


async def migrate_parse_tasks():
    """Migrate parse tasks from JSON to database"""
    if not PARSE_TASKS_FILE.exists():
        print(f"No parse tasks file found at {PARSE_TASKS_FILE}")
        return 0

    with open(PARSE_TASKS_FILE, "r", encoding="utf-8") as f:
        tasks = json.load(f)

    migrated = 0
    async with async_session_maker() as session:
        for t in tasks:
            # Check if already exists
            result = await session.execute(
                select(ModuleParseTask).where(ModuleParseTask.task_id == t["id"])
            )
            existing = result.scalar_one_or_none()

            if existing:
                print(f"  Skipping existing task: {t['id']}")
                continue

            # Parse date fields
            def parse_date(d):
                if not d:
                    return None
                try:
                    return datetime.fromisoformat(d.replace("Z", "+00:00"))
                except:
                    return None

            # Create new task
            new_task = ModuleParseTask(
                task_id=t["id"],
                file_id=t.get("file_id", ""),
                status=t.get("status", "pending"),
                progress=t.get("progress", 0),
                current_step=t.get("current_step"),
                current_message=t.get("current_message"),
                error_message=t.get("error_message"),
                steps_completed=t.get("steps_completed", []),
                batch_messages=t.get("batch_messages", []),
                module_id=t.get("module_id"),
                started_at=parse_date(t.get("started_at")),
                completed_at=parse_date(t.get("completed_at"))
            )
            session.add(new_task)
            migrated += 1
            print(f"  Migrated task: {t['id']}")

        await session.commit()

    return migrated


async def main():
    print("=" * 50)
    print("Migrating Parsed Modules and Parse Tasks to Database")
    print("=" * 50)

    print("\n[1/2] Migrating parsed modules...")
    modules_count = await migrate_parsed_modules()
    print(f"  -> Migrated {modules_count} modules")

    print("\n[2/2] Migrating parse tasks...")
    tasks_count = await migrate_parse_tasks()
    print(f"  -> Migrated {tasks_count} tasks")

    print("\n" + "=" * 50)
    print("Migration complete!")
    print(f"  Modules: {modules_count}")
    print(f"  Tasks: {tasks_count}")
    print("=" * 50)


if __name__ == "__main__":
    asyncio.run(main())
