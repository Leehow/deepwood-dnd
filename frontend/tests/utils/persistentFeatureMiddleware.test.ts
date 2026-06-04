import { beforeAll, describe, it, expect } from 'vitest'
import {
  resolvePersistentEffects,
  hasRuleOverride,
  getUnconditionalModifierSum,
  getConditionalModifierSum,
  getTriggersByType,
} from '~/utils/persistentFeatureMiddleware'
import type { ResolvedPersistentEffects } from '~/types/featureEffect'

describe('resolvePersistentEffects', () => {
  it('returns empty result for no feats', () => {
    const r = resolvePersistentEffects({ featIds: [] })
    expect(r.modifiers).toHaveLength(0)
    expect(r.combatOptions).toHaveLength(0)
    expect(r.combatTriggers).toHaveLength(0)
    expect(r.resources).toHaveLength(0)
    expect(r.ruleOverrides).toHaveLength(0)
    expect(r.advantages).toHaveLength(0)
    expect(r.hasCombatOptions).toBe(false)
    expect(r.hasCombatTriggers).toBe(false)
    expect(r.hasResources).toBe(false)
  })

  it('extracts alert feat passive bonuses', () => {
    const r = resolvePersistentEffects({ featIds: ['alert'] })
    const initMod = r.modifiers.find(m => m.target === 'initiative')
    expect(initMod).toBeDefined()
    expect(initMod!.value).toBe(5)
    expect(initMod!.source.type).toBe('feat')
    expect(initMod!.source.id).toBe('alert')
  })

  it('extracts alert rule overrides', () => {
    const r = resolvePersistentEffects({ featIds: ['alert'] })
    expect(hasRuleOverride(r, 'cannot_be_surprised')).toBe(true)
    expect(hasRuleOverride(r, 'invisible_no_advantage_against_you')).toBe(true)
  })

  it('extracts mobile feat speed + rule overrides', () => {
    const r = resolvePersistentEffects({ featIds: ['mobile'] })
    const speed = r.modifiers.find(m => m.target === 'speed')
    expect(speed).toBeDefined()
    expect(speed!.value).toBe(10)
    expect(hasRuleOverride(r, 'dash_ignores_difficult_terrain')).toBe(true)
    expect(hasRuleOverride(r, 'no_opportunity_attack_after_melee')).toBe(true)
  })

  it('extracts tough feat hp_per_level', () => {
    const r = resolvePersistentEffects({ featIds: ['tough'] })
    const hp = r.modifiers.find(m => m.target === 'hp_per_level')
    expect(hp).toBeDefined()
    expect(hp!.value).toBe(2)
  })

  it('extracts war_caster advantages and overrides', () => {
    const r = resolvePersistentEffects({ featIds: ['war_caster'] })
    expect(r.advantages.some(a => a.context === 'concentration_save')).toBe(true)
    expect(hasRuleOverride(r, 'somatic_with_hands_full')).toBe(true)
    expect(hasRuleOverride(r, 'cantrip_as_opportunity_attack')).toBe(true)
  })

  it('extracts great_weapon_master combat options and triggers', () => {
    const r = resolvePersistentEffects({ featIds: ['great_weapon_master'] })
    expect(r.hasCombatOptions).toBe(true)
    expect(r.hasCombatTriggers).toBe(true)

    const powerAttack = r.combatOptions.find(o => o.name === '强力打击')
    expect(powerAttack).toBeDefined()
    expect(powerAttack!.attackPenalty).toBe(-5)
    expect(powerAttack!.damageBonus).toBe(10)
    expect(powerAttack!.condition).toBe('heavy_melee_weapon')

    const critTrigger = r.combatTriggers.find(t => t.trigger === 'crit_or_reduce_to_0')
    expect(critTrigger).toBeDefined()
    expect(critTrigger!.effect).toBe('bonus_action_melee_attack')
  })

  it('extracts sharpshooter combat options', () => {
    const r = resolvePersistentEffects({ featIds: ['sharpshooter'] })
    const preciseShot = r.combatOptions.find(o => o.nameEn === 'Precise Shot')
    expect(preciseShot).toBeDefined()
    expect(preciseShot!.attackPenalty).toBe(-5)
    expect(preciseShot!.damageBonus).toBe(10)
    expect(preciseShot!.condition).toBe('ranged_weapon')
  })

  it('extracts sentinel combat triggers', () => {
    const r = resolvePersistentEffects({ featIds: ['sentinel'] })
    expect(r.combatTriggers).toHaveLength(3)
    const triggers = r.combatTriggers.map(t => t.trigger)
    expect(triggers).toContain('opportunity_attack_hit')
    expect(triggers).toContain('enemy_disengage_within_reach')
    expect(triggers).toContain('ally_attacked_within_5ft')
  })

  it('extracts lucky resources', () => {
    const r = resolvePersistentEffects({ featIds: ['lucky'] })
    expect(r.hasResources).toBe(true)
    expect(r.resources).toHaveLength(1)
    expect(r.resources[0].name).toBe('幸运点数')
    expect(r.resources[0].max).toBe(3)
    expect(r.resources[0].recharge).toBe('long_rest')
  })

  it('extracts dual_wielder conditional AC bonus', () => {
    const r = resolvePersistentEffects({ featIds: ['dual_wielder'] })
    const ac = r.modifiers.find(m => m.target === 'ac')
    expect(ac).toBeDefined()
    expect(ac!.value).toBe(1)
    expect(ac!.condition).toBe('dual_wielding')
  })

  it('extracts heavy_armor_master damage reduction', () => {
    const r = resolvePersistentEffects({ featIds: ['heavy_armor_master'] })
    expect(r.damageReduction).toBeDefined()
    expect(r.damageReduction!.amount).toBe(3)
    expect(r.damageReduction!.types).toContain('bludgeoning')
    expect(r.damageReduction!.condition).toBe('heavy_armor_nonmagical')
  })

  it('extracts heavily_armored proficiency grants', () => {
    const r = resolvePersistentEffects({ featIds: ['heavily_armored'] })
    expect(r.proficiencyGrants.armor).toContain('heavy')
  })

  it('aggregates multiple feats correctly', () => {
    const r = resolvePersistentEffects({ featIds: ['alert', 'mobile', 'tough'] })
    expect(getUnconditionalModifierSum(r, 'initiative')).toBe(5)
    expect(getUnconditionalModifierSum(r, 'speed')).toBe(10)
    expect(getUnconditionalModifierSum(r, 'hp_per_level')).toBe(2)
    expect(r.ruleOverrides.length).toBeGreaterThanOrEqual(4)
  })

  it('handles unknown feat ids gracefully', () => {
    const r = resolvePersistentEffects({ featIds: ['nonexistent_feat'] })
    expect(r.modifiers).toHaveLength(0)
  })

  it('empty result has new fields initialized', () => {
    const r = resolvePersistentEffects({ featIds: [] })
    expect(r.acFormulas).toHaveLength(0)
    expect(r.immunities).toHaveLength(0)
    expect(r.resistances).toHaveLength(0)
    expect(r.classAbilities).toHaveLength(0)
  })
})

