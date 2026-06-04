/**
 * Module and content types
 */

export interface Module {
  id: string;
  title: string;
  title_en?: string;
  description?: string;
  version?: string;
  author?: string;
  level_range?: string;
  player_count?: string;
  estimated_time?: string;
  created_at: string;
  updated_at: string;
  user_id: string;
}

export interface ModuleContent {
  module_id: string;
  chapters: Chapter[];
  monsters: ModuleMonster[];
  items: ModuleItem[];
  maps: ModuleMap[];
  npcs: NPC[];
}

export interface ModuleMonster {
  id?: string | number;
  name: string;
  name_en?: string;
  nameEn?: string;
  size?: string;
  type?: string;
  alignment?: string;
  cr?: string | number;
  hp?: number | { average?: number; dice?: string };
  ac?: number | { value?: number } | Array<{ value?: number }>;
  hpFormula?: string;
  speed?: Record<string, number> | string;
  speeds?: Record<string, number>;
  ability_scores?: Record<string, unknown>;
  abilityScores?: Record<string, unknown>;
  actions?: unknown[];
  attacks?: unknown[];
  special_abilities?: unknown[];
  specialAbilities?: unknown[];
  legendary_actions?: unknown[];
  legendaryActions?: unknown[];
  reactions?: unknown[];
  description?: string;
  appearance?: string;
  avatar_url?: string;
}

export interface ModuleItem {
  id?: string | number;
  name: string;
  name_en?: string;
  description?: string;
  category?: string;
  subcategory?: string;
  avatar_url?: string;
  [key: string]: unknown;
}

export interface Chapter {
  id: string;
  number: number;
  title: string;
  title_en?: string;
  description?: string;
  content?: string;
  level_range?: string;
  key_locations?: string[];
  key_npcs?: string[];
  encounters?: string[];
  sections?: ChapterSection[];
}

export interface ChapterSection {
  id: string;
  title: string;
  content: string;
  subsections?: ChapterSection[];
}

export interface ModuleMap {
  id: number;
  module_id: string;
  name: string;
  description?: string;
  image_url: string;
  width: number;
  height: number;
  grid_size?: number;
  tags?: string[];
}

export interface NPC {
  id: number;
  name: string;
  name_en?: string;
  race?: string;
  class?: string;
  role?: string;
  description?: string;
  personality?: string;
  goals?: string;
  location?: string;
  avatar_url?: string;
  stats?: Record<string, unknown>;
}

export interface Location {
  id: string;
  name: string;
  description?: string;
  type?: string;
  parent_location_id?: string;
  map_id?: number;
  coordinates?: { x: number; y: number };
}

export interface Quest {
  id: string;
  title: string;
  description?: string;
  objectives?: string[];
  reward?: string;
  giver_npc_id?: string;
  status?: 'available' | 'in_progress' | 'completed' | 'failed';
}

export interface Faction {
  id: string;
  name: string;
  description?: string;
  alignment?: string;
  goals?: string;
  leader_npc_id?: string;
  reputation?: number;
}

export interface Encounter {
  id: string;
  name: string;
  description?: string;
  difficulty?: 'easy' | 'medium' | 'hard' | 'deadly';
  monsters?: Array<{
    monster_id: number;
    count: number;
  }>;
  location_id?: string;
  trigger?: string;
}

export interface ParseProgress {
  module_id: string;
  status: 'pending' | 'parsing' | 'completed' | 'failed';
  progress: number;
  current_step?: string;
  error?: string;
  started_at?: string;
  completed_at?: string;
}

export interface ModuleAsset {
  path: string;
  type: 'json' | 'image' | 'pdf' | 'text';
  size: number;
  url: string;
}
