import type { SpellSelection } from '../components/character/CharacterDisplay/types/Character';

/**
 * Extract spell IDs from spell list (works with both old and new formats)
 */
export function extractSpellIds(spells?: SpellSelection[] | string[]): string[] {
  if (!spells || spells.length === 0) return [];

  // Handle mixed-format arrays robustly: extract id from each element individually
  // This handles: strings, objects with .id, null entries, and mixed arrays
  const ids: string[] = [];
  for (const spell of spells) {
    if (typeof spell === 'string') {
      ids.push(spell);
    } else if (spell && typeof spell === 'object' && 'id' in spell) {
      const id = (spell as SpellSelection).id;
      if (id) ids.push(id);
    }
  }
  return ids;
}

/**
 * Normalize spell list to new format
 */
export function normalizeSpellList(
  spells?: SpellSelection[] | string[],
  defaultLevel: number = 1,
  defaultSource: string = 'unknown'
): SpellSelection[] {
  if (!spells || spells.length === 0) return [];

  // Already in new format
  if (typeof spells[0] === 'object' && spells[0] !== null) {
    return spells as SpellSelection[];
  }

  // Convert old format to new format
  return (spells as string[]).map(spellId => ({
    id: spellId,
    level_learned: defaultLevel,
    source: defaultSource
  }));
}

/**
 * Filter spells by level learned
 */
export function filterSpellsByLevel(
  spells?: SpellSelection[] | string[],
  maxLevel: number = 1
): SpellSelection[] {
  const normalized = normalizeSpellList(spells);
  return normalized.filter(spell => spell.level_learned <= maxLevel);
}

/**
 * Check if spell list is in new format
 */
export function isNewSpellFormat(spells?: SpellSelection[] | string[]): boolean {
  if (!spells || spells.length === 0) return false;
  return typeof spells[0] === 'object' && spells[0] !== null && 'level_learned' in spells[0];
}

/**
 * Get spells learned at a specific level
 */
export function getSpellsAtLevel(
  spells: SpellSelection[] | string[] | undefined,
  level: number
): SpellSelection[] {
  const normalized = normalizeSpellList(spells);
  return normalized.filter(spell => spell.level_learned === level);
}

/**
 * Get spells grouped by source class
 */
export function getSpellsBySource(
  spells: SpellSelection[] | string[] | undefined,
  defaultSource: string = 'unknown'
): Record<string, SpellSelection[]> {
  const normalized = normalizeSpellList(spells, 1, defaultSource);
  const grouped: Record<string, SpellSelection[]> = {};

  for (const spell of normalized) {
    const source = spell.source || defaultSource;
    if (!grouped[source]) {
      grouped[source] = [];
    }
    grouped[source].push(spell);
  }

  return grouped;
}

/**
 * Get the source class for a specific spell
 */
export function getSpellSource(
  spellId: string,
  spells: SpellSelection[] | string[] | undefined,
  defaultSource: string = 'unknown'
): string {
  const normalized = normalizeSpellList(spells, 1, defaultSource);
  const spell = normalized.find(s => s.id === spellId);
  return spell?.source || defaultSource;
}

/**
 * Check if a spell is already learned (by any class)
 */
export function isSpellLearned(
  spellId: string,
  spells: SpellSelection[] | string[] | undefined
): boolean {
  return extractSpellIds(spells).includes(spellId);
}
