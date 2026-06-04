/**
 * Tests for featureEffectMiddleware — 触发型职业特性中间件
 */
import { describe, it, expect } from 'vitest'
import {
  resolveFeatureEffects,
  resolveDieSize,
  filterFeaturesForCharacter,
  groupByTrigger,
} from '~/utils/featureEffectMiddleware'
import type {
  TriggeredFeatureDefinition,
  FeatureResolveContext,
} from '~/types/triggeredFeature'

// ── Helpers ──────────────────────────────────────────

function makeFeature(overrides: Partial<TriggeredFeatureDefinition> = {}): TriggeredFeatureDefinition {
  return {
    id: 'test_feature',
    name: '测试特性',
    nameEn: 'Test Feature',
    class: ['fighter'],
    level: 1,
    trigger: 'on_activate',
    actionType: 'bonus_action',
    cost: { resourceId: 'second_wind', amount: 1 },
    phases: [{
      trigger: 'on_cast',
      target: { type: 'self' },
      effects: [{ type: 'heal', formula: '1d10+level' }],
    }],
    ui: { promptType: 'quick_use', icon: '💨', color: '#dc2626' },
    chat: { activate: '{source} 使用了 {target} 特性！' },
    ...overrides,
  }
}

function makeContext(overrides: Partial<FeatureResolveContext> = {}): FeatureResolveContext {
  return {
    casterName: '战士小明',
    casterLevel: 5,
    resources: { second_wind: { current: 1, max: 1 } },
    ...overrides,
  }
}

// ── resolveDieSize ───────────────────────────────────

describe('resolveDieSize', () => {
  const scaling = { '3': 'd8', '10': 'd10', '18': 'd12' }

  it('returns null when no scaling', () => {
    expect(resolveDieSize(undefined, 10)).toBeNull()
  })

  it('returns d8 at level 3', () => {
    expect(resolveDieSize(scaling, 3)).toBe('d8')
  })

  it('returns d8 at level 9 (before d10 threshold)', () => {
    expect(resolveDieSize(scaling, 9)).toBe('d8')
  })

  it('returns d10 at level 10', () => {
    expect(resolveDieSize(scaling, 10)).toBe('d10')
  })

  it('returns d12 at level 20', () => {
    expect(resolveDieSize(scaling, 20)).toBe('d12')
  })

  it('returns null below minimum level', () => {
    expect(resolveDieSize(scaling, 2)).toBeNull()
  })
})

// ── resolveFeatureEffects — 资源校验 ─────────────────

describe('resolveFeatureEffects - resource check', () => {
  it('sufficient when pool has enough', () => {
    const feature = makeFeature()
    const ctx = makeContext({ resources: { second_wind: { current: 1, max: 1 } } })
    const result = resolveFeatureEffects(feature, ctx)
    expect(result.resourceCheck.sufficient).toBe(true)
    expect(result.resourceCheck.resourceId).toBe('second_wind')
  })

  it('insufficient when pool empty', () => {
    const feature = makeFeature()
    const ctx = makeContext({ resources: { second_wind: { current: 0, max: 1 } } })
    const result = resolveFeatureEffects(feature, ctx)
    expect(result.resourceCheck.sufficient).toBe(false)
  })

  it('insufficient when resource missing', () => {
    const feature = makeFeature()
    const ctx = makeContext({ resources: {} })
    const result = resolveFeatureEffects(feature, ctx)
    expect(result.resourceCheck.sufficient).toBe(false)
  })

  it('spell slot cost always returns sufficient (caller managed)', () => {
    const feature = makeFeature({
      cost: { resourceId: 'spell_slots', amount: 1, spellSlot: true, minSlotLevel: 1 },
    })
    const ctx = makeContext({ resources: {} })
    const result = resolveFeatureEffects(feature, ctx)
    expect(result.resourceCheck.sufficient).toBe(true)
    expect(result.resourceCheck.resourceId).toBe('spell_slots')
  })
})

// ── resolveFeatureEffects — 聊天模板 ─────────────────

describe('resolveFeatureEffects - chat messages', () => {
  it('fills {source} and {target}', () => {
    const feature = makeFeature({
      chat: { activate: '{source} 攻击 {target}！' },
    })
    const ctx = makeContext({ targetName: '哥布林' })
    const result = resolveFeatureEffects(feature, ctx)
    expect(result.chatMessages.activate).toBe('战士小明 攻击 哥布林！')
  })

  it('fills {dc}', () => {
    const feature = makeFeature({
      chat: { activate: 'DC {dc} 豁免', save_fail: '失败了' },
    })
    const ctx = makeContext({ dc: 15 })
    const result = resolveFeatureEffects(feature, ctx)
    expect(result.chatMessages.activate).toBe('DC 15 豁免')
    expect(result.chatMessages.save_fail).toBe('失败了')
  })

  it('fills {die} from diceScaling', () => {
    const feature = makeFeature({
      diceScaling: { '3': 'd8', '10': 'd10' },
      chat: { activate: '投 {die}' },
    })
    const ctx = makeContext({ casterLevel: 12 })
    const result = resolveFeatureEffects(feature, ctx)
    expect(result.chatMessages.activate).toBe('投 d10')
  })

  it('fills extraVars', () => {
    const feature = makeFeature({
      chat: { activate: '造成 {value} 伤害' },
    })
    const ctx = makeContext({ extraVars: { value: '15' } })
    const result = resolveFeatureEffects(feature, ctx)
    expect(result.chatMessages.activate).toBe('造成 15 伤害')
  })

  it('replaces missing target with empty string', () => {
    const feature = makeFeature({
      chat: { activate: '{source} 对 {target} 使用' },
    })
    const ctx = makeContext({ targetName: undefined })
    const result = resolveFeatureEffects(feature, ctx)
    expect(result.chatMessages.activate).toBe('战士小明 对  使用')
  })
})

