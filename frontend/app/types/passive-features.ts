/**
 * Passive Features System - Type Definitions
 * For permanent class abilities that don't need activation
 */

/**
 * Standard Condition IDs for immunities and effects
 * Based on D&D 5e conditions
 */
export const CONDITION_IDS = {
  // Combat conditions
  blinded: 'blinded',
  charmed: 'charmed',
  deafened: 'deafened',
  frightened: 'frightened',
  grappled: 'grappled',
  incapacitated: 'incapacitated',
  invisible: 'invisible',
  paralyzed: 'paralyzed',
  petrified: 'petrified',
  poisoned: 'poisoned',
  prone: 'prone',
  restrained: 'restrained',
  stunned: 'stunned',
  unconscious: 'unconscious',
  exhaustion: 'exhaustion',
  // Non-combat / special
  diseased: 'diseased',
  aging: 'aging',
} as const;

export type ConditionId = typeof CONDITION_IDS[keyof typeof CONDITION_IDS];

/**
 * Condition display names (Chinese)
 */
export const CONDITION_NAMES: Record<ConditionId, string> = {
  blinded: '目盲',
  charmed: '魅惑',
  deafened: '耳聋',
  frightened: '恐惧',
  grappled: '被擒',
  incapacitated: '失能',
  invisible: '隐形',
  paralyzed: '麻痹',
  petrified: '石化',
  poisoned: '中毒',
  prone: '倒地',
  restrained: '束缚',
  stunned: '震慑',
  unconscious: '昏迷',
  exhaustion: '力竭',
  diseased: '疾病',
  aging: '衰老',
};

/**
 * Get condition display name
 */
export function getConditionName(conditionId: string): string {
  return CONDITION_NAMES[conditionId as ConditionId] || conditionId;
}

// Feature types for different combat mechanics
export type PassiveFeatureType =
  | 'ac_formula'           // AC calculation replacement (Unarmored Defense)
  | 'speed_bonus'          // Movement speed increase
  | 'extra_attack'         // Additional attacks per action
  | 'brutal_critical'      // Extra dice on critical hits
  | 'sneak_attack'         // Conditional bonus damage
  | 'damage_reduction'     // Reduce incoming damage (Uncanny Dodge)
  | 'evasion'              // Modify saving throw results
  | 'saving_throw_bonus'   // Bonus to saving throws
  | 'saving_throw_proficiency' // Proficiency in saving throws
  | 'minimum_roll'         // Minimum d20 result (Reliable Talent)
  | 'advantage_grant'      // Grant advantage on certain rolls
  | 'advantage_deny'       // Deny enemy advantage (Elusive)
  | 'immunity'             // Immunity to conditions/damage
  | 'resistance'           // Resistance to damage types
  | 'bonus_action'         // Bonus action abilities
  | 'healing_bonus'        // Bonus HP on healing spells (Disciple of Life)
  | 'expertise'            // Double proficiency on skills (Blessing of Knowledge)
  | 'destroy_undead'       // Destroy undead below CR threshold
  | 'divine_strike'        // Bonus weapon damage per turn (8th level domain feature)
  | 'cantrip_damage_bonus' // Add ability modifier to cantrip damage (Potent Spellcasting)
  | 'self_healing'         // Self-heal when healing others (Blessed Healer)
  | 'maximize_healing'     // Maximize healing dice (Supreme Healing)
  | 'maximize_damage'      // Maximize damage dice of specific types (Destructive Wrath)
  | 'flying_speed'         // Grant flying speed (Stormborn)
  | 'post_roll_bonus'      // Add bonus after attack roll (Guided Strike)
  | 'knockback';           // Push target on damage (Thunderbolt Strike)

