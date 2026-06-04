/**
 * useImmunities Hook
 * Calculates immunities from character race, class, level, and active effects
 */

import { useMemo } from 'react';
import type {
  ImmunityInfo,
  ImmunitySource,
  DamageType,
  ConditionType,
  ActiveEffect
} from '~/types/effects';
import passiveFeatures from '~/data/passive-features.json';

// Race immunities (inherent racial features)
const RACE_IMMUNITIES: Record<string, {
  conditionImmunities?: string[];
  damageImmunities?: string[];
  savingThrowAdvantage?: string[];
  source: string;
}> = {
  elf: {
    conditionImmunities: ['sleep'],
    savingThrowAdvantage: ['charmed'],
    source: '精类血统'
  },
  '精灵': {
    conditionImmunities: ['sleep'],
    savingThrowAdvantage: ['charmed'],
    source: '精类血统'
  },
  half_elf: {
    conditionImmunities: ['sleep'],
    savingThrowAdvantage: ['charmed'],
    source: '精类血统'
  },
  '半精灵': {
    conditionImmunities: ['sleep'],
    savingThrowAdvantage: ['charmed'],
    source: '精类血统'
  },
  warforged: {
    conditionImmunities: ['poisoned', 'diseased'],
    damageImmunities: ['poison'],
    source: '活化构装体'
  },
  '锻造者': {
    conditionImmunities: ['poisoned', 'diseased'],
    damageImmunities: ['poison'],
    source: '活化构装体'
  },
};

// Class immunities (by level)
const CLASS_IMMUNITIES: Record<string, Record<number, {
  conditionImmunities?: string[];
  damageImmunities?: string[];
  source: string;
}>> = {
  paladin: {
    3: {
      conditionImmunities: ['diseased'],
      source: '圣洁体魄'
    }
  },
  '圣武士': {
    3: {
      conditionImmunities: ['diseased'],
      source: '圣洁体魄'
    }
  },
  monk: {
    10: {
      conditionImmunities: ['diseased', 'poisoned'],
      damageImmunities: ['poison'],
      source: '身心纯净'
    }
  },
  '武僧': {
    10: {
      conditionImmunities: ['diseased', 'poisoned'],
      damageImmunities: ['poison'],
      source: '身心纯净'
    }
  },
  druid: {
    18: {
      conditionImmunities: ['aging'],
      source: '永恒之躯'
    }
  },
  '德鲁伊': {
    18: {
      conditionImmunities: ['aging'],
      source: '永恒之躯'
    }
  },
};

interface CharacterData {
  raceId?: string;
  race_id?: string;
  classId?: string;
  class_id?: string;
  level?: number;
  subclassId?: string;
  subclass_id?: string;
}

function normalizeString(str: string): string {
  return str.toLowerCase().trim();
}

function getRaceImmunities(raceId: string | undefined): {
  damageImmunities: DamageType[];
  conditionImmunities: ConditionType[];
  savingThrowAdvantage: ConditionType[];
  sources: ImmunitySource[];
} {
  const result = {
    damageImmunities: [] as DamageType[],
    conditionImmunities: [] as ConditionType[],
    savingThrowAdvantage: [] as ConditionType[],
    sources: [] as ImmunitySource[]
  };

  if (!raceId) return result;

  const raceKey = normalizeString(raceId);

  // Check direct match first
  let raceData = RACE_IMMUNITIES[raceKey];
  if (!raceData) {
    // Check for partial match (e.g., "wood_elf" contains "elf")
    for (const [key, data] of Object.entries(RACE_IMMUNITIES)) {
      if (key.includes(raceKey) || raceKey.includes(key)) {
        raceData = data;
        break;
      }
    }
  }

  if (raceData) {
    const source = raceData.source;
    if (raceData.damageImmunities) {
      for (const imm of raceData.damageImmunities) {
        result.damageImmunities.push(imm as DamageType);
        result.sources.push({
          type: 'race',
          name: source,
          immunity: imm
        });
      }
    }
    if (raceData.conditionImmunities) {
      for (const imm of raceData.conditionImmunities) {
        result.conditionImmunities.push(imm as ConditionType);
        result.sources.push({
          type: 'race',
          name: source,
          immunity: imm
        });
      }
    }
    if (raceData.savingThrowAdvantage) {
      result.savingThrowAdvantage = raceData.savingThrowAdvantage as ConditionType[];
    }
  }

  return result;
}

