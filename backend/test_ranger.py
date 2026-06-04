import asyncio
from app.db.session import async_session_maker
from app.models.character import Character
from sqlalchemy import select, update

async def main():
    async with async_session_maker() as db:
        # 查看角色 18 (加鲁什·碎颅) 的职业
        result = await db.execute(select(Character).where(Character.id == 18))
        char = result.scalar_one_or_none()
        if char:
            print(f'角色: {char.name}, 职业: {char.class_id}')
            print(f'favored_enemy: {char.favored_enemy}')
            print(f'favored_terrain: {char.favored_terrain}')
            
            # 临时改为游侠并设置宿敌和地形
            await db.execute(
                update(Character)
                .where(Character.id == 18)
                .values(
                    class_id='ranger',
                    favored_enemy={'value': 'beasts', 'level_acquired': 1, 'source': 'ranger'},
                    favored_terrain={'value': 'forest', 'level_acquired': 1, 'source': 'ranger'}
                )
            )
            await db.commit()
            print('已将角色修改为游侠，设置宿敌为野兽，地形为森林')

asyncio.run(main())

