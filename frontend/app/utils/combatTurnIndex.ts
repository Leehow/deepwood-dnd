/**
 * Combat turn-index compatibility helpers.
 *
 * Older frontend code stored the active participant pointer as `current_index`.
 * The newer runtime/backend (see `combat_turn_trigger_hooks.py`) uses
 * `current_turn_index` and prefers it over the legacy field when deciding turn
 * transitions. To keep both layers working during the migration, every reader
 * must accept either field and every writer must update both to the same value.
 */

type MaybeCombatState =
  | {
      current_index?: number | null;
      current_turn_index?: number | null;
      order?: unknown;
    }
  | null
  | undefined;

/**
 * Read the active turn index from a combat state object, accepting either
 * `current_index` or `current_turn_index`. Returns a bounded non-negative
 * integer, falling back to 0 when both fields are missing/invalid.
 *
 * If `orderLength` is provided and > 0, the result is clamped to
 * `[0, orderLength - 1]`.
 */
export function getCombatTurnIndex(
  state: MaybeCombatState,
  orderLength?: number,
): number {
  const raw =
    state && typeof state === "object"
      ? state.current_turn_index ?? state.current_index
      : undefined;
  let idx = Number(raw);
  if (!Number.isFinite(idx)) idx = 0;
  idx = Math.trunc(idx);
  if (idx < 0) idx = 0;
  if (typeof orderLength === "number" && orderLength > 0) {
    if (idx > orderLength - 1) idx = orderLength - 1;
  }
  return idx;
}

/**
 * Return a shallow-copied combat state with both `current_index` and
 * `current_turn_index` set to the same `nextIndex`. Use this when mutating
 * combat state so that legacy frontend code and the newer backend runtime
 * hooks observe consistent values.
 */
export function withCombatTurnIndex<T extends Record<string, unknown>>(
  state: T,
  nextIndex: number,
): T & { current_index: number; current_turn_index: number } {
  return {
    ...state,
    current_index: nextIndex,
    current_turn_index: nextIndex,
  };
}
