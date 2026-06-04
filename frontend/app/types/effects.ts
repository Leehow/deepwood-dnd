/**
 * Unified Effect System - Type Definitions
 * Centralizes all buff/effect definitions for D&D 5E combat
 */

// Condition types (D&D 5E standard conditions + extended)
export type ConditionType =
  | 'blinded' | 'charmed' | 'deafened' | 'exhaustion'
  | 'frightened' | 'grappled' | 'incapacitated' | 'invisible'
  | 'paralyzed' | 'petrified' | 'poisoned' | 'prone'
  | 'restrained' | 'stunned' | 'unconscious'
  | 'silenced' | 'diseased' | 'sleep' | 'aging' | 'confused';  // Extended types

// Conditions that cause incapacitated (can't take actions or reactions)
export const INCAPACITATING_CONDITIONS: ConditionType[] = [
  'incapacitated', 'stunned', 'paralyzed', 'unconscious', 'petrified'
];

// Effect categories for organization
export type EffectCategory = 'standard_action' | 'class_feature' | 'spell' | 'condition';

// Action types that can activate effects
export type ActionType = 'action' | 'bonus_action' | 'reaction' | 'free';

// Modifier types for combat effects
export type ModifierType = 'advantage' | 'disadvantage' | 'bonus' | 'resistance' | 'immunity' | 'suppress';

// Targets for modifiers
export type ModifierTarget =
  | 'attack_roll'        // Attacks made by this token
  | 'incoming_attack'    // Attacks against this token
  | 'saving_throw'       // Saving throws made by this token
  | 'damage'             // Damage dealt by this token
  | 'damage_taken'       // Damage received by this token
  | 'ability_check'      // Ability checks made by this token
  | 'opportunity_attack_provoked';  // Whether movement provokes OA

// Recharge timing
export type RechargeType = 'short_rest' | 'long_rest' | 'turn' | 'dawn';

// Trigger timing
export type TriggerTiming = 'on_activate' | 'on_deactivate' | 'on_hit' | 'on_damage' | 'turn_start' | 'turn_end';

// Damage types for resistance/immunity
export type DamageType =
  | 'bludgeoning' | 'piercing' | 'slashing'
  | 'fire' | 'cold' | 'lightning' | 'thunder' | 'acid' | 'poison'
  | 'necrotic' | 'radiant' | 'psychic' | 'force';

// Abilities for saving throws and checks
export type Ability = 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma';

/**
 * Modifier condition - when does this modifier apply?
 */
export interface ModifierCondition {
  ability?: Ability;                    // Only for this ability (e.g., dexterity saves)
  damageType?: DamageType | DamageType[];  // Only for these damage types
  attackType?: 'melee' | 'ranged';      // Only for melee or ranged attacks
  weaponProperty?: string;              // Only with weapons having this property
  isStrengthBased?: boolean;            // Only for strength-based attacks
  consumeOnUse?: boolean;               // Effect consumed after first use
}

/**
 * Action Effect Type - how the front-end executes this action
 */
export type ActionEffectType =
  | 'self_buff'        // Apply effect to self
  | 'movement_bonus'   // Add extra movement
  | 'ally_buff'        // Apply effect to a target ally
  | 'check_then_buff'  // Roll a check, on success apply effect
  | 'narrative'        // Only send chat message, no mechanical effect
  | 'instant_heal';    // Instant healing (e.g., Second Wind)

/**
 * Action Effect configuration - declares how the frontend handles a standard action
 */
export interface ActionEffect {
  type: ActionEffectType;
  chatTemplate: string;                 // Chat message template with {source}, {target}, {value} placeholders
  value?: string;                       // For movement_bonus: "speed"
  requiresTarget?: boolean;             // For ally_buff: must select a target
  checkType?: string;                   // For check_then_buff: e.g., "stealth"
  successEffectId?: string;             // For check_then_buff: effect to apply on success
  healFormula?: string;                 // For instant_heal: e.g., "1d10+level"
}

/**
 * Effect modifier - how the effect changes combat mechanics
 */
export interface EffectModifier {
  type: ModifierType;
  target: ModifierTarget;
  value?: number | string;              // Numeric bonus or formula like "level/4"
  condition?: ModifierCondition;
}

/**
 * Trigger action - what happens when triggered
 */
export interface TriggerAction {
  type: 'add_effect' | 'remove_effect' | 'heal' | 'damage' | 'custom';
  effectId?: string;                    // For add/remove_effect
  value?: string | number;              // For heal/damage
  description?: string;                 // For custom actions
}

/**
 * Effect trigger - events that cause actions
 */
export interface EffectTrigger {
  timing: TriggerTiming;
  action: TriggerAction;
}

/**
 * Effect duration configuration
 */
export interface EffectDuration {
  rounds?: number;                      // Duration in combat rounds
  minutes?: number;                     // Duration in minutes (out of combat)
  hours?: number;                       // Duration in hours
  concentration?: boolean;              // Requires concentration
  untilRest?: 'short' | 'long';        // Until short/long rest
}

/**
 * Usage limits for the effect
 */
export interface EffectUses {
  max: number;
  current?: number;
  recharge: RechargeType;
}

/**
 * Prerequisites for using the effect
 */
export interface EffectPrerequisites {
  class?: string[];                     // Required class(es)
  subclass?: string[];                  // Required subclass(es)
  level?: number;                       // Minimum level required
  hasEffect?: string[];                 // Must have these effects active
  notHasEffect?: string[];              // Must NOT have these effects active
}

/**
 * Visual configuration for UI display
 */
export interface EffectVisual {
  icon: string;                         // Emoji or icon name
  color: string;                        // Hex color for UI
  borderStyle?: 'solid' | 'dashed' | 'pulse';
  animation?: 'glow' | 'pulse' | 'shake';
}