function getClassImmunities(classId: string | undefined, level: number): {
  damageImmunities: DamageType[];
  conditionImmunities: ConditionType[];
  sources: ImmunitySource[];
} {
  const result = {
    damageImmunities: [] as DamageType[],
    conditionImmunities: [] as ConditionType[],
    sources: [] as ImmunitySource[]
  };

  if (!classId) return result;

  const classKey = normalizeString(classId);

  // Check direct match first
  let classData = CLASS_IMMUNITIES[classKey];
  if (!classData) {
    // Check for partial match
    for (const [key, data] of Object.entries(CLASS_IMMUNITIES)) {
      if (key.includes(classKey) || classKey.includes(key)) {
        classData = data;
        break;
      }
    }
  }

  if (classData) {
    // Check each level threshold
    for (const [reqLevelStr, immunityData] of Object.entries(classData)) {
      const reqLevel = parseInt(reqLevelStr);
      if (level >= reqLevel) {
        const source = immunityData.source;
        if (immunityData.damageImmunities) {
          for (const imm of immunityData.damageImmunities) {
            if (!result.damageImmunities.includes(imm as DamageType)) {
              result.damageImmunities.push(imm as DamageType);
              result.sources.push({
                type: 'class',
                name: source,
                immunity: imm,
                level: reqLevel
              });
            }
          }
        }
        if (immunityData.conditionImmunities) {
          for (const imm of immunityData.conditionImmunities) {
            if (!result.conditionImmunities.includes(imm as ConditionType)) {
              result.conditionImmunities.push(imm as ConditionType);
              result.sources.push({
                type: 'class',
                name: source,
                immunity: imm,
                level: reqLevel
              });
            }
          }
        }
      }
    }
  }

  return result;
}

function getPassiveFeatureImmunities(
  classId: string | undefined,
  level: number,
  raceId: string | undefined
): {
  damageImmunities: DamageType[];
  conditionImmunities: ConditionType[];
  sources: ImmunitySource[];
} {
  const result = {
    damageImmunities: [] as DamageType[],
    conditionImmunities: [] as ConditionType[],
    sources: [] as ImmunitySource[]
  };

  const features = passiveFeatures.features || [];

  for (const feature of features) {
    if (feature.type !== 'immunity') continue;

    // Check race requirement (for race-based features)
    const featureRaces = (feature as { race?: string[] }).race || [];
    if (featureRaces.length > 0) {
      if (!raceId) continue;
      const raceMatch = featureRaces.some(
        r => normalizeString(r).includes(normalizeString(raceId)) ||
             normalizeString(raceId).includes(normalizeString(r))
      );
      if (!raceMatch) continue;
    }

    // Check class requirement
    const featureClasses = feature.class || [];
    if (featureClasses.length > 0 && classId) {
      const classMatch = featureClasses.some(
        c => normalizeString(c).includes(normalizeString(classId)) ||
             normalizeString(classId).includes(normalizeString(c))
      );
      if (!classMatch) continue;
    }

    // Check level requirement
    const reqLevel = feature.level || 1;
    if (level < reqLevel) continue;

    // Extract immunities from effect
    const effect = feature.effect || {};
    const immuneTo = (effect as { immuneTo?: string[] }).immuneTo || [];
    const source = feature.name || feature.id || 'Unknown';

    for (const imm of immuneTo) {
      // Determine if it's a condition or damage type
      const conditionTypes = [
        'diseased', 'poisoned', 'sleep', 'aging', 'charmed',
        'frightened', 'paralyzed', 'petrified', 'stunned',
        'blinded', 'deafened', 'exhaustion', 'grappled',
        'incapacitated', 'invisible', 'prone', 'restrained',
        'unconscious'
      ];

      const normImm = normalizeString(imm);
      if (conditionTypes.includes(normImm)) {
        if (!result.conditionImmunities.includes(normImm as ConditionType)) {
          result.conditionImmunities.push(normImm as ConditionType);
          result.sources.push({
            type: 'feature',
            name: source,
            immunity: imm,
            level: reqLevel
          });
        }
      } else {
        if (!result.damageImmunities.includes(normImm as DamageType)) {
          result.damageImmunities.push(normImm as DamageType);
          result.sources.push({
            type: 'feature',
            name: source,
            immunity: imm,
            level: reqLevel
          });
        }
      }
    }
  }

  return result;
}

