/**
 * Helper utility functions for ResourceLibrary
 */

import type { Item } from '../types';
import { createLogger } from '~/utils/logger';

const logger = createLogger('helpers');


/**
 * Get viewport center position from TacticalMap
 * @returns Grid position {x, y}
 */
export const getViewportCenter = (): { x: number; y: number } => {
  if (typeof (window as any).__getViewportCenterGridPosition === 'function') {
    return (window as any).__getViewportCenterGridPosition();
  }
  return { x: 5, y: 5 }; // Default fallback
};

/**
 * Get current map URL from TacticalMap
 * @returns Current map URL or 'current' as fallback
 */
export const getCurrentMapUrl = (): string => {
  if (typeof (window as any).__getCurrentMapUrl === 'function') {
    return (window as any).__getCurrentMapUrl() || 'current';
  }
  return 'current';
};

// Cache equipment data to avoid repeated imports
let _equipmentDataCache: any = null;
let _equipmentLoadPromise: Promise<any> | null = null;
async function getEquipmentData(): Promise<any> {
  if (_equipmentDataCache) return _equipmentDataCache;
  if (!_equipmentLoadPromise) {
    _equipmentLoadPromise = import('~/data/rules/equipment.json')
      .then(m => { _equipmentDataCache = m.default; return _equipmentDataCache; })
      .catch(() => null);
  }
  return _equipmentLoadPromise;
}

/**
 * Load icon path from equipment.json for an item
 * @param item Item to find icon for
 * @returns Icon path or null if not found
 */
export const loadItemIcon = async (item: Item): Promise<string | null> => {
  try {
    const data = await getEquipmentData();
    if (!data) return null;

    // Search in all categories
    const searchInCategory = (category: any): string | null => {
      if (!category) return null;

      for (const subcategory of Object.values(category)) {
        if (Array.isArray(subcategory)) {
          const found = subcategory.find((i: any) =>
            i.nameEn === item.name || i.name === item.name_cn
          );
          if (found?.iconPath) return found.iconPath;
        }
      }
      return null;
    };

    // Search in weapons, armor, and adventuring gear
    let path = searchInCategory(data.weapons?.simple);
    if (!path) path = searchInCategory(data.weapons?.martial);
    if (!path) path = searchInCategory(data.armor);
    if (!path) path = searchInCategory(data.adventuringGear);

    return path;
  } catch (error) {
    logger.error('[loadItemIcon] Failed to load icon:', error);
    return null;
  }
};

/**
 * Resolve icon path for item from equipment.json (more comprehensive search)
 * @param item Item to find icon for
 * @returns Icon path or null
 */
export const resolveItemIconPath = async (item: Item): Promise<string | null> => {
  try {
    const data = await getEquipmentData();
    if (!data) return null;

    const findIcon = (arr: any[]): string | null => {
      if (!Array.isArray(arr)) return null;
      const found = arr.find((i: any) => i.nameEn === item.name || i.name === item.name_cn);
      return found?.iconPath || null;
    };

    const simple = data.weapons?.simple || {};
    const martial = data.weapons?.martial || {};
    const armor = data.armor || {};
    const gear = data.adventuringGear || {};

    return (
      findIcon(simple.melee) ||
      findIcon(simple.ranged) ||
      findIcon(martial.melee) ||
      findIcon(martial.ranged) ||
      findIcon(armor.light) ||
      findIcon(armor.medium) ||
      findIcon(armor.heavy) ||
      findIcon(armor.shields) ||
      findIcon(gear.ammunition) ||
      findIcon(gear.standard) ||
      findIcon(gear.containers) ||
      findIcon(gear.tools) ||
      findIcon(gear.kits) ||
      findIcon(gear.instruments) ||
      null
    );
  } catch {
    return null;
  }
};
