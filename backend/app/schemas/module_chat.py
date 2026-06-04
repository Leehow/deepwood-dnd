"""Pydantic schemas for Module Chat API with Function Calling support"""
from pydantic import BaseModel, ConfigDict, Field
from datetime import datetime
from typing import List, Optional, Dict, Any


class ModuleChatMessageCreate(BaseModel):
    """Request schema for creating a chat message"""
    content: str = Field(..., min_length=1, description="User question")
    chapter_titles: Optional[List[str]] = Field(None, description="Selected chapter titles for context")


class ChapterChatRequest(BaseModel):
    """Request schema for chapter editing chat"""
    content: str = Field(..., min_length=1, description="User question")
    chapter_title: str = Field("", description="Current chapter title")
    chapter_content: str = Field("", description="Current chapter markdown content")


class ModuleChatMessageResponse(BaseModel):
    """Response schema for chat messages"""
    id: int
    module_id: str
    user_id: str
    role: str  # 'user' | 'assistant'
    content: str
    session_id: Optional[int] = None
    chapter_title: Optional[str] = None
    analyzed_entities: Optional[Dict[str, Any]] = None  # Cached entity analysis results
    tool_calls: Optional[List[Dict[str, Any]]] = None  # Agent tool calls
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ModuleChatHistoryResponse(BaseModel):
    """Response schema for chat history list"""
    messages: List[ModuleChatMessageResponse]
    total: int


# ===== Session Schemas =====

class ModuleChatSessionCreate(BaseModel):
    """Request schema for creating a chat session"""
    title: Optional[str] = None


class ModuleChatSessionUpdate(BaseModel):
    """Request schema for updating a chat session"""
    title: str = Field(..., min_length=1, max_length=200)


class ModuleChatSessionResponse(BaseModel):
    """Response schema for a chat session"""
    id: int
    module_id: str
    user_id: str
    campaign_id: Optional[int] = None
    title: Optional[str] = None
    message_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ===== Function Calling 工具定义 =====

