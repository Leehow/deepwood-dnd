/**
 * Locale-aware unit tests for spell-card status/buff term helpers.
 *
 * Verifies that `translateBuffTerm`, `translateDamageBonus`, `formatBuffEffects`,
 * and `getSpellStatusSummaryLabels` accept an optional locale parameter and
 * produce English output under `en-US` while keeping the legacy zh-CN
 * behavior intact when locale is omitted (the dialog out of scope continues to
 * default to Chinese).
 */

import { describe, expect, it } from 'vitest';

import {
  translateBuffTerm,
  translateDamageBonus,
  formatBuffEffects,
  getSpellStatusSummaryLabels,
} from '~/components/spell/spell-constants';

describe('translateBuffTerm — locale-aware dictionary', () => {
  it('zh-CN default preserves Chinese term', () => {
    expect(translateBuffTerm('poisoned')).toBe('中毒');
    expect(translateBuffTerm('fire')).toBe('火焰');
  });

  it('en-US returns canonical English term', () => {
    expect(translateBuffTerm('poisoned', 'en-US')).toBe('Poisoned');
    expect(translateBuffTerm('fire', 'en-US')).toBe('Fire');
  });

  it('en-US handles parenthetical note', () => {
    expect(translateBuffTerm('attack_rolls (weapon attacks)', 'en-US'))
      .toBe('Attack Rolls (weapon attacks)');
  });

  it('zh-CN handles parenthetical note with Chinese punctuation', () => {
    expect(translateBuffTerm('attack_rolls (weapon attacks)'))
      .toBe('攻击检定（武器攻击）');
  });

  it('falls back to raw term when unknown', () => {
    expect(translateBuffTerm('made_up_term', 'en-US')).toBe('made_up_term');
    expect(translateBuffTerm('made_up_term')).toBe('made_up_term');
  });
});

describe('translateDamageBonus — locale-aware', () => {
  it('zh-CN default translates "2d6 thunder" → "2d6 雷鸣"', () => {
    expect(translateDamageBonus('2d6 thunder')).toBe('2d6 雷鸣');
  });

  it('en-US returns canonical English: "2d6 Thunder"', () => {
    expect(translateDamageBonus('2d6 thunder', 'en-US')).toBe('2d6 Thunder');
  });

  it('en-US handles parenthetical with paren punctuation', () => {
    expect(translateDamageBonus('1d4 (fire/cold)', 'en-US')).toBe('1d4 (Fire/Cold)');
  });

  it('zh-CN handles parenthetical with fullwidth punctuation', () => {
    expect(translateDamageBonus('1d4 (fire/cold)')).toBe('1d4（火焰/冰霜）');
  });
});

describe('formatBuffEffects — locale-aware', () => {
  it('zh-CN default keeps existing Chinese output', () => {
    const labels = formatBuffEffects({
      acBonus: 2,
      attackBonus: 1,
      speedBonus: 10,
      resistances: ['fire', 'cold'],
    });
    expect(labels).toEqual([
      'AC +2',
      '攻击 +1',
      '速度 +10尺',
      '抗性：火焰、冰霜',
    ]);
  });

  it('en-US produces English label set', () => {
    const labels = formatBuffEffects(
      { acBonus: 2, attackBonus: 1, speedBonus: 10, resistances: ['fire', 'cold'] },
      undefined,
      undefined,
      'en-US',
    );
    expect(labels).toEqual([
      'AC +2',
      'Attack +1',
      'Speed +10 ft',
      'Resistance: Fire, Cold',
    ]);
  });

  it('en-US conditions section uses English status keyword', () => {
    const labels = formatBuffEffects(undefined, undefined, ['poisoned'], 'en-US');
    expect(labels).toEqual(['Status: Poisoned']);
  });
});

describe('getSpellStatusSummaryLabels — locale-aware', () => {
  it('zh-CN default returns Chinese summaries (deferred backstop behavior)', () => {
    const labels = getSpellStatusSummaryLabels('bless');
    expect(labels.length).toBeGreaterThan(0);
    // Should mention the Chinese trigger/effect tokens for known data.
    expect(labels.join('|')).toMatch(/[一-鿿]/);
  });

  it('en-US returns English summaries with no residual Chinese chrome', () => {
    const labels = getSpellStatusSummaryLabels('bless', undefined, 'target', 'en-US');
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label).not.toMatch(/[一-鿿]/);
    }
  });
});
