import { describe, it, expect } from 'vitest';
import { deriveBuffConditions } from './deriveBuffConditions';

describe('deriveBuffConditions', () => {
  it('returns conditions from apply_condition effects, ordered and deduped', () => {
    const spell = {
      conditions: ['charmed', 'invisible'], // loose tag — must be ignored
      effects: [
        {
          effects: [
            { type: 'apply_condition', condition: 'paralyzed' },
            { type: 'apply_condition', condition: 'blinded' },
            { type: 'apply_condition', condition: 'paralyzed' }, // dup
            { type: 'deal_damage', formula: '2d6' },
          ],
        },
        { effects: [{ type: 'apply_condition', condition: 'blinded' }] },
      ],
    };
    expect(deriveBuffConditions(spell as any)).toEqual(['paralyzed', 'blinded']);
  });

  it('ignores the loose top-level conditions field (remove/prevent spells)', () => {
    // lesser_restoration-shaped: top level lists the CURED conditions; applies none.
    const spell = {
      conditions: ['paralyzed', 'blinded', 'poisoned'],
      effects: [{ effects: [{ type: 'remove_condition', condition: 'paralyzed' }] }],
    };
    expect(deriveBuffConditions(spell as any)).toEqual([]);
  });

  it('returns [] when there are no effects', () => {
    expect(deriveBuffConditions({ conditions: ['poisoned'] } as any)).toEqual([]);
    expect(deriveBuffConditions(undefined)).toEqual([]);
    expect(deriveBuffConditions(null)).toEqual([]);
  });
});
