from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, Dict, List, Any, Literal
from datetime import datetime


class NPCQuest(BaseModel):
    """Schema for NPC quest - 基于D&D城主指南的冒险设计"""
    name: str                                          # 任务名称
    description: str = ""                              # 任务描述/背景
    goal_type: Optional[str] = None                    # 目标类型：rescue/eliminate/retrieve/escort/investigate/negotiate
    target: Optional[str] = None                       # 任务目标（要救的人、要杀的怪物、要找的物品等）
    location_hint: Optional[str] = None                # 地点提示
    obstacle: Optional[str] = None                     # 障碍/敌人描述
    reward: Optional[str] = None                       # 奖励描述
    reward_gold: Optional[int] = None                  # 金币奖励
    reward_xp: Optional[int] = None                    # 经验值奖励
    difficulty: Optional[str] = None                   # 难度：easy/medium/hard/deadly
    status: Literal['pending', 'in_progress', 'completed'] = 'pending'


class MonsterInstanceBase(BaseModel):
    """Base monster instance schema"""
    campaign_id: int
    monster_id: str
    name: str
    name_cn: Optional[str] = None
    size: Optional[str] = None
    type: Optional[str] = None
    alignment: Optional[str] = None
    challenge_rating: Optional[str] = None
    armor_class: Optional[int] = None
    hit_points: Optional[int] = None
    hit_dice: Optional[str] = None
    ability_scores: Optional[Dict[str, Any]] = None
    speeds: Optional[Dict[str, Any]] = None
    monster_data: Optional[Dict[str, Any]] = None  # Full monster data from monsters.json
    avatar_url: Optional[str] = None
    avatar_url_large: Optional[str] = None  # Large avatar for 2x2+ display
    has_avatar: bool = False
    current_hp: Optional[int] = None
    conditions: Optional[List[str]] = None
    notes: Optional[str] = None
    token_size: str = "1x1"  # Default to Medium size (1x1 grid)
    # NPC-specific fields
    entity_type: Optional[str] = "monster"  # "monster" or "npc"
    quests: Optional[List[NPCQuest]] = None  # Quests for NPCs
    # Inventory and Currency (for loot drops)
    inventory: Optional[List[Dict[str, Any]]] = None  # [{item_id, name, icon, quantity, ...}]
    currency: Optional[Dict[str, int]] = None  # {cp, sp, ep, gp, pp}
    # Equipment (same format as character EquipmentItem[])
    equipment: Optional[List[Dict[str, Any]]] = None
    # Status effects (same format as character: {effects, conditions, exhaustion_level, ...})
    status_effects: Optional[Dict[str, Any]] = None
    # Spellcasting (DM-assigned)
    selected_spells: Optional[List[str]] = None       # spell IDs
    spell_slots: Optional[List[int]] = None            # max slots per level
    spell_slots_state: Optional[List[int]] = None      # remaining slots
    # Companion/Summon control
    controller_character_id: Optional[int] = None
    control_type: Optional[str] = None  # companion/familiar/summon/mount


class MonsterInstanceCreate(MonsterInstanceBase):
    """Schema for creating a new monster instance"""
    pass


class MonsterInstanceUpdate(BaseModel):
    """Schema for updating a monster instance"""
    # Basic fields
    name: Optional[str] = None
    name_cn: Optional[str] = None
    avatar_url: Optional[str] = None
    avatar_url_large: Optional[str] = None
    has_avatar: Optional[bool] = None
    current_hp: Optional[int] = None
    conditions: Optional[List[str]] = None
    notes: Optional[str] = None
    token_size: Optional[str] = None
    # Core stat fields (editable via double-click in modal)
    armor_class: Optional[int] = None
    hit_points: Optional[int] = None
    ability_scores: Optional[Dict[str, Any]] = None
    speeds: Optional[Dict[str, Any]] = None
    monster_data: Optional[Dict[str, Any]] = None
    # NPC-specific fields
    quests: Optional[List[NPCQuest]] = None
    # Inventory and Currency (for loot drops)
    inventory: Optional[List[Dict[str, Any]]] = None
    currency: Optional[Dict[str, int]] = None
    # Equipment & Status effects
    equipment: Optional[List[Dict[str, Any]]] = None
    status_effects: Optional[Dict[str, Any]] = None
    # Spellcasting (DM-assigned)
    selected_spells: Optional[List[str]] = None
    spell_slots: Optional[List[int]] = None
    spell_slots_state: Optional[List[int]] = None
    # Companion/Summon control
    controller_character_id: Optional[int] = None
    control_type: Optional[str] = None


class MonsterInstanceResponse(MonsterInstanceBase):
    """Schema for monster instance response"""
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class MonsterAvatarGenerationRequest(BaseModel):
    """Request schema for generating monster avatar"""
    monster_instance_id: int
    appearance_description: Optional[str] = None  # Override default description
    created_by: Optional[str] = None  # User ID who generated this avatar
    is_npc: bool = False  # If True, use avatar_npc model config instead of avatar_monster


class MonsterAvatarGenerationResponse(BaseModel):
    """Response schema for monster avatar generation"""
    success: bool
    avatar_url: Optional[str] = None
    avatar_url_large: Optional[str] = None  # Large avatar for 2x2+ display
    prompt: Optional[str] = None
    error: Optional[str] = None