/**
 * Main Effect Definition
 */
export interface EffectDefinition {
  id: string;                           // Unique identifier (e.g., "rage", "dodge")
  name: string;                         // Chinese name
  nameEn: string;                       // English name
  description?: string;                 // Chinese description
  descriptionEn?: string;               // English description

  category: EffectCategory;
  source?: string;                      // Source class/race/spell
  resourceId?: string;                  // Link to unified class resource system

  visual: EffectVisual;
  actionType: ActionType;
  canToggle: boolean;                   // Can be manually ended

  duration?: EffectDuration;
  modifiers?: EffectModifier[];
  triggers?: EffectTrigger[];
  uses?: EffectUses;
  prerequisites?: EffectPrerequisites;
  endsWhen?: string[];                  // Effect IDs that end this effect when they end
  actionEffect?: ActionEffect;          // How the frontend executes this action

  // Spell linkage
  spell_id?: string;

  // Level scaling
  levelScaling?: {
    [level: number]: Partial<EffectDefinition>;
  };
}

/**
 * Active effect instance on a token
 */
export interface ActiveEffect {
  id: string;                           // Effect definition ID
  instanceId?: string;                  // Unique instance ID (for multiple of same effect)
  name: string;                         // Display name
  icon: string;                         // Display icon
  color: string;                        // Display color
  source?: string;                      // Who applied this effect
  duration?: number;                    // Remaining rounds
  maxDuration?: number;                 // Maximum duration
  usesRemaining?: number;               // Uses left
  metadata?: Record<string, unknown>;   // Additional data
}

/**
 * Effect registry - all loaded effects
 */
export interface EffectRegistry {
  effects: Record<string, EffectDefinition>;
  byCategory: Record<EffectCategory, string[]>;
  bySource: Record<string, string[]>;
}

/**
 * Result of checking for modifiers
 */
export interface ModifierCheckResult {
  hasAdvantage: boolean;
  hasDisadvantage: boolean;
  bonuses: number[];
  resistances: DamageType[];
  immunities: DamageType[];
  reasons: string[];
  suppressed?: boolean;                 // Whether this target is suppressed (e.g., OA suppressed by disengage)
}

/**
 * Hook options for useEffectSystem
 */
export interface UseEffectSystemOptions {
  tokenId: number;
  activeEffects: ActiveEffect[];
  characterLevel?: number;
  classId?: string;
  subclassId?: string;
  onEffectsChange?: (effects: ActiveEffect[]) => Promise<void>;
}

/**
 * Return type for useEffectSystem hook
 */
export interface UseEffectSystemReturn {
  // State
  effects: ActiveEffect[];

  // Effect Management
  activateEffect: (effectId: string, metadata?: Record<string, unknown>) => Promise<ActiveEffect | null>;
  deactivateEffect: (effectId: string | { instanceId: string }) => Promise<boolean>;
  toggleEffect: (effectId: string) => Promise<ActiveEffect | null>;

  // Queries
  isEffectActive: (effectId: string) => boolean;
  getActiveEffect: (effectId: string) => ActiveEffect | undefined;
  getEffectDefinition: (effectId: string) => EffectDefinition | undefined;

  // Combat Modifiers
  getModifiersFor: (target: ModifierTarget, condition?: ModifierCondition) => ModifierCheckResult;
  hasAdvantageOn: (target: ModifierTarget, condition?: ModifierCondition) => boolean;
  hasDisadvantageOn: (target: ModifierTarget, condition?: ModifierCondition) => boolean;
  getDamageBonus: (attackType?: 'melee' | 'ranged') => number;
  getResistances: () => DamageType[];
  getImmunities: () => DamageType[];

  // Duration Management
  decrementDurations: () => ActiveEffect[];  // Returns expired effects

  // Utilities
  getAvailableEffects: () => EffectDefinition[];  // Effects this token can use
  canUseEffect: (effectId: string) => { canUse: boolean; reason?: string };
}

/**
 * Source of an immunity (race, class, effect, equipment)
 */
export interface ImmunitySource {
  type: 'race' | 'class' | 'effect' | 'equipment' | 'feature' | 'monster';
  name: string;
  immunity: string;
  level?: number;
}

/**
 * Aggregated immunity information from all sources
 */
export interface ImmunityInfo {
  damageImmunities: DamageType[];
  conditionImmunities: ConditionType[];
  savingThrowAdvantage?: ConditionType[];
  sources: ImmunitySource[];
}

/**
 * Condition translations for display
 */
export const CONDITION_NAMES: Record<ConditionType, string> = {
  blinded: '目盲',
  charmed: '魅惑',
  deafened: '耳聋',
  exhaustion: '力竭',
  frightened: '恐惧',
  grappled: '擒抱',
  incapacitated: '失能',
  invisible: '隐形',
  paralyzed: '麻痹',
  petrified: '石化',
  poisoned: '中毒',
  prone: '倒地',
  restrained: '束缚',
  stunned: '震慑',
  unconscious: '昏迷',
  silenced: '沉默',
  diseased: '疾病',
  sleep: '睡眠',
  aging: '衰老',
  confused: '困惑',
};

/**
 * Damage type translations for display
 */
export const DAMAGE_TYPE_NAMES: Record<DamageType, string> = {
  bludgeoning: '钝击',
  piercing: '穿刺',
  slashing: '挥砍',
  fire: '火焰',
  cold: '寒冷',
  lightning: '闪电',
  thunder: '雷鸣',
  acid: '强酸',
  poison: '毒素',
  necrotic: '黯蚀',
  radiant: '光耀',
  psychic: '心灵',
  force: '力场',
};