// ── resolveFeatureEffects — 骰子替换 ─────────────────

describe('resolveFeatureEffects - die formula replacement', () => {
  it('replaces {die} in effect formulas', () => {
    const feature = makeFeature({
      diceScaling: { '3': 'd8' },
      phases: [{
        trigger: 'on_hit',
        effects: [{ type: 'deal_damage', formula: '{die}', damageType: 'weapon' }],
      }],
    })
    const ctx = makeContext({ casterLevel: 5 })
    const result = resolveFeatureEffects(feature, ctx)
    const dmgEffect = result.phases[0].effects[0] as any
    expect(dmgEffect.formula).toBe('d8')
  })

  it('leaves formula unchanged when no diceScaling', () => {
    const feature = makeFeature({
      phases: [{
        trigger: 'on_cast',
        target: { type: 'self' },
        effects: [{ type: 'heal', formula: '1d10+level' }],
      }],
    })
    const ctx = makeContext()
    const result = resolveFeatureEffects(feature, ctx)
    const healEffect = result.phases[0].effects[0] as any
    expect(healEffect.formula).toBe('1d10+level')
  })
})

// ── resolveFeatureEffects — 机械效果检测 ─────────────

describe('resolveFeatureEffects - mechanical detection', () => {
  it('detects mechanical effects', () => {
    const feature = makeFeature()
    const ctx = makeContext()
    const result = resolveFeatureEffects(feature, ctx)
    expect(result.hasMechanicalEffects).toBe(true)
    expect(result.mechanicalTypes.has('heal')).toBe(true)
  })

  it('narrative-only is not mechanical', () => {
    const feature = makeFeature({
      phases: [{
        trigger: 'on_cast',
        effects: [{ type: 'narrative', description: '纯叙事' }],
      }],
    })
    const ctx = makeContext()
    const result = resolveFeatureEffects(feature, ctx)
    expect(result.hasMechanicalEffects).toBe(false)
    expect(result.mechanicalTypes.size).toBe(0)
  })

  it('collects multiple effect types', () => {
    const feature = makeFeature({
      phases: [
        { trigger: 'on_hit', effects: [{ type: 'deal_damage', formula: '1d8', damageType: 'fire' }] },
        { trigger: 'on_hit', effects: [{ type: 'apply_condition', condition: 'prone' }] },
      ],
    })
    const ctx = makeContext()
    const result = resolveFeatureEffects(feature, ctx)
    expect(result.mechanicalTypes.has('deal_damage')).toBe(true)
    expect(result.mechanicalTypes.has('apply_condition')).toBe(true)
  })
})

// ── resolveFeatureEffects — resolvedDie ──────────────

describe('resolveFeatureEffects - resolvedDie', () => {
  it('returns resolved die', () => {
    const feature = makeFeature({ diceScaling: { '3': 'd8', '10': 'd10' } })
    const ctx = makeContext({ casterLevel: 14 })
    const result = resolveFeatureEffects(feature, ctx)
    expect(result.resolvedDie).toBe('d10')
  })

  it('returns null when no scaling', () => {
    const feature = makeFeature()
    const ctx = makeContext()
    const result = resolveFeatureEffects(feature, ctx)
    expect(result.resolvedDie).toBeNull()
  })
})

// ── filterFeaturesForCharacter ───────────────────────

describe('filterFeaturesForCharacter', () => {
  const features: TriggeredFeatureDefinition[] = [
    makeFeature({ id: 'f1', class: ['fighter'], level: 1 }),
    makeFeature({ id: 'f2', class: ['fighter'], subclass: ['battle_master'], level: 3 }),
    makeFeature({ id: 'f3', class: ['monk'], level: 2 }),
    makeFeature({ id: 'f4', class: ['fighter'], level: 10 }),
  ]

  it('filters by class and level', () => {
    const result = filterFeaturesForCharacter(features, 'fighter', null, 5)
    expect(result.map(f => f.id)).toEqual(['f1'])
  })

  it('includes subclass features when subclass matches', () => {
    const result = filterFeaturesForCharacter(features, 'fighter', 'battle_master', 5)
    expect(result.map(f => f.id)).toEqual(['f1', 'f2'])
  })

  it('excludes features above level', () => {
    const result = filterFeaturesForCharacter(features, 'fighter', 'battle_master', 2)
    expect(result.map(f => f.id)).toEqual(['f1'])
  })

  it('returns empty for wrong class', () => {
    const result = filterFeaturesForCharacter(features, 'wizard', null, 20)
    expect(result).toEqual([])
  })
})

// ── groupByTrigger ───────────────────────────────────

describe('groupByTrigger', () => {
  it('groups features by trigger type', () => {
    const features = [
      makeFeature({ id: 'a', trigger: 'on_hit' }),
      makeFeature({ id: 'b', trigger: 'on_activate' }),
      makeFeature({ id: 'c', trigger: 'on_hit' }),
    ]
    const groups = groupByTrigger(features)
    expect(groups['on_hit']?.length).toBe(2)
    expect(groups['on_activate']?.length).toBe(1)
  })
})
