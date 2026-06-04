/**
 * Unified Translation Layer (Plan A)
 *
 * Provides centralized term translation for D&D 5E game enums.
 * Loads rule JSONs once and exposes translation functions.
 * 100% reuses existing Chinese translations from rule files.
 */

import { createLogger } from '~/utils/logger';

const logger = createLogger('dictionary');

// Base path for static assets (still needed for core-rules, conditions, spell_schools)
const BASE_PATH = typeof import.meta.env?.BASE_URL === 'string' ? import.meta.env.BASE_URL.replace(/\/$/, '') : '';

// Type definitions for rule data structures
interface DamageTypeEntry {
  type: string;
  name: string;
  nameEn: string;
}

interface WeaponPropertyEntry {
  name: string;
  nameEn: string;
  description?: string;
}

interface SchoolEntry {
  id: string;
  name: string;
  nameEn: string;
  description: string;
}

interface ConditionEntry {
  id: string;
  name: string;
  nameEn: string;
}

interface AbilityEntry {
  id: string;
  name: string;
  nameEn: string;
}

interface SkillEntry {
  id: string;
  name: string;
  nameEn: string;
  ability: string;
}

// Dictionary storage
class TranslationDictionary {
  private damageTypes: Map<string, string> = new Map();
  private weaponProperties: Map<string, string> = new Map();
  private weaponPropertyDescs: Map<string, string> = new Map();
  private schools: Map<string, string> = new Map();
  private conditions: Map<string, string> = new Map();
  private abilities: Map<string, string> = new Map();
  private skills: Map<string, string> = new Map();
  private currencies: Map<string, string> = new Map();
  private proficiencies: Map<string, string> = new Map();
  private initialized = false;

