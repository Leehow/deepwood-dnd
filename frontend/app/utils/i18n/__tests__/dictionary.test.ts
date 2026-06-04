/**
 * Unit tests for the unified translation dictionary
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  ensureDictionaryInitialized,
  tDamageType,
  tWeaponProperty,
  tSchool,
  tCondition,
  tAbility,
  tSkill,
  tCurrency,
  tProficiency,
} from '../dictionary';

describe('Translation Dictionary', () => {
  beforeAll(async () => {
    // Initialize dictionary before running tests
    await ensureDictionaryInitialized();
  });

  describe('Damage Types', () => {
    it('should translate physical damage types', () => {
      expect(tDamageType('piercing')).toBe('穿刺');
      expect(tDamageType('slashing')).toBe('挥砍');
      expect(tDamageType('bludgeoning')).toBe('钝击');
    });

    it('should translate elemental damage types', () => {
      expect(tDamageType('fire')).toBe('火焰');
      expect(tDamageType('cold')).toBe('冷冻');
      expect(tDamageType('lightning')).toBe('闪电');
      expect(tDamageType('thunder')).toBe('雷鸣');
      expect(tDamageType('acid')).toBe('强酸');
    });

    it('should return original value for unknown damage type', () => {
      expect(tDamageType('unknown')).toBe('unknown');
    });
  });

  describe('Weapon Properties', () => {
    it('should translate weapon properties', () => {
      expect(tWeaponProperty('finesse')).toBe('灵巧');
      expect(tWeaponProperty('heavy')).toBe('重型');
      expect(tWeaponProperty('light')).toBe('轻型');
      expect(tWeaponProperty('reach')).toBe('触及');
      expect(tWeaponProperty('thrown')).toBe('投掷');
    });

    it('should return original value for unknown property', () => {
      expect(tWeaponProperty('unknown')).toBe('unknown');
    });
  });

  describe('Spell Schools', () => {
    it('should translate spell schools', () => {
      expect(tSchool('abjuration')).toBe('防护');
      expect(tSchool('conjuration')).toBe('咒法');
      expect(tSchool('divination')).toBe('预言');
      expect(tSchool('evocation')).toBe('塑能');
      expect(tSchool('illusion')).toBe('幻术');
      expect(tSchool('necromancy')).toBe('死灵');
      expect(tSchool('transmutation')).toBe('变化');
    });

    it('should translate enchantment school as 惑控 (not 附魔)', () => {
      expect(tSchool('enchantment')).toBe('惑控');
    });

    it('should return original value for unknown school', () => {
      expect(tSchool('unknown')).toBe('unknown');
    });
  });

  describe('Conditions', () => {
    it('should translate conditions', () => {
      expect(tCondition('blinded')).toBe('目盲');
      expect(tCondition('charmed')).toBe('魅惑');
      expect(tCondition('frightened')).toBe('恐慌');
    });

    it('should return original value for unknown condition', () => {
      expect(tCondition('unknown')).toBe('unknown');
    });
  });

  describe('Abilities', () => {
    it('should translate abilities', () => {
      expect(tAbility('strength')).toBe('力量');
      expect(tAbility('dexterity')).toBe('敏捷');
      expect(tAbility('constitution')).toBe('体质');
      expect(tAbility('intelligence')).toBe('智力');
      expect(tAbility('wisdom')).toBe('感知');
      expect(tAbility('charisma')).toBe('魅力');
    });
  });

  describe('Skills', () => {
    it('should translate skills', () => {
      expect(tSkill('acrobatics')).toBe('杂技');
      expect(tSkill('stealth')).toBe('隐匿');
      expect(tSkill('perception')).toBe('察觉');
    });
  });

  describe('Currency', () => {
    it('should translate currency codes', () => {
      expect(tCurrency('cp')).toBe('铜币');
      expect(tCurrency('sp')).toBe('银币');
      expect(tCurrency('gp')).toBe('金币');
      expect(tCurrency('pp')).toBe('铂币');
    });
  });

  describe('Proficiencies', () => {
    it('should translate armor proficiencies', () => {
      expect(tProficiency('light_armor')).toBe('轻甲');
      expect(tProficiency('medium_armor')).toBe('中甲');
      expect(tProficiency('heavy_armor')).toBe('重甲');
      expect(tProficiency('shields')).toBe('盾牌');
    });

    it('should translate weapon proficiencies', () => {
      expect(tProficiency('simple_weapons')).toBe('简易武器');
      expect(tProficiency('martial_weapons')).toBe('军用武器');
    });
  });
});

