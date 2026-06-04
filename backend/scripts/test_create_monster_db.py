"""
测试实际创建怪物实例到数据库
"""
import asyncio
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select

from app.core.config import settings
from app.services.entity_creation_service import EntityCreationService, MonsterDataNormalizer
from app.models.monster_instance import MonsterInstance


async def main():
    # 连接数据库
    engine = create_async_engine(settings.DATABASE_URL)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    # 测试数据：一个完整的怪物
    test_monster = {
        "name": "测试火元素",
        "nameEn": "Test Fire Elemental",
        "size": "大型",
        "type": "元素生物",
        "cr": "5",
        "ac": 13,
        "hp": 102,
        "abilityScores": {"str": 10, "dex": 17, "con": 16, "int": 6, "wis": 10, "cha": 7},
        "speed": {"walk": 50},
        "specialAbilities": [
            {"name": "火焰形态", "description": "火元素可以穿过1英寸宽的缝隙"}
        ],
        "actions": [
            {
                "name": "多重攻击",
                "description": "火元素发动两次触碰攻击。",
                "action_category": "multiattack",
                "multiattack_actions": ["触碰"]
            },
            {
                "name": "触碰",
                "description": "近战武器攻击：命中+6，触及5尺，单一目标。伤害：10(2d6+3)火焰伤害。",
                "action_category": "weapon_attack",
                "attack_type": "melee",
                "attack_bonus": 6,
                "reach": "5尺",
                "damage": {"dice": "2d6", "bonus": 3, "average": 10, "type": "火焰"}
            }
        ]
    }

    async with async_session() as db:
        # 查询一个存在的 campaign_id
        from app.models.campaign import Campaign
        result = await db.execute(select(Campaign).limit(1))
        campaign = result.scalar_one_or_none()

        if not campaign:
            print("❌ 没有找到任何战役，无法创建测试怪物")
            return

        print(f"使用战役: {campaign.name} (ID: {campaign.id})")

        # 使用统一服务创建怪物
        monster = await EntityCreationService.create_from_raw_data(
            db=db,
            campaign_id=campaign.id,
            raw_data=test_monster,
            source="ai",
            monster_id="test_fire_elemental_001",
        )

        await db.commit()

        print(f"\n✅ 创建成功!")
        print(f"   ID: {monster.id}")
        print(f"   名称: {monster.name}")
        print(f"   体型: {monster.size}")
        print(f"   CR: {monster.challenge_rating}")
        print(f"   AC: {monster.armor_class}")
        print(f"   HP: {monster.hit_points}")
        print(f"   Token大小: {monster.token_size}")
        print(f"\n   monster_data.source: {monster.monster_data.get('source')}")
        print(f"   monster_data.ability_scores: {monster.monster_data.get('ability_scores')}")
        print(f"   monster_data.speeds: {monster.monster_data.get('speeds')}")
        print(f"   monster_data.actions: {len(monster.monster_data.get('actions', []))} 个动作")

        # 显示动作详情
        for i, action in enumerate(monster.monster_data.get('actions', [])):
            print(f"\n   动作 {i+1}: {action.get('name')}")
            print(f"     类型: {action.get('action_category')}")
            if action.get('attack_bonus'):
                print(f"     命中: +{action.get('attack_bonus')}")
            if action.get('damage'):
                dmg = action.get('damage')
                print(f"     伤害: {dmg.get('dice')}+{dmg.get('bonus')} {dmg.get('type')}")


if __name__ == "__main__":
    asyncio.run(main())
