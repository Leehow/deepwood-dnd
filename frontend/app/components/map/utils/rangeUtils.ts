/**
 * Parse a range string (e.g. "5尺", "30/120 ft", "10") into numeric values.
 * Shared between SelectionContextMenu and TokenStatsTab.
 */
export function parseRangeValue(rangeStr: string | number | undefined | null): { normal: number; max: number } | null {
  if (rangeStr === undefined || rangeStr === null) return null;

  if (typeof rangeStr === 'number') {
    return { normal: rangeStr, max: rangeStr };
  }

  if (typeof rangeStr !== 'string') return null;

  // Match patterns like "5尺", "10 ft", "30/120尺", "30/120 ft"
  const match = rangeStr.match(/(\d+)(?:\/(\d+))?\s*(?:尺|ft|feet)?/i);
  if (match) {
    const normal = parseInt(match[1], 10);
    const max = match[2] ? parseInt(match[2], 10) : normal;
    return { normal, max };
  }
  return null;
}

/** Extract effective range from an action's reach/range fields. */
export function getActionRange(action: { reach?: any; range?: any }): { normalRange: number; maxRange: number } | null {
  const reachRange = parseRangeValue(action.reach);
  const rangedRange = action.range
    ? parseRangeValue(typeof action.range === 'object' ? `${action.range.normal}/${action.range.long || action.range.normal}` : action.range)
    : null;
  const effectiveRange = reachRange || rangedRange;
  if (!effectiveRange) return null;
  return { normalRange: effectiveRange.normal, maxRange: effectiveRange.max };
}
