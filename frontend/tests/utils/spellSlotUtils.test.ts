import { describe, it, expect } from 'vitest'
import {
  normalizeSpellSlotArray,
  getMaxSpellSlots,
  getSpellcasterType,
  getRemainingSlots,
  consumeSpellSlotState,
  getAvailableSlotLevels,
  canCastSpell,
  resolveUpcastPreview,
} from '~/utils/spellSlotUtils'

// ── normalizeSpellSlotArray ──────────────────────────

describe('normalizeSpellSlotArray', () => {
  it('returns 10-length zero array for non-array input', () => {
    expect(normalizeSpellSlotArray(null)).toEqual(new Array(10).fill(0))
    expect(normalizeSpellSlotArray(undefined)).toEqual(new Array(10).fill(0))
    expect(normalizeSpellSlotArray('abc')).toEqual(new Array(10).fill(0))
  })

  it('normalizes valid array', () => {
    const result = normalizeSpellSlotArray([0, 4, 3, 2])
    expect(result.length).toBe(10)
    expect(result[0]).toBe(0)
    expect(result[1]).toBe(4)
    expect(result[2]).toBe(3)
    expect(result[3]).toBe(2)
    expect(result[4]).toBe(0)
  })

  it('clamps negative values to 0', () => {
    expect(normalizeSpellSlotArray([0, -1, 3])[1]).toBe(0)
  })
})

// ── getMaxSpellSlots ─────────────────────────────────

describe('getMaxSpellSlots', () => {
  it('returns correct slots for wizard level 5 (full caster)', () => {
    const slots = getMaxSpellSlots('wizard', 5)
    // L5 full: [4,3,2,0,0,0,0,0,0] → index 0=0 padded
    expect(slots[0]).toBe(0) // cantrips
    expect(slots[1]).toBe(4)
    expect(slots[2]).toBe(3)
    expect(slots[3]).toBe(2)
    expect(slots[4]).toBe(0)
    expect(slots.length).toBe(10)
  })

  it('returns correct slots for paladin level 5 (half caster)', () => {
    const slots = getMaxSpellSlots('paladin', 5)
    expect(slots[1]).toBe(4)
    expect(slots[2]).toBe(2)
    expect(slots[3]).toBe(0)
  })

  it('returns correct slots for eldritch knight (third caster)', () => {
    const slots = getMaxSpellSlots('fighter', 7, 'eldritch_knight')
    expect(slots[1]).toBe(4)
    expect(slots[2]).toBe(2)
  })

  it('returns correct slots for warlock (pact magic)', () => {
    const slots = getMaxSpellSlots('warlock', 5)
    // Warlock L5: 2 slots at level 3
    expect(slots[3]).toBe(2)
    // All other levels should be 0
    expect(slots[1]).toBe(0)
    expect(slots[2]).toBe(0)
  })

  it('returns zeros for non-caster class', () => {
    const slots = getMaxSpellSlots('barbarian', 10)
    expect(slots.every(s => s === 0)).toBe(true)
  })

  it('handles warlock levels not explicitly in pact table (fallback)', () => {
    // Level 4 is between 3 and 5, should use level 3 entry
    const slots = getMaxSpellSlots('warlock', 4)
    expect(slots[2]).toBe(2) // L3 warlock: 2 slots at level 2
  })
})

// ── getSpellcasterType ───────────────────────────────

describe('getSpellcasterType', () => {
  it('returns full for wizard', () => {
    expect(getSpellcasterType('wizard')).toBe('full')
  })
  it('returns half for paladin', () => {
    expect(getSpellcasterType('paladin')).toBe('half')
  })
  it('returns pact for warlock', () => {
    expect(getSpellcasterType('warlock')).toBe('pact')
  })
  it('returns third for eldritch knight', () => {
    expect(getSpellcasterType('fighter', 'eldritch_knight')).toBe('third')
  })
  it('returns null for barbarian', () => {
    expect(getSpellcasterType('barbarian')).toBeNull()
  })
})

// ── getRemainingSlots ────────────────────────────────

describe('getRemainingSlots', () => {
  const max = [0, 4, 3, 2, 0, 0, 0, 0, 0, 0]

  it('from array state', () => {
    const result = getRemainingSlots([0, 2, 1, 0], max)
    expect(result[1]).toBe(2)
    expect(result[2]).toBe(1)
    expect(result[3]).toBe(0)
  })

  it('from null returns max', () => {
    expect(getRemainingSlots(null, max)).toEqual(max)
  })

  it('from object with pact_slots', () => {
    const state = { slots: [0, 0, 0], pact_slots: [0, 0, 0, 2] }
    expect(getRemainingSlots(state, max)[3]).toBe(2)
  })

  it('clamps to max', () => {
    const result = getRemainingSlots([0, 99, 3], max)
    expect(result[1]).toBe(4) // clamped to max
  })
})

// ── consumeSpellSlotState ────────────────────────────

