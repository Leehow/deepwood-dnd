#!/usr/bin/env python3
"""
清理数据库中无效的用户ID

无效ID格式包括：
- "0", "1", "2", "3" (测试模式默认值)
- "dm-user" (DM控制台硬编码)
- "user_0", "user_1" 等 (旧格式)
- "resource-library" (资源面板硬编码)

有效ID格式：
- "resterlab_数字" (真实登录用户)
"""

import asyncio
import sys
import os

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select, delete, or_, text
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import async_session_maker
from app.models.campaign import Campaign, CampaignMember


# 无效的用户ID模式
INVALID_USER_IDS = [
    "0", "1", "2", "3",  # 测试模式默认值
    "dm-user",  # DM控制台硬编码
    "resource-library",  # 资源面板硬编码
]

INVALID_PREFIXES = [
    "user_",  # 旧格式
]


def is_invalid_user_id(user_id: str) -> bool:
    """检查用户ID是否无效"""
    if user_id in INVALID_USER_IDS:
        return True
    for prefix in INVALID_PREFIXES:
        if user_id.startswith(prefix):
            return True
    return False


async def analyze_data(db: AsyncSession):
    """分析数据库中的用户ID情况"""
    print("\n" + "=" * 60)
    print("📊 分析数据库中的用户ID")
    print("=" * 60)

    # 1. 分析 campaigns 表的 dm_user_id
    result = await db.execute(select(Campaign.dm_user_id).distinct())
    dm_user_ids = [row[0] for row in result.fetchall()]

    print("\n📋 campaigns.dm_user_id 统计:")
    valid_dms = []
    invalid_dms = []
    for uid in dm_user_ids:
        if is_invalid_user_id(uid):
            invalid_dms.append(uid)
        else:
            valid_dms.append(uid)

    print(f"  ✅ 有效ID: {len(valid_dms)} 个")
    for uid in valid_dms[:5]:
        print(f"     - {uid}")
    if len(valid_dms) > 5:
        print(f"     ... 还有 {len(valid_dms) - 5} 个")

    print(f"  ❌ 无效ID: {len(invalid_dms)} 个")
    for uid in invalid_dms:
        print(f"     - {uid}")

    # 2. 分析 campaign_members 表的 user_id
    result = await db.execute(select(CampaignMember.user_id).distinct())
    member_user_ids = [row[0] for row in result.fetchall()]

    print("\n📋 campaign_members.user_id 统计:")
    valid_members = []
    invalid_members = []
    for uid in member_user_ids:
        if is_invalid_user_id(uid):
            invalid_members.append(uid)
        else:
            valid_members.append(uid)

    print(f"  ✅ 有效ID: {len(valid_members)} 个")
    for uid in valid_members[:5]:
        print(f"     - {uid}")
    if len(valid_members) > 5:
        print(f"     ... 还有 {len(valid_members) - 5} 个")

    print(f"  ❌ 无效ID: {len(invalid_members)} 个")
    for uid in invalid_members:
        print(f"     - {uid}")

    # 3. 显示受影响的记录详情
    if invalid_dms:
        print("\n🔍 使用无效dm_user_id的战役:")
        for uid in invalid_dms:
            result = await db.execute(
                select(Campaign.id, Campaign.name).where(Campaign.dm_user_id == uid)
            )
            campaigns = result.fetchall()
            for c in campaigns:
                print(f"  - 战役 #{c[0]}: {c[1]} (dm_user_id={uid})")

    if invalid_members:
        print("\n🔍 使用无效user_id的成员记录:")
        for uid in invalid_members:
            result = await db.execute(
                select(CampaignMember.id, CampaignMember.campaign_id, CampaignMember.role)
                .where(CampaignMember.user_id == uid)
            )
            members = result.fetchall()
            for m in members:
                print(f"  - 成员 #{m[0]}: 战役#{m[1]}, 角色={m[2]}, user_id={uid}")

    return invalid_dms, invalid_members