MODULE_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "query_module",
            "description": "查询模组内容 - 搜索模组中的章节、NPC、怪物、物品、地点等信息并回答问题。当用户询问模组相关问题时使用此工具。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query_type": {
                        "type": "string",
                        "description": "查询类型",
                        "enum": ["chapter", "npc", "monster", "item", "location", "plot", "general"]
                    },
                    "answer": {"type": "string", "description": "基于模组内容的详细回答"}
                },
                "required": ["answer"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_npc",
            "description": "创建NPC - 基于模组背景创建一个NPC角色，生成完整的D&D 5E属性卡。当用户要求创建NPC、生成某个角色的属性、或询问某个NPC的属性时使用此工具。必须包含appearance字段用于头像生成。",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "NPC名称(中文)"},
                    "name_en": {"type": "string", "description": "英文名称"},
                    "role": {"type": "string", "description": "角色定位(守卫、商人、法师、领主等)"},
                    "race": {"type": "string", "description": "种族(人类、精灵、矮人等)"},
                    "type": {"type": "string", "description": "生物类型(类人生物、龙类等)", "default": "类人生物"},
                    "challenge_rating": {"type": "string", "description": "CR等级(0, 1/8, 1/4, 1/2, 1-30)"},
                    "armor_class": {"type": "integer", "description": "AC值"},
                    "hit_points": {"type": "integer", "description": "生命值"},
                    "hit_dice": {"type": "string", "description": "生命骰如4d8+4"},
                    "size": {
                        "type": "string",
                        "description": "体型",
                        "enum": ["微型", "小型", "中型", "大型", "超大型", "巨型"]
                    },
                    "alignment": {"type": "string", "description": "阵营(守序善良、中立等)"},
                    "ability_scores": {
                        "type": "object",
                        "description": "属性值",
                        "properties": {
                            "str": {"type": "integer", "description": "力量"},
                            "dex": {"type": "integer", "description": "敏捷"},
                            "con": {"type": "integer", "description": "体质"},
                            "int": {"type": "integer", "description": "智力"},
                            "wis": {"type": "integer", "description": "感知"},
                            "cha": {"type": "integer", "description": "魅力"}
                        }
                    },
                    "speeds": {
                        "type": "object",
                        "description": "速度",
                        "properties": {
                            "walk": {"type": "integer", "description": "步行速度(尺)"},
                            "fly": {"type": "integer", "description": "飞行速度"},
                            "swim": {"type": "integer", "description": "游泳速度"},
                            "burrow": {"type": "integer", "description": "掘地速度"}
                        }
                    },
                    "skills": {
                        "type": "array",
                        "description": "熟练技能列表",
                        "items": {"type": "string"}
                    },
                    "languages": {
                        "type": "array",
                        "description": "掌握的语言",
                        "items": {"type": "string"}
                    },
                    "special_abilities": {
                        "type": "array",
                        "description": "特殊能力",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "description": "能力名称"},
                                "description": {"type": "string", "description": "能力描述"}
                            }
                        }
                    },
                    "actions": {
                        "type": "array",
                        "description": "动作",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "description": "动作名称"},
                                "description": {"type": "string", "description": "动作描述"},
                                "attack_bonus": {"type": "integer", "description": "攻击加值"},
                                "damage": {"type": "string", "description": "伤害如1d8+3 挥砍"}
                            }
                        }
                    },
                    "appearance": {
                        "type": "string",
                        "description": "外观描述(必需，用于AI头像生成。描述外貌特征、穿着、年龄、表情等)"
                    },
                    "personality": {"type": "string", "description": "性格特点"},
                    "background": {"type": "string", "description": "背景故事"}
                },
                "required": ["name", "challenge_rating", "armor_class", "hit_points", "appearance"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_monster",
            "description": "创建怪物 - 基于模组描述或用户需求创建一个怪物。当模组中提到的怪物不在预设库中，或用户需要自定义怪物时使用。必须包含appearance字段。",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "怪物名称(中文)"},
                    "name_en": {"type": "string", "description": "英文名称"},
                    "type": {"type": "string", "description": "生物类型(野兽、龙类、亡灵等)"},
                    "challenge_rating": {"type": "string", "description": "CR等级"},
                    "armor_class": {"type": "integer", "description": "AC值"},
                    "hit_points": {"type": "integer", "description": "生命值"},
                    "hit_dice": {"type": "string", "description": "生命骰"},
                    "size": {
                        "type": "string",
                        "enum": ["微型", "小型", "中型", "大型", "超大型", "巨型"]
                    },
                    "alignment": {"type": "string", "description": "阵营"},
                    "ability_scores": {
                        "type": "object",
                        "properties": {
                            "str": {"type": "integer"},
                            "dex": {"type": "integer"},
                            "con": {"type": "integer"},
                            "int": {"type": "integer"},
                            "wis": {"type": "integer"},
                            "cha": {"type": "integer"}
                        }
                    },
                    "speeds": {
                        "type": "object",
                        "properties": {
                            "walk": {"type": "integer"},
                            "fly": {"type": "integer"},
                            "swim": {"type": "integer"}
                        }
                    },
                    "damage_resistances": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "伤害抗性"
                    },
                    "damage_immunities": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "伤害免疫"
                    },
                    "condition_immunities": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "状态免疫"
                    },
                    "senses": {
                        "type": "object",
                        "description": "感官",
                        "properties": {
                            "darkvision": {"type": "integer"},
                            "blindsight": {"type": "integer"},
                            "tremorsense": {"type": "integer"},
                            "passive_perception": {"type": "integer"}
                        }
                    },
                    "special_abilities": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "description": {"type": "string"}
                            }
                        }
                    },
                    "actions": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "description": {"type": "string"},
                                "attack_bonus": {"type": "integer"},
                                "damage": {"type": "string"}
                            }
                        }
                    },
                    "legendary_actions": {
                        "type": "array",
                        "description": "传奇动作",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "description": {"type": "string"},
                                "cost": {"type": "integer", "default": 1}
                            }
                        }
                    },
                    "appearance": {
                        "type": "string",
                        "description": "外观描述(必需，用于AI头像生成)"
                    }
                },
                "required": ["name", "type", "challenge_rating", "armor_class", "hit_points", "appearance"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_encounter",
            "description": "创建遭遇 - 组合多个怪物/NPC形成遭遇。当用户要求准备战斗、设置遭遇时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "monsters": {
                        "type": "array",
                        "description": "要创建的怪物/NPC列表",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "description": "名称"},
                                "quantity": {"type": "integer", "description": "数量", "default": 1}
                            },
                            "required": ["name"]
                        }
                    },
                    "difficulty": {
                        "type": "string",
                        "description": "遭遇难度",
                        "enum": ["简单", "中等", "困难", "致命"]
                    },
                    "notes": {"type": "string", "description": "遭遇说明或战术建议"}
                },
                "required": ["monsters"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_item",
            "description": "创建物品 - 基于模组描述创建自定义物品(武器、护甲、魔法物品等)。当模组中提到特殊物品或用户需要自定义物品时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "物品名称(中文)"},
                    "name_en": {"type": "string", "description": "英文名称"},
                    "category": {
                        "type": "string",
                        "description": "物品类型",
                        "enum": ["weapon", "armor", "wondrous_item", "potion", "scroll", "ring", "wand", "rod", "staff", "adventuring_gear"]
                    },
                    "rarity": {
                        "type": "string",
                        "description": "稀有度",
                        "enum": ["common", "uncommon", "rare", "very_rare", "legendary", "artifact"]
                    },
                    "description": {"type": "string", "description": "物品描述和特性"},
                    "damage": {
                        "type": "object",
                        "description": "伤害(武器)",
                        "properties": {
                            "dice": {"type": "string"},
                            "type": {"type": "string"}
                        }
                    },
                    "armor_class": {
                        "type": "object",
                        "description": "护甲等级(护甲)",
                        "properties": {
                            "base": {"type": "integer"},
                            "dex_bonus": {"type": "boolean"},
                            "max_dex_bonus": {"type": "integer"}
                        }
                    },
                    "magic_bonus": {"type": "integer", "description": "魔法加值"},
                    "requires_attunement": {"type": "boolean", "description": "是否需要调谐"},
                    "abilities": {
                        "type": "array",
                        "description": "特殊能力",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "type": {"type": "string", "enum": ["passive", "active", "rechargeable"]},
                                "description": {"type": "string"}
                            }
                        }
                    }
                },
                "required": ["name", "category", "description"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_shop",
            "description": "创建商店 - 基于模组场景创建商店(武器店、药水店、杂货店等)。当模组中提到商店或用户需要创建商店时使用。商店必须包含出售的物品列表。",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "商店名称"},
                    "description": {"type": "string", "description": "商店描述(经营范围、特色等)"},
                    "appearance": {"type": "string", "description": "商店外观描述(用于生成头像)"},
                    "gold_gp": {"type": "integer", "description": "商店金币储备", "default": 1000},
                    "discount_rate": {"type": "number", "description": "回收折扣率(0-1)", "default": 0.5},
                    "items": {
                        "type": "array",
                        "description": "商店出售的物品列表(必需，至少5-10种)",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "description": "物品名称"},
                                "price_gp": {"type": "number", "description": "价格(金币)"},
                                "quantity": {"type": "integer", "description": "库存数量", "default": 5}
                            },
                            "required": ["name"]
                        }
                    }
                },
                "required": ["name", "description", "items"]
            }
        }
    }
]


