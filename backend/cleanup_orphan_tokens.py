"""
清理孤儿 token - 删除那些关联的 monster_instance 已不存在的 token
"""
import asyncio
from sqlalchemy import select, delete, text
from app.db.session import async_session_maker
from app.models.token import Token
from app.models.monster_instance import MonsterInstance


async def cleanup_orphan_monster_tokens():
    """删除所有孤儿怪物 token（monster_instance 已被删除的 token）"""
    async with async_session_maker() as db:
        # 找出所有孤儿 token（有 monster_instance_id 但对应的 monster_instance 不存在）
        orphan_query = text("""
            SELECT t.id, t.instance_name, t.campaign_id
            FROM tokens t
            WHERE t.monster_instance_id IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM monster_instances m WHERE m.id = t.monster_instance_id
            )
        """)

        result = await db.execute(orphan_query)
        orphan_tokens = result.fetchall()

        if not orphan_tokens:
            print("✓ 没有发现孤儿 token，无需清理")
            return

        print(f"发现 {len(orphan_tokens)} 个孤儿 token:")
        for token in orphan_tokens:
            print(f"  - ID: {token[0]}, 名称: {token[1]}, 战役ID: {token[2]}")

        # 删除孤儿 token
        delete_query = text("""
            DELETE FROM tokens
            WHERE monster_instance_id IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM monster_instances m WHERE m.id = tokens.monster_instance_id
            )
        """)

        result = await db.execute(delete_query)
        await db.commit()

        print(f"✓ 已清理 {result.rowcount} 个孤儿 token")


if __name__ == "__main__":
    asyncio.run(cleanup_orphan_monster_tokens())
