import asyncio
import json
from pathlib import Path
from typing import Dict
import sys

# Ensure backend package is importable
CURRENT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = CURRENT_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import select

from app.db.session import async_session_maker
from app.models.campaign_storage import CampaignStorage


QUEST_PROGRESS_DIR = Path("../dnd-platform/quest_progress")


async def migrate() -> None:
    print("==> Quest progress migration: files -> campaign_storage")
    print(f"Source dir: {QUEST_PROGRESS_DIR.resolve()}")

    if not QUEST_PROGRESS_DIR.exists():
        print("No quest_progress directory found. Nothing to migrate.")
        return

    files = sorted(QUEST_PROGRESS_DIR.glob("*.json"))
    print(f"Found {len(files)} file(s) to process.")

    created, merged, skipped, errored = 0, 0, 0, 0

    async with async_session_maker() as session:
        for fp in files:
            campaign_id_str = fp.stem
            try:
                campaign_id = int(campaign_id_str)
            except ValueError:
                print(f"[SKIP] filename '{fp.name}' is not an integer campaign_id")
                skipped += 1
                continue

            try:
                with fp.open("r", encoding="utf-8") as f:
                    data = json.load(f)
                if not isinstance(data, dict):
                    print(f"[SKIP] {fp.name}: json root is not an object")
                    skipped += 1
                    continue
            except Exception as e:
                print(f"[ERROR] reading {fp.name}: {e}")
                errored += 1
                continue

            # look for existing storage object
            res = await session.execute(
                select(CampaignStorage)
                .where(
                    CampaignStorage.campaign_id == campaign_id,
                    CampaignStorage.object_type == "quest_progress",
                    CampaignStorage.object_id == "default",
                    CampaignStorage.is_active == True,
                )
                .limit(1)
            )
            obj = res.scalar_one_or_none()

            if obj:
                # merge: only add missing keys from file, do not overwrite DB
                db_map: Dict[str, str] = dict(obj.data or {})
                added = 0
                for k, v in data.items():
                    if k not in db_map:
                        db_map[k] = v
                        added += 1
                if added == 0:
                    print(f"[SKIP] campaign={campaign_id}: already up-to-date; no keys added")
                    skipped += 1
                    continue
                obj.data = db_map
                obj.version = (obj.version or 1) + 1
                obj.updated_by = "system"
                merged += 1
                print(f"[MERGE] campaign={campaign_id}: +{added} keys")
            else:
                obj = CampaignStorage(
                    campaign_id=campaign_id,
                    object_type="quest_progress",
                    object_id="default",
                    object_name="Quest Progress",
                    category="quest",
                    tags=None,
                    data=data,
                    source="custom",
                    visibility="dm_only",
                    is_active=True,
                    version=1,
                    created_by="system",
                )
                session.add(obj)
                created += 1
                print(f"[CREATE] campaign={campaign_id}: {len(data)} keys")

        await session.commit()

    print(f"==> Done. created={created}, merged={merged}, skipped={skipped}, errored={errored}")


if __name__ == "__main__":
    asyncio.run(migrate())