# ===== NPC/怪物创建Plan Schemas =====

class NPCPlan(BaseModel):
    """AI生成的NPC创建计划"""
    name: str
    name_en: Optional[str] = None
    role: Optional[str] = None
    race: Optional[str] = "人类"
    type: str = "类人生物"
    challenge_rating: str
    armor_class: int
    hit_points: int
    hit_dice: Optional[str] = None
    size: str = "中型"
    alignment: Optional[str] = None
    ability_scores: Optional[Dict[str, int]] = None
    speeds: Optional[Dict[str, int]] = None
    skills: Optional[List[str]] = None
    languages: Optional[List[str]] = None
    special_abilities: Optional[List[Dict[str, str]]] = None
    actions: Optional[List[Dict[str, Any]]] = None
    appearance: str  # Required for avatar generation
    personality: Optional[str] = None
    background: Optional[str] = None


class MonsterPlan(BaseModel):
    """AI生成的怪物创建计划"""
    name: str
    name_en: Optional[str] = None
    type: str
    challenge_rating: str
    armor_class: int
    hit_points: int
    hit_dice: Optional[str] = None
    size: str = "中型"
    alignment: Optional[str] = None
    ability_scores: Optional[Dict[str, int]] = None
    speeds: Optional[Dict[str, int]] = None
    damage_resistances: Optional[List[str]] = None
    damage_immunities: Optional[List[str]] = None
    condition_immunities: Optional[List[str]] = None
    senses: Optional[Dict[str, int]] = None
    special_abilities: Optional[List[Dict[str, str]]] = None
    actions: Optional[List[Dict[str, Any]]] = None
    legendary_actions: Optional[List[Dict[str, Any]]] = None
    appearance: str


