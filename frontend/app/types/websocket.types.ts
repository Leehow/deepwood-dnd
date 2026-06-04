/**
 * WebSocket message types
 */

export type WebSocketMessageType =
  | 'chat'
  | 'dice_roll'
  | 'dice_request'
  | 'token_move'
  | 'map_update'
  | 'drawing'
  | 'fog_update'
  | 'combat_update'
  | 'character_update'
  | 'system'
  | 'heartbeat'
  | 'ack'
  | 'error';

export interface BaseWebSocketMessage {
  type: WebSocketMessageType;
  campaign_id: string;
  user_id: string;
  timestamp: string;
  message_id?: string;
}

export interface ChatMessage extends BaseWebSocketMessage {
  type: 'chat';
  content: string;
  sender_name: string;
  sender_role: 'dm' | 'player' | 'ai';
  recipients?: string[];
  is_private: boolean;
  character_id?: number;
}

export interface DiceRollMessage extends BaseWebSocketMessage {
  type: 'dice_roll';
  roll_data: import('./dice.types').DiceRoll;
  character_name?: string;
  is_private: boolean;
}

export interface DiceRequestMessage extends BaseWebSocketMessage {
  type: 'dice_request';
  request_data: import('./dice.types').DiceRequest;
}

export interface TokenMoveMessage extends BaseWebSocketMessage {
  type: 'token_move';
  token_id: number;
  position: { x: number; y: number };
  map_id?: number;
}

export interface MapUpdateMessage extends BaseWebSocketMessage {
  type: 'map_update';
  map_id: number;
  update_type: 'change' | 'scale' | 'grid';
  data: Record<string, unknown>;
}

export interface DrawingMessage extends BaseWebSocketMessage {
  type: 'drawing';
  action: 'add' | 'update' | 'delete';
  drawing_data: DrawingData;
}

export interface DrawingData {
  id: string;
  tool: 'pen' | 'line' | 'rectangle' | 'circle' | 'text';
  color: string;
  width: number;
  points: number[];
  map_id?: number;
}

export interface FogUpdateMessage extends BaseWebSocketMessage {
  type: 'fog_update';
  action: 'reveal' | 'hide' | 'clear';
  fog_data: FogData;
}

export interface FogData {
  map_id: number;
  polygons?: Array<{ points: number[] }>;
  clear_all?: boolean;
}

export interface CombatUpdateMessage extends BaseWebSocketMessage {
  type: 'combat_update';
  action: 'start' | 'end' | 'next_turn' | 'update_hp' | 'add_combatant' | 'remove_combatant';
  combat_data: CombatData;
}

export interface CombatData {
  combat_id?: number;
  current_turn?: number;
  round?: number;
  combatants?: Combatant[];
  updated_combatant?: Partial<Combatant>;
}

export interface Combatant {
  id: number;
  name: string;
  initiative: number;
  hp_current: number;
  hp_max: number;
  ac: number;
  is_player: boolean;
  character_id?: number;
  monster_id?: number;
  token_id?: number;
  conditions?: string[];
}

export interface HeartbeatMessage extends BaseWebSocketMessage {
  type: 'heartbeat';
  server_time: number;
}

export interface AckMessage extends BaseWebSocketMessage {
  type: 'ack';
  original_message_id: string;
  status: 'success' | 'error';
  error_message?: string;
}

export interface ErrorMessage extends BaseWebSocketMessage {
  type: 'error';
  error: string;
  error_code?: string;
}

export type WebSocketMessage =
  | ChatMessage
  | DiceRollMessage
  | DiceRequestMessage
  | TokenMoveMessage
  | MapUpdateMessage
  | DrawingMessage
  | FogUpdateMessage
  | CombatUpdateMessage
  | HeartbeatMessage
  | AckMessage
  | ErrorMessage;

export interface WebSocketState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  lastHeartbeat: number | null;
  reconnectAttempts: number;
  messageQueue: WebSocketMessage[];
}