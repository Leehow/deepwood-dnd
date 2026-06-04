/**
 * Unified Effect System Hook
 * Centralizes all buff/effect management for D&D 5E combat
 */

import { useCallback, useMemo } from 'react';
import type {
  EffectDefinition,
  ActiveEffect,
  UseEffectSystemOptions,
  UseEffectSystemReturn,
  ModifierTarget,
  ModifierCondition,
  ModifierCheckResult,
  DamageType,
  EffectRegistry,
} from '~/types/effects';
import effectsData from '~/data/effects.json';

// Build effect registry from JSON data
const buildRegistry = (): EffectRegistry => {
  const effects: Record<string, EffectDefinition> = {};
  const byCategory: Record<string, string[]> = {};
  const bySource: Record<string, string[]> = {};

  for (const effect of effectsData.effects as EffectDefinition[]) {
    effects[effect.id] = effect;

    // Index by category
    if (!byCategory[effect.category]) {
      byCategory[effect.category] = [];
    }
    byCategory[effect.category].push(effect.id);

    // Index by source
    if (effect.source) {
      if (!bySource[effect.source]) {
        bySource[effect.source] = [];
      }
      bySource[effect.source].push(effect.id);
    }
  }

  return { effects, byCategory: byCategory as EffectRegistry['byCategory'], bySource };
};

// Global registry (loaded once)
const effectRegistry = buildRegistry();

/**
 * Get effect definition by ID
 */
export function getEffectDefinition(effectId: string): EffectDefinition | undefined {
  return effectRegistry.effects[effectId];
}

/**
 * Get all effect definitions
 */
export function getAllEffects(): EffectDefinition[] {
  return Object.values(effectRegistry.effects);
}

/**
 * Get effects by category
 */
export function getEffectsByCategory(category: string): EffectDefinition[] {
  const ids = effectRegistry.byCategory[category as keyof typeof effectRegistry.byCategory] || [];
  return ids.map(id => effectRegistry.effects[id]).filter(Boolean);
}

/**
 * Get effects by source (class, race, etc.)
 */
export function getEffectsBySource(source: string): EffectDefinition[] {
  const ids = effectRegistry.bySource[source] || [];
  return ids.map(id => effectRegistry.effects[id]).filter(Boolean);
}

/**
 * Check if a condition matches
 */
function checkCondition(
  condition: ModifierCondition | undefined,
  checkCondition: ModifierCondition | undefined
): boolean {
  if (!condition) return true;
  if (!checkCondition) return true;

  // Check ability
  if (condition.ability && checkCondition.ability) {
    if (condition.ability !== checkCondition.ability) return false;
  }

  // Check damage type
  if (condition.damageType && checkCondition.damageType) {
    const condTypes = Array.isArray(condition.damageType) ? condition.damageType : [condition.damageType];
    const checkTypes = Array.isArray(checkCondition.damageType) ? checkCondition.damageType : [checkCondition.damageType];
    if (!condTypes.some(t => checkTypes.includes(t))) return false;
  }

  // Check attack type
  if (condition.attackType && checkCondition.attackType) {
    if (condition.attackType !== checkCondition.attackType) return false;
  }

  // Check strength-based
  if (condition.isStrengthBased !== undefined && checkCondition.isStrengthBased !== undefined) {
    if (condition.isStrengthBased !== checkCondition.isStrengthBased) return false;
  }

  return true;
}

/**
 * Get rage damage bonus based on barbarian level
 */
function getRageDamageBonus(level: number): number {
  if (level >= 16) return 4;
  if (level >= 9) return 3;
  return 2;
}

/**
 * Main hook for managing effects on a token
 */
