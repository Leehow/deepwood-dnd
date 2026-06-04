/**
 * Passive Features Hook
 * Calculates permanent class abilities based on character class/level
 */

import { useMemo } from 'react';
import passiveFeaturesData from '~/data/passive-features.json';
import type {
  PassiveFeature,
  CharacterPassiveFeatures,
  GetPassiveFeaturesOptions,
  PassiveScaling,
} from '~/types/passive-features';

const features = passiveFeaturesData.features as PassiveFeature[];

/**
 * Get the scaled value for a feature at a given level
 */
function getScaledValue(scaling: PassiveScaling | undefined, level: number): number | string | undefined {
  if (!scaling) return undefined;

  // Find the highest level that's <= character level
  const levels = Object.keys(scaling)
    .map(Number)
    .filter(l => l <= level)
    .sort((a, b) => b - a);

  if (levels.length === 0) return undefined;
  return scaling[levels[0]];
}

/**
 * Check if a feature applies to given class/subclass/level/race
 */
function featureApplies(
  feature: PassiveFeature,
  classId: string,
  subclassId: string | undefined,
  level: number,
  raceId?: string,
  subraceId?: string,
): boolean {
  const isRacialFeature = feature.race && Array.isArray(feature.race) && feature.race.length > 0;
  const isClassFeature = feature.class && Array.isArray(feature.class) && feature.class.length > 0;

  // Racial feature: match race/subrace instead of class
  if (isRacialFeature) {
    if (!raceId) return false;
    const raceLower = raceId.toLowerCase();
    const subraceLower = subraceId?.toLowerCase() || '';
    const raceMatch = feature.race!.some(r => {
      const rl = r.toLowerCase();
      return rl === raceLower || rl === subraceLower || raceLower.includes(rl) || subraceLower.includes(rl);
    });
    if (!raceMatch) return false;
    // Level check still applies (some racial spells unlock at higher levels)
    if (level < feature.level) return false;
    return true;
  }

  // Class feature: original logic
  if (!isClassFeature) return false;

  const classLower = classId.toLowerCase();
  const subclassLower = subclassId?.toLowerCase() || '';

  // Check class requirement
  if (!feature.class!.some(c => c.toLowerCase() === classLower)) {
    return false;
  }

  // Check level requirement
  if (level < feature.level) {
    return false;
  }

  // Check subclass requirement if specified
  if (feature.subclass && feature.subclass.length > 0) {
    if (!feature.subclass.some(s => subclassLower.includes(s.toLowerCase()))) {
      return false;
    }
  }

  return true;
}

function isAlwaysOnPassiveFeature(feature: PassiveFeature): boolean {
  const cost = String(feature.cost || 'none').trim().toLowerCase();
  const trigger = String(feature.trigger || 'always').trim().toLowerCase();
  return trigger === 'always' && (cost === '' || cost === 'none');
}

/**
 * Get all passive features for a character
 */
