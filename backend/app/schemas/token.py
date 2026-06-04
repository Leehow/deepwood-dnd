from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Dict, Any


class TokenBase(BaseModel):
    campaign_id: int
    character_id: Optional[int] = None  # NULL for monster/item tokens
    monster_instance_id: Optional[int] = None  # NULL for character/item tokens
    item_data: Optional[Dict[str, Any]] = None  # NULL for character/monster tokens
    item_quantity: Optional[int] = None  # NULL for character/monster tokens
    shop_id: Optional[int] = None  # NULL for character/monster/item tokens
    loot_bag_data: Optional[Dict[str, Any]] = None  # NULL for character/monster/item/shop tokens
    chest_id: Optional[int] = None  # NULL for character/monster/item/shop/loot_bag tokens
    user_id: Optional[str] = None  # NULL for monster tokens
    map_url: str
    position_x: int
    position_y: int
    token_size: str = "1x1"  # Default to Medium size (1x1 grid), items typically "0.5x0.5"
    instance_name: Optional[str] = None  # Display name (e.g., "地精1", "长弓 x5")
    current_hp: Optional[int] = None  # Current HP for this token instance (NULL for items)
    temp_hp: Optional[int] = None  # Temporary HP buffer (D&D 5E)


class TokenCreate(TokenBase):
    pass


class TokenPositionUpdate(BaseModel):
    position_x: int
    position_y: int


class TokenSizeUpdate(BaseModel):
    token_size: str  # Format: "WxH" like "1x1", "2x2", "2x3"


class TokenHPUpdate(BaseModel):
    current_hp: int  # New current HP value
    force: bool = False  # DM direct set: skip temp HP absorption


class TokenTempHPUpdate(BaseModel):
    temp_hp: int  # Temporary HP value (D&D 5E: take highest, don't stack)
    force: bool = False  # DM override: set directly without max() check


class TokenActiveEffectsUpdate(BaseModel):
    """Update active status effects on a token"""
    active_effects: List[Dict[str, Any]]  # [{id, name, icon, color, source?}]


class TokenAurasUpdate(BaseModel):
    """Update active auras on a token"""
    active_auras: List[Dict[str, Any]]  # [{id, radius, source_cha_mod?, enabled?}]


class TokenFactionUpdate(BaseModel):
    """Update faction for a token"""
    faction: str  # "player", "enemy", "neutral"


class TokenTransformationUpdate(BaseModel):
    """Update transformation data for a token (Wild Shape, Polymorph, etc.)"""
    transformation_data: Optional[Dict[str, Any]] = None  # None to end transformation
    caster_token_id: Optional[int] = None  # Token ID of the caster (for concentration tracking)


class TokenConcentrationUpdate(BaseModel):
    """Update concentration spell data for a token"""
    concentration_spell: Optional[Dict[str, Any]] = None  # None to break concentration


class TokenDisguiseUpdate(BaseModel):
    """Update disguise/illusion appearance data for a token"""
    disguise_data: Optional[Dict[str, Any]] = None  # None to dismiss disguise


class TokenResponse(TokenBase):
    id: int
    character_name: Optional[str] = None
    character_race: Optional[str] = None  # race_id for character tokens
    character_class: Optional[str] = None  # class_id for character tokens
    character_level: Optional[int] = None  # level for character tokens
    monster_name: Optional[str] = None  # For monster tokens (English name)
    monster_name_cn: Optional[str] = None  # For monster tokens (Chinese name)
    monster_type: Optional[str] = None  # creature type for monster tokens (beast, humanoid, etc.)
    monster_size: Optional[str] = None  # size for monster tokens (Small, Medium, Large, etc.)
    shop_name: Optional[str] = None  # For shop tokens
    chest_name: Optional[str] = None  # For chest tokens
    chest_state: Optional[str] = None  # For chest tokens (locked, unlocked, open, looted)
    avatar: Optional[str] = None  # Small avatar (128x128)
    avatar_large: Optional[str] = None  # Large avatar (512x512) for 2x2+ tokens
    max_hp: Optional[int] = None  # Max HP for display (from character or monster instance)
    active_effects: Optional[List[Dict[str, Any]]] = None  # Active status effects
    active_auras: Optional[List[Dict[str, Any]]] = None  # Active auras emitted by this token
    faction: Optional[str] = "player"  # Faction for aura filtering in combat
    transformation_data: Optional[Dict[str, Any]] = None  # Transformation data (Wild Shape, Polymorph, etc.)
    concentration_spell: Optional[Dict[str, Any]] = None  # Active concentration spell with save data
    casting_in_progress: Optional[Dict[str, Any]] = None  # Active long casting / ritual casting state
    disguise_data: Optional[Dict[str, Any]] = None  # Disguise/illusion appearance override
    temp_hp: Optional[int] = None  # Temporary HP buffer
    death_saves: Optional[Dict[str, Any]] = None  # Death saving throws tracker
    spell_overlays: Optional[List[Dict[str, Any]]] = None  # Runtime-projected spell overlays for token UI
    spell_badges: Optional[List[Dict[str, Any]]] = None  # Runtime-projected compact spell badges
    spell_visuals: Optional[List[Dict[str, Any]]] = None  # Runtime-projected token visuals
    granted_actions_ui: Optional[List[Dict[str, Any]]] = None  # Runtime-projected granted actions
    attached_runtime_refs: Optional[List[Dict[str, Any]]] = None  # Runtime instance refs attached to token
    controller_character_id: Optional[int] = None  # Character that controls this companion/summon
    control_type: Optional[str] = None  # companion/familiar/summon/mount
    entity_type: Optional[str] = None  # "monster" or "npc" (from monster_instance)

    model_config = ConfigDict(from_attributes=True)


class TokensResponse(BaseModel):
    tokens: List[TokenResponse]


# Loot Bag Schemas
class LootBagCreateRequest(BaseModel):
    """Request to create a loot bag from a dead monster"""
    monster_token_id: int
    position_x: Optional[int] = None  # If None, use monster token position
    position_y: Optional[int] = None


class LootBagLootRequest(BaseModel):
    """Request to loot items/currency from a loot bag"""
    character_id: int
    item_indices: Optional[List[int]] = None  # None = take all items
    take_currency: bool = True


class LootBagLootResponse(BaseModel):
    """Response after looting a loot bag"""
    success: bool
    items_taken: List[Dict[str, Any]]
    currency_taken: Dict[str, int]
    remaining_items: List[Dict[str, Any]]
    remaining_currency: Dict[str, int]
    bag_empty: bool  # If true, bag token was deleted
