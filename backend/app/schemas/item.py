from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, Dict, List, Any
from datetime import datetime


class ItemCost(BaseModel):
    """Item cost structure"""
    amount: float
    unit: str = "gp"  # gp, sp, cp, etc.


class ItemDamage(BaseModel):
    """Weapon damage structure"""
    dice: str  # e.g., "1d8"
    type: str  # slashing, piercing, bludgeoning, etc.


class ItemRange(BaseModel):
    """Weapon range structure"""
    normal: int
    long: Optional[int] = None


class ItemArmorClass(BaseModel):
    """Armor class structure"""
    base: int
    dex_bonus: bool = False
    max_dex_bonus: Optional[int] = None


class ItemExtraDamage(BaseModel):
    """Extra damage for magic weapons"""
    dice: str  # e.g., "2d6"
    type: str  # necrotic, fire, etc.
    condition: Optional[str] = None  # "on_hit", "attuned", etc.


class ItemAbility(BaseModel):
    """Special ability structure"""
    name: str
    name_en: Optional[str] = None
    type: str = "passive"  # passive, active, rechargeable, triggered
    description: str
    condition: Optional[str] = None
    uses: Optional[Dict[str, Any]] = None  # {"per": "day", "max": 1}
    effects: Optional[Dict[str, Any]] = None


class ItemCharges(BaseModel):
    """Charges system structure"""
    max: int
    current: Optional[int] = None
    recharge: Optional[Dict[str, Any]] = None  # {"time": "dawn", "amount": "1d6+1"}
    on_zero: Optional[Dict[str, Any]] = None  # {"check": "d20", "destroy_on": 20}


class ItemSpell(BaseModel):
    """Spell that can be cast from item"""
    name: str
    name_en: Optional[str] = None
    charges: int = 0  # 0 = free
    level: Optional[Any] = None  # int or "cantrip"
    attack_bonus: Optional[int] = None
    save_dc: Optional[int] = None
    notes: Optional[str] = None


class ItemSentient(BaseModel):
    """Sentient item properties"""
    is_sentient: bool = True
    alignment: Optional[str] = None
    languages: Optional[List[str]] = None
    communication: Optional[str] = None  # speech, telepathy, empathy
    personality: Optional[str] = None


class ItemBase(BaseModel):
    """Base item schema for creation"""
    campaign_id: int
    name: str
    name_cn: Optional[str] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None
    cost: Optional[Dict[str, Any]] = None
    weight: Optional[float] = None
    rarity: Optional[str] = "common"
    damage: Optional[Dict[str, Any]] = None
    properties: Optional[List[str]] = None
    range: Optional[Dict[str, Any]] = None
    armor_class: Optional[Dict[str, Any]] = None
    strength_requirement: Optional[int] = None
    stealth_disadvantage: bool = False
    description: Optional[str] = None
    description_cn: Optional[str] = None
    quantity: int = 1
    notes: Optional[str] = None
    # Custom extensions
    is_custom: Optional[bool] = False
    avatar_url: Optional[str] = None
    avatar_url_large: Optional[str] = None
    has_avatar: Optional[bool] = False
    # Magic item fields
    requires_attunement: Optional[bool] = False
    attunement_by: Optional[str] = None
    magic_bonus: Optional[int] = None
    extra_damage: Optional[Dict[str, Any]] = None
    abilities: Optional[List[Dict[str, Any]]] = None
    charges: Optional[Dict[str, Any]] = None
    item_spells: Optional[List[Dict[str, Any]]] = None
    sentient: Optional[Dict[str, Any]] = None
    source_module: Optional[str] = None


class ItemCreate(ItemBase):
    """Schema for creating a new item"""
    pass


class ItemUpdate(BaseModel):
    """Schema for updating an item"""
    name: Optional[str] = None
    name_cn: Optional[str] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None
    cost: Optional[Dict[str, Any]] = None
    weight: Optional[float] = None
    rarity: Optional[str] = None
    damage: Optional[Dict[str, Any]] = None
    properties: Optional[List[str]] = None
    range: Optional[Dict[str, Any]] = None
    armor_class: Optional[Dict[str, Any]] = None
    strength_requirement: Optional[int] = None
    stealth_disadvantage: Optional[bool] = None
    description: Optional[str] = None
    description_cn: Optional[str] = None
    quantity: Optional[int] = None
    notes: Optional[str] = None
    # Custom extensions
    is_custom: Optional[bool] = None
    avatar_url: Optional[str] = None
    avatar_url_large: Optional[str] = None
    has_avatar: Optional[bool] = None
    # Magic item fields
    requires_attunement: Optional[bool] = None
    attunement_by: Optional[str] = None
    magic_bonus: Optional[int] = None
    extra_damage: Optional[Dict[str, Any]] = None
    abilities: Optional[List[Dict[str, Any]]] = None
    charges: Optional[Dict[str, Any]] = None
    item_spells: Optional[List[Dict[str, Any]]] = None
    sentient: Optional[Dict[str, Any]] = None
    source_module: Optional[str] = None


class ItemResponse(ItemBase):
    """Schema for item response"""
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

