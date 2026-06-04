"""Resource Chat schemas for API request/response models"""
from pydantic import BaseModel
from typing import List, Optional, Dict, Any, Literal
from datetime import datetime


class ResourceChatMessageCreate(BaseModel):
    """Schema for creating a new chat message"""
    content: str
    mode: Literal['query', 'create'] = 'query'  # query=search only, create=create resources


class ResourceChatMessageResponse(BaseModel):
    """Schema for chat message response"""
    id: int
    campaign_id: int
    user_id: str
    role: str
    content: str
    created_at: datetime

    class Config:
        from_attributes = True


class ResourceChatHistoryResponse(BaseModel):
    """Schema for chat history response"""
    messages: List[ResourceChatMessageResponse]
    total: int


# ===== 遭遇创建相关Schema =====

class EncounterMonsterSpec(BaseModel):
    """单个怪物的规格"""
    name: str                              # 怪物名称
    name_cn: Optional[str] = None          # 中文名
    quantity: int = 1                      # 数量
    monster_id: Optional[str] = None       # monsters.json中的ID
    matched: bool = False                  # 是否匹配到预设怪物
    generated_stats: Optional[Dict[str, Any]] = None  # AI生成的属性(未匹配时)


class EncounterPlan(BaseModel):
    """AI解析后的遭遇计划"""
    monsters: List[EncounterMonsterSpec]
    difficulty: Optional[str] = None       # 难度: 简单/中等/困难/致命
    notes: Optional[str] = None            # 备注


class EncounterConfirmRequest(BaseModel):
    """确认创建遭遇的请求"""
    monsters: List[EncounterMonsterSpec]
    viewport_center: Dict[str, int]        # {x, y} 网格坐标


class EncounterCreateResult(BaseModel):
    """遭遇创建结果"""
    created_monsters: int
    created_tokens: int
    monster_ids: List[int]
    token_ids: List[int]


# ===== Function Calling 工具定义 =====