// ── 职业被动特性 ─────────────────────────────────────

describe('class passive features', () => {
  it('extracts barbarian unarmored defense AC formula', () => {
    const r = resolvePersistentEffects({ featIds: [], classId: 'barbarian', level: 1 })
    const formula = r.acFormulas.find(f => f.formula === '10 + dex + con')
    expect(formula).toBeDefined()
    expect(formula!.condition).toBe('unarmored')
    expect(formula!.source.type).toBe('class_feature')
  })

  it('extracts monk unarmored defense with no-shield condition', () => {
    const r = resolvePersistentEffects({ featIds: [], classId: 'monk', level: 1 })
    const formula = r.acFormulas.find(f => f.formula === '10 + dex + wis')
    expect(formula).toBeDefined()
    expect(formula!.condition).toBe('unarmored_no_shield')
  })

  it('extracts barbarian speed bonus at level 5', () => {
    const r = resolvePersistentEffects({ featIds: [], classId: 'barbarian', level: 5 })
    const speed = r.modifiers.find(m => m.target === 'speed' && m.source.id === 'fast_movement_barbarian')
    expect(speed).toBeDefined()
    expect(speed!.value).toBe(10)
  })

  it('extracts monk speed bonus with level scaling', () => {
    const r2 = resolvePersistentEffects({ featIds: [], classId: 'monk', level: 2 })
    const s2 = r2.modifiers.find(m => m.target === 'speed' && m.source.id === 'unarmored_movement_monk')
    expect(s2).toBeDefined()
    expect(s2!.value).toBe(10)

    const r10 = resolvePersistentEffects({ featIds: [], classId: 'monk', level: 10 })
    const s10 = r10.modifiers.find(m => m.target === 'speed' && m.source.id === 'unarmored_movement_monk')
    expect(s10!.value).toBe(20)
  })

  it('extracts fighter extra attack scaling', () => {
    const r5 = resolvePersistentEffects({ featIds: [], classId: 'fighter', level: 5 })
    const ea5 = r5.modifiers.find(m => m.target === 'extra_attack')
    expect(ea5).toBeDefined()
    expect(ea5!.value).toBe(2)

    const r11 = resolvePersistentEffects({ featIds: [], classId: 'fighter', level: 11 })
    const ea11 = r11.modifiers.find(m => m.target === 'extra_attack')
    expect(ea11!.value).toBe(3)
  })

  it('extracts rogue sneak attack as class ability', () => {
    const r = resolvePersistentEffects({ featIds: [], classId: 'rogue', level: 5 })
    const sa = r.classAbilities.find(a => a.type === 'sneak_attack')
    expect(sa).toBeDefined()
    expect(sa!.damage).toBe('3d6')
    expect(sa!.usesPerTurn).toBe(1)
  })

  it('rogue sneak attack scales with level', () => {
    const r19 = resolvePersistentEffects({ featIds: [], classId: 'rogue', level: 19 })
    const sa = r19.classAbilities.find(a => a.type === 'sneak_attack')
    expect(sa!.damage).toBe('10d6')
  })

  it('extracts rogue evasion as rule override', () => {
    const r = resolvePersistentEffects({ featIds: [], classId: 'rogue', level: 7 })
    expect(hasRuleOverride(r, 'evasion')).toBe(true)
  })

  it('does not extract evasion before required level', () => {
    const r = resolvePersistentEffects({ featIds: [], classId: 'rogue', level: 6 })
    expect(hasRuleOverride(r, 'evasion')).toBe(false)
  })

  it('extracts rogue reliable talent', () => {
    const r = resolvePersistentEffects({ featIds: [], classId: 'rogue', level: 11 })
    expect(r.ruleOverrides.some(o => o.key.startsWith('minimum_roll_'))).toBe(true)
  })

  it('extracts rogue elusive as rule override', () => {
    const r = resolvePersistentEffects({ featIds: [], classId: 'rogue', level: 18 })
    expect(hasRuleOverride(r, 'deny_attack_advantage')).toBe(true)
  })

  it('extracts barbarian brutal critical scaling', () => {
    const r9 = resolvePersistentEffects({ featIds: [], classId: 'barbarian', level: 9 })
    const bc = r9.modifiers.find(m => m.target === 'brutal_critical_dice')
    expect(bc).toBeDefined()
    expect(bc!.value).toBe(1)

    const r17 = resolvePersistentEffects({ featIds: [], classId: 'barbarian', level: 17 })
    const bc17 = r17.modifiers.find(m => m.target === 'brutal_critical_dice')
    expect(bc17!.value).toBe(3)
  })

  it('extracts champion crit range', () => {
    const r = resolvePersistentEffects({ featIds: [], classId: 'fighter', level: 3, subclassId: 'champion' })
    const cr = r.modifiers.find(m => m.target === 'crit_range')
    expect(cr).toBeDefined()
    expect(cr!.value).toBe(19)
  })

  it('extracts paladin saving throw bonus (aura)', () => {
    const r = resolvePersistentEffects({ featIds: [], classId: 'paladin', level: 6 })
    const save = r.modifiers.find(m => m.target === 'all_saves')
    expect(save).toBeDefined()
    expect(save!.value).toBe('charisma')
  })

  it('extracts paladin divine health immunity', () => {
    const r = resolvePersistentEffects({ featIds: [], classId: 'paladin', level: 3 })
    expect(r.immunities.some(i => i.immuneTo === 'diseased')).toBe(true)
  })

  it('extracts monk diamond soul', () => {
    const r = resolvePersistentEffects({ featIds: [], classId: 'monk', level: 14 })
    expect(r.proficiencyGrants.savingThrows).toContain('all')
    expect(hasRuleOverride(r, 'all_save_proficiency')).toBe(true)
  })

  it('extracts cleric divine strike', () => {
    const r = resolvePersistentEffects({ featIds: [], classId: 'cleric', level: 8, subclassId: 'life' })
    const ds = r.classAbilities.find(a => a.type === 'divine_strike')
    expect(ds).toBeDefined()
    expect(ds!.damage).toBe('1d8')
    expect(ds!.damageType).toContain('radiant')
  })

  it('cleric divine strike scales at level 14', () => {
    const r = resolvePersistentEffects({ featIds: [], classId: 'cleric', level: 14, subclassId: 'life' })
    const ds = r.classAbilities.find(a => a.type === 'divine_strike')
    expect(ds!.damage).toBe('2d8')
  })

  it('extracts cleric healing bonus (disciple of life)', () => {
    const r = resolvePersistentEffects({ featIds: [], classId: 'cleric', level: 1, subclassId: 'life' })
    const hb = r.modifiers.find(m => m.target === 'healing_bonus')
    expect(hb).toBeDefined()
    expect(hb!.value).toBe(2)
  })

  it('extracts cleric cantrip damage bonus', () => {
    const r = resolvePersistentEffects({ featIds: [], classId: 'cleric', level: 8, subclassId: 'knowledge' })
    const cdb = r.modifiers.find(m => m.target === 'cantrip_damage_bonus')
    expect(cdb).toBeDefined()
  })

  it('extracts destroy undead CR scaling', () => {
    const r8 = resolvePersistentEffects({ featIds: [], classId: 'cleric', level: 8 })
    const du = r8.modifiers.find(m => m.target === 'destroy_undead_cr')
    expect(du).toBeDefined()
    expect(du!.value).toBe(1)
  })

  it('extracts advantage grants (danger sense)', () => {
    const r = resolvePersistentEffects({ featIds: [], classId: 'barbarian', level: 2 })
    expect(r.advantages.length).toBeGreaterThan(0)
    expect(r.advantages.some(a => a.context.includes('dexterity'))).toBe(true)
  })

  it('extracts stormborn flying speed', () => {
    const r = resolvePersistentEffects({ featIds: [], classId: 'cleric', level: 17, subclassId: 'tempest' })
    const fly = r.modifiers.find(m => m.target === 'flying_speed')
    expect(fly).toBeDefined()
  })
})

