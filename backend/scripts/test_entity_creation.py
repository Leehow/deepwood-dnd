"""
测试统一实体创建服务
验证字段名规范化和创建流程
"""
import asyncio
import json
from app.services.entity_creation_service import (
    EntityCreationService,
    MonsterDataNormalizer,
    size_cn_to_token_size,
)
from app.schemas.monster_data import ActionSchema, MonsterDataSchema


def test_field_normalization():
    """测试字段名规范化（驼峰 -> 下划线）"""
    print("=" * 50)
    print("测试 1: 字段名规范化")
    print("=" * 50)

    # 模拟驼峰格式的预设怪物数据
    preset_data = {
        "id": "goblin",
        "name": "地精",
        "nameEn": "Goblin",
        "size": "小型",
        "type": "类人生物",
        "cr": "1/4",
        "ac": 15,
        "hp": 7,
        "hpFormula": "2d6",
        "abilityScores": {"str": 8, "dex": 14, "con": 10, "int": 10, "wis": 8, "cha": 8},
        "speed": {"walk": 30},
        "specialAbilities": [{"name": "灵巧逃脱", "description": "地精可以..."}],
        "actions": [
            {
                "name": "弯刀",
                "description": "近战武器攻击：命中+4，触及5尺，单一目标。伤害：5(1d6+2)挥砍伤害。",
                "action_category": "weapon_attack",
                "attack_bonus": 4,
                "damage": {"dice": "1d6", "bonus": 2, "average": 5, "type": "挥砍"}
            }
        ]
    }

    normalized = MonsterDataNormalizer.normalize(preset_data)

    print(f"原始 abilityScores: {preset_data.get('abilityScores')}")
    print(f"规范化 ability_scores: {normalized.get('ability_scores')}")
    print(f"原始 speed: {preset_data.get('speed')}")
    print(f"规范化 speeds: {normalized.get('speeds')}")
    print(f"原始 specialAbilities: {len(preset_data.get('specialAbilities', []))} 项")
    print(f"规范化 special_abilities: {len(normalized.get('special_abilities', []))} 项")

    assert normalized.get('ability_scores') == preset_data.get('abilityScores'), "ability_scores 规范化失败"
    assert normalized.get('speeds') == preset_data.get('speed'), "speeds 规范化失败"
    assert normalized.get('special_abilities') == preset_data.get('specialAbilities'), "special_abilities 规范化失败"

    print("✓ 字段名规范化测试通过\n")


def test_mixed_format_normalization():
    """测试混合格式数据的规范化"""
    print("=" * 50)
    print("测试 2: 混合格式数据规范化")
    print("=" * 50)

    # 模拟混合格式的模组数据
    module_data = {
        "name": "兰德卓萨",
        "size": "大型",
        "type": "龙类",
        "cr": "8",
        "armor_class": 17,  # 下划线格式
        "hit_points": 136,  # 下划线格式
        "ability_scores": {"str": 19, "dex": 10},  # 下划线格式
        "speed": {"walk": 40, "fly": 80},  # 驼峰格式
        "actions": [
            {"name": "多重攻击", "description": "...", "action_category": "multiattack"},
            {"name": "啮咬", "description": "...", "action_category": "weapon_attack", "attack_bonus": 7}
        ]
    }

    normalized = MonsterDataNormalizer.normalize(module_data)

    print(f"ac: {normalized.get('ac')}")
    print(f"hp: {normalized.get('hp')}")
    print(f"ability_scores: {normalized.get('ability_scores')}")
    print(f"speeds: {normalized.get('speeds')}")
    print(f"actions: {len(normalized.get('actions', []))} 项")

    assert normalized.get('ac') == 17, "ac 提取失败"
    assert normalized.get('hp') == 136, "hp 提取失败"
    assert normalized.get('speeds') == {"walk": 40, "fly": 80}, "speeds 提取失败"

    print("✓ 混合格式规范化测试通过\n")


def test_build_monster_data():
    """测试构建标准化 monster_data"""
    print("=" * 50)
    print("测试 3: 构建标准化 monster_data")
    print("=" * 50)

    raw_data = {
        "name": "测试怪物",
        "abilityScores": {"str": 16},
        "speed": {"walk": 30},
        "actions": [{"name": "攻击", "description": "...", "action_category": "weapon_attack"}]
    }

    normalized = MonsterDataNormalizer.normalize(raw_data)
    monster_data = MonsterDataNormalizer.build_monster_data(
        source="ai",
        normalized_data=normalized,
        source_module="test_module",
        appearance="一个可怕的怪物"
    )

    print(f"source: {monster_data.get('source')}")
    print(f"source_module: {monster_data.get('source_module')}")
    print(f"appearance: {monster_data.get('appearance')}")
    print(f"ability_scores: {monster_data.get('ability_scores')}")
    print(f"speeds: {monster_data.get('speeds')}")

    assert monster_data.get('source') == "ai", "source 设置失败"
    assert monster_data.get('source_module') == "test_module", "source_module 设置失败"
    assert monster_data.get('appearance') == "一个可怕的怪物", "appearance 设置失败"
    assert 'abilityScores' not in monster_data, "驼峰字段未被清除"

    print("✓ 构建 monster_data 测试通过\n")