export function getPassiveFeatures(options: GetPassiveFeaturesOptions): CharacterPassiveFeatures {
  const { classId, subclassId, level, raceId, subraceId } = options;

  const result: CharacterPassiveFeatures = {
    speedBonus: 0,
    attacksPerAction: 1,
    brutalCriticalDice: 0,
    hasUncannyDodge: false,
    hasEvasion: false,
    savingThrowBonuses: [],
    allSavingThrowProficiency: false,
    reliableTalent: false,
    advantageOn: [],
    denyEnemyAdvantage: false,
    immunities: [],
    resistances: [],
    critRange: 20,
    expertise: [],
    maximizeHealing: false,
    postRollBonuses: [],
    knockbacks: [],
    allFeatures: [],
  };

  // Find all applicable features
  const applicableFeatures = features.filter(f =>
    featureApplies(f, classId, subclassId, level, raceId, subraceId)
  );

  result.allFeatures = applicableFeatures;

  for (const feature of applicableFeatures) {
    switch (feature.type) {
      case 'ac_formula':
        // Only one AC formula can apply (first one wins)
        if (!result.acFormula) {
          result.acFormula = feature;
        }
        break;

      case 'speed_bonus': {
        const scaled = getScaledValue(feature.effect.scaling, level);
        const bonus = typeof scaled === 'number' ? scaled : (feature.effect.value as number) || 0;
        result.speedBonus = Math.max(result.speedBonus, bonus);
        break;
      }

      case 'extra_attack': {
        const scaled = getScaledValue(feature.effect.scaling, level);
        const attacks = typeof scaled === 'number' ? scaled : (feature.effect.value as number) || 1;
        result.attacksPerAction = Math.max(result.attacksPerAction, attacks);
        break;
      }

      case 'brutal_critical': {
        // For crit range (improved/superior critical)
        if (feature.id.includes('critical') && !feature.id.includes('brutal')) {
          const critValue = feature.effect.value as number;
          if (critValue && critValue < result.critRange) {
            result.critRange = critValue;
          }
        } else {
          // For brutal critical (extra dice)
          const scaled = getScaledValue(feature.effect.scaling, level);
          const dice = typeof scaled === 'number' ? scaled : 0;
          result.brutalCriticalDice = Math.max(result.brutalCriticalDice, dice);
        }
        break;
      }

      case 'sneak_attack': {
        const scaled = getScaledValue(feature.effect.scaling, level);
        if (scaled) {
          result.sneakAttack = {
            dice: String(scaled),
            feature,
          };
        }
        break;
      }

      case 'damage_reduction':
        if (feature.id === 'uncanny_dodge') {
          result.hasUncannyDodge = true;
        }
        break;

      case 'evasion':
        result.hasEvasion = true;
        break;

      case 'saving_throw_bonus':
        result.savingThrowBonuses.push({
          source: feature.name,
          value: feature.effect.abilityModifier || (feature.effect.value as number) || 0,
          condition: feature.condition,
        });
        break;

      case 'saving_throw_proficiency':
        result.allSavingThrowProficiency = true;
        break;

      case 'minimum_roll':
        if (feature.id === 'reliable_talent') {
          result.reliableTalent = true;
        }
        break;

      case 'advantage_grant':
        result.advantageOn.push({
          target: feature.trigger,
          condition: feature.condition,
        });
        break;

      case 'advantage_deny':
        if (feature.id === 'elusive') {
          result.denyEnemyAdvantage = true;
        }
        break;

      case 'immunity':
        if (!isAlwaysOnPassiveFeature(feature)) {
          break;
        }
        if (feature.effect.immuneTo) {
          result.immunities.push(...feature.effect.immuneTo);
        }
        if (feature.effect.savingThrowAdvantage) {
          for (const st of feature.effect.savingThrowAdvantage) {
            result.advantageOn.push({ target: 'saving_throw', condition: { type: st } });
          }
        }
        break;

      case 'resistance':
        if (!isAlwaysOnPassiveFeature(feature)) {
          break;
        }
        if (feature.effect.resistTo) {
          result.resistances.push(...feature.effect.resistTo);
        }
        if (feature.effect.damageResistance) {
          result.resistances.push(...feature.effect.damageResistance);
        }
        if (feature.effect.savingThrowAdvantage) {
          for (const st of feature.effect.savingThrowAdvantage) {
            result.advantageOn.push({ target: 'saving_throw', condition: { type: st } });
          }
        }
        break;

      case 'healing_bonus': {
        const base = (feature.effect.value as number) || 0;
        const perLevel = feature.effect.perSpellLevel || 0;
        result.healingBonus = { base, perSpellLevel: perLevel, feature };
        break;
      }

      case 'expertise':
        if (feature.effect.skills) {
          result.expertise.push({
            skills: feature.effect.skills,
            chooseCount: feature.effect.chooseCount || feature.effect.skills.length,
            feature,
          });
        }
        break;

      case 'destroy_undead': {
        const scaled = getScaledValue(feature.effect.scaling, level);
        if (scaled !== undefined) {
          result.destroyUndeadCR = typeof scaled === 'number' ? scaled : parseFloat(String(scaled));
        }
        break;
      }

      case 'divine_strike': {
        const dmg = getScaledValue(feature.effect.scaling, level) || feature.effect.damage || '1d8';
        const dmgType = feature.effect.damageType?.[0] || 'radiant';
        result.divineStrike = { damage: String(dmg), damageType: dmgType, feature };
        break;
      }

      case 'cantrip_damage_bonus':
        result.cantripDamageBonus = {
          abilityModifier: feature.effect.abilityModifier || 'wisdom',
          damageTypes: feature.effect.damageType,
          feature,
        };
        break;

      case 'self_healing': {
        const base = (feature.effect.value as number) || 0;
        const perLevel = feature.effect.perSpellLevel || 0;
        result.selfHealing = { base, perSpellLevel: perLevel, feature };
        break;
      }

      case 'maximize_healing':
        result.maximizeHealing = true;
        break;

      case 'maximize_damage':
        // Store as a feature reference; combat system checks damageType
        break;

      case 'flying_speed': {
        if (feature.id === 'stormborn') {
          break;
        }
        const spd = (feature.effect.value as number) || 0;
        if (spd > 0) {
          result.flyingSpeed = Math.max(result.flyingSpeed || 0, spd);
        }
        break;
      }

      case 'post_roll_bonus': {
        const bonus = feature.effect.bonus || (feature.effect.value as number) || 0;
        if (bonus > 0) {
          result.postRollBonuses.push({
            bonus,
            cost: feature.cost,
            feature,
          });
        }
        break;
      }

      case 'knockback': {
        const dist = feature.effect.distance || (feature.effect.value as number) || 10;
        result.knockbacks.push({
          distance: dist,
          damageTypes: feature.effect.damageType || [],
          maxSize: feature.effect.maxSize || 'Large',
          feature,
        });
        break;
      }
    }
  }

  return result;
}