class EncounterMonsterSpec(BaseModel):
    """遭遇中的怪物规格"""
    name: str
    quantity: int = 1


class EncounterPlan(BaseModel):
    """AI生成的遭遇创建计划"""
    monsters: List[EncounterMonsterSpec]
    difficulty: Optional[str] = None
    notes: Optional[str] = None


class ItemPlan(BaseModel):
    """AI生成的物品创建计划"""
    name: str
    name_en: Optional[str] = None
    category: str
    rarity: str = "common"
    description: str
    damage: Optional[Dict[str, str]] = None
    armor_class: Optional[Dict[str, Any]] = None
    magic_bonus: Optional[int] = None
    requires_attunement: bool = False
    abilities: Optional[List[Dict[str, Any]]] = None


class ShopItemPlan(BaseModel):
    """商店物品计划"""
    name: str
    price_gp: Optional[float] = None
    quantity: int = 5


class ShopPlan(BaseModel):
    """AI生成的商店创建计划"""
    name: str
    description: str
    appearance: Optional[str] = None
    appearance_description: Optional[str] = None  # Alias for appearance
    gold_gp: int = 1000
    discount_rate: float = 0.5
    items: Optional[List[ShopItemPlan]] = None  # Shop inventory items


# ===== 创建请求Schemas =====

class NPCCreateRequest(BaseModel):
    """NPC创建请求"""
    campaign_id: int
    npc_plan: NPCPlan
    map_url: Optional[str] = None
    viewport_center: Optional[Dict[str, int]] = None


class MonsterCreateRequest(BaseModel):
    """怪物创建请求"""
    campaign_id: int
    monster_plan: MonsterPlan
    map_url: Optional[str] = None
    viewport_center: Optional[Dict[str, int]] = None


class EncounterCreateRequest(BaseModel):
    """遭遇创建请求"""
    campaign_id: int
    encounter_plan: EncounterPlan
    map_url: Optional[str] = None
    viewport_center: Optional[Dict[str, int]] = None


class ItemCreateRequest(BaseModel):
    """物品创建请求"""
    campaign_id: int
    item_plan: ItemPlan


class ShopCreateRequest(BaseModel):
    """商店创建请求"""
    campaign_id: int
    shop_plan: ShopPlan


# ===== 创建结果Schemas =====

class CreateResult(BaseModel):
    """通用创建结果"""
    success: bool
    id: int
    name: str
    message: Optional[str] = None


# ===== AI响应Schemas =====

class ToolCallResult(BaseModel):
    """单个工具调用结果"""
    tool: str
    npc_plan: Optional[NPCPlan] = None
    monster_plan: Optional[MonsterPlan] = None
    encounter_plan: Optional[EncounterPlan] = None
    item_plan: Optional[ItemPlan] = None
    shop_plan: Optional[ShopPlan] = None
    answer: Optional[str] = None


class ModuleChatAgentResponse(BaseModel):
    """模组AI Agent响应"""
    content: str  # AI的文字回复
    tool_calls: Optional[List[ToolCallResult]] = None  # 工具调用列表
    message_id: Optional[int] = None  # 保存的消息ID