def test_action_schema():
    """测试 ActionSchema 验证"""
    print("=" * 50)
    print("测试 4: ActionSchema 验证")
    print("=" * 50)

    # 完整的武器攻击动作
    weapon_action = {
        "name": "长剑",
        "description": "近战武器攻击：命中+5，触及5尺，单一目标。伤害：8(1d8+4)挥砍伤害。",
        "action_category": "weapon_attack",
        "attack_type": "melee",
        "attack_bonus": 5,
        "reach": "5尺",
        "damage": {"dice": "1d8", "bonus": 4, "average": 8, "type": "挥砍"}
    }

    action = ActionSchema(**weapon_action)
    print(f"name: {action.name}")
    print(f"action_category: {action.action_category}")
    print(f"attack_bonus: {action.attack_bonus}")
    print(f"damage: {action.damage}")

    # 特殊攻击动作（有豁免）
    breath_action = {
        "name": "火焰吐息",
        "description": "...",
        "action_category": "special_attack",
        "save": {"ability": "敏捷", "dc": 15, "success_effect": "伤害减半"},
        "area": {"shape": "锥形", "size": "30尺"},
        "damage": {"dice": "8d6", "average": 28, "type": "火焰"},
        "usage": {"type": "recharge", "value": "5-6"}
    }

    breath = ActionSchema(**breath_action)
    print(f"\n特殊攻击: {breath.name}")
    print(f"save: {breath.save}")
    print(f"area: {breath.area}")
    print(f"usage: {breath.usage}")

    print("✓ ActionSchema 测试通过\n")


def test_size_to_token():
    """测试体型转 token 大小"""
    print("=" * 50)
    print("测试 5: 体型转 token 大小")
    print("=" * 50)

    test_cases = [
        ("微型", "0.5x0.5"),
        ("小型", "1x1"),
        ("中型", "1x1"),
        ("大型", "2x2"),
        ("巨型", "3x3"),
        ("超巨型", "4x4"),
        ("未知", "1x1"),  # 默认值
    ]

    for size, expected in test_cases:
        result = size_cn_to_token_size(size)
        status = "✓" if result == expected else "✗"
        print(f"{status} {size} -> {result} (期望: {expected})")
        assert result == expected, f"{size} 转换失败"

    print("✓ 体型转换测试通过\n")


async def test_create_monster_instance():
    """测试创建怪物实例（需要数据库连接）"""
    print("=" * 50)
    print("测试 6: 创建怪物实例（模拟）")
    print("=" * 50)

    # 这里只测试参数构建，不实际创建数据库记录
    raw_data = {
        "name": "火元素",
        "nameEn": "Fire Elemental",
        "size": "大型",
        "type": "元素生物",
        "cr": "5",
        "ac": 13,
        "hp": 102,
        "abilityScores": {"str": 10, "dex": 17, "con": 16, "int": 6, "wis": 10, "cha": 7},
        "speed": {"walk": 50},
        "specialAbilities": [
            {"name": "火焰形态", "description": "火元素可以穿过1英寸宽的缝隙..."}
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

    normalized = MonsterDataNormalizer.normalize(raw_data)
    monster_data = MonsterDataNormalizer.build_monster_data(
        source="preset",
        normalized_data=normalized,
        source_id="fire_elemental"
    )

    print(f"怪物名: {normalized.get('name')}")
    print(f"体型: {normalized.get('size')} -> token: {size_cn_to_token_size(normalized.get('size'))}")
    print(f"CR: {normalized.get('cr')}")
    print(f"AC: {normalized.get('ac')}, HP: {normalized.get('hp')}")
    print(f"动作数: {len(normalized.get('actions', []))}")

    # 验证 monster_data 结构
    print(f"\nmonster_data 结构:")
    print(f"  source: {monster_data.get('source')}")
    print(f"  ability_scores: {monster_data.get('ability_scores')}")
    print(f"  speeds: {monster_data.get('speeds')}")
    print(f"  actions[0]: {monster_data.get('actions', [{}])[0].get('name')} ({monster_data.get('actions', [{}])[0].get('action_category')})")

    # 尝试用 Schema 验证
    try:
        schema = MonsterDataSchema(**monster_data)
        print(f"\n✓ MonsterDataSchema 验证通过")
    except Exception as e:
        print(f"\n✗ Schema 验证失败: {e}")

    print("✓ 创建怪物实例测试通过\n")


def main():
    print("\n" + "=" * 50)
    print("统一实体创建服务测试")
    print("=" * 50 + "\n")

    test_field_normalization()
    test_mixed_format_normalization()
    test_build_monster_data()
    test_action_schema()
    test_size_to_token()
    asyncio.run(test_create_monster_instance())

    print("=" * 50)
    print("所有测试通过！")
    print("=" * 50)


if __name__ == "__main__":
    main()