// ── 种族被动特性 ─────────────────────────────────────

describe('race passive features', () => {
  it('extracts elf fey ancestry (sleep immunity + charm advantage)', () => {
    const r = resolvePersistentEffects({ featIds: [], raceId: 'elf' })
    expect(r.immunities.some(i => i.immuneTo === 'sleep')).toBe(true)
    expect(r.immunities[0].source.type).toBe('race_feature')
    expect(r.advantages.some(a => a.context === 'save_vs_charmed')).toBe(true)
  })

  it('extracts dwarf resilience (poison resistance + advantage)', () => {
    const r = resolvePersistentEffects({ featIds: [], raceId: 'dwarf' })
    expect(r.resistances.some(res => res.damageType === 'poison')).toBe(true)
    expect(r.advantages.some(a => a.context === 'save_vs_poisoned')).toBe(true)
  })

  it('extracts tiefling hellish resistance', () => {
    const r = resolvePersistentEffects({ featIds: [], raceId: 'tiefling' })
    expect(r.resistances.some(res => res.damageType === 'fire')).toBe(true)
  })

  it('combines feats + class + race correctly', () => {
    const r = resolvePersistentEffects({
      featIds: ['alert', 'tough'],
      classId: 'rogue', level: 7,
      raceId: 'elf',
    })
    // feat: alert initiative
    expect(getUnconditionalModifierSum(r, 'initiative')).toBe(5)
    // feat: tough HP
    expect(getUnconditionalModifierSum(r, 'hp_per_level')).toBe(2)
    // class: evasion
    expect(hasRuleOverride(r, 'evasion')).toBe(true)
    // class: sneak attack
    expect(r.classAbilities.some(a => a.type === 'sneak_attack')).toBe(true)
    // race: fey ancestry
    expect(r.immunities.some(i => i.immuneTo === 'sleep')).toBe(true)
  })
})