RESOURCE_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "create_encounter",
            "description": """创建遭遇 - 批量创建怪物实例并放置Token到地图上。
当用户要求设置遭遇、添加怪物到地图、准备战斗等操作时调用此工具。

重要：对于每个怪物，如果是D&D 5E标准怪物（如地精、狗头人、狼等），只需提供name和quantity。
如果是自定义怪物或特殊变体，必须提供完整属性（cr, hp, ac, size, type, abilityScores, actions等）。""",
            "parameters": {
                "type": "object",
                "properties": {
                    "monsters": {
                        "type": "array",
                        "description": "要创建的怪物列表",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "description": "怪物名称(中文或英文)"},
                                "quantity": {"type": "integer", "description": "数量", "default": 1},
                                "cr": {"type": "string", "description": "挑战等级，如'1/4', '1', '5'等"},
                                "hp": {"type": "integer", "description": "生命值"},
                                "hpFormula": {"type": "string", "description": "HP骰子公式，如'2d6+2'"},
                                "ac": {"type": "integer", "description": "护甲等级"},
                                "size": {"type": "string", "description": "体型", "enum": ["微型", "小型", "中型", "大型", "超大型", "巨型"]},
                                "type": {"type": "string", "description": "生物类型，如'人形生物', '野兽', '亡灵', '恶魔'等"},
                                "alignment": {"type": "string", "description": "阵营，如'守序邪恶', '中立'等"},
                                "speed": {
                                    "type": "object",
                                    "description": "移动速度",
                                    "properties": {
                                        "walk": {"type": "integer"},
                                        "fly": {"type": "integer"},
                                        "swim": {"type": "integer"},
                                        "climb": {"type": "integer"},
                                        "burrow": {"type": "integer"}
                                    }
                                },
                                "abilityScores": {
                                    "type": "object",
                                    "description": "属性值",
                                    "properties": {
                                        "str": {"type": "integer"}, "strMod": {"type": "integer"},
                                        "dex": {"type": "integer"}, "dexMod": {"type": "integer"},
                                        "con": {"type": "integer"}, "conMod": {"type": "integer"},
                                        "int": {"type": "integer"}, "intMod": {"type": "integer"},
                                        "wis": {"type": "integer"}, "wisMod": {"type": "integer"},
                                        "cha": {"type": "integer"}, "chaMod": {"type": "integer"}
                                    }
                                },
                                "specialAbilities": {
                                    "type": "array",
                                    "description": "特殊能力列表",
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
                                    "description": "动作列表",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "name": {"type": "string"},
                                            "description": {"type": "string"}
                                        }
                                    }
                                },
                                "description": {"type": "string", "description": "怪物描述/背景故事"}
                            },
                            "required": ["name"]
                        }
                    },
                    "difficulty": {
                        "type": "string",
                        "description": "遭遇难度评估",
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
            "name": "create_shop",
            "description": "创建商店 - 在战役中创建一个新商店(武器店、药水店、杂货店等)并自动添加库存物品。当用户要求创建商店时调用此工具。重要：武器和弹药必须分开列出，如'长弓(含20箭)'应拆分为'长弓'和'箭矢x20'两个物品。",
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
                        "description": "商店库存物品列表(必须提供5-15个物品)。武器和弹药必须分开：如长弓和箭矢是两个物品。常见弹药：箭矢(arrows)、弩矢(crossbow_bolts)、投石索弹丸(sling_bullets)",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "description": "物品名称(使用D&D标准名称如长剑、皮甲、箭矢、治疗药水)"},
                                "price_gp": {"type": "number", "description": "售价(金币)"},
                                "quantity": {"type": "integer", "description": "库存数量", "default": 5},
                                "category": {"type": "string", "enum": ["weapon", "armor", "gear", "ammunition", "potion", "scroll"]},
                                "damage": {
                                    "type": "object",
                                    "description": "武器伤害",
                                    "properties": {
                                        "dice": {"type": "string", "description": "如1d8, 1d6, 2d6"},
                                        "type": {"type": "string", "description": "如slashing, piercing, bludgeoning"}
                                    }
                                },
                                "armor_class": {
                                    "type": "object",
                                    "description": "护甲AC(护甲类物品必填)",
                                    "properties": {
                                        "base": {"type": "integer", "description": "基础AC值"},
                                        "dex_bonus": {"type": "boolean", "description": "是否加敏捷调整值"},
                                        "max_dex_bonus": {"type": "integer", "description": "敏捷加值上限(中甲为2)"}
                                    }
                                },
                                "properties": {
                                    "type": "array",
                                    "description": "武器属性如finesse, light, two-handed, thrown, versatile",
                                    "items": {"type": "string"}
                                },
                                "range": {
                                    "type": "object",
                                    "description": "远程武器射程",
                                    "properties": {
                                        "normal": {"type": "integer"},
                                        "long": {"type": "integer"}
                                    }
                                }
                            },
                            "required": ["name", "price_gp"]
                        }
                    }
                },
                "required": ["name", "description", "items"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_item",
            "description": "创建物品 - 根据描述创建自定义物品(武器、护甲、魔法物品等)。当用户描述一件物品的属性和特性时调用此工具。",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "物品名称"},
                    "name_cn": {"type": "string", "description": "中文名称"},
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
                    "description": {"type": "string", "description": "物品描述和特性说明"},
                    "cost": {
                        "type": "object",
                        "description": "物品价格",
                        "properties": {
                            "amount": {"type": "number"},
                            "unit": {"type": "string", "enum": ["cp", "sp", "gp", "pp"]}
                        }
                    },
                    "weight": {"type": "number", "description": "重量(磅)"},
                    "damage": {
                        "type": "object",
                        "description": "伤害(武器必填)",
                        "properties": {
                            "dice": {"type": "string", "description": "伤害骰如1d8, 1d6, 2d6"},
                            "type": {"type": "string", "description": "伤害类型如slashing, piercing, bludgeoning, fire, cold"}
                        }
                    },
                    "armor_class": {
                        "type": "object",
                        "description": "护甲等级(护甲必填)",
                        "properties": {
                            "base": {"type": "integer", "description": "基础AC值(皮甲11,链甲16等)"},
                            "dex_bonus": {"type": "boolean", "description": "是否加敏捷调整值(轻甲/中甲为true,重甲为false)"},
                            "max_dex_bonus": {"type": "integer", "description": "敏捷加值上限(中甲为2,轻甲为null)"}
                        }
                    },
                    "properties": {
                        "type": "array",
                        "description": "武器属性",
                        "items": {"type": "string", "enum": ["finesse", "light", "heavy", "two-handed", "versatile", "thrown", "reach", "loading", "ammunition", "special"]}
                    },
                    "range": {
                        "type": "object",
                        "description": "远程武器射程",
                        "properties": {
                            "normal": {"type": "integer"},
                            "long": {"type": "integer"}
                        }
                    },
                    "strength_requirement": {"type": "integer", "description": "力量需求(重甲)"},
                    "stealth_disadvantage": {"type": "boolean", "description": "是否造成隐匿劣势"},
                    "magic_bonus": {"type": "integer", "description": "魔法加值(+1/+2/+3)"},
                    "requires_attunement": {"type": "boolean", "description": "是否需要调谐"},
                    "attunement_by": {"type": "string", "description": "调谐要求(如spellcaster, cleric)"},
                    "abilities": {
                        "type": "array",
                        "description": "特殊能力列表",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "type": {"type": "string", "enum": ["passive", "active", "rechargeable"]},
                                "description": {"type": "string"}
                            }
                        }
                    },
                    "charges": {
                        "type": "object",
                        "description": "充能系统",
                        "properties": {
                            "max": {"type": "integer"},
                            "recharge": {"type": "string", "description": "恢复方式如dawn"}
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
            "name": "create_chest",
            "description": """创建宝箱 - 在战役中创建一个宝箱，可包含锁、陷阱、货币和物品。
当用户要求创建宝箱、放置宝藏、设置带陷阱的箱子等操作时调用此工具。

可选陷阱类型：poison_needle(毒针), fire_trap(火焰), alarm(警报), acid_spray(强酸喷射), poison_gas(毒气), blade_trap(刀刃)

锁难度参考：简单10，中等15，困难20，非常困难25""",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "宝箱名称"},
                    "description": {"type": "string", "description": "宝箱描述(内容、来历等)"},
                    "appearance": {"type": "string", "description": "外观描述(用于生成头像)"},
                    "is_locked": {"type": "boolean", "description": "是否上锁", "default": True},
                    "lock_dc": {"type": "integer", "description": "开锁DC", "default": 15},
                    "requires_key": {"type": "boolean", "description": "是否需要钥匙", "default": False},
                    "key_name": {"type": "string", "description": "钥匙名称(需要钥匙时必填)"},
                    "is_trapped": {"type": "boolean", "description": "是否有陷阱", "default": False},
                    "trap_type": {
                        "type": "string",
                        "description": "陷阱类型",
                        "enum": ["poison_needle", "fire_trap", "alarm", "acid_spray", "poison_gas", "blade_trap"]
                    },
                    "currency": {
                        "type": "object",
                        "description": "货币内容",
                        "properties": {
                            "cp": {"type": "integer", "description": "铜币"},
                            "sp": {"type": "integer", "description": "银币"},
                            "ep": {"type": "integer", "description": "银金币"},
                            "gp": {"type": "integer", "description": "金币"},
                            "pp": {"type": "integer", "description": "铂金币"}
                        }
                    },
                    "items": {
                        "type": "array",
                        "description": "宝箱内物品列表",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "description": "物品名称"},
                                "quantity": {"type": "integer", "description": "数量", "default": 1},
                                "category": {"type": "string", "enum": ["weapon", "armor", "gear", "potion", "scroll", "wondrous_item"]},
                                "rarity": {"type": "string", "enum": ["common", "uncommon", "rare", "very_rare", "legendary"]},
                                "description": {"type": "string", "description": "物品描述"}
                            },
                            "required": ["name"]
                        }
                    }
                },
                "required": ["name", "description"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "query_resources",
            "description": "查询战役资源 - 查询战役中的怪物、物品、商店、宝箱信息，回答规则问题，提供战术建议等。这是默认的查询和问答功能。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query_type": {
                        "type": "string",
                        "description": "查询类型",
                        "enum": ["monsters", "items", "shops", "chests", "rules", "tactics", "general"]
                    },
                    "answer": {"type": "string", "description": "对用户问题的回答"}
                },
                "required": ["answer"]
            }
        }
    }
]


