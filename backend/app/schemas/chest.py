"""Pydantic schemas for Chest and ChestInventory"""
from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


# ==================== Chest Schemas ====================

class TrapEffect(BaseModel):
    """Trap effect details"""
    damage: Optional[str] = None  # e.g., "2d6"
    damage_type: Optional[str] = None  # e.g., "fire", "poison"
    save_dc: Optional[int] = None
    save_ability: Optional[str] = None  # e.g., "DEX", "CON"
    effect_text: Optional[str] = None  # Full description


class ChestBase(BaseModel):
    campaign_id: int
    name: str
    description: Optional[str] = None
    appearance_description: Optional[str] = None
    state: str = "locked"
    # Lock
    is_locked: bool = True
    lock_dc: int = 15
    requires_key: bool = False
    key_name: Optional[str] = None
    # Trap
    is_trapped: bool = False
    trap_detected: bool = False
    trap_disarmed: bool = False
    trap_triggered: bool = False
    trap_type: Optional[str] = None
    trap_detection_dc: int = 15
    trap_disarm_dc: int = 15
    trap_effect: Optional[Dict[str, Any]] = None
    # Currency
    cp: int = 0
    sp: int = 0
    ep: int = 0
    gp: int = 0
    pp: int = 0
    # Avatar
    avatar_url: Optional[str] = None
    avatar_url_large: Optional[str] = None
    has_avatar: bool = False


class ChestCreate(ChestBase):
    pass


class ChestUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    appearance_description: Optional[str] = None
    state: Optional[str] = None
    # Lock
    is_locked: Optional[bool] = None
    lock_dc: Optional[int] = None
    requires_key: Optional[bool] = None
    key_name: Optional[str] = None
    # Trap
    is_trapped: Optional[bool] = None
    trap_detected: Optional[bool] = None
    trap_disarmed: Optional[bool] = None
    trap_triggered: Optional[bool] = None
    trap_type: Optional[str] = None
    trap_detection_dc: Optional[int] = None
    trap_disarm_dc: Optional[int] = None
    trap_effect: Optional[Dict[str, Any]] = None
    # Currency
    cp: Optional[int] = None
    sp: Optional[int] = None
    ep: Optional[int] = None
    gp: Optional[int] = None
    pp: Optional[int] = None
    # Avatar
    avatar_url: Optional[str] = None
    avatar_url_large: Optional[str] = None
    has_avatar: Optional[bool] = None


