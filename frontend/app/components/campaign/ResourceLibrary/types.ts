// Type definitions for ResourceLibrary components

// Magic item ability
export interface ItemAbility {
  name: string;
  name_en?: string;
  type: 'passive' | 'active' | 'rechargeable' | 'triggered';
  description: string;
  condition?: string;
  uses?: { per: string; max: number };
}

// Magic item charges
export interface ItemCharges {
  max: number;
  current?: number;
  recharge?: { time: string; amount: string };
  on_zero?: { check: string; destroy_on: number };
}

// Magic item spell
export interface ItemSpell {
  name: string;
  name_en?: string;
  charges: number;
  level?: number | string;
  attack_bonus?: number;
  save_dc?: number;
  notes?: string;
}

// Sentient item properties
export interface ItemSentient {
  is_sentient: boolean;
  alignment?: string;
  languages?: string[];
  communication?: string;
  personality?: string;
}

// Item type definition
export interface Item {
  id: number;
  campaign_id: number;
  name: string;
  name_cn?: string;
  category?: string;
  subcategory?: string;
  cost?: { amount: number; unit: string };
  weight?: number;
  rarity?: string;
  damage?: { dice: string; type: string };
  properties?: string[];
  range?: { normal: number; long?: number };
  armor_class?: { base: number; dex_bonus?: boolean; max_dex_bonus?: number };
  strength_requirement?: number;
  stealth_disadvantage?: boolean;
  description?: string;
  description_cn?: string;
  quantity?: number;
  notes?: string;
  is_custom?: boolean;
  // AI-generated avatar
  avatar_url?: string;
  avatar_url_large?: string;
  has_avatar?: boolean;
  // Magic item fields
  requires_attunement?: boolean;
  attunement_by?: string;
  magic_bonus?: number;
  extra_damage?: { dice: string; type: string; condition?: string };
  abilities?: ItemAbility[];
  charges?: ItemCharges;
  item_spells?: ItemSpell[];
  sentient?: ItemSentient;
  source_module?: string;
  created_at?: string;
  updated_at?: string;
}

// Monster Instance type definition
export interface MonsterInstance {
  id: number;
  campaign_id: number;
  monster_id: string;
  name: string;
  name_cn?: string;
  size?: string;
  type?: string;
  alignment?: string;
  challenge_rating?: string;
  armor_class?: number;
  hit_points?: number;
  hit_dice?: string;
  current_hp?: number;
  ability_scores?: Record<string, any>;
  speeds?: Record<string, any>;
  avatar_url?: string;  // Small avatar (128x128)
  avatar_url_large?: string;  // Large avatar (512x512)
  has_avatar: boolean;
  token_size?: string;
  conditions?: string[];
  notes?: string;
  monster_data?: any;
  // NPC-specific fields
  entity_type?: 'monster' | 'npc';  // Distinguish monsters from NPCs
  quests?: NPCQuest[];  // Quests for NPCs only
  // Inventory and Currency (for loot drops)
  inventory?: InventoryItem[];
  currency?: Currency;
}

// Inventory item for monsters/NPCs
export interface InventoryItem {
  id?: number | string;
  name: string;
  name_cn?: string;
  icon?: string;
  quantity: number;
  category?: string;
  stackable?: boolean;
}

// Currency for monsters/NPCs
export interface Currency {
  cp: number;  // Copper pieces
  sp: number;  // Silver pieces
  ep: number;  // Electrum pieces
  gp: number;  // Gold pieces
  pp: number;  // Platinum pieces
}

// Token type definition (from map)
export interface Token {
  id: number;
  campaign_id: number;
  monster_instance_id?: number;
  character_id?: number;
  user_id?: string;
  map_url: string;
  position_x: number;
  position_y: number;
  token_size: string;
  instance_name?: string;
  current_hp?: number;
  monster_name?: string;
  avatar?: string;  // Small avatar (128x128)
  avatar_large?: string;  // Large avatar (512x512)
  item_data?: any;  // Item data for item tokens
  shop_id?: number;  // Shop ID for shop tokens
}

// NPC type (from moduleStore)
export interface NPC {
  id: string;
  name: string;
  name_en?: string;
  race?: string;
  occupation?: string;
  faction?: string;
  alignment?: string;
  is_combatant?: boolean;
  description?: string;
  personality_traits?: string;
  hp?: number;
  ac?: number;
  dialogue_samples?: string[];
  secrets?: string[];
  relationships?: Record<string, string>;
}

// Monster type (from moduleStore, deprecated)
export interface Monster {
  id: string;
  name: string;
  name_en?: string;
  cr: string;
  type?: string;
  hp?: number;
  ac?: number;
  description?: string;
  speed?: string;
  attacks?: any[];
  special_abilities?: any[];
}

// Toast notification type
export interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

// NPC Quest type - 基于D&D城主指南的冒险设计
export interface NPCQuest {
  name: string;                              // 任务名称
  description: string;                       // 任务描述/背景
  goal_type?: string;                        // 目标类型：rescue/eliminate/retrieve/escort/investigate/negotiate
  target?: string;                           // 任务目标
  location_hint?: string;                    // 地点提示
  obstacle?: string;                         // 障碍/敌人描述
  reward?: string;                           // 奖励描述
  reward_gold?: number;                      // 金币奖励
  reward_xp?: number;                        // 经验值奖励
  difficulty?: string;                       // 难度：easy/medium/hard/deadly
  status: 'pending' | 'in_progress' | 'completed';
}
