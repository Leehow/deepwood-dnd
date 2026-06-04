/**
 * Unit tests for the rule-data localized field helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  getLocalizedName,
  getLocalizedDescription,
  getLocalizedField,
  type LocalizedEntity,
} from '../localizedData';

describe('getLocalizedName / getLocalizedDescription — legacy shape', () => {
  const legacySpell: LocalizedEntity = {
    name: '火球术',
    nameEn: 'Fireball',
    description: '一道明亮的光束...',
    descriptionEn: 'A bright streak flashes ...',
  };

  it('prefers English-suffixed fields for en-US', () => {
    expect(getLocalizedName(legacySpell, 'en-US')).toBe('Fireball');
    expect(getLocalizedDescription(legacySpell, 'en-US')).toBe(
      'A bright streak flashes ...',
    );
  });

  it('prefers canonical (currently Chinese) fields for zh-CN', () => {
    expect(getLocalizedName(legacySpell, 'zh-CN')).toBe('火球术');
    expect(getLocalizedDescription(legacySpell, 'zh-CN')).toBe(
      '一道明亮的光束...',
    );
  });

  it('also accepts snake_case English variants (backend / module data)', () => {
    const snakeEntity: LocalizedEntity = {
      name: '迷雾古堡',
      name_en: 'Misty Keep',
      description: '一座迷雾笼罩的古堡。',
      description_en: 'A mist-shrouded keep.',
    };
    expect(getLocalizedName(snakeEntity, 'en-US')).toBe('Misty Keep');
    expect(getLocalizedDescription(snakeEntity, 'en-US')).toBe(
      'A mist-shrouded keep.',
    );
  });
});

describe('getLocalizedName / getLocalizedDescription — future locales overlay', () => {
  const canonicalEntity: LocalizedEntity = {
    name: 'Fireball',
    description: 'A bright streak flashes ...',
    locales: {
      'zh-CN': {
        name: '火球术',
        description: '一道明亮的光束...',
      },
      'en-US': {
        name: 'Fireball (canonical)',
        description: 'A bright streak — canonical English.',
      },
    },
  };

  it('reads zh-CN from locales overlay when requested', () => {
    expect(getLocalizedName(canonicalEntity, 'zh-CN')).toBe('火球术');
    expect(getLocalizedDescription(canonicalEntity, 'zh-CN')).toBe(
      '一道明亮的光束...',
    );
  });

  it('prefers locales["en-US"] overlay over canonical English fields', () => {
    expect(getLocalizedName(canonicalEntity, 'en-US')).toBe(
      'Fireball (canonical)',
    );
  });

  it('falls back to canonical English when no en-US overlay exists', () => {
    const mixed: LocalizedEntity = {
      name: 'Fireball',
      description: 'A bright streak ...',
      locales: {
        'zh-CN': { name: '火球术', description: '一道明亮的光束...' },
      },
    };
    expect(getLocalizedName(mixed, 'en-US')).toBe('Fireball');
    expect(getLocalizedDescription(mixed, 'en-US')).toBe(
      'A bright streak ...',
    );
  });
});

describe('English-default behavior', () => {
  it('falls back to canonical when only canonical exists, regardless of locale', () => {
    const englishOnly: LocalizedEntity = {
      name: 'Mystery Item',
      description: 'No translations available.',
    };
    expect(getLocalizedName(englishOnly, 'en-US')).toBe('Mystery Item');
    expect(getLocalizedName(englishOnly, 'zh-CN')).toBe('Mystery Item');
  });

  it('en-US can fall back to Chinese-only canonical content as last resort', () => {
    const zhOnly: LocalizedEntity = {
      name: '仅中文',
      description: '没有英文翻译。',
    };
    // Today's reality: canonical name holds Chinese; helper still returns
    // something rather than empty so UI is not broken.
    expect(getLocalizedName(zhOnly, 'en-US')).toBe('仅中文');
  });

  it('zh-CN falls back to English-suffixed when no Chinese is present', () => {
    const enOnly: LocalizedEntity = { nameEn: 'English Only' };
    expect(getLocalizedName(enOnly, 'zh-CN')).toBe('English Only');
  });
});

describe('zh-suffixed and locale normalization', () => {
  it('honors *Cn suffixed Chinese fields for zh-CN', () => {
    const magicItem: LocalizedEntity = {
      name: 'Bag of Holding',
      nameCn: '储物袋',
      description: 'An English description.',
      descriptionCn: '一个中文描述。',
    };
    expect(getLocalizedName(magicItem, 'zh-CN')).toBe('储物袋');
    expect(getLocalizedDescription(magicItem, 'zh-CN')).toBe('一个中文描述。');
    expect(getLocalizedName(magicItem, 'en-US')).toBe('Bag of Holding');
    expect(getLocalizedDescription(magicItem, 'en-US')).toBe(
      'An English description.',
    );
  });

  it('normalizes unsupported locales to the default (en-US)', () => {
    const entity: LocalizedEntity = {
      name: '火球术',
      nameEn: 'Fireball',
    };
    // 'fr-FR', 'jp', '' all fall back to DEFAULT_LOCALE = 'en-US'.
    expect(getLocalizedName(entity, 'fr-FR')).toBe('Fireball');
    expect(getLocalizedName(entity, 'jp')).toBe('Fireball');
    expect(getLocalizedName(entity, '')).toBe('Fireball');
    expect(getLocalizedName(entity, undefined)).toBe('Fireball');
    expect(getLocalizedName(entity)).toBe('Fireball');
  });

  it('normalizes loose codes (e.g. en, zh, zh-Hans) to supported locales', () => {
    const entity: LocalizedEntity = {
      name: '火球术',
      nameEn: 'Fireball',
    };
    expect(getLocalizedName(entity, 'en')).toBe('Fireball');
    expect(getLocalizedName(entity, 'zh')).toBe('火球术');
    expect(getLocalizedName(entity, 'zh-Hans')).toBe('火球术');
  });
});

describe('defensive behavior', () => {
  it('returns fallback for null / undefined / non-object input', () => {
    expect(getLocalizedName(null as unknown)).toBe('');
    expect(getLocalizedName(undefined as unknown)).toBe('');
    expect(getLocalizedName('not an object' as unknown)).toBe('');
    expect(getLocalizedName(42 as unknown)).toBe('');
    expect(getLocalizedName([] as unknown)).toBe('');
  });

  it('returns the supplied fallback string when value is missing', () => {
    expect(getLocalizedName({}, 'en-US', '(unnamed)')).toBe('(unnamed)');
    expect(getLocalizedDescription({}, 'zh-CN', '无描述')).toBe('无描述');
  });

  it('treats empty-string fields as missing and continues fallback chain', () => {
    const entity: LocalizedEntity = {
      name: '',
      nameEn: 'Fireball',
    };
    expect(getLocalizedName(entity, 'zh-CN')).toBe('Fireball');
  });

  it('does not throw on malformed locales overlay', () => {
    const malformed = {
      name: 'Fireball',
      locales: 'not-an-object',
    };
    expect(() => getLocalizedName(malformed, 'en-US')).not.toThrow();
    expect(getLocalizedName(malformed, 'en-US')).toBe('Fireball');
  });

  it('does not mutate the input entity', () => {
    const entity: LocalizedEntity = {
      name: '火球术',
      nameEn: 'Fireball',
      locales: { 'zh-CN': { name: '火球术' } },
    };
    const snapshot = JSON.parse(JSON.stringify(entity));
    getLocalizedName(entity, 'en-US');
    getLocalizedName(entity, 'zh-CN');
    getLocalizedDescription(entity, 'en-US');
    getLocalizedField(entity, 'name', 'fr-FR');
    expect(entity).toEqual(snapshot);
  });
});

describe('getLocalizedField generic accessor', () => {
  it('resolves arbitrary fields with the same precedence rules', () => {
    const monster = {
      appearance: '一只巨大的红龙。',
      appearanceEn: 'A massive red dragon.',
    };
    expect(getLocalizedField(monster, 'appearance', 'en-US')).toBe(
      'A massive red dragon.',
    );
    expect(getLocalizedField(monster, 'appearance', 'zh-CN')).toBe(
      '一只巨大的红龙。',
    );
  });

  it('reads overlay fields via getLocalizedField for non-name/description', () => {
    const entity = {
      flavor: 'English flavor.',
      locales: {
        'zh-CN': { flavor: '中文风味文本。' },
      },
    };
    expect(getLocalizedField(entity, 'flavor', 'zh-CN')).toBe('中文风味文本。');
    expect(getLocalizedField(entity, 'flavor', 'en-US')).toBe('English flavor.');
  });

  it('returns fallback for empty/invalid field name', () => {
    expect(getLocalizedField({ name: 'x' }, '', 'en-US', 'fb')).toBe('fb');
  });
});
