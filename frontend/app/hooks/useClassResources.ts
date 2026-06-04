/**
 * Unified Class Resource System Hook
 * 统一职业资源系统
 */

import { useCallback, useMemo } from 'react';
import type {
  ClassResource,
  ResourceAbility,
  CharacterResourceState,
  ResourceMaxParams,
  CharacterResources,
  MaxFormula,
} from '~/types/classResources';
import classResourcesData from '~/data/rules/class_resources.json';

// 加载资源数据
const { classResources, resourceAbilities } = classResourcesData as {
  classResources: ClassResource[];
  resourceAbilities: ResourceAbility[];
};

// 索引
const resourcesById = new Map(classResources.map(r => [r.id, r]));
const abilitiesById = new Map(resourceAbilities.map(a => [a.id, a]));
const abilitiesByResource = new Map<string, ResourceAbility[]>();
for (const ability of resourceAbilities) {
  const list = abilitiesByResource.get(ability.resourceId) || [];
  list.push(ability);
  abilitiesByResource.set(ability.resourceId, list);
}

/**
 * 获取资源定义
 */
export function getResourceDefinition(resourceId: string): ClassResource | undefined {
  return resourcesById.get(resourceId);
}

/**
 * 获取能力定义
 */
export function getAbilityDefinition(abilityId: string): ResourceAbility | undefined {
  return abilitiesById.get(abilityId);
}

/**
 * 获取资源关联的所有能力
 */
export function getResourceAbilities(resourceId: string): ResourceAbility[] {
  return abilitiesByResource.get(resourceId) || [];
}

/**
 * 计算属性调整值
 */
function getModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/**
 * 根据等级获取缩放值
 */
function getScaledValue(scaling: Record<number, number | string> | undefined, level: number): number | string | undefined {
  if (!scaling) return undefined;

  let result: number | string | undefined;
  const levels = Object.keys(scaling).map(Number).sort((a, b) => a - b);

  for (const lvl of levels) {
    if (level >= lvl) {
      result = scaling[lvl];
    }
  }

  return result;
}

/**
 * 计算资源最大值
 */
export function calculateResourceMax(resource: ClassResource, params: ResourceMaxParams): number {
  const { level, charisma = 10, wisdom = 10, intelligence = 10 } = params;

  // 检查等级要求
  if (level < resource.minLevel) {
    return 0;
  }

  const formula = resource.maxFormula;
  let max = 0;

  switch (formula) {
    case 'level':
      max = level;
      break;

    case 'half_level_rounded_up':
      max = Math.ceil(level / 2);
      break;

    case 'cha_mod':
      max = Math.max(resource.minMax || 1, getModifier(charisma));
      break;

    case 'wis_mod':
      max = Math.max(resource.minMax || 1, getModifier(wisdom));
      break;

    case 'int_mod':
      max = Math.max(resource.minMax || 1, getModifier(intelligence));
      break;

    case 'level_times_5':
      max = level * 5;
      break;

    case 'wizard_level_times_2_plus_int':
      max = level * 2 + getModifier(intelligence);
      break;

    case 'fixed':
      const scaledValue = getScaledValue(resource.maxScaling, level);
      max = typeof scaledValue === 'number' ? scaledValue : 0;
      // -1 表示无限
      if (max === -1) max = 999;
      break;

    case 'passive':
    case 'uses_ki':
    case 'uses_wild_shape':
    case 'spell_slots':
      // 这些不是独立资源，返回 0
      max = 0;
      break;

    default:
      max = 0;
  }

  return max;
}

/**
 * 获取当前骰子类型
 */
export function getCurrentDiceType(resource: ClassResource, level: number): string | undefined {
  if (!resource.diceType) return undefined;

  if (resource.diceScaling) {
    const scaled = getScaledValue(resource.diceScaling, level);
    if (typeof scaled === 'string') return scaled;
  }

  return resource.diceType;
}

/**
 * 获取当前恢复类型
 */
export function getCurrentRechargeType(resource: ClassResource, level: number): 'short_rest' | 'long_rest' | undefined {
  if (resource.rechargeUpgrade && level >= resource.rechargeUpgrade.level) {
    return resource.rechargeUpgrade.recharge;
  }
  return resource.recharge;
}

/**
 * 获取角色可用的所有资源
 */