describe('convenience queries', () => {
  let resolved: ResolvedPersistentEffects

  beforeAll(() => {
    resolved = resolvePersistentEffects({
      featIds: ['alert', 'dual_wielder', 'sentinel'],
    })
  })

  it('getUnconditionalModifierSum ignores conditional mods', () => {
    // dual_wielder AC has condition, should be excluded
    expect(getUnconditionalModifierSum(resolved, 'ac')).toBe(0)
    // alert initiative has no condition
    expect(getUnconditionalModifierSum(resolved, 'initiative')).toBe(5)
  })

  it('getConditionalModifierSum includes matching conditions', () => {
    const active = new Set(['dual_wielding'])
    expect(getConditionalModifierSum(resolved, 'ac', active)).toBe(1)
  })

  it('getConditionalModifierSum excludes non-matching conditions', () => {
    const active = new Set<string>()
    expect(getConditionalModifierSum(resolved, 'ac', active)).toBe(0)
  })

  it('getTriggersByType finds sentinel triggers', () => {
    const hits = getTriggersByType(resolved, 'opportunity_attack_hit')
    expect(hits).toHaveLength(1)
    expect(hits[0].effect).toBe('target_speed_to_0')
  })

  it('getTriggersByType returns empty for non-matching trigger', () => {
    expect(getTriggersByType(resolved, 'nonexistent')).toHaveLength(0)
  })
})