/**
 * React hook for passive features
 */
export function usePassiveFeatures(options: GetPassiveFeaturesOptions | null): CharacterPassiveFeatures | null {
  return useMemo(() => {
    if (!options || !options.classId || !options.level) {
      return null;
    }
    return getPassiveFeatures(options);
  }, [options?.classId, options?.subclassId, options?.level, options?.raceId, options?.subraceId]);
}

/**
 * Get sneak attack dice for a rogue level
 */
export function getSneakAttackDice(level: number): string {
  if (level < 1) return '0';
  const sneakAttackFeature = features.find(f => f.id === 'sneak_attack');
  if (!sneakAttackFeature?.effect.scaling) return '1d6';

  const scaled = getScaledValue(sneakAttackFeature.effect.scaling, level);
  return String(scaled || '1d6');
}

/**
 * Get extra attack count for class/subclass/level
 */
export function getExtraAttackCount(
  classId: string | undefined,
  level: number | undefined,
  subclassId?: string
): number {
  if (!classId || !level) return 1;
  const result = getPassiveFeatures({ classId, subclassId, level });
  return result.attacksPerAction;
}

/**
 * Get extra attack feature details (name, description, source)
 */
export function getExtraAttackFeatureDetails(
  classId: string | undefined,
  level: number | undefined,
  subclassId?: string
): { count: number; feature: PassiveFeature | null; reason: string } {
  if (!classId || !level) {
    return { count: 1, feature: null, reason: '基础：每次攻击动作可进行1次攻击' };
  }
  const result = getPassiveFeatures({ classId, subclassId, level });

  // Find the extra_attack feature that applies
  const extraAttackFeature = result.allFeatures.find(f => f.type === 'extra_attack');

  if (extraAttackFeature) {
    return {
      count: result.attacksPerAction,
      feature: extraAttackFeature,
      reason: `${extraAttackFeature.name}（${level}级）`
    };
  }

  return { count: 1, feature: null, reason: '基础：每次攻击动作可进行1次攻击' };
}

/**
 * Get all bonus action features for a class/subclass/level
 */
export function getBonusActionFeatures(
  classId: string | undefined,
  level: number | undefined,
  subclassId?: string
): PassiveFeature[] {
  if (!classId || !level) {
    // No class info - return empty (no profession-specific bonus actions)
    return [];
  }

  const result = getPassiveFeatures({ classId, subclassId, level });

  // Filter for bonus_action type features from class abilities
  return result.allFeatures.filter(f => f.type === 'bonus_action');
}

/**
 * Get brutal critical dice for class/level
 */
export function getBrutalCriticalDice(classId: string, level: number): number {
  if (classId.toLowerCase() !== 'barbarian') return 0;
  const result = getPassiveFeatures({ classId, level });
  return result.brutalCriticalDice;
}

/**
 * Get crit range for class/subclass/level
 */
export function getCritRange(
  classId: string,
  level: number,
  subclassId?: string
): number {
  const result = getPassiveFeatures({ classId, subclassId, level });
  return result.critRange;
}

/**
 * Check if character has evasion
 */
export function hasEvasion(classId: string, level: number): boolean {
  const result = getPassiveFeatures({ classId, level });
  return result.hasEvasion;
}

/**
 * Check if character has uncanny dodge
 */
export function hasUncannyDodge(classId: string, level: number): boolean {
  const result = getPassiveFeatures({ classId, level });
  return result.hasUncannyDodge;
}

/**
 * Get healing bonus for a spell of given level
 * Returns total bonus HP (e.g., Disciple of Life: 2 + spellLevel)
 */
export function getHealingBonus(
  classId: string,
  level: number,
  subclassId?: string,
  spellLevel: number = 1
): number {
  const result = getPassiveFeatures({ classId, subclassId, level });
  if (!result.healingBonus) return 0;
  return result.healingBonus.base + result.healingBonus.perSpellLevel * spellLevel;
}

/**
 * Get expertise info (skills with double proficiency bonus)
 */
export function getExpertise(
  classId: string,
  level: number,
  subclassId?: string
): CharacterPassiveFeatures['expertise'] {
  const result = getPassiveFeatures({ classId, subclassId, level });
  return result.expertise;
}

/**
 * Get Destroy Undead CR threshold for cleric level
 * Returns undefined if not yet available
 */
export function getDestroyUndeadCR(
  classId: string,
  level: number
): number | undefined {
  if (classId.toLowerCase() !== 'cleric') return undefined;
  const result = getPassiveFeatures({ classId, level });
  return result.destroyUndeadCR;
}

export default usePassiveFeatures;