export function getCharacterResources(
  classId: string,
  subclassId: string | undefined,
  level: number
): CharacterResources {
  const resources: ClassResource[] = [];
  const abilities: ResourceAbility[] = [];

  for (const resource of classResources) {
    // 检查职业匹配
    if (resource.classId !== classId) continue;

    // 检查子职业匹配（如果资源需要特定子职业）
    if (resource.subclassId && resource.subclassId !== subclassId) continue;

    // 检查等级要求
    if (level < resource.minLevel) continue;

    // 跳过被动能力；共享资源本身不单独展示，但它们的能力仍需暴露
    if (resource.maxFormula === 'passive') continue;
    if (!resource.shareResource) {
      resources.push(resource);
    }

    // 添加关联能力
    const resourceAbilities = getResourceAbilities(resource.id);
    for (const ability of resourceAbilities) {
      if (ability.subclassId && ability.subclassId !== subclassId) continue;
      if (!ability.minLevel || level >= ability.minLevel) {
        abilities.push(ability);
      }
    }
  }

  return { resources, abilities };
}

// ============ Hook ============

export interface UseClassResourcesOptions {
  classId: string;
  subclassId?: string;
  level: number;
  charisma?: number;
  wisdom?: number;
  intelligence?: number;
  /** 当前资源状态（从角色数据加载） */
  resourceStates?: CharacterResourceState[];
  /** 资源变化回调 */
  onResourceChange?: (states: CharacterResourceState[]) => Promise<void>;
}

export interface UseClassResourcesReturn {
  /** 角色可用的资源列表 */
  resources: ClassResource[];
  /** 角色可用的能力列表 */
  abilities: ResourceAbility[];
  /** 当前资源状态 */
  states: CharacterResourceState[];

  /** 获取资源当前值 */
  getResourceCurrent: (resourceId: string) => number;
  /** 获取资源最大值 */
  getResourceMax: (resourceId: string) => number;
  /** 获取资源骰子类型 */
  getResourceDice: (resourceId: string) => string | undefined;

  /** 使用资源（减少当前值） */
  useResource: (resourceId: string, amount?: number) => Promise<boolean>;
  /** 恢复资源 */
  restoreResource: (resourceId: string, amount?: number) => Promise<void>;
  /** 短休恢复 */
  shortRest: () => Promise<void>;
  /** 长休恢复 */
  longRest: () => Promise<void>;

  /** 检查是否能使用能力 */
  canUseAbility: (abilityId: string) => { canUse: boolean; reason?: string };
  /** 使用能力（自动消耗资源） */
  useAbility: (abilityId: string, spellLevel?: number) => Promise<boolean>;
}