class ChestResponse(ChestBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


# ==================== Chest Inventory Schemas ====================

class ChestInventoryBase(BaseModel):
    item_id: int
    quantity: int = 1


class ChestInventoryCreate(ChestInventoryBase):
    pass


class ChestInventoryUpdate(BaseModel):
    quantity: Optional[int] = None


class ChestInventoryResponse(ChestInventoryBase):
    id: int
    chest_id: int
    model_config = ConfigDict(from_attributes=True)


class ChestWithInventory(ChestResponse):
    inventory: List[ChestInventoryResponse] = []


# ==================== Interaction Request/Response Schemas ====================

class InvestigateRequest(BaseModel):
    """Request to investigate (detect trap) a chest"""
    character_id: int
    roll_result: int = Field(..., description="Investigation/Perception check result")


class InvestigateResponse(BaseModel):
    success: bool
    trap_detected: bool
    message: str
    chest: ChestResponse


class PickLockRequest(BaseModel):
    """Request to pick a lock"""
    character_id: int
    roll_result: int = Field(..., description="Dexterity (Thieves' Tools) check result")


class PickLockResponse(BaseModel):
    success: bool
    unlocked: bool
    message: str
    chest: ChestResponse


class DisarmTrapRequest(BaseModel):
    """Request to disarm a trap"""
    character_id: int
    roll_result: int = Field(..., description="Dexterity (Thieves' Tools) check result")


class DisarmTrapResponse(BaseModel):
    success: bool
    disarmed: bool
    triggered: bool
    damage_taken: Optional[str] = None
    message: str
    chest: ChestResponse


class OpenChestRequest(BaseModel):
    """Request to open a chest"""
    character_id: int


class OpenChestResponse(BaseModel):
    success: bool
    trap_triggered: bool
    damage_taken: Optional[str] = None
    message: str
    chest: ChestResponse
    contents: Optional[Dict[str, Any]] = None  # Items and currency


class LootRequest(BaseModel):
    """Request to loot items from chest"""
    character_id: int
    items: Optional[List[Dict[str, Any]]] = None  # [{inventory_id, quantity}]
    take_currency: bool = True


class LootResponse(BaseModel):
    success: bool
    message: str
    looted_items: List[Dict[str, Any]] = []
    looted_currency: Dict[str, int] = {}
    chest: ChestResponse


# ==================== Avatar Generation ====================

class ChestAvatarGenRequest(BaseModel):
    prompt_override: Optional[str] = None
    size: Optional[str] = "256x256"


# ==================== Trap Presets ====================

TRAP_PRESETS = {
    "poison_needle": {
        "name": "毒针陷阱",
        "trap_type": "poison_needle",
        "trap_effect": {
            "damage": "1d4",
            "damage_type": "穿刺",
            "save_dc": 11,
            "save_ability": "CON",
            "effect_text": "1d4穿刺伤害。DC11体质豁免，失败则中毒1小时。"
        },
        "trap_detection_dc": 15,
        "trap_disarm_dc": 15
    },
    "fire_trap": {
        "name": "火焰陷阱",
        "trap_type": "fire_trap",
        "trap_effect": {
            "damage": "2d6",
            "damage_type": "火焰",
            "save_dc": 13,
            "save_ability": "DEX",
            "effect_text": "2d6火焰伤害，DC13敏捷豁免成功则减半。"
        },
        "trap_detection_dc": 14,
        "trap_disarm_dc": 14
    },
    "alarm": {
        "name": "警报陷阱",
        "trap_type": "alarm",
        "trap_effect": {
            "damage": None,
            "damage_type": None,
            "save_dc": None,
            "save_ability": None,
            "effect_text": "触发时发出响亮警报，300尺内可闻，持续10分钟。"
        },
        "trap_detection_dc": 12,
        "trap_disarm_dc": 12
    },
    "acid_spray": {
        "name": "强酸喷射陷阱",
        "trap_type": "acid_spray",
        "trap_effect": {
            "damage": "3d6",
            "damage_type": "强酸",
            "save_dc": 14,
            "save_ability": "DEX",
            "effect_text": "3d6强酸伤害，DC14敏捷豁免成功则减半。"
        },
        "trap_detection_dc": 16,
        "trap_disarm_dc": 16
    },
    "poison_gas": {
        "name": "毒气陷阱",
        "trap_type": "poison_gas",
        "trap_effect": {
            "damage": "2d8",
            "damage_type": "毒素",
            "save_dc": 13,
            "save_ability": "CON",
            "effect_text": "2d8毒素伤害，DC13体质豁免成功则减半。10尺范围内所有生物受影响。"
        },
        "trap_detection_dc": 15,
        "trap_disarm_dc": 17
    },
    "blade_trap": {
        "name": "刀刃陷阱",
        "trap_type": "blade_trap",
        "trap_effect": {
            "damage": "2d10",
            "damage_type": "挥砍",
            "save_dc": 15,
            "save_ability": "DEX",
            "effect_text": "2d10挥砍伤害，DC15敏捷豁免成功则无伤害。"
        },
        "trap_detection_dc": 17,
        "trap_disarm_dc": 18
    }
}

# Lock DC reference for display
LOCK_DC_REFERENCE = {
    "simple": {"dc": 10, "description": "简单锁（普通木箱）"},
    "average": {"dc": 15, "description": "中等锁（铁锁木箱）"},
    "hard": {"dc": 20, "description": "困难锁（精制保险箱）"},
    "very_hard": {"dc": 25, "description": "非常困难（大师锁）"},
    "nearly_impossible": {"dc": 30, "description": "近乎不可能（传奇锁）"}
}