// Trigger conditions for when the feature applies
export type PassiveTrigger =
  | 'always'               // Always active
  | 'on_attack'            // When making an attack
  | 'on_hit'               // When attack hits
  | 'on_critical'          // When scoring a critical hit
  | 'on_damage_received'   // When receiving damage
  | 'on_saving_throw'      // When making a saving throw
  | 'on_ability_check'     // When making an ability check
  | 'on_initiative'        // When rolling initiative
  | 'on_turn'              // On your turn (for bonus actions)
  | 'after_attack'         // After taking Attack action
  | 'on_attack_miss'       // After attack misses (for post-roll bonuses)
  | 'on_damage_dealt'      // After dealing damage (for knockback effects)
  | 'on_healing_spell'     // When casting a healing spell
  | 'on_attacked'          // When being targeted by an attack
  | 'on_hit_by_melee'      // When hit by a melee attack
  | 'on_turn_undead';      // When using Turn Undead

// Cost for using the feature (can be a single value or a combination like "bonus_action, 1 ki")
export type PassiveCost = string;

// Conditions for the feature to apply
export interface PassiveCondition {
  // Equipment conditions
  unarmored?: boolean;           // Must not wear armor
  noShield?: boolean;            // Must not use shield
  unarmoredOrLightArmor?: boolean;

  // Attack conditions
  hasAdvantage?: boolean;        // Must have advantage
  allyAdjacent?: boolean;        // Ally within 5ft of target
  weaponProperty?: string[];     // Weapon must have property (finesse, etc)
  attackType?: 'melee' | 'ranged';
  abilityBased?: 'strength' | 'dexterity';

  // Saving throw conditions
  savingThrowAbility?: string;   // Only for specific ability saves
  canSeeAttacker?: boolean;      // Must be able to see attacker

  // Target conditions
  creatureType?: string[];       // Favored Enemy types

  // Other conditions
  notIncapacitated?: boolean;
  withinRange?: number;          // Range in feet (for auras)
  spellLevelMin?: number;        // Minimum spell level required
  type?: string;                 // Condition type (for saving throw advantages)
}

// Scaling configuration for level-based progression
export interface PassiveScaling {
  [level: number]: string | number;  // Level -> value
}

// Effect configuration
export interface PassiveEffect {
  // AC formula: "10 + dex + con" or "10 + dex + wis"
  formula?: string;

  // Numeric bonus/value
  value?: number | string;       // Can be number or dice like "1d6"

  // Scaling by level
  scaling?: PassiveScaling;

  // Target for bonuses
  abilityModifier?: string;      // Add this ability modifier

  // For auras
  affectsAllies?: boolean;
  range?: number;

  // For immunities
  immuneTo?: string[];           // Condition or damage types

  // For resistances
  resistTo?: string[];           // Damage types (class features)
  damageResistance?: string[];   // Damage types (racial features)

  // For saving throw advantages
  savingThrowAdvantage?: string[]; // Condition types with advantage (racial features)

  // For special racial mechanics
  damageResistanceFromAncestry?: boolean; // Dragonborn: resistance from draconic ancestry

  // For bonus actions
  actions?: string[];            // Actions granted (e.g., "dash", "disengage", "hide")
  uses?: number;                 // Number of uses per rest

  // For healing_bonus
  perSpellLevel?: number;        // Additional bonus per spell level

  // For expertise
  skills?: string[];             // Eligible skills for double proficiency
  chooseCount?: number;          // How many skills to choose from the list

  // For reaction abilities
  damage?: string;               // Damage dice (e.g., "2d8")
  damageType?: string[];         // Damage type options (e.g., ["thunder", "lightning"])
  savingThrow?: {                // Required saving throw
    ability: string;             // Save ability (e.g., "dexterity")
    dcAbility: string;           // DC based on this ability (e.g., "wisdom")
  };
  halfOnSave?: boolean;          // Half damage on successful save
  imposedCondition?: string[];   // Conditions imposed (e.g., ["disadvantage_attack"])
  targetImmunity?: string;       // Target immune if has this condition
  advantageOnSkills?: string[];   // Skills that get advantage

  // For flying_speed
  flyingSpeedFormula?: string;    // e.g., "walking_speed" means equal to walk speed

  // For post_roll_bonus
  bonus?: number;                 // Attack roll bonus (e.g., 10 for Guided Strike)
  target?: string;                // "self" or "ally"