export function useClassResources(options: UseClassResourcesOptions): UseClassResourcesReturn {
  const {
    classId,
    subclassId,
    level,
    charisma = 10,
    wisdom = 10,
    intelligence = 10,
    resourceStates = [],
    onResourceChange,
  } = options;

  // 计算可用资源和能力
  const { resources, abilities } = useMemo(
    () => getCharacterResources(classId, subclassId, level),
    [classId, subclassId, level]
  );

  // 计算资源最大值
  const resourceMaxValues = useMemo(() => {
    const params: ResourceMaxParams = { level, classId, subclassId, charisma, wisdom, intelligence };
    const maxes = new Map<string, number>();
    for (const resource of resources) {
      maxes.set(resource.id, calculateResourceMax(resource, params));
    }
    return maxes;
  }, [resources, level, classId, subclassId, charisma, wisdom, intelligence]);

  // 合并状态（确保所有资源都有状态）
  const states = useMemo(() => {
    const stateMap = new Map(resourceStates.map(s => [s.resourceId, s]));
    return resources.map(resource => {
      const existing = stateMap.get(resource.id);
      const max = resourceMaxValues.get(resource.id) || 0;
      return existing || { resourceId: resource.id, current: max, max };
    });
  }, [resources, resourceStates, resourceMaxValues]);

  // 获取资源当前值
  const getResourceCurrent = useCallback((resourceId: string): number => {
    const state = states.find(s => s.resourceId === resourceId);
    return state?.current || 0;
  }, [states]);

  // 获取资源最大值
  const getResourceMax = useCallback((resourceId: string): number => {
    return resourceMaxValues.get(resourceId) || 0;
  }, [resourceMaxValues]);

  // 获取资源骰子类型
  const getResourceDice = useCallback((resourceId: string): string | undefined => {
    const resource = resourcesById.get(resourceId);
    if (!resource) return undefined;
    return getCurrentDiceType(resource, level);
  }, [level]);

  // 更新状态
  const updateStates = useCallback(async (newStates: CharacterResourceState[]) => {
    if (onResourceChange) {
      await onResourceChange(newStates);
    }
  }, [onResourceChange]);

  // 使用资源
  const useResource = useCallback(async (resourceId: string, amount = 1): Promise<boolean> => {
    const current = getResourceCurrent(resourceId);
    if (current < amount) return false;

    const newStates = states.map(s =>
      s.resourceId === resourceId
        ? { ...s, current: s.current - amount }
        : s
    );
    await updateStates(newStates);
    return true;
  }, [states, getResourceCurrent, updateStates]);

  // 恢复资源
  const restoreResource = useCallback(async (resourceId: string, amount?: number) => {
    const max = getResourceMax(resourceId);
    const current = getResourceCurrent(resourceId);
    const newCurrent = amount !== undefined
      ? Math.min(current + amount, max)
      : max;

    const newStates = states.map(s =>
      s.resourceId === resourceId
        ? { ...s, current: newCurrent, max }
        : s
    );
    await updateStates(newStates);
  }, [states, getResourceCurrent, getResourceMax, updateStates]);

  // 短休恢复
  const shortRest = useCallback(async () => {
    const newStates = states.map(state => {
      const resource = resourcesById.get(state.resourceId);
      if (!resource) return state;

      const rechargeType = getCurrentRechargeType(resource, level);
      if (rechargeType === 'short_rest') {
        const max = resourceMaxValues.get(resource.id) || 0;
        return { ...state, current: max, max };
      }
      return state;
    });
    await updateStates(newStates);
  }, [states, level, resourceMaxValues, updateStates]);

  // 长休恢复
  const longRest = useCallback(async () => {
    const newStates = states.map(state => {
      const max = resourceMaxValues.get(state.resourceId) || 0;
      return { ...state, current: max, max };
    });
    await updateStates(newStates);
  }, [states, resourceMaxValues, updateStates]);

  // 检查能否使用能力
  const canUseAbility = useCallback((abilityId: string): { canUse: boolean; reason?: string } => {
    const ability = abilitiesById.get(abilityId);
    if (!ability) return { canUse: false, reason: '能力不存在' };

    // 检查等级
    if (ability.minLevel && level < ability.minLevel) {
      return { canUse: false, reason: `需要等级 ${ability.minLevel}` };
    }

    // 检查资源
    const resourceId = ability.resourceId;
    const resource = resourcesById.get(resourceId);

    // 如果是共享资源，找到实际资源
    let actualResourceId = resourceId;
    if (resource?.shareResource) {
      actualResourceId = resource.shareResource;
    }

    const current = getResourceCurrent(actualResourceId);
    const cost = typeof ability.cost === 'number' ? ability.cost : (ability.minCost || 1);

    if (current < cost) {
      const resourceDef = resourcesById.get(actualResourceId);
      return { canUse: false, reason: `${resourceDef?.name || '资源'}不足 (${current}/${cost})` };
    }

    return { canUse: true };
  }, [level, getResourceCurrent]);

  // 使用能力
  const useAbility = useCallback(async (abilityId: string, spellLevel?: number): Promise<boolean> => {
    const ability = abilitiesById.get(abilityId);
    if (!ability) return false;

    const check = canUseAbility(abilityId);
    if (!check.canUse) return false;

    // 计算消耗
    let cost: number;
    if (ability.cost === 'spell_level') {
      cost = Math.max(ability.minCost || 1, spellLevel || 1);
    } else {
      cost = ability.cost;
    }

    // 找到实际资源
    const resource = resourcesById.get(ability.resourceId);
    const actualResourceId = resource?.shareResource || ability.resourceId;

    return useResource(actualResourceId, cost);
  }, [canUseAbility, useResource]);

  return {
    resources,
    abilities,
    states,
    getResourceCurrent,
    getResourceMax,
    getResourceDice,
    useResource,
    restoreResource,
    shortRest,
    longRest,
    canUseAbility,
    useAbility,
  };
}

// 导出常用函数
export {
  classResources,
  resourceAbilities,
};
