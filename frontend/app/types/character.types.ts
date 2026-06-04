/**
 * Character and related types
 */

export interface Character {
  id: number;
  name: string;
  race: string;
  class: string;
  level: number;
  background?: string;
  alignment?: string;
  experience_points: number;

  // Ability scores
  abilities: AbilityScores;

  // Combat stats
  hit_points_current: number;
  hit_points_max: number;
  temporary_hit_points: number;
  armor_class: number;
  initiative: number;
  speed: number;

  // Skills and proficiencies
  skills: Skill[];
  proficiencies: string[];
  languages: string[];
  proficient_skills?: string[];
  proficient_tools?: string[];

  // Inventory
  equipment: Equipment[];
  inventory: InventoryItem[];
  currency: Currency;

  // Spellcasting
  spells?: SpellSlot[];
  spell_slots?: Record<number, { current: number; max: number }>;
  spell_slots_state?: number[] | { slots: number[]; pact_slots?: number[] };

  // Class identification (for subclass features)
  class_id?: string;

  // Character details
  personality_traits?: string;
  ideals?: string;
  bonds?: string;
  flaws?: string;
  backstory?: string;
  notes?: string;

  // Avatar
  avatar_url?: string;

  // Metadata
  campaign_id: number;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface AbilityScores {
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}

export interface Skill {
  name: string;
  ability: keyof AbilityScores;
  proficiency: boolean;
  expertise: boolean;
  bonus: number;
}

export interface Equipment {
  id: number;
  item_id: number;
  name: string;
  category: string;
  equipped: boolean;
  quantity: number;
  properties?: Record<string, unknown>;
}

export interface InventoryItem {
  id: number;
  item_id: number;
  name: string;
  description?: string;
  quantity: number;
  weight?: number;
  value_gp?: number;
}

export interface Currency {
  copper: number;
  silver: number;
  electrum: number;
  gold: number;
  platinum: number;
}

export interface SpellSlot {
  level: number;
  name: string;
  school: string;
  casting_time: string;
  range: string;
  components: string;
  duration: string;
  description: string;
  prepared: boolean;
}

export interface CharacterSheet {
  character: Character;
  features: Feature[];
  actions: Action[];
}

export interface Feature {
  id: string;
  name: string;
  nameEn?: string;
  description: string;
  source: string;
  level_acquired?: number;
  execution?: Record<string, unknown>;
}

export interface Action {
  id: number;
  name: string;
  nameEn?: string;
  action_type: 'action' | 'bonus_action' | 'reaction' | 'free';
  attack_bonus?: number;
  damage_dice?: string;
  damage_type?: string;
  description: string;
  range?: string;
  uses?: { current: number; max: number; recharge: string };
}