export function useEffectSystem(options: UseEffectSystemOptions): UseEffectSystemReturn {
  const {
    tokenId,
    activeEffects,
    characterLevel = 1,
    classId,
    subclassId,
    onEffectsChange,
  } = options;

  // Get effect definition
  const getDefinition = useCallback((effectId: string): EffectDefinition | undefined => {
    return effectRegistry.effects[effectId];
  }, []);

  // Check if effect is active
  const isEffectActive = useCallback((effectId: string): boolean => {
    return activeEffects.some(e => e.id === effectId);
  }, [activeEffects]);

  // Get active effect instance
  const getActiveEffect = useCallback((effectId: string): ActiveEffect | undefined => {
    return activeEffects.find(e => e.id === effectId);
  }, [activeEffects]);

  // Check if can use effect
  const canUseEffect = useCallback((effectId: string): { canUse: boolean; reason?: string } => {
    const def = getDefinition(effectId);
    if (!def) return { canUse: false, reason: '效果不存在' };

    const prereqs = def.prerequisites;
    if (prereqs) {
      // Check class
      if (prereqs.class && classId && !prereqs.class.includes(classId.toLowerCase())) {
        return { canUse: false, reason: `需要职业: ${prereqs.class.join('/')}` };
      }

      // Check subclass
      if (prereqs.subclass && subclassId && !prereqs.subclass.includes(subclassId.toLowerCase())) {
        return { canUse: false, reason: `需要子职业: ${prereqs.subclass.join('/')}` };
      }

      // Check level
      if (prereqs.level && characterLevel < prereqs.level) {
        return { canUse: false, reason: `需要等级 ${prereqs.level}` };
      }

      // Check required effects
      if (prereqs.hasEffect) {
        for (const reqEffect of prereqs.hasEffect) {
          if (!isEffectActive(reqEffect)) {
            const reqDef = getDefinition(reqEffect);
            return { canUse: false, reason: `需要激活: ${reqDef?.name || reqEffect}` };
          }
        }
      }

      // Check forbidden effects
      if (prereqs.notHasEffect) {
        for (const forbidEffect of prereqs.notHasEffect) {
          if (isEffectActive(forbidEffect)) {
            const forbidDef = getDefinition(forbidEffect);
            return { canUse: false, reason: `不能同时激活: ${forbidDef?.name || forbidEffect}` };
          }
        }
      }
    }

    return { canUse: true };
  }, [getDefinition, classId, subclassId, characterLevel, isEffectActive]);

  // Activate effect
  const activateEffect = useCallback(async (
    effectId: string,
    metadata?: Record<string, unknown>
  ): Promise<ActiveEffect | null> => {
    const def = getDefinition(effectId);
    if (!def) return null;

    const check = canUseEffect(effectId);
    if (!check.canUse) {
      console.warn(`Cannot activate effect ${effectId}: ${check.reason}`);
      return null;
    }

    // Calculate duration
    let duration: number | undefined;
    let maxDuration: number | undefined;
    if (def.duration?.rounds) {
      duration = def.duration.rounds;
      maxDuration = def.duration.rounds;
    } else if (def.duration?.minutes) {
      // Convert minutes to rounds (1 round = 6 seconds)
      duration = def.duration.minutes * 10;
      maxDuration = def.duration.minutes * 10;
    }

    const newEffect: ActiveEffect = {
      id: effectId,
      instanceId: `${effectId}_${Date.now()}`,
      name: def.name,
      icon: def.visual.icon,
      color: def.visual.color,
      duration,
      maxDuration,
      metadata,
    };

    const updatedEffects = [...activeEffects, newEffect];
    if (onEffectsChange) {
      await onEffectsChange(updatedEffects);
    }

    return newEffect;
  }, [getDefinition, canUseEffect, activeEffects, onEffectsChange]);

  // Deactivate effect
  const deactivateEffect = useCallback(async (
    identifier: string | { instanceId: string }
  ): Promise<boolean> => {
    let effectToRemove: ActiveEffect | undefined;

    if (typeof identifier === 'string') {
      effectToRemove = activeEffects.find(e => e.id === identifier);
    } else {
      effectToRemove = activeEffects.find(e => e.instanceId === identifier.instanceId);
    }

    if (!effectToRemove) return false;

    const def = getDefinition(effectToRemove.id);

    // Check for effects that end together
    let effectsToRemove = [effectToRemove.id];
    if (def) {
      // Find effects that should end when this effect ends
      for (const effect of activeEffects) {
        const effectDef = getDefinition(effect.id);
        if (effectDef?.endsWhen?.includes(effectToRemove.id)) {
          effectsToRemove.push(effect.id);
        }
      }
    }

    const updatedEffects = activeEffects.filter(e => !effectsToRemove.includes(e.id));

    if (onEffectsChange) {
      await onEffectsChange(updatedEffects);
    }

    return true;
  }, [activeEffects, getDefinition, onEffectsChange]);

  // Toggle effect
  const toggleEffect = useCallback(async (effectId: string): Promise<ActiveEffect | null> => {
    if (isEffectActive(effectId)) {
      await deactivateEffect(effectId);
      return null;
    }
    return activateEffect(effectId);
  }, [isEffectActive, deactivateEffect, activateEffect]);

  // Get modifiers for a target
  const getModifiersFor = useCallback((
    target: ModifierTarget,
    condition?: ModifierCondition
  ): ModifierCheckResult => {
    const result: ModifierCheckResult = {
      hasAdvantage: false,
      hasDisadvantage: false,
      bonuses: [],
      resistances: [],
      immunities: [],
      reasons: [],
      suppressed: false,
    };

    for (const effect of activeEffects) {
      const def = getDefinition(effect.id);
      if (!def?.modifiers) continue;

      for (const mod of def.modifiers) {
        if (mod.target !== target) continue;
        if (!checkCondition(mod.condition, condition)) continue;

        switch (mod.type) {
          case 'advantage':
            result.hasAdvantage = true;
            result.reasons.push(`${def.name}: 优势`);
            break;

          case 'disadvantage':
            result.hasDisadvantage = true;
            result.reasons.push(`${def.name}: 劣势`);
            break;

          case 'bonus':
            if (typeof mod.value === 'number') {
              // Special handling for rage damage bonus
              if (effect.id === 'rage' && target === 'damage') {
                const rageDmg = getRageDamageBonus(characterLevel);
                result.bonuses.push(rageDmg);
                result.reasons.push(`${def.name}: +${rageDmg}伤害`);
              } else {
                result.bonuses.push(mod.value);
                result.reasons.push(`${def.name}: +${mod.value}`);
              }
            } else if (typeof mod.value === 'string') {
              // Formula like "1d4" - just note it
              result.reasons.push(`${def.name}: +${mod.value}`);
            }
            break;

          case 'suppress':
            result.suppressed = true;
            result.reasons.push(`${def.name}: 抑制`);
            break;

          case 'resistance':
            if (mod.condition?.damageType) {
              const types = Array.isArray(mod.condition.damageType)
                ? mod.condition.damageType
                : [mod.condition.damageType];
              result.resistances.push(...types);
              result.reasons.push(`${def.name}: 抗性 (${types.join(', ')})`);
            }
            break;

          case 'immunity':
            if (mod.condition?.damageType) {
              const types = Array.isArray(mod.condition.damageType)
                ? mod.condition.damageType
                : [mod.condition.damageType];
              result.immunities.push(...types);
              result.reasons.push(`${def.name}: 免疫 (${types.join(', ')})`);
            }
            break;
        }
      }
    }

    return result;
  }, [activeEffects, getDefinition, characterLevel]);

  // Convenience methods
  const hasAdvantageOn = useCallback((
    target: ModifierTarget,
    condition?: ModifierCondition
  ): boolean => {
    const mods = getModifiersFor(target, condition);
    return mods.hasAdvantage && !mods.hasDisadvantage;
  }, [getModifiersFor]);

  const hasDisadvantageOn = useCallback((
    target: ModifierTarget,
    condition?: ModifierCondition
  ): boolean => {
    const mods = getModifiersFor(target, condition);
    return mods.hasDisadvantage && !mods.hasAdvantage;
  }, [getModifiersFor]);

  const getDamageBonus = useCallback((attackType?: 'melee' | 'ranged'): number => {
    const mods = getModifiersFor('damage', { attackType, isStrengthBased: attackType === 'melee' });
    return mods.bonuses.reduce((sum, b) => sum + b, 0);
  }, [getModifiersFor]);

  const getResistances = useCallback((): DamageType[] => {
    const mods = getModifiersFor('damage_taken');
    return [...new Set(mods.resistances)];
  }, [getModifiersFor]);

  const getImmunities = useCallback((): DamageType[] => {
    const mods = getModifiersFor('damage_taken');
    return [...new Set(mods.immunities)];
  }, [getModifiersFor]);

  // Decrement durations (call at end of turn)
  const decrementDurations = useCallback((): ActiveEffect[] => {
    const expired: ActiveEffect[] = [];
    const updated: ActiveEffect[] = [];

    for (const effect of activeEffects) {
      if (effect.duration !== undefined && effect.duration > 0) {
        const newDuration = effect.duration - 1;
        if (newDuration <= 0) {
          expired.push(effect);
        } else {
          updated.push({ ...effect, duration: newDuration });
        }
      } else {
        updated.push(effect);
      }
    }

    if (expired.length > 0 && onEffectsChange) {
      onEffectsChange(updated);
    }

    return expired;
  }, [activeEffects, onEffectsChange]);

  // Get available effects for this token
  const getAvailableEffects = useCallback((): EffectDefinition[] => {
    const available: EffectDefinition[] = [];

    for (const def of Object.values(effectRegistry.effects)) {
      const check = canUseEffect(def.id);
      if (check.canUse || !def.prerequisites) {
        available.push(def);
      }
    }

    return available;
  }, [canUseEffect]);

  return {
    effects: activeEffects,
    activateEffect,
    deactivateEffect,
    toggleEffect,
    isEffectActive,
    getActiveEffect,
    getEffectDefinition: getDefinition,
    getModifiersFor,
    hasAdvantageOn,
    hasDisadvantageOn,
    getDamageBonus,
    getResistances,
    getImmunities,
    decrementDurations,
    getAvailableEffects,
    canUseEffect,
  };
}

// Re-export types
export type {
  EffectDefinition,
  ActiveEffect,
  UseEffectSystemOptions,
  UseEffectSystemReturn,
  ModifierTarget,
  ModifierCondition,
  ModifierCheckResult,
  DamageType,
};
