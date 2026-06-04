import { describe, it, expect } from 'vitest'
import {
  resolveFeatureActionUI,
  resolveResourceActionUI,
  getAvailableActions,
  getUsableActions,
  getActionsByType,
} from '~/utils/featureActionMiddleware'
import { resolvePersistentEffects } from '~/utils/persistentFeatureMiddleware'
import type { CombatOption, FeatureActionContext, FeatureResource } from '~/types/featureEffect'

// ── resolveFeatureActionUI ──────────────────────────

describe('resolveFeatureActionUI', () => {
  const powerAttack: CombatOption = {
    id: 'gwm_opt_0', name: '强力打击', nameEn: 'Power Attack',
    actionType: 'action', condition: 'heavy_melee_weapon',
    attackPenalty: -5, damageBonus: 10,
    source: { type: 'feat', id: 'great_weapon_master', name: '巨武器大师' },
  }

  it('returns canUse=true when condition is met', () => {
    const ctx: FeatureActionContext = { weaponType: 'heavy_melee' }
    const r = resolveFeatureActionUI(powerAttack, ctx)
    expect(r.canUse).toBe(true)
    expect(r.conditionsMet).toBe(true)
    expect(r.disabledReasons).toHaveLength(0)
  })

  it('returns canUse=false with reason when condition not met', () => {
    const ctx: FeatureActionContext = { weaponType: 'ranged' }
    const r = resolveFeatureActionUI(powerAttack, ctx)
    expect(r.canUse).toBe(false)
    expect(r.conditionsMet).toBe(false)
    expect(r.disabledReasons[0].type).toBe('condition_not_met')
    expect(r.disabledReasons[0].detail).toContain('重型近战武器')
  })

  it('returns canUse=false when limit already used', () => {
    const limited: CombatOption = {
      ...powerAttack,
      condition: undefined,
      limit: 'once_per_turn',
    }
    const ctx: FeatureActionContext = { usedThisTurn: new Set(['once_per_turn']) }
    const r = resolveFeatureActionUI(limited, ctx)
    expect(r.canUse).toBe(false)
    expect(r.disabledReasons[0].type).toBe('already_used')
  })

  it('returns correct actionLabel', () => {
    const r = resolveFeatureActionUI(powerAttack, { weaponType: 'heavy_melee' })
    expect(r.actionLabel).toBe('动作')

    const reaction: CombatOption = { ...powerAttack, actionType: 'reaction' }
    const r2 = resolveFeatureActionUI(reaction, {})
    expect(r2.actionLabel).toBe('反应')
  })

  it('handles option with no condition', () => {
    const noCondition: CombatOption = {
      ...powerAttack,
      condition: undefined,
    }
    const r = resolveFeatureActionUI(noCondition, {})
    expect(r.canUse).toBe(true)
    expect(r.conditionLabel).toBeUndefined()
  })
})

// ── resolveResourceActionUI ─────────────────────────

describe('resolveResourceActionUI', () => {
  const luckPoints: FeatureResource = {
    id: 'feat_lucky_luck_points', name: '幸运点数', nameEn: 'Luck Points',
    max: 3, recharge: 'long_rest', usage: 'extra_d20_on_attack_ability_save',
    source: { type: 'feat', id: 'lucky', name: '幸运' },
  }

  it('returns canUse=true when resource available', () => {
    const ctx: FeatureActionContext = { resourcesRemaining: { feat_lucky_luck_points: 2 } }
    const r = resolveResourceActionUI(luckPoints, ctx)
    expect(r.canUse).toBe(true)
    expect(r.resourceCost).toEqual({ resourceId: 'feat_lucky_luck_points', amount: 1 })
  })

  it('returns canUse=false when resource exhausted', () => {
    const ctx: FeatureActionContext = { resourcesRemaining: { feat_lucky_luck_points: 0 } }
    const r = resolveResourceActionUI(luckPoints, ctx)
    expect(r.canUse).toBe(false)
    expect(r.disabledReasons[0].type).toBe('resource_exhausted')
  })

  it('returns canUse=false when resource not tracked', () => {
    const r = resolveResourceActionUI(luckPoints, {})
    expect(r.canUse).toBe(false)
  })
})

// ── batch helpers ───────────────────────────────────

describe('batch action helpers', () => {
  it('getAvailableActions returns all combat options with descriptors', () => {
    const resolved = resolvePersistentEffects({
      featIds: ['great_weapon_master', 'sharpshooter'],
    })
    const ctx: FeatureActionContext = { weaponType: 'heavy_melee' }
    const all = getAvailableActions(resolved, ctx)
    expect(all.length).toBe(2) // power attack + precise shot
    // GWM should be usable, sharpshooter should not
    const gwm = all.find(a => a.option.name === '强力打击')
    expect(gwm!.descriptor.canUse).toBe(true)
    const ss = all.find(a => a.option.nameEn === 'Precise Shot')
    expect(ss!.descriptor.canUse).toBe(false)
  })

  it('getUsableActions filters to only usable ones', () => {
    const resolved = resolvePersistentEffects({
      featIds: ['great_weapon_master', 'sharpshooter'],
    })
    const ctx: FeatureActionContext = { weaponType: 'heavy_melee' }
    const usable = getUsableActions(resolved, ctx)
    expect(usable.length).toBe(1)
    expect(usable[0].option.name).toBe('强力打击')
  })

  it('getActionsByType groups by action type', () => {
    const resolved = resolvePersistentEffects({
      featIds: ['polearm_master', 'defensive_duelist'],
    })
    const ctx: FeatureActionContext = { weaponType: 'polearm' }
    const grouped = getActionsByType(resolved, ctx)
    // polearm_master: bonus_action, defensive_duelist: reaction
    expect(grouped['bonus_action']).toBeDefined()
    expect(grouped['reaction']).toBeDefined()
  })
})