  async initialize() {
    if (this.initialized) return;

    try {
      // Load all required rule JSONs in parallel
      const [coreRules, equipment, spellSchools, conditions, abilities, skills] = await Promise.all([
        import('~/data/rules/core-rules.json').then(m => m.default),
        import('~/data/rules/equipment.json').then(m => m.default),
        fetch(`${BASE_PATH}/rules-meta/spell_schools.json`).then(r => r.json()),
        import('~/data/rules/conditions.json').then(m => m.default),
        import('~/data/rules/abilities.json').then(m => m.default),
        import('~/data/rules/skills.json').then(m => m.default),
      ]);

      // Build damage types dictionary (flatten physical + elemental)
      const damageTypesData = (coreRules as any).coreRules?.damageTypes || (coreRules as any).damageTypes;
      if (damageTypesData) {
        const allDamageTypes = [
          ...(damageTypesData.physical || []),
          ...(damageTypesData.elemental || []),
          ...(damageTypesData.magical || []),
        ];
        allDamageTypes.forEach((entry: DamageTypeEntry) => {
          this.damageTypes.set(entry.type, entry.name);
        });
      }

      // Build weapon properties dictionary
      const weaponPropsData = (equipment as any).weapons?.weaponProperties || (equipment as any).weaponProperties;
      if (weaponPropsData) {
        Object.entries(weaponPropsData).forEach(([id, entry]: [string, any]) => {
          this.weaponProperties.set(id, entry.name);
          if (entry.description) this.weaponPropertyDescs.set(id, entry.description);
        });
      }

      // Build spell schools dictionary
      if (spellSchools.schools) {
        spellSchools.schools.forEach((entry: SchoolEntry) => {
          this.schools.set(entry.id, entry.name);
        });
      }

      // Build conditions dictionary
      const conditionsArray = conditions.conditions || conditions;
      if (Array.isArray(conditionsArray)) {
        conditionsArray.forEach((entry: ConditionEntry) => {
          this.conditions.set(entry.id, entry.name);
        });
      }

      // Build abilities dictionary
      const abilitiesArray = abilities.abilities || abilities;
      if (Array.isArray(abilitiesArray)) {
        abilitiesArray.forEach((entry: AbilityEntry) => {
          this.abilities.set(entry.id, entry.name);
        });
      }

      // Build skills dictionary
      const skillsArray = skills.skills || skills;
      if (Array.isArray(skillsArray)) {
        skillsArray.forEach((entry: SkillEntry) => {
          this.skills.set(entry.id, entry.name);
        });
      }

      // Build currency dictionary (hardcoded as not in JSON)
      this.currencies.set('cp', '铜币');
      this.currencies.set('sp', '银币');
      this.currencies.set('ep', '电币');
      this.currencies.set('gp', '金币');
      this.currencies.set('pp', '铂币');

      // Build proficiency complement table (for IDs not in rule JSONs)
      // Armor
      this.proficiencies.set('light_armor', '轻甲');
      this.proficiencies.set('light', '轻甲');
      this.proficiencies.set('medium_armor', '中甲');
      this.proficiencies.set('medium', '中甲');
      this.proficiencies.set('heavy_armor', '重甲');
      this.proficiencies.set('heavy', '重甲');
      this.proficiencies.set('shields', '盾牌');
      this.proficiencies.set('shield', '盾牌');
      this.proficiencies.set('all_armor', '所有护甲');

      // Weapons - General
      this.proficiencies.set('simple_weapons', '简易武器');
      this.proficiencies.set('martial_weapons', '军用武器');
      this.proficiencies.set('all_weapons', '所有武器');
      this.proficiencies.set('simple_melee_weapons', '简易近战武器');
      this.proficiencies.set('simple_ranged_weapons', '简易远程武器');
      this.proficiencies.set('martial_melee_weapons', '军用近战武器');
      this.proficiencies.set('martial_ranged_weapons', '军用远程武器');

      // Weapons - Specific
      this.proficiencies.set('battleaxe', '战斧');
      this.proficiencies.set('handaxe', '手斧');
      this.proficiencies.set('light_hammer', '轻锤');
      this.proficiencies.set('warhammer', '战锤');
      this.proficiencies.set('longsword', '长剑');
      this.proficiencies.set('longswords', '长剑');
      this.proficiencies.set('shortsword', '短剑');
      this.proficiencies.set('shortswords', '短剑');
      this.proficiencies.set('rapier', '刺剑');
      this.proficiencies.set('rapiers', '刺剑');
      this.proficiencies.set('hand_crossbow', '手弩');
      this.proficiencies.set('hand_crossbows', '手弩');
      this.proficiencies.set('daggers', '匕首');
      this.proficiencies.set('darts', '飞镖');
      this.proficiencies.set('slings', '投石索');
      this.proficiencies.set('quarterstaffs', '长棍');
      this.proficiencies.set('light_crossbows', '轻弩');
      this.proficiencies.set('shortbow', '短弓');
      this.proficiencies.set('longbow', '长弓');

      // Tools
      this.proficiencies.set('thieves_tools', '盗贼工具');
      this.proficiencies.set('artisan_tools', '工匠工具');
      this.proficiencies.set('artisans_tools', '工匠工具');
      this.proficiencies.set('smiths_tools', '铁匠工具');
      this.proficiencies.set('brewers_supplies', '酿酒工具');
      this.proficiencies.set('masons_tools', '石匠工具');
      this.proficiencies.set('tinkers_tools', '修补匠工具');
      this.proficiencies.set('musical_instrument', '乐器');
      this.proficiencies.set('gaming_set', '游戏套装');
      this.proficiencies.set('disguise_kit', '易容工具');
      this.proficiencies.set('forgery_kit', '伪造工具');
      this.proficiencies.set('herbalism_kit', '草药工具');
      this.proficiencies.set('navigator_tools', '导航工具');
      this.proficiencies.set('navigators_tools', '导航工具');
      this.proficiencies.set('poisoner_kit', '毒药工具');
      this.proficiencies.set('poisoner_tools', '制毒工具');
      this.proficiencies.set('vehicles_land', '陆上载具');
      this.proficiencies.set('vehicles_water', '水上载具');
      this.proficiencies.set('alchemists_supplies', '炼金术士工具');
      this.proficiencies.set('calligraphers_supplies', '书法工具');
      this.proficiencies.set('carpenters_tools', '木匠工具');
      this.proficiencies.set('cartographers_tools', '制图工具');
      this.proficiencies.set('cobblers_tools', '鞋匠工具');
      this.proficiencies.set('cooks_utensils', '厨师用具');
      this.proficiencies.set('glassblowers_tools', '玻璃匠工具');
      this.proficiencies.set('jewelers_tools', '珠宝匠工具');
      this.proficiencies.set('leatherworkers_tools', '皮匠工具');
      this.proficiencies.set('painters_supplies', '画家工具');
      this.proficiencies.set('potters_tools', '陶匠工具');
      this.proficiencies.set('weavers_tools', '织工工具');
      this.proficiencies.set('woodcarvers_tools', '木雕工具');

      // Languages
      this.proficiencies.set('common', '通用语');
      this.proficiencies.set('dwarvish', '矮人语');
      this.proficiencies.set('elvish', '精灵语');
      this.proficiencies.set('giant', '巨人语');
      this.proficiencies.set('gnomish', '侏儒语');
      this.proficiencies.set('goblin', '地精语');
      this.proficiencies.set('halfling', '半身人语');
      this.proficiencies.set('orc', '兽人语');
      this.proficiencies.set('abyssal', '深渊语');
      this.proficiencies.set('celestial', '天界语');
      this.proficiencies.set('draconic', '龙语');
      this.proficiencies.set('deep_speech', '深层语');
      this.proficiencies.set('infernal', '炼狱语');
      this.proficiencies.set('primordial', '原初语');
      this.proficiencies.set('sylvan', '林地语');
      this.proficiencies.set('undercommon', '地底通用语');

      // Weapons - Additional (from D&D 5E API)
      this.proficiencies.set('battleaxes', '战斧');
      this.proficiencies.set('blowguns', '吹箭筒');
      this.proficiencies.set('clubs', '棍棒');
      this.proficiencies.set('crossbows_heavy', '重弩');
      this.proficiencies.set('crossbows_light', '轻弩');
      this.proficiencies.set('flails', '连枷');
      this.proficiencies.set('glaives', '长刀');
      this.proficiencies.set('greataxes', '巨斧');
      this.proficiencies.set('greatclubs', '巨棍');
      this.proficiencies.set('greatswords', '巨剑');
      this.proficiencies.set('halberds', '戟');
      this.proficiencies.set('handaxes', '手斧');
      this.proficiencies.set('javelins', '标枪');
      this.proficiencies.set('lances', '骑枪');
      this.proficiencies.set('light_hammers', '轻锤');
      this.proficiencies.set('longbows', '长弓');
      this.proficiencies.set('maces', '硬头锤');
      this.proficiencies.set('mauls', '重槌');
      this.proficiencies.set('morningstars', '流星锤');
      this.proficiencies.set('nets', '网');
      this.proficiencies.set('pikes', '长矛');
      this.proficiencies.set('scimitars', '弯刀');
      this.proficiencies.set('shortbows', '短弓');
      this.proficiencies.set('sickles', '镰刀');
      this.proficiencies.set('spears', '矛');
      this.proficiencies.set('tridents', '三叉戟');
      this.proficiencies.set('war_picks', '战镐');
      this.proficiencies.set('warhammers', '战锤');
      this.proficiencies.set('whips', '鞭子');

      // Armor - Specific types
      this.proficiencies.set('breastplate', '胸甲');
      this.proficiencies.set('chain_mail', '链甲');
      this.proficiencies.set('chain_shirt', '链甲衫');
      this.proficiencies.set('half_plate_armor', '半身板甲');
      this.proficiencies.set('hide_armor', '兽皮甲');
      this.proficiencies.set('leather_armor', '皮甲');
      this.proficiencies.set('padded_armor', '棉甲');
      this.proficiencies.set('plate_armor', '板甲');
      this.proficiencies.set('ring_mail', '环甲');
      this.proficiencies.set('scale_mail', '鳞甲');
      this.proficiencies.set('splint_armor', '夹板甲');
      this.proficiencies.set('studded_leather_armor', '镶嵌皮甲');

      // Musical Instruments
      this.proficiencies.set('bagpipes', '风笛');
      this.proficiencies.set('drum', '鼓');
      this.proficiencies.set('dulcimer', '扬琴');
      this.proficiencies.set('flute', '笛子');
      this.proficiencies.set('horn', '号角');
      this.proficiencies.set('lute', '鲁特琴');
      this.proficiencies.set('lyre', '里拉琴');
      this.proficiencies.set('pan_flute', '排箫');
      this.proficiencies.set('shawm', '肖姆管');
      this.proficiencies.set('viol', '维奥尔琴');

      // Gaming Sets & Other
      this.proficiencies.set('dice_set', '骰子套装');
      this.proficiencies.set('playing_card_set', '扑克牌套装');
      this.proficiencies.set('land_vehicles', '陆上载具');
      this.proficiencies.set('water_vehicles', '水上载具');
      this.proficiencies.set('poisoners_kit', '制毒工具包');

      // Choice-based proficiencies (from class data)
      this.proficiencies.set('one_type_artisan_tools_or_musical_instrument', '一种工匠工具或乐器');
      this.proficiencies.set('three_musical_instruments', '三种乐器');

      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize translation dictionary:', error);
      // Silent failure - functions will return original values
    }
  }