  // For knockback
  distance?: number;              // Push distance in feet (e.g., 10)
  maxSize?: string;               // Max creature size affected (e.g., "Large")
  direction?: string;             // "away_from_attacker"
}

/**
 * Main Passive Feature Definition
 */
export interface PassiveFeature {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  descriptionEn?: string;

  // Source (at least one of class or race should be set)
  class?: string[];              // Required class(es) - for class features
  subclass?: string[];           // Required subclass(es)
  race?: string[];               // Required race(es) - for racial features
  level: number;                 // Minimum level required

  // Mechanics
  type: PassiveFeatureType;
  trigger: PassiveTrigger;
  cost: PassiveCost;
  condition?: PassiveCondition;
  effect: PassiveEffect;

  // Limits
  usesPerTurn?: number;          // e.g., Sneak Attack once per turn
  usesPerRound?: number;         // e.g., Uncanny Dodge once per round

  // UI
  icon?: string;
  color?: string;
}

/**
 * Result of getPassiveFeatures
 */
export interface CharacterPassiveFeatures {
  // AC
  acFormula?: PassiveFeature;

  // Speed
  speedBonus: number;

  // Attacks
  attacksPerAction: number;
  brutalCriticalDice: number;

  // Sneak Attack
  sneakAttack?: {
    dice: string;
    feature: PassiveFeature;
  };

  // Defenses
  hasUncannyDodge: boolean;
  hasEvasion: boolean;

  // Saving throws
  savingThrowBonuses: Array<{
    source: string;
    value: number | string;
    condition?: PassiveCondition;
  }>;
  allSavingThrowProficiency: boolean;

  // Skill checks
  reliableTalent: boolean;

  // Advantage/Disadvantage
  advantageOn: Array<{
    target: string;
    condition?: PassiveCondition;
  }>;
  denyEnemyAdvantage: boolean;

  // Immunities
  immunities: string[];
  resistances: string[];

  // Crit range
  critRange: number;             // 20 = normal, 19 = 19-20, 18 = 18-20

  // Healing bonus (e.g., Disciple of Life)
  healingBonus?: {
    base: number;
    perSpellLevel: number;
    feature: PassiveFeature;
  };

  // Expertise - double proficiency on skills
  expertise: Array<{
    skills: string[];            // Eligible skill pool
    chooseCount: number;         // How many chosen
    feature: PassiveFeature;
  }>;

  // Destroy Undead CR threshold
  destroyUndeadCR?: number;

  // Divine Strike (bonus weapon damage per turn)
  divineStrike?: {
    damage: string;              // e.g., "1d8" or "2d8"
    damageType: string;          // e.g., "radiant", "thunder"
    feature: PassiveFeature;
  };

  // Cantrip damage bonus (add ability mod to cantrip damage)
  cantripDamageBonus?: {
    abilityModifier: string;     // e.g., "wisdom"
    damageTypes?: string[];      // Restrict to specific damage types (empty = all)
    feature: PassiveFeature;
  };

  // Self-healing when healing others
  selfHealing?: {
    base: number;
    perSpellLevel: number;
    feature: PassiveFeature;
  };

  // Maximize healing dice
  maximizeHealing: boolean;

  // Flying speed
  flyingSpeed?: number;

  // Post-roll bonus features (Guided Strike etc.)
  postRollBonuses: Array<{
    bonus: number;
    cost: string;              // "channel_divinity" etc.
    feature: PassiveFeature;
  }>;

  // Knockback features (Thunderbolt Strike etc.)
  knockbacks: Array<{
    distance: number;          // Push distance in feet
    damageTypes: string[];     // Triggering damage types
    maxSize: string;           // Max creature size (e.g., "Large")
    feature: PassiveFeature;
  }>;

  // All features (for reference)
  allFeatures: PassiveFeature[];
}

/**
 * Options for getPassiveFeatures function
 */
export interface GetPassiveFeaturesOptions {
  classId: string;
  subclassId?: string;
  level: number;
  raceId?: string;
  subraceId?: string;
  // For multiclass support in future
  multiclass?: Array<{
    classId: string;
    subclassId?: string;
    level: number;
  }>;
}
