/**
 * Dice and dice roll types
 */

export type DiceType = 'd2' | 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100';

export interface DiceRoll {
  id: string;
  user_id: string;
  character_id?: number;
  roll_type: DiceRollType;
  dice_notation: string;
  results: DiceResult[];
  total: number;
  modifier: number;
  advantage?: 'advantage' | 'disadvantage' | 'normal';
  target_dc?: number;
  success?: boolean;
  critical?: 'hit' | 'miss' | null;
  description?: string;
  timestamp: string;
}

export type DiceRollType =
  | 'attack'
  | 'damage'
  | 'skill_check'
  | 'ability_check'
  | 'saving_throw'
  | 'initiative'
  | 'custom';

export interface DiceResult {
  die: DiceType;
  value: number;
  dropped?: boolean;
}

export interface DiceRequest {
  id: number;
  campaign_id: number;
  requester_user_id: string;
  target_character_id?: number;
  target_user_id?: string;
  request_type: DiceRequestType;
  check_type?: string;
  dc?: number;
  ability?: string;
  skill?: string;
  save_type?: string;
  description?: string;
  is_private: boolean;
  status: 'pending' | 'completed' | 'expired';
  created_at: string;
  expires_at?: string;
}

export type DiceRequestType =
  | 'ability_check'
  | 'skill_check'
  | 'saving_throw'
  | 'attack_roll'
  | 'custom';

export interface DiceCheck {
  type: DiceRequestType;
  dc?: number;
  modifier?: number;
  ability?: keyof import('./character.types').AbilityScores;
  skill?: string;
  advantage?: boolean;
  disadvantage?: boolean;
}

export interface DiceRollResult {
  rolls: number[];
  total: number;
  modifier: number;
  finalTotal: number;
  success?: boolean;
  critical?: 'hit' | 'miss';
  droppedRolls?: number[];
}

export interface DiceNotation {
  count: number;
  die: DiceType;
  modifier: number;
  advantage?: boolean;
  disadvantage?: boolean;
}

export function parseDiceNotation(notation: string): DiceNotation {
  const match = notation.match(/^(\d+)d(\d+)([+-]\d+)?$/);
  if (!match) {
    throw new Error(`Invalid dice notation: ${notation}`);
  }

  return {
    count: parseInt(match[1]),
    die: `d${match[2]}` as DiceType,
    modifier: match[3] ? parseInt(match[3]) : 0
  };
}

export function rollDice(notation: DiceNotation): DiceRollResult {
  const rolls: number[] = [];
  const max = parseInt(notation.die.slice(1));

  for (let i = 0; i < notation.count; i++) {
    rolls.push(Math.floor(Math.random() * max) + 1);
  }

  const total = rolls.reduce((sum, roll) => sum + roll, 0);
  const finalTotal = total + notation.modifier;

  return {
    rolls,
    total,
    modifier: notation.modifier,
    finalTotal
  };
}