# ===== 查询模式专用工具（返回可添加的搜索结果）=====

QUERY_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_and_answer",
            "description": """搜索预设怪物/物品数据库并回答问题。
当用户询问怪物、物品、法术等信息时使用此工具。
如果搜索到匹配的预设数据，在monsters/items字段中返回，用户可以直接添加到资源库。

重要：
- 只返回与用户查询直接相关的结果
- monsters字段返回匹配的怪物（需要是D&D 5E标准怪物）
- items字段返回匹配的装备/物品
- 如果用户只是问规则问题而非搜索特定实体，可以不返回monsters/items""",
            "parameters": {
                "type": "object",
                "properties": {
                    "answer": {
                        "type": "string",
                        "description": "对用户问题的详细回答"
                    },
                    "monsters": {
                        "type": "array",
                        "description": "搜索到的怪物列表（仅当用户搜索怪物时返回）",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "description": "怪物中文名"},
                                "name_en": {"type": "string", "description": "怪物英文名"},
                                "cr": {"type": "string", "description": "挑战等级"},
                                "type": {"type": "string", "description": "生物类型"},
                                "size": {"type": "string", "description": "体型"},
                                "hp": {"type": "integer", "description": "生命值"},
                                "ac": {"type": "integer", "description": "护甲等级"}
                            },
                            "required": ["name"]
                        }
                    },
                    "items": {
                        "type": "array",
                        "description": "搜索到的物品列表（仅当用户搜索物品时返回）",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "description": "物品中文名"},
                                "name_en": {"type": "string", "description": "物品英文名"},
                                "category": {"type": "string", "description": "物品类型(weapon/armor/gear)"},
                                "cost_gp": {"type": "number", "description": "价格(金币)"}
                            },
                            "required": ["name"]
                        }
                    }
                },
                "required": ["answer"]
            }
        }
    }
]


