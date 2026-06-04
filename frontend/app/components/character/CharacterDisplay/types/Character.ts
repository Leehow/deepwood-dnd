export type AbilityScores = {
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
};

export type AbilityScoreId = keyof AbilityScores;

// Spell selection with level tracking
export interface SpellSelection {
  id: string;
  level_learned: number;
  source: string; // Class or source that provided the spell
}

// Generic level-tracked selection for skills, features, etc.
export interface LevelTrackedSelection<T = string> {
  value: T;                    // The actual value (skill ID, feat name, etc.)
  level_acquired: number;      // Character level when acquired
  source: string;              // Source (class, subclass, background, feat, etc.)
  source_detail?: string;      // Additional context
}

// Ability Score Improvement tracking
export interface AbilityScoreImprovement {
  level: number;
  type: 'asi' | 'feat';
  improvements?: Partial<AbilityScores>;  // For ASI
  feat_id?: string;                       // For feat
}

export interface Currency {
  cp?: number;
  sp?: number;
  ep?: number;
  gp?: number;
  pp?: number;
}

export type EquipSlot = "main_hand" | "off_hand" | "armor" | "ammo" | "quick_item" | "clothing" | "accessory";

// Optional, lightweight stat blocks for equipment specialization (non-breaking)
export type WeaponProficiencyGroup = "simple" | "martial";
export type WeaponKind = "melee" | "ranged";

export interface EquipmentDamage {
  dice: string;
  type?: string;
  formula?: string;
  bonus?: number;
  [key: string]: any;
}

export interface WeaponStats {
  damage: string | EquipmentDamage;
  damageType?: string;
  properties?: string[];
  range?: string | { normal: number; long?: number };
}

export interface ArmorStats {
  ac?: number | string;
  acBonus?: number;
  strengthRequired?: number;
  stealthDisadvantage?: boolean;
}


export interface EquipmentItem {
  id: string;
  name: string;
  quantity?: number;
  equippedSlot?: EquipSlot;
  equipmentType?: "weapon" | "armor" | "gear" | "tool" | string;
  weight?: number;
  gripMode?: "one-hand" | "two-hand";  // 仅对 versatile 武器有效
  // Container support - if set, this item is inside a container
  containerId?: string;  // ID of the container item this is stored in
  // Paper writing system
  writtenContent?: string;    // 书写的文字内容
  sourceItemId?: string;      // 原纸类型 ID（如 "parchment"）
  sourceItemName?: string;    // 原纸名称（如 "羊皮纸"）
  // Flat fields kept for backward-compat with existing data and UI logic
  damage?: string | EquipmentDamage;
  damageType?: string;
  properties?: string[];
  range?: string | { normal: number; long?: number };
  ac?: number | string;
  acBonus?: number;
  strengthRequired?: number;
  stealthDisadvantage?: boolean;
  description?: string;
  category?: string;
  iconPath?: string;
  avatar_url?: string;
  avatar_url_large?: string;
  libraryItemId?: number;
  is_custom?: boolean;
  // Optional structured stats (non-breaking)
  weapon?: WeaponStats;
  armor?: ArmorStats;
  [key: string]: any; // allow extra fields from data JSON
}

export interface HotbarSlot {
  type: 'spell' | 'weapon' | 'equipment' | 'feature' | 'item';
  id: string;
  name: string;
  icon?: string;
  meta?: Record<string, any>;
}

export interface Character {
  id: number;
  user_id: string;
  // Basic Information
  name: string;
  race_id: string;
  subrace_id?: string | null;
  class_id: string;
  subclass_id?: string | null;
  background_id?: string | null;
  level: number;
  avatar?: string | null;
  avatar_url?: string | null;

  // Character Details
  gender?: string | null;
  age?: number | string | null;
  alignment?: string | null;
  deity_id?: string | null;
  experience_points?: number;

  // HP & Combat
  current_hp?: number | null;
  max_hp?: number | null;

  // Descriptive
  appearance?: Record<string, any>;
  personality?: Record<string, any>;
  other_traits?: string | null;
  backstory?: string | null;

  // Ability Scores
  ability_scores: AbilityScores;

  // Skills & Proficiencies
  selected_skills?: LevelTrackedSelection[] | string[];
  expertise_skills?: LevelTrackedSelection[] | string[];

  // Class Features & Choices
  fighting_style?: LevelTrackedSelection | string | null;
  favored_enemy?: LevelTrackedSelection | string | null;
  favored_terrain?: LevelTrackedSelection | string | null;
  eldritch_invocations?: LevelTrackedSelection[] | string[];
  ability_score_improvements?: AbilityScoreImprovement[];
  feats?: LevelTrackedSelection[];
  feat_choices?: Record<string, any> | null;
  subclass_choices?: Record<string, any>;
  race_choices?: Record<string, any>;

  // Spells
  // New format with level tracking (backward compatible)
  selected_cantrips?: SpellSelection[] | string[];
  selected_spells?: SpellSelection[] | string[];
  prepared_spells?: string[];
  // Whether prepared casters can change prepared list (from DB, set on long rest / level-up)
  can_prepare_spells?: boolean;
  // Remaining spell slots per level (index = spell level, 0 unused)
  spell_slots_state?: number[];

  // Equipment & Currency
  equipment: EquipmentItem[];
  currency?: Currency;

  // Status effects (buff/debuff/conditions managed by DM)
  status_effects?: Record<string, any> | null;

  // Class feature usage tracking (e.g., Divine Sense 1/2)
  class_feature_uses?: Record<string, any> | null;

  // Hotbar slots
  hotbar?: (HotbarSlot | null)[] | null;

  // Legacy camelCase aliases (frontend compatibility)
  selectedSkills?: string[];
  expertiseSkills?: string[];
  preparedSpells?: string[];
  selectedCantrips?: string[];
  selectedSpells?: string[];
  raceChoices?: Record<string, any>;
  subclassChoices?: Record<string, any>;
  fightingStyle?: string | null;
  otherTraits?: string | null;

  // Metadata
  created_at?: string;
  updated_at?: string | null;
}

export interface CharacterComputed {
  race: any;
  subrace: any;
  charClass: any;
  subclass: any;
  background: any;
  finalAbilityScores: AbilityScores;
  abilityMods: AbilityScores;
  proficiencyBonus: number;
}
