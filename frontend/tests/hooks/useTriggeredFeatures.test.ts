/**
 * Tests for useTriggeredFeatures hook
 */
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  useTriggeredFeatures,
  getTriggeredFeature,
  getAllTriggeredFeatures,
} from '~/hooks/useTriggeredFeatures'

// ── 静态函数测试 ─────────────────────────────────────

describe('getTriggeredFeature', () => {
  it('returns feature by id', () => {
    const f = getTriggeredFeature('stunning_strike')
    expect(f).not.toBeNull()
    expect(f!.name).toBe('震慑打击')
    expect(f!.class).toContain('monk')
  })

  it('returns null for unknown id', () => {
    expect(getTriggeredFeature('nonexistent')).toBeNull()
  })
})

describe('getAllTriggeredFeatures', () => {
  it('returns all features from JSON', () => {
    const all = getAllTriggeredFeatures()
    expect(all.length).toBeGreaterThan(10)
    expect(all.some(f => f.id === 'second_wind')).toBe(true)
    expect(all.some(f => f.id === 'divine_smite')).toBe(true)
  })
})

// ── Hook 测试 ────────────────────────────────────────

const defaultResources = {
  ki: { current: 5, max: 5 },
  second_wind: { current: 1, max: 1 },
  superiority_dice: { current: 4, max: 4 },
}

describe('useTriggeredFeatures', () => {
  it('filters features for fighter class', () => {
    const { result } = renderHook(() =>
      useTriggeredFeatures({
        classId: 'fighter',
        level: 5,
        resources: defaultResources,
      }),
    )
    const ids = result.current.features.map(f => f.id)
    expect(ids).toContain('second_wind')
    expect(ids).toContain('action_surge')
    // monk features should not appear
    expect(ids).not.toContain('stunning_strike')
    expect(ids).not.toContain('flurry_of_blows')
  })

  it('includes subclass features when subclass matches', () => {
    const { result } = renderHook(() =>
      useTriggeredFeatures({
        classId: 'fighter',
        subclassId: 'battle_master',
        level: 5,
        resources: defaultResources,
      }),
    )
    const ids = result.current.features.map(f => f.id)
    expect(ids).toContain('trip_attack')
    expect(ids).toContain('riposte')
    expect(ids).toContain('precision_attack')
  })

  it('excludes subclass features when subclass does not match', () => {
    const { result } = renderHook(() =>
      useTriggeredFeatures({
        classId: 'fighter',
        subclassId: 'champion',
        level: 5,
        resources: defaultResources,
      }),
    )
    const ids = result.current.features.map(f => f.id)
    expect(ids).toContain('second_wind')
    expect(ids).not.toContain('trip_attack')
  })

  it('respects level requirements', () => {
    const { result } = renderHook(() =>
      useTriggeredFeatures({
        classId: 'monk',
        level: 3,
        resources: defaultResources,
      }),
    )
    const ids = result.current.features.map(f => f.id)
    // level 2 features
    expect(ids).toContain('flurry_of_blows')
    expect(ids).toContain('patient_defense')
    // level 5 feature — should NOT be included
    expect(ids).not.toContain('stunning_strike')
  })

  it('groups features by trigger type', () => {
    const { result } = renderHook(() =>
      useTriggeredFeatures({
        classId: 'fighter',
        subclassId: 'battle_master',
        level: 5,
        resources: defaultResources,
      }),
    )
    const { grouped } = result.current
    // on_activate: second_wind, action_surge, rally
    expect(grouped['on_activate']?.length).toBeGreaterThanOrEqual(2)
    // on_hit: trip_attack, menacing_attack, etc.
    expect(grouped['on_hit']?.length).toBeGreaterThanOrEqual(3)
    // on_enemy_miss: riposte
    expect(grouped['on_enemy_miss']?.length).toBe(1)
  })

  it('getByTrigger returns features for given trigger', () => {
    const { result } = renderHook(() =>
      useTriggeredFeatures({
        classId: 'monk',
        level: 5,
        resources: defaultResources,
      }),
    )
    const onHit = result.current.getByTrigger('on_hit')
    expect(onHit.some(f => f.id === 'stunning_strike')).toBe(true)

    const onActivate = result.current.getByTrigger('on_activate')
    expect(onActivate.some(f => f.id === 'flurry_of_blows')).toBe(true)
  })

  it('getByTrigger returns empty array for missing trigger', () => {
    const { result } = renderHook(() =>
      useTriggeredFeatures({
        classId: 'monk',
        level: 5,
        resources: defaultResources,
      }),
    )
    expect(result.current.getByTrigger('on_enemy_miss')).toEqual([])
  })

  it('resolve returns resolved effects', () => {
    const { result } = renderHook(() =>
      useTriggeredFeatures({
        classId: 'monk',
        level: 5,
        resources: { ki: { current: 3, max: 5 } },
      }),
    )
    const resolved = result.current.resolve('stunning_strike', {
      casterName: '武僧小红',
      casterLevel: 5,
      targetName: '巨魔',
      dc: 14,
    })
    expect(resolved).not.toBeNull()
    expect(resolved!.resourceCheck.sufficient).toBe(true)
    expect(resolved!.chatMessages.activate).toContain('武僧小红')
    expect(resolved!.chatMessages.activate).toContain('巨魔')
  })

  it('resolve returns null for unknown feature', () => {
    const { result } = renderHook(() =>
      useTriggeredFeatures({
        classId: 'monk',
        level: 5,
        resources: defaultResources,
      }),
    )
    expect(result.current.resolve('nonexistent', {
      casterName: 'test',
      casterLevel: 1,
    })).toBeNull()
  })

  it('getFeature returns feature definition', () => {
    const { result } = renderHook(() =>
      useTriggeredFeatures({
        classId: 'fighter',
        level: 1,
        resources: defaultResources,
      }),
    )
    const f = result.current.getFeature('second_wind')
    expect(f).not.toBeNull()
    expect(f!.nameEn).toBe('Second Wind')
  })
})
