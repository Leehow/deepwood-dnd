#!/usr/bin/env python3
"""
迁移现有头像到OSS
- 读取本地头像文件或下载远程图片
- 转换为WebP格式
- 生成两个尺寸：128x128（小图）和 512x512（大图）
- 上传到OSS
- 更新数据库URL
"""

import asyncio
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import httpx
from sqlalchemy import select, update, text
from app.db.session import async_session_maker
from app.domain.parsing.oss_storage import get_oss_storage

# Frontend public directory for local images
FRONTEND_PUBLIC = Path(__file__).parent.parent.parent / "frontend" / "public"


def read_local_image(url_path: str) -> bytes | None:
    """Read image from local filesystem"""
    # URL path like /images/monsters/xxx.png -> frontend/public/images/monsters/xxx.png
    if url_path.startswith("/"):
        url_path = url_path[1:]
    local_path = FRONTEND_PUBLIC / url_path
    if local_path.exists():
        return local_path.read_bytes()
    print(f"  [WARN] Local file not found: {local_path}")
    return None


async def download_image(url: str) -> bytes | None:
    """Download image from URL"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url)
            if response.status_code == 200:
                return response.content
            print(f"  [WARN] HTTP {response.status_code} for {url}")
            return None
    except Exception as e:
        print(f"  [ERROR] Download failed: {e}")
        return None


async def get_image_data(url: str) -> bytes | None:
    """Get image data from local file or remote URL"""
    if not url:
        return None

    # Check if it's a local path
    if url.startswith("/images/") or url.startswith("/assets/"):
        return read_local_image(url)

    # Check if it's already on OSS
    if "aliyuncs.com" in url:
        return await download_image(url)

    # Try as remote URL
    if url.startswith("http"):
        return await download_image(url)

    # Try as local path
    return read_local_image(url)


async def migrate_avatars(dry_run: bool = True):
    """Migrate all existing avatars to OSS"""
    oss = get_oss_storage()
    if not oss:
        print("[ERROR] OSS not configured. Please check environment variables.")
        return

    stats = {
        "characters": {"total": 0, "migrated": 0, "skipped": 0, "failed": 0},
        "monsters": {"total": 0, "migrated": 0, "skipped": 0, "failed": 0},
        "items": {"total": 0, "migrated": 0, "skipped": 0, "failed": 0},
        "shops": {"total": 0, "migrated": 0, "skipped": 0, "failed": 0},
    }

    # Migrate Characters (using raw SQL)
    print("\n=== Migrating Character Avatars ===")
    async with async_session_maker() as db:
        result = await db.execute(
            text("SELECT id, name, avatar FROM characters WHERE avatar IS NOT NULL")
        )
        characters = result.fetchall()
        stats["characters"]["total"] = len(characters)

        for c in characters:
            c_id, c_name, c_avatar = c
            # Skip if already on OSS
            if c_avatar and "aliyuncs.com" in c_avatar:
                print(f"  [SKIP] Character {c_id} ({c_name}) - already on OSS")
                stats["characters"]["skipped"] += 1
                continue

            print(f"  [PROCESS] Character {c_id} ({c_name})")

            if dry_run:
                print(f"    DRY RUN: Would migrate {c_avatar[:60]}..." if len(c_avatar) > 60 else f"    DRY RUN: Would migrate {c_avatar}")
                continue

            # Get image data (local or remote)
            image_data = await get_image_data(c_avatar)
            if not image_data:
                stats["characters"]["failed"] += 1
                continue

            # Upload to OSS with two sizes
            upload_result = oss.upload_avatar(image_data, "character", c_id, c_name)
            if upload_result:
                small_url, large_url = upload_result
                # Update using raw SQL
                await db.execute(
                    text("UPDATE characters SET avatar = :small, avatar_large = :large WHERE id = :id"),
                    {"small": small_url, "large": large_url, "id": c_id}
                )
                print(f"    [OK] small={small_url[:60]}...")
                print(f"    [OK] large={large_url[:60]}...")
                stats["characters"]["migrated"] += 1
            else:
                print(f"    [FAIL] Upload failed")
                stats["characters"]["failed"] += 1

        if not dry_run:
            await db.commit()
            print("  [COMMIT] Character changes saved")

    # Migrate Monster Instances (using raw SQL to avoid ORM relationship issues)
    print("\n=== Migrating Monster Avatars ===")
    async with async_session_maker() as db:
        result = await db.execute(
            text("SELECT id, name, avatar_url FROM monster_instances WHERE avatar_url IS NOT NULL")
        )
        monsters = result.fetchall()
        stats["monsters"]["total"] = len(monsters)

        for m in monsters:
            m_id, m_name, m_avatar_url = m
            # Skip if already on OSS
            if m_avatar_url and "aliyuncs.com" in m_avatar_url:
                print(f"  [SKIP] Monster {m_id} ({m_name}) - already on OSS")
                stats["monsters"]["skipped"] += 1
                continue

            print(f"  [PROCESS] Monster {m_id} ({m_name})")

            if dry_run:
                print(f"    DRY RUN: Would migrate {m_avatar_url}")
                continue

            # Get image data (local or remote)
            image_data = await get_image_data(m_avatar_url)
            if not image_data:
                stats["monsters"]["failed"] += 1
                continue

            # Upload to OSS with two sizes
            upload_result = oss.upload_avatar(image_data, "monster", m_id, m_name)
            if upload_result:
                small_url, large_url = upload_result
                # Update using raw SQL
                await db.execute(
                    text("UPDATE monster_instances SET avatar_url = :small, avatar_url_large = :large WHERE id = :id"),
                    {"small": small_url, "large": large_url, "id": m_id}
                )
                print(f"    [OK] small={small_url[:60]}...")
                print(f"    [OK] large={large_url[:60]}...")
                stats["monsters"]["migrated"] += 1
            else:
                print(f"    [FAIL] Upload failed")
                stats["monsters"]["failed"] += 1

        if not dry_run:
            await db.commit()
            print("  [COMMIT] Monster changes saved")

    # Migrate Items (using raw SQL)
    print("\n=== Migrating Item Avatars ===")
    async with async_session_maker() as db:
        result = await db.execute(
            text("SELECT id, name, avatar_url FROM items WHERE avatar_url IS NOT NULL")
        )
        items = result.fetchall()
        stats["items"]["total"] = len(items)

        for item in items:
            item_id, item_name, item_avatar_url = item
            # Skip if already on OSS or is a preset icon
            if item_avatar_url and ("aliyuncs.com" in item_avatar_url or item_avatar_url.startswith("/assets/")):
                print(f"  [SKIP] Item {item_id} ({item_name}) - already on OSS or preset")
                stats["items"]["skipped"] += 1
                continue

            print(f"  [PROCESS] Item {item_id} ({item_name})")

            if dry_run:
                print(f"    DRY RUN: Would migrate {item_avatar_url}")
                continue

            # Get image data (local or remote)
            image_data = await get_image_data(item_avatar_url)
            if not image_data:
                stats["items"]["failed"] += 1
                continue

            # Upload to OSS with two sizes
            upload_result = oss.upload_avatar(image_data, "item", item_id, item_name)
            if upload_result:
                small_url, large_url = upload_result
                # Update using raw SQL
                await db.execute(
                    text("UPDATE items SET avatar_url = :small, avatar_url_large = :large WHERE id = :id"),
                    {"small": small_url, "large": large_url, "id": item_id}
                )
                print(f"    [OK] small={small_url[:60]}...")
                print(f"    [OK] large={large_url[:60]}...")
                stats["items"]["migrated"] += 1
            else:
                print(f"    [FAIL] Upload failed")
                stats["items"]["failed"] += 1

        if not dry_run:
            await db.commit()
            print("  [COMMIT] Item changes saved")

    # Migrate Shops (using raw SQL)
    print("\n=== Migrating Shop Avatars ===")
    async with async_session_maker() as db:
        result = await db.execute(
            text("SELECT id, name, avatar_url FROM shops WHERE avatar_url IS NOT NULL")
        )
        shops = result.fetchall()
        stats["shops"]["total"] = len(shops)

        for shop in shops:
            shop_id, shop_name, shop_avatar_url = shop
            # Skip if already on OSS
            if shop_avatar_url and "aliyuncs.com" in shop_avatar_url:
                print(f"  [SKIP] Shop {shop_id} ({shop_name}) - already on OSS")
                stats["shops"]["skipped"] += 1
                continue

            print(f"  [PROCESS] Shop {shop_id} ({shop_name})")

            if dry_run:
                print(f"    DRY RUN: Would migrate {shop_avatar_url}")
                continue

            # Get image data (local or remote)
            image_data = await get_image_data(shop_avatar_url)
            if not image_data:
                stats["shops"]["failed"] += 1
                continue

            # Upload to OSS with two sizes
            upload_result = oss.upload_avatar(image_data, "shop", shop_id, shop_name)
            if upload_result:
                small_url, large_url = upload_result
                # Update using raw SQL
                await db.execute(
                    text("UPDATE shops SET avatar_url = :small, avatar_url_large = :large WHERE id = :id"),
                    {"small": small_url, "large": large_url, "id": shop_id}
                )
                print(f"    [OK] small={small_url[:60]}...")
                print(f"    [OK] large={large_url[:60]}...")
                stats["shops"]["migrated"] += 1
            else:
                print(f"    [FAIL] Upload failed")
                stats["shops"]["failed"] += 1

        if not dry_run:
            await db.commit()
            print("  [COMMIT] Shop changes saved")

    # Print summary
    print("\n" + "=" * 50)
    print("MIGRATION SUMMARY")
    print("=" * 50)
    for entity, s in stats.items():
        print(f"\n{entity.upper()}:")
        print(f"  Total:    {s['total']}")
        print(f"  Migrated: {s['migrated']}")
        print(f"  Skipped:  {s['skipped']}")
        print(f"  Failed:   {s['failed']}")

    if dry_run:
        print("\n[INFO] This was a DRY RUN. No changes were made.")
        print("[INFO] Run with --execute to perform actual migration.")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Migrate avatars to OSS")
    parser.add_argument("--execute", action="store_true", help="Actually perform migration (default is dry run)")
    args = parser.parse_args()

    asyncio.run(migrate_avatars(dry_run=not args.execute))