function getEffectImmunities(activeEffects: ActiveEffect[]): {
  damageImmunities: DamageType[];
  conditionImmunities: ConditionType[];
  sources: ImmunitySource[];
} {
  const result = {
    damageImmunities: [] as DamageType[],
    conditionImmunities: [] as ConditionType[],
    sources: [] as ImmunitySource[]
  };

  if (!activeEffects) return result;

  for (const effect of activeEffects) {
    const metadata = effect.metadata || {};
    const immunities = (metadata as { immunities?: { damage?: string[]; condition?: string[] } }).immunities;
    if (!immunities) continue;

    const source = effect.name || effect.id || 'Unknown';

    if (immunities.damage) {
      for (const imm of immunities.damage) {
        const normImm = normalizeString(imm);
        if (!result.damageImmunities.includes(normImm as DamageType)) {
          result.damageImmunities.push(normImm as DamageType);
          result.sources.push({
            type: 'effect',
            name: source,
            immunity: imm
          });
        }
      }
    }

    if (immunities.condition) {
      for (const imm of immunities.condition) {
        const normImm = normalizeString(imm);
        if (!result.conditionImmunities.includes(normImm as ConditionType)) {
          result.conditionImmunities.push(normImm as ConditionType);
          result.sources.push({
            type: 'effect',
            name: source,
            immunity: imm
          });
        }
      }
    }
  }

  return result;
}

/**
 * Hook to calculate all immunities for a character
 */
export function useImmunities(
  characterData: CharacterData | null,
  activeEffects: ActiveEffect[] = []
): ImmunityInfo {
  return useMemo(() => {
    if (!characterData) {
      return {
        damageImmunities: [],
        conditionImmunities: [],
        savingThrowAdvantage: [],
        sources: []
      };
    }

    const result: ImmunityInfo = {
      damageImmunities: [],
      conditionImmunities: [],
      savingThrowAdvantage: [],
      sources: []
    };

    const raceId = characterData.raceId || characterData.race_id;
    const classId = characterData.classId || characterData.class_id;
    const level = characterData.level || 1;

    // 1. Race immunities
    const raceImm = getRaceImmunities(raceId);
    for (const imm of raceImm.damageImmunities) {
      if (!result.damageImmunities.includes(imm)) {
        result.damageImmunities.push(imm);
      }
    }
    for (const imm of raceImm.conditionImmunities) {
      if (!result.conditionImmunities.includes(imm)) {
        result.conditionImmunities.push(imm);
      }
    }
    result.sources.push(...raceImm.sources);
    if (raceImm.savingThrowAdvantage.length > 0) {
      result.savingThrowAdvantage = [...(result.savingThrowAdvantage || []), ...raceImm.savingThrowAdvantage];
    }

    // 2. Class immunities
    const classImm = getClassImmunities(classId, level);
    for (const imm of classImm.damageImmunities) {
      if (!result.damageImmunities.includes(imm)) {
        result.damageImmunities.push(imm);
      }
    }
    for (const imm of classImm.conditionImmunities) {
      if (!result.conditionImmunities.includes(imm)) {
        result.conditionImmunities.push(imm);
      }
    }
    result.sources.push(...classImm.sources);

    // 3. Passive feature immunities
    const featureImm = getPassiveFeatureImmunities(classId, level, raceId);
    for (const imm of featureImm.damageImmunities) {
      if (!result.damageImmunities.includes(imm)) {
        result.damageImmunities.push(imm);
      }
    }
    for (const imm of featureImm.conditionImmunities) {
      if (!result.conditionImmunities.includes(imm)) {
        result.conditionImmunities.push(imm);
      }
    }
    result.sources.push(...featureImm.sources);

    // 4. Active effect immunities
    const effectImm = getEffectImmunities(activeEffects);
    for (const imm of effectImm.damageImmunities) {
      if (!result.damageImmunities.includes(imm)) {
        result.damageImmunities.push(imm);
      }
    }
    for (const imm of effectImm.conditionImmunities) {
      if (!result.conditionImmunities.includes(imm)) {
        result.conditionImmunities.push(imm);
      }
    }
    result.sources.push(...effectImm.sources);

    return result;
  }, [characterData, activeEffects]);
}

/**
 * Utility to check if a specific damage type is immune
 */
export function checkDamageImmunity(
  immunities: ImmunityInfo,
  damageType: DamageType
): { isImmune: boolean; source?: string } {
  if (immunities.damageImmunities.includes(damageType)) {
    const source = immunities.sources.find(
      s => normalizeString(s.immunity) === normalizeString(damageType)
    );
    return { isImmune: true, source: source?.name };
  }
  return { isImmune: false };
}

/**
 * Utility to check if a specific condition is immune
 */
export function checkConditionImmunity(
  immunities: ImmunityInfo,
  conditionType: ConditionType
): { isImmune: boolean; source?: string } {
  if (immunities.conditionImmunities.includes(conditionType)) {
    const source = immunities.sources.find(
      s => normalizeString(s.immunity) === normalizeString(conditionType)
    );
    return { isImmune: true, source: source?.name };
  }
  return { isImmune: false };
}

export default useImmunities;