async def cleanup_invalid_members(db: AsyncSession, dry_run: bool = True):
    """清理无效的成员记录"""
    print("\n" + "=" * 60)
    print("🧹 清理无效的 campaign_members 记录")
    print("=" * 60)

    # 构建查询条件
    conditions = [CampaignMember.user_id == uid for uid in INVALID_USER_IDS]
    for prefix in INVALID_PREFIXES:
        conditions.append(CampaignMember.user_id.like(f"{prefix}%"))

    # 查找要删除的记录
    result = await db.execute(
        select(CampaignMember).where(or_(*conditions))
    )
    members_to_delete = result.scalars().all()

    if not members_to_delete:
        print("✅ 没有需要清理的无效成员记录")
        return 0

    print(f"\n将删除 {len(members_to_delete)} 条记录:")
    for m in members_to_delete:
        print(f"  - ID={m.id}, campaign_id={m.campaign_id}, user_id={m.user_id}, role={m.role}")

    if dry_run:
        print("\n⚠️  这是 DRY RUN 模式，实际未删除任何数据")
        print("   使用 --execute 参数执行实际删除")
        return len(members_to_delete)

    # 执行删除
    await db.execute(
        delete(CampaignMember).where(or_(*conditions))
    )
    await db.commit()
    print(f"\n✅ 已删除 {len(members_to_delete)} 条记录")
    return len(members_to_delete)


async def cleanup_orphan_campaigns(db: AsyncSession, dry_run: bool = True):
    """清理使用无效dm_user_id的战役（可选）"""
    print("\n" + "=" * 60)
    print("🧹 检查使用无效 dm_user_id 的战役")
    print("=" * 60)

    # 构建查询条件
    conditions = [Campaign.dm_user_id == uid for uid in INVALID_USER_IDS]
    for prefix in INVALID_PREFIXES:
        conditions.append(Campaign.dm_user_id.like(f"{prefix}%"))

    result = await db.execute(
        select(Campaign).where(or_(*conditions))
    )
    campaigns_to_delete = result.scalars().all()

    if not campaigns_to_delete:
        print("✅ 没有使用无效dm_user_id的战役")
        return 0

    print(f"\n发现 {len(campaigns_to_delete)} 个使用无效dm_user_id的战役:")
    for c in campaigns_to_delete:
        print(f"  - ID={c.id}, name={c.name}, dm_user_id={c.dm_user_id}")

    print("\n⚠️  删除战役会级联删除所有相关数据（成员、角色、地图等）")
    print("   如需删除，请手动执行或使用 --delete-campaigns 参数")

    return len(campaigns_to_delete)


async def main():
    import argparse
    parser = argparse.ArgumentParser(description="清理数据库中无效的用户ID")
    parser.add_argument("--execute", action="store_true", help="执行实际删除（默认为 dry-run）")
    parser.add_argument("--delete-campaigns", action="store_true", help="同时删除使用无效dm_user_id的战役")
    parser.add_argument("--analyze-only", action="store_true", help="仅分析，不执行任何删除")
    args = parser.parse_args()

    dry_run = not args.execute

    async with async_session_maker() as db:
        # 分析数据
        invalid_dms, invalid_members = await analyze_data(db)

        if args.analyze_only:
            print("\n📊 分析完成（仅分析模式）")
            return

        # 清理无效成员
        if invalid_members:
            await cleanup_invalid_members(db, dry_run=dry_run)

        # 检查无效战役
        if invalid_dms:
            count = await cleanup_orphan_campaigns(db, dry_run=dry_run)
            if args.delete_campaigns and count > 0 and not dry_run:
                conditions = [Campaign.dm_user_id == uid for uid in INVALID_USER_IDS]
                for prefix in INVALID_PREFIXES:
                    conditions.append(Campaign.dm_user_id.like(f"{prefix}%"))
                await db.execute(delete(Campaign).where(or_(*conditions)))
                await db.commit()
                print(f"\n✅ 已删除 {count} 个战役")

    print("\n" + "=" * 60)
    if dry_run:
        print("💡 这是 DRY RUN 模式，使用 --execute 执行实际清理")
    else:
        print("✅ 清理完成")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