# ===== 商店创建Schema =====

class ShopCreateSpec(BaseModel):
    """商店创建规格"""
    name: str
    description: Optional[str] = None
    appearance: Optional[str] = None
    gold_gp: int = 1000
    discount_rate: float = 0.5


class ShopCreateResult(BaseModel):
    """商店创建结果"""
    shop_id: int
    name: str


# ===== 物品创建Schema =====

class ItemCreateSpec(BaseModel):
    """物品创建规格"""
    name: str
    name_cn: Optional[str] = None
    category: str
    rarity: Optional[str] = "common"
    description: Optional[str] = None
    cost: Optional[Dict[str, Any]] = None
    weight: Optional[float] = None
    damage: Optional[Dict[str, Any]] = None
    armor_class: Optional[Dict[str, Any]] = None
    properties: Optional[List[str]] = None
    range: Optional[Dict[str, Any]] = None
    strength_requirement: Optional[int] = None
    stealth_disadvantage: Optional[bool] = False
    magic_bonus: Optional[int] = None
    requires_attunement: bool = False
    attunement_by: Optional[str] = None
    abilities: Optional[List[Dict[str, Any]]] = None
    charges: Optional[Dict[str, Any]] = None


class ItemCreateResult(BaseModel):
    """物品创建结果"""
    item_id: int
    name: str


# ===== 场景生成相关Schema =====

class SceneNPCQuest(BaseModel):
    """NPC的任务（简化版）"""
    name: str
    description: str
    reward: Optional[str] = None


class SceneNPC(BaseModel):
    """场景中的NPC"""
    name: str                              # 英文名
    name_cn: str                           # 中文名
    role: str                              # 角色定位
    description: str                       # 外貌和性格描述
    position_percent: Dict[str, int]       # {x: 0-100, y: 0-100} 百分比坐标
    quest: Optional[SceneNPCQuest] = None  # 可选的任务


class SceneShopItem(BaseModel):
    """场景商店中的物品"""
    preset_id: Optional[str] = None        # 预设物品ID (equipment.json中的id)
    name: str                              # 物品名称(中文)
    name_en: Optional[str] = None          # 英文名
    price_gp: float                        # 售价(金币)
    quantity: int = 5                      # 库存数量
    category: str                          # weapon, armor, gear, tool, ammunition


class SceneShop(BaseModel):
    """场景中的商店"""
    name: str
    type: str                              # 武器店、杂货店、酒馆等
    description: str
    position_percent: Dict[str, int]       # {x: 0-100, y: 0-100} 百分比坐标
    items: List[SceneShopItem] = []        # 商店库存物品


class ScenePlan(BaseModel):
    """AI生成的场景计划"""
    summary: str                           # 场景总结
    npcs: List[SceneNPC]
    shops: List[SceneShop]


class SceneGenerationRequest(BaseModel):
    """场景生成请求"""
    map_url: str  # 地图URL，后端下载并转base64（避免前端CORS问题）
    chapter_title: str
    chapter_content: str


class SceneCreateResult(BaseModel):
    """场景创建结果"""
    created_npcs: int
    created_shops: int
    created_tokens: int
    npc_ids: List[int]
    shop_ids: List[int]
    token_ids: List[int]


# ===== 宝箱创建Schema =====

class ChestItemSpec(BaseModel):
    """宝箱内物品规格"""
    name: str
    quantity: int = 1
    category: Optional[str] = None
    rarity: Optional[str] = "common"
    description: Optional[str] = None


class ChestCreateSpec(BaseModel):
    """宝箱创建规格"""
    name: str
    description: Optional[str] = None
    appearance: Optional[str] = None
    is_locked: bool = True
    lock_dc: int = 15
    requires_key: bool = False
    key_name: Optional[str] = None
    is_trapped: bool = False
    trap_type: Optional[str] = None
    currency: Optional[Dict[str, int]] = None  # {cp, sp, ep, gp, pp}
    items: Optional[List[ChestItemSpec]] = None


class ChestCreateResult(BaseModel):
    """宝箱创建结果"""
    chest_id: int
    name: str
    items_added: int = 0

