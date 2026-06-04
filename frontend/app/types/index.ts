/**
 * Central type definitions export
 * Import all types from here for consistency
 */

// Campaign types
export type {
  Campaign,
  CampaignSettings,
  CampaignMember
} from './campaign.types';

// Character types
export type {
  Character,
  AbilityScores,
  Skill,
  Equipment,
  InventoryItem,
  Currency,
  SpellSlot,
  CharacterSheet,
  Feature,
  Action
} from './character.types';

// Dice types
export type {
  DiceType,
  DiceRoll,
  DiceRollType,
  DiceResult,
  DiceRequest,
  DiceRequestType,
  DiceCheck,
  DiceRollResult,
  DiceNotation
} from './dice.types';

export { parseDiceNotation, rollDice } from './dice.types';

// WebSocket types
export type {
  WebSocketMessageType,
  BaseWebSocketMessage,
  ChatMessage,
  DiceRollMessage,
  DiceRequestMessage,
  TokenMoveMessage,
  MapUpdateMessage,
  DrawingMessage,
  DrawingData,
  FogUpdateMessage,
  FogData,
  CombatUpdateMessage,
  CombatData,
  Combatant,
  HeartbeatMessage,
  AckMessage,
  ErrorMessage,
  WebSocketMessage,
  WebSocketState
} from './websocket.types';

// Module types
export type {
  Module,
  ModuleContent,
  Chapter,
  ChapterSection,
  ModuleMap,
  NPC,
  Location,
  Quest,
  Faction,
  Encounter,
  ParseProgress,
  ModuleAsset
} from './module.types';

export type {
  MapData,
  Shop,
  ShopInventoryItem,
} from './platform.types';

// Utility types
export type APIResponse<T> = {
  data: T;
  error?: never;
} | {
  data?: never;
  error: string;
};

export type PaginatedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
};

export type AsyncState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

// Common enums
export enum UserRole {
  DM = 'dm',
  Player = 'player',
  Spectator = 'spectator'
}

export enum CampaignStatus {
  Active = 'active',
  Paused = 'paused',
  Completed = 'completed',
  Archived = 'archived'
}

export enum TokenType {
  Character = 'character',
  Monster = 'monster',
  NPC = 'npc',
  Item = 'item',
  Shop = 'shop'
}
