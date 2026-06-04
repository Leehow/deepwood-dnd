/**
 * Unified Translation Layer - Public API
 */

export {
  ensureDictionaryInitialized,
  translate,
  tDamageType,
  tWeaponProperty,
  tWeaponPropertyDesc,
  tSchool,
  tCondition,
  tAbility,
  tSkill,
  tCurrency,
  tProficiency,
  tDamageTypes,
  tWeaponProperties,
} from './dictionary';

export { useDictionary } from './useDictionary';

export {
  getLocalizedField,
  getLocalizedName,
  getLocalizedDescription,
  type LocalizedEntity,
} from './localizedData';