describe('consumeSpellSlotState', () => {
  const max = [0, 4, 3, 2, 0, 0, 0, 0, 0, 0]

  it('decrements simple array', () => {
    const state = [0, 3, 2, 1, 0, 0, 0, 0, 0, 0]
    const next = consumeSpellSlotState(state, 2, max)
    expect(next).not.toBe(state) // new reference
    expect((next as number[])[2]).toBe(1)
  })

  it('returns same ref when no slots available', () => {
    const state = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const next = consumeSpellSlotState(state, 1, max)
    expect(next).toBe(state) // unchanged
  })

  it('returns same ref for invalid level', () => {
    const state = [0, 3, 2]
    expect(consumeSpellSlotState(state, 0, max)).toBe(state)
    expect(consumeSpellSlotState(state, 10, max)).toBe(state)
  })

  it('from null uses fallback max', () => {
    const next = consumeSpellSlotState(null, 1, max) as number[]
    expect(next[1]).toBe(3) // 4 - 1
  })

  it('object state: consumes regular first, then pact', () => {
    const state = { slots: [0, 1, 0], pact_slots: [0, 0, 2] }
    // Consume level 1 → uses regular
    const next1 = consumeSpellSlotState(state, 1, max) as any
    expect(next1.slots[1]).toBe(0)
    // Consume level 2 → uses pact
    const next2 = consumeSpellSlotState(state, 2, max) as any
    expect(next2.pact_slots[2]).toBe(1)
  })
})

// ── getAvailableSlotLevels ───────────────────────────

describe('getAvailableSlotLevels', () => {
  const max = [0, 4, 3, 2, 1, 0, 0, 0, 0, 0]
  const remaining = [0, 2, 0, 1, 1, 0, 0, 0, 0, 0]

  it('returns cantrip as empty (no slot consumption)', () => {
    expect(getAvailableSlotLevels(0, max, remaining)).toEqual([])
  })

  it('returns available levels for level 1 spell', () => {
    const levels = getAvailableSlotLevels(1, max, remaining)
    expect(levels.length).toBe(4) // levels 1,2,3,4 all have max > 0
    expect(levels[0]).toEqual({ level: 1, max: 4, remaining: 2, isUpcast: false, levelsAbove: 0 })
    expect(levels[1]).toEqual({ level: 2, max: 3, remaining: 0, isUpcast: true, levelsAbove: 1 })
    expect(levels[2]).toEqual({ level: 3, max: 2, remaining: 1, isUpcast: true, levelsAbove: 2 })
    expect(levels[3]).toEqual({ level: 4, max: 1, remaining: 1, isUpcast: true, levelsAbove: 3 })
  })

  it('returns only levels >= spell level', () => {
    const levels = getAvailableSlotLevels(3, max, remaining)
    expect(levels.length).toBe(2) // 3, 4
    expect(levels[0].level).toBe(3)
  })
})

// ── canCastSpell ─────────────────────────────────────

describe('canCastSpell', () => {
  const max = [0, 4, 3, 2, 0, 0, 0, 0, 0, 0]

  it('cantrip is always castable', () => {
    expect(canCastSpell(0, [0, 0, 0], max)).toBe(true)
  })

  it('returns true when slots available', () => {
    expect(canCastSpell(1, [0, 1, 0, 0, 0, 0, 0, 0, 0, 0], max)).toBe(true)
  })

  it('returns true for upcast availability', () => {
    // No level 1 slots, but level 2 has slots
    expect(canCastSpell(1, [0, 0, 2, 0, 0, 0, 0, 0, 0, 0], max)).toBe(true)
  })

  it('returns false when all slots exhausted', () => {
    expect(canCastSpell(1, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], max)).toBe(false)
  })
})

// ── resolveUpcastPreview ─────────────────────────────

describe('resolveUpcastPreview', () => {
  it('returns base values at base level', () => {
    const spell = { id: 'fireball', level: 3, damage: '8d6', damageAtSlotLevel: { '3': '8d6', '4': '9d6' } } as any
    const preview = resolveUpcastPreview(spell, 3)
    expect(preview.levelsAbove).toBe(0)
    expect(preview.damage).toBe('8d6')
  })

  it('uses damageAtSlotLevel table for upcast', () => {
    const spell = { id: 'fireball', level: 3, damage: '8d6', damageAtSlotLevel: { '3': '8d6', '5': '10d6' } } as any
    const preview = resolveUpcastPreview(spell, 5)
    expect(preview.levelsAbove).toBe(2)
    expect(preview.damage).toBe('10d6')
    expect(preview.baseDamage).toBe('8d6')
  })

  it('uses healingAtSlotLevel table', () => {
    const spell = { id: 'cure_wounds', level: 1, healing: '1d8', healingAtSlotLevel: { '1': '1d8', '3': '3d8' } } as any
    const preview = resolveUpcastPreview(spell, 3)
    expect(preview.healing).toBe('3d8')
  })

  it('falls back to scaling config from effects', () => {
    const spell = {
      id: 'magic_missile', level: 1, damage: '3d4+3',
      effects: [{ trigger: 'on_cast', effects: [{ type: 'deal_damage', formula: '3d4+3' }], scaling: { perSlotAbove: 1, extraDice: '1d4' } }],
    } as any
    const preview = resolveUpcastPreview(spell, 3)
    expect(preview.damage).toBe('3d4+3+2d4')
    expect(preview.levelsAbove).toBe(2)
  })

  it('includes atHigherLevels description on upcast', () => {
    const spell = { id: 'shield_of_faith', level: 1, atHigherLevels: '无额外效果' } as any
    const preview = resolveUpcastPreview(spell, 2)
    expect(preview.description).toBe('无额外效果')
  })

  it('no description at base level', () => {
    const spell = { id: 'shield_of_faith', level: 1, atHigherLevels: '无额外效果' } as any
    const preview = resolveUpcastPreview(spell, 1)
    expect(preview.description).toBeNull()
  })
})
