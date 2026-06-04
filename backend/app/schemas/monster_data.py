"""
统一的怪物数据 Schema
用于规范化 MonsterInstance.monster_data 的结构
"""
from typing import Optional, Dict, List, Any
from pydantic import BaseModel, Field


class DamageSchema(BaseModel):
    """伤害结构"""
    dice: Optional[str] = None  # "2d6"
    bonus: Optional[int] = None  # 3
    average: Optional[int] = None  # 10
    type: Optional[str] = None  # "挥砍"/"穿刺"/"钝击"


class SaveSchema(BaseModel):
    """豁免结构"""
    ability: Optional[str] = None  # "体质"/"敏捷"等
    dc: Optional[int] = None  # 15
    success_effect: Optional[str] = None  # "伤害减半"
    fail_effect: Optional[str] = None  # "受到全额伤害"


class AreaSchema(BaseModel):
    """区域效果结构"""
    shape: Optional[str] = None  # "锥形"/"球形"/"线形"
    size: Optional[str] = None  # "30尺"


class UsageSchema(BaseModel):
    """使用限制结构"""
    type: Optional[str] = None  # "recharge"/"per_day"
    value: Optional[Any] = None  # "5-6" 或 3


class ActionSchema(BaseModel):
    """
    标准化的动作结构（与解析格式一致）
    所有 AI 生成的怪物动作都应符合此结构
    """
    name: str
    description: str
    action_category: str = "other"  # multiattack/weapon_attack/special_attack/spell/other
    name_en: Optional[str] = None

    # 武器攻击字段
    attack_type: Optional[str] = None  # melee/ranged/melee_or_ranged
    attack_bonus: Optional[int] = None
    reach: Optional[str] = None  # "5尺"
    range: Optional[str] = None  # "30/120尺"

    # 伤害
    damage: Optional[DamageSchema] = None
    extra_damage: Optional[DamageSchema] = None

    # 豁免和区域效果
    save: Optional[SaveSchema] = None
    area: Optional[AreaSchema] = None

    # 使用限制
    usage: Optional[UsageSchema] = None

    # 多重攻击引用
    multiattack_actions: Optional[List[str]] = None

    class Config:
        extra = "allow"


class SpecialAbilitySchema(BaseModel):
    """特殊能力结构"""
    name: str
    description: str
    name_en: Optional[str] = None

    class Config:
        extra = "allow"


class MonsterDataSchema(BaseModel):
    """
    MonsterInstance.monster_data 的标准结构
    统一所有来源（预设/AI/模组）的怪物数据格式
    """
    # 来源标识
    source: str = "unknown"  # preset/ai/module

    # 基础信息
    name: str
    name_en: Optional[str] = None
    cr: Optional[str] = None  # 挑战等级
    hp: Optional[int] = None
    hp_formula: Optional[str] = None  # "2d8+4"
    ac: Optional[int] = None
    size: Optional[str] = None
    type: Optional[str] = None
    alignment: Optional[str] = None

    # 属性值
    ability_scores: Optional[Dict[str, int]] = None

    # 速度
    speeds: Optional[Dict[str, int]] = None

    # 能力和动作
    special_abilities: Optional[List[SpecialAbilitySchema]] = None
    actions: Optional[List[ActionSchema]] = None
    reactions: Optional[List[Dict]] = None
    legendary_actions: Optional[List[Dict]] = None

    # 来源追踪
    source_module: Optional[str] = None
    source_encounter: Optional[str] = None
    source_id: Optional[str] = None  # 预设怪物ID

    # NPC 特有字段
    is_npc: Optional[bool] = None
    appearance: Optional[str] = None
    background: Optional[str] = None

    class Config:
        extra = "allow"


# AI Prompt 中使用的动作格式说明
ACTION_FORMAT_PROMPT = """
动作格式要求（actions 数组中的每个对象）:
{
    "name": "动作名称",
    "description": "完整描述文本",
    "action_category": "weapon_attack",  // multiattack/weapon_attack/special_attack/spell/other
    "name_en": "Action Name",  // 可选
    "attack_type": "melee",  // 仅weapon_attack: melee/ranged/melee_or_ranged
    "attack_bonus": 5,  // 仅weapon_attack: 命中加值
    "reach": "5尺",  // 仅近战
    "range": "30/120尺",  // 仅远程
    "damage": {
        "dice": "2d6",
        "bonus": 3,
        "average": 10,
        "type": "挥砍"  // 挥砍/穿刺/钝击/火焰等
    },
    "extra_damage": { ... },  // 额外伤害，结构同上
    "save": {
        "ability": "体质",  // 力量/敏捷/体质/智力/感知/魅力
        "dc": 15,
        "success_effect": "伤害减半",
        "fail_effect": "受到全额伤害并被击倒"
    },
    "area": {
        "shape": "锥形",  // 锥形/球形/线形/立方体
        "size": "30尺"
    },
    "usage": {
        "type": "recharge",  // recharge 或 per_day
        "value": "5-6"  // 充能值或每日次数
    },
    "multiattack_actions": ["爪击", "啮咬"]  // 仅multiattack类型
}

注意：
- action_category 是必填字段
- weapon_attack 类型必须有 attack_bonus
- special_attack 类型通常有 save 或 area
- multiattack 类型必须有 multiattack_actions 列出引用的动作
"""
