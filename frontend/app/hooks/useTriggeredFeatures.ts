/**
 * useTriggeredFeatures — 触发型职业特性 hook
 *
 * 静态加载 triggered-features.json，按角色职业/子职/等级筛选，
 * 按触发类型分组，提供 resolve 快捷函数。
 */
import { useMemo, useCallback } from 'react'
import type {
  TriggeredFeatureDefinition,
  FeatureResolveContext,
  ResolvedFeatureEffects,
} from '~/types/triggeredFeature'
import {
  resolveFeatureEffects,
  filterFeaturesForCharacter,
  groupByTrigger,
} from '~/utils/featureEffectMiddleware'
import featuresData from '~/data/rules/triggered-features.json'

// ── 模块级静态注册表 ────────────────────────────────

const allFeatures = featuresData.features as unknown as TriggeredFeatureDefinition[]

const byId: Record<string, TriggeredFeatureDefinition> = {}
for (const f of allFeatures) {
  byId[f.id] = f
}

/** 直接按 id 获取特性定义（不需要 hook） */
export function getTriggeredFeature(id: string): TriggeredFeatureDefinition | null {
  return byId[id] ?? null
}

/** 获取所有触发型特性 */
export function getAllTriggeredFeatures(): TriggeredFeatureDefinition[] {
  return allFeatures
}

// ── Hook ─────────────────────────────────────────────

export interface UseTriggeredFeaturesOptions {
  classId: string
  subclassId?: string | null
  level: number
  resources: Record<string, { current: number; max: number }>
}

export interface UseTriggeredFeaturesReturn {
  /** 该角色可用的全部触发型特性 */
  features: TriggeredFeatureDefinition[]
  /** 按触发类型分组：{ on_hit: [...], on_activate: [...], ... } */
  grouped: Record<string, TriggeredFeatureDefinition[]>
  /** 解析特性效果 */
  resolve: (featureId: string, ctx: Omit<FeatureResolveContext, 'resources'>) => ResolvedFeatureEffects | null
  /** 按 id 查找特性 */
  getFeature: (id: string) => TriggeredFeatureDefinition | null
  /** 获取某触发类型下的可用特性 */
  getByTrigger: (trigger: string) => TriggeredFeatureDefinition[]
}

export function useTriggeredFeatures(
  opts: UseTriggeredFeaturesOptions,
): UseTriggeredFeaturesReturn {
  const { classId, subclassId, level, resources } = opts

  const features = useMemo(
    () => filterFeaturesForCharacter(allFeatures, classId, subclassId ?? null, level),
    [classId, subclassId, level],
  )

  const grouped = useMemo(() => groupByTrigger(features), [features])

  const resolve = useCallback(
    (featureId: string, ctx: Omit<FeatureResolveContext, 'resources'>) => {
      const feature = byId[featureId]
      if (!feature) return null
      return resolveFeatureEffects(feature, { ...ctx, resources })
    },
    [resources],
  )

  const getByTrigger = useCallback(
    (trigger: string) => grouped[trigger] ?? [],
    [grouped],
  )

  return {
    features,
    grouped,
    resolve,
    getFeature: (id: string) => byId[id] ?? null,
    getByTrigger,
  }
}
