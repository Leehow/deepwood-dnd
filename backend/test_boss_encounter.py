#!/usr/bin/env python3
"""
测试BOSS战和遭遇生成功能
"""
import asyncio
import httpx
import json

API_BASE = "http://localhost:8174"

# 测试数据
TEST_MODULE_ID = "b2294f0b-354b-46f0-bd93-c1b62b75cd00"  # 实际的module_id
TEST_CAMPAIGN_ID = 2  # 实际的campaign_id

async def test_analyze_entities():
    """测试analyze-entities端点"""
    async with httpx.AsyncClient(timeout=60.0) as client:
        # 测试1: 普通遭遇
        print("=" * 50)
        print("测试1: 普通遭遇 (ENCOUNTER)")
        print("=" * 50)

        encounter_content = """
        在森林小道上，玩家遭遇了一群地精强盗的埋伏。
        这是一场CR 1/4的简单遭遇，适合1级冒险者。
        地精们躲在灌木丛后，准备突袭过往的旅人。
        """

        response = await client.post(
            f"{API_BASE}/api/modules/{TEST_MODULE_ID}/chat/analyze-entities",
            json={
                "content": encounter_content,
                "entity_types": ["ENCOUNTER"],
                "message_id": 1,
                "campaign_id": TEST_CAMPAIGN_ID
            }
        )

        if response.status_code == 200:
            result = response.json()
            print(f"状态: 成功")
            print(f"遭遇数量: {len(result.get('encounters', []))}")
            for enc in result.get('encounters', []):
                print(f"  - {enc.get('title')}: {len(enc.get('monsters', []))}个怪物")
                for m in enc.get('monsters', []):
                    print(f"    - {m.get('name')} x{m.get('count', 1)}, CR {m.get('challenge_rating')}")
        else:
            print(f"状态: 失败 ({response.status_code})")
            print(f"错误: {response.text}")

        print()

        # 测试2: BOSS战
        print("=" * 50)
        print("测试2: BOSS战 (BOSS)")
        print("=" * 50)

        boss_content = """
        在克拉摩堡的最深处，玩家终于面对了地精王克拉摩尔。
        这个狡猾的地精酋长统领着整个部族，身边总是有忠诚的护卫保护。
        他是一个CR 3的强大敌人，身穿破旧的链甲，手持一把锋利的弯刀。
        他的巢穴里还有几只巨狼和地精护卫随时待命。
        """

        response = await client.post(
            f"{API_BASE}/api/modules/{TEST_MODULE_ID}/chat/analyze-entities",
            json={
                "content": boss_content,
                "entity_types": ["BOSS"],
                "message_id": 2,
                "campaign_id": TEST_CAMPAIGN_ID
            }
        )

        if response.status_code == 200:
            result = response.json()
            print(f"状态: 成功")
            print(f"完整返回: {json.dumps(result, ensure_ascii=False, indent=2)[:2000]}")
            print(f"BOSS战数量: {len(result.get('bosses', []))}")
            for boss_enc in result.get('bosses', []):
                print(f"  标题: {boss_enc.get('title')}")
                print(f"  难度: {boss_enc.get('difficulty')}")
                boss = boss_enc.get('boss', {})
                print(f"  BOSS: {boss.get('name')}, CR {boss.get('challenge_rating')}, AC {boss.get('armor_class')}, HP {boss.get('hit_points')}")
                print(f"  小兵:")
                for m in boss_enc.get('minions', []):
                    print(f"    - {m.get('name')} x{m.get('count', 1)}")
        else:
            print(f"状态: 失败 ({response.status_code})")
            print(f"错误: {response.text}")

        print()

        # 测试3: 龙类BOSS (高CR)
        print("=" * 50)
        print("测试3: 龙类BOSS (高CR)")
        print("=" * 50)

        dragon_content = """
        在火山深处的巢穴，一头年轻的红龙正在守护它的宝藏。
        这是一场致命的BOSS战，红龙拥有强大的火焰吐息和锋利的爪牙。
        它的巢穴周围还有几个狗头人仆从在服侍它。
        """

        response = await client.post(
            f"{API_BASE}/api/modules/{TEST_MODULE_ID}/chat/analyze-entities",
            json={
                "content": dragon_content,
                "entity_types": ["BOSS"],
                "message_id": 3,
                "campaign_id": TEST_CAMPAIGN_ID
            }
        )

        if response.status_code == 200:
            result = response.json()
            print(f"状态: 成功")
            print(f"完整返回: {json.dumps(result, ensure_ascii=False, indent=2)[:2000]}")
            print(f"BOSS战数量: {len(result.get('bosses', []))}")
            for boss_enc in result.get('bosses', []):
                print(f"  标题: {boss_enc.get('title')}")
                print(f"  难度: {boss_enc.get('difficulty')}")
                boss = boss_enc.get('boss', {})
                print(f"  BOSS: {boss.get('name')}, CR {boss.get('challenge_rating')}, AC {boss.get('armor_class')}, HP {boss.get('hit_points')}")
                actions = boss.get('actions', [])
                if actions:
                    print(f"  动作: {len(actions)}个")
                    for a in actions[:2]:
                        print(f"    - {a.get('name')}: {a.get('description', '')[:50]}...")
                print(f"  小兵:")
                for m in boss_enc.get('minions', []):
                    print(f"    - {m.get('name')} x{m.get('count', 1)}")
        else:
            print(f"状态: 失败 ({response.status_code})")
            print(f"错误: {response.text}")


async def main():
    print("BOSS战和遭遇生成测试")
    print("=" * 50)
    print(f"API: {API_BASE}")
    print(f"Module ID: {TEST_MODULE_ID}")
    print(f"Campaign ID: {TEST_CAMPAIGN_ID}")
    print()

    try:
        await test_analyze_entities()
    except httpx.ConnectError:
        print("错误: 无法连接到API服务器，请确保后端正在运行")
    except Exception as e:
        print(f"错误: {e}")


if __name__ == "__main__":
    asyncio.run(main())