  translate(category: string, id: string): string {
    if (!this.initialized) return id;

    const map = this.getMap(category);
    return map?.get(id) || id;
  }

  private getMap(category: string): Map<string, string> | null {
    switch (category) {
      case 'damageType': return this.damageTypes;
      case 'weaponProperty': return this.weaponProperties;
      case 'weaponPropertyDesc': return this.weaponPropertyDescs;
      case 'school': return this.schools;
      case 'condition': return this.conditions;
      case 'ability': return this.abilities;
      case 'skill': return this.skills;
      case 'currency': return this.currencies;
      case 'proficiency': return this.proficiencies;
      default: return null;
    }
  }
}

// Singleton instance
const dictionary = new TranslationDictionary();

// Initialize on module load (will be called once)
let initPromise: Promise<void> | null = null;

export function ensureDictionaryInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = dictionary.initialize();
  }
  return initPromise;
}

// Generic translation function
export function translate(category: string, id: string): string {
  return dictionary.translate(category, id);
}

// Semantic wrapper functions for better DX
export function tDamageType(id: string): string {
  return translate('damageType', id);
}

export function tWeaponProperty(id: string): string {
  return translate('weaponProperty', id);
}

export function tWeaponPropertyDesc(id: string): string {
  return translate('weaponPropertyDesc', id);
}

export function tSchool(id: string): string {
  return translate('school', id);
}

export function tCondition(id: string): string {
  return translate('condition', id);
}

export function tAbility(id: string): string {
  return translate('ability', id);
}

export function tSkill(id: string): string {
  return translate('skill', id);
}

export function tCurrency(code: string): string {
  return translate('currency', code);
}

export function tProficiency(id: string): string {
  return translate('proficiency', id);
}

// Batch translation helper for arrays
export function tDamageTypes(ids: string[]): string[] {
  return ids.map(tDamageType);
}

export function tWeaponProperties(ids: string[]): string[] {
  return ids.map(tWeaponProperty);
}

// Export for testing
export { dictionary };

