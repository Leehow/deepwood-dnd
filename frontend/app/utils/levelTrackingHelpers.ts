import type { LevelTrackedSelection } from '../components/character/CharacterDisplay/types/Character';

/**
 * Extract values from level-tracked selections (works with both old and new formats)
 */
export function extractValues<T = string>(
  selections?: LevelTrackedSelection<T>[] | T[]
): T[] {
  if (!selections || selections.length === 0) return [];

  // Check if it's the new format (array of objects)
  if (typeof selections[0] === 'object' && selections[0] !== null && 'value' in selections[0]) {
    return (selections as LevelTrackedSelection<T>[]).map(s => s.value);
  }

  // Old format (array of values)
  return selections as T[];
}

/**
 * Extract a single value from level-tracked selection (works with both formats)
 */
export function extractSingleValue<T = string>(
  selection?: LevelTrackedSelection<T> | T | null
): T | null {
  if (!selection) return null;

  // Check if it's the new format (object)
  if (typeof selection === 'object' && selection !== null && 'value' in selection) {
    return (selection as LevelTrackedSelection<T>).value;
  }

  // Old format (direct value)
  return selection as T;
}

/**
 * Normalize selections to new format
 */
export function normalizeSelections<T = string>(
  values?: LevelTrackedSelection<T>[] | T[],
  defaultLevel: number = 1,
  defaultSource: string = 'unknown'
): LevelTrackedSelection<T>[] {
  if (!values || values.length === 0) return [];

  // Already in new format
  if (typeof values[0] === 'object' && values[0] !== null && 'value' in values[0]) {
    return values as LevelTrackedSelection<T>[];
  }

  // Convert old format to new format
  return (values as T[]).map(value => ({
    value,
    level_acquired: defaultLevel,
    source: defaultSource
  }));
}

/**
 * Normalize a single selection to new format
 */
export function normalizeSingleSelection<T = string>(
  value?: LevelTrackedSelection<T> | T | null,
  defaultLevel: number = 1,
  defaultSource: string = 'unknown'
): LevelTrackedSelection<T> | null {
  if (!value) return null;

  // Already in new format
  if (typeof value === 'object' && value !== null && 'value' in value) {
    return value as LevelTrackedSelection<T>;
  }

  // Convert old format to new format
  return {
    value: value as T,
    level_acquired: defaultLevel,
    source: defaultSource
  };
}

/**
 * Filter selections by level acquired
 */
export function filterByLevel<T = string>(
  selections?: LevelTrackedSelection<T>[] | T[],
  maxLevel: number = 1
): LevelTrackedSelection<T>[] {
  const normalized = normalizeSelections(selections);
  return normalized.filter(selection => selection.level_acquired <= maxLevel);
}

/**
 * Check if selections are in new format
 */
export function isNewFormat<T = string>(
  selections?: LevelTrackedSelection<T>[] | T[]
): boolean {
  if (!selections || selections.length === 0) return false;
  return typeof selections[0] === 'object' &&
         selections[0] !== null &&
         'level_acquired' in selections[0];
}

/**
 * Get selections acquired at a specific level
 */
export function getSelectionsAtLevel<T = string>(
  selections: LevelTrackedSelection<T>[] | T[] | undefined,
  level: number
): LevelTrackedSelection<T>[] {
  const normalized = normalizeSelections(selections);
  return normalized.filter(selection => selection.level_acquired === level);
}

/**
 * Group selections by source
 */
export function groupBySource<T = string>(
  selections?: LevelTrackedSelection<T>[] | T[]
): Record<string, LevelTrackedSelection<T>[]> {
  const normalized = normalizeSelections(selections);
  return normalized.reduce((groups, selection) => {
    const source = selection.source || 'unknown';
    if (!groups[source]) {
      groups[source] = [];
    }
    groups[source].push(selection);
    return groups;
  }, {} as Record<string, LevelTrackedSelection<T>[]>);
}

/**
 * Merge new selections with existing ones (for level up)
 */
export function mergeSelections<T = string>(
  existing: LevelTrackedSelection<T>[] | T[],
  newSelections: T[],
  level: number,
  source: string,
  sourceDetail?: string
): LevelTrackedSelection<T>[] {
  const normalized = normalizeSelections(existing);
  const existingValues = extractValues(normalized);

  const toAdd = newSelections
    .filter(value => !existingValues.includes(value))
    .map(value => ({
      value,
      level_acquired: level,
      source,
      source_detail: sourceDetail
    }));

  return [...normalized, ...toAdd];
}

/**
 * Remove selections (for retraining or level down)
 */
export function removeSelections<T = string>(
  existing: LevelTrackedSelection<T>[] | T[],
  toRemove: T[]
): LevelTrackedSelection<T>[] {
  const normalized = normalizeSelections(existing);
  return normalized.filter(selection => !toRemove.includes(selection.value));
}