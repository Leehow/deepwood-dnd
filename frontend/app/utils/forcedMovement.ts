/**
 * Forced-movement consumption helpers.
 *
 * Backend `ForcedMovementHandler` persists a transient
 * `effect_type: "forced_movement"` entry on the target token's `active_effects`
 * after spells like Thorn Whip resolve. The frontend map layer is responsible
 * for converting that intent into an actual coordinate change and removing the
 * transient entry exactly once.
 */

export type ForcedMovementDirection = "push" | "pull" | "toward_point";

export interface ForcedMovementIntent {
  /** Stable id for dedupe — usually `<spell_id>_forced_movement` */
  effectId: string;
  /** Source/caster token id used to derive the reference point */
  sourceTokenId: number | null;
  direction: ForcedMovementDirection;
  /** Distance in feet (D&D 5E convention) */
  distanceFeet: number;
  /** Reference frame; today only "caster" is exercised */
  relativeTo: string | null;
  /** Optional explicit point for `toward_point` direction */
  point: { x: number; y: number } | null;
}

interface RawEffect {
  id?: unknown;
  spell_id?: unknown;
  effect_type?: unknown;
  source_token_id?: unknown;
  direction?: unknown;
  distance?: unknown;
  relative_to?: unknown;
  relativeTo?: unknown;
  transient?: unknown;
  point?: unknown;
  [key: string]: unknown;
}

function asFiniteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function asPoint(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { x?: unknown; y?: unknown };
  const x = asFiniteNumber(v.x);
  const y = asFiniteNumber(v.y);
  if (x === null || y === null) return null;
  return { x, y };
}

/**
 * Extract every transient forced_movement intent from a token's active_effects.
 * Returns an empty array when there is nothing to consume.
 */
export function findForcedMovementIntents(
  effects: readonly unknown[] | null | undefined,
): ForcedMovementIntent[] {
  if (!Array.isArray(effects)) return [];
  const intents: ForcedMovementIntent[] = [];
  for (const raw of effects as RawEffect[]) {
    if (!raw || typeof raw !== "object") continue;
    if (raw.effect_type !== "forced_movement") continue;
    if (raw.transient !== true) continue;
    const direction = raw.direction;
    if (
      direction !== "push"
      && direction !== "pull"
      && direction !== "toward_point"
    ) {
      continue;
    }
    const distance = asFiniteNumber(raw.distance);
    if (distance === null || distance <= 0) continue;
    const idValue = typeof raw.id === "string" && raw.id.length > 0
      ? raw.id
      : `${String(raw.spell_id ?? "spell")}_forced_movement`;
    const sourceTokenId = asFiniteNumber(raw.source_token_id);
    const relativeTo = typeof raw.relative_to === "string"
      ? raw.relative_to
      : (typeof raw.relativeTo === "string" ? raw.relativeTo : null);
    intents.push({
      effectId: idValue,
      sourceTokenId: sourceTokenId !== null ? Math.trunc(sourceTokenId) : null,
      direction,
      distanceFeet: distance,
      relativeTo,
      point: asPoint(raw.point),
    });
  }
  return intents;
}

/**
 * True for entries that look like a transient forced_movement intent.
 * Used when filtering them out of `active_effects` after consumption.
 */
export function isForcedMovementIntentEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as RawEffect;
  return e.effect_type === "forced_movement" && e.transient === true;
}

export interface ComputeDestinationArgs {
  sourcePos: { x: number; y: number } | null;
  targetPos: { x: number; y: number };
  intent: Pick<ForcedMovementIntent, "direction" | "distanceFeet" | "point">;
  /** Map-configured feet per square (5 in standard D&D 5E) */
  gridUnitLength: number;
}

/**
 * Compute the grid destination for a forced-movement intent.
 *
 * - `push` moves the target away from the reference along the source→target ray.
 * - `pull` moves the target toward the reference (caster) along that ray.
 * - `toward_point` moves the target toward the supplied point.
 *
 * Returns null if direction has no defined unit vector (source coincident with
 * target) or if the intent is malformed (e.g. `toward_point` without a point).
 */
export function computeForcedMovementDestination(
  args: ComputeDestinationArgs,
): { x: number; y: number } | null {
  const { sourcePos, targetPos, intent, gridUnitLength } = args;
  const feetPerSquare = gridUnitLength > 0 ? gridUnitLength : 5;
  const squares = Math.round(intent.distanceFeet / feetPerSquare);
  if (squares <= 0) return null;

  let refX: number;
  let refY: number;
  if (intent.direction === "toward_point") {
    if (!intent.point) return null;
    refX = intent.point.x;
    refY = intent.point.y;
  } else {
    if (!sourcePos) return null;
    refX = sourcePos.x;
    refY = sourcePos.y;
  }

  const dx = targetPos.x - refX;
  const dy = targetPos.y - refY;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) return null;

  const ux = dx / length;
  const uy = dy / length;
  const sign = intent.direction === "push" ? 1 : -1;

  const stepX = ux * squares * sign;
  const stepY = uy * squares * sign;
  // Clamp the per-axis travel so we never overshoot the reference point when
  // pulling. Otherwise a 10-ft pull from 1 square away would walk past the
  // caster onto the far side.
  const clampedX = sign < 0 ? Math.max(-Math.abs(dx), Math.min(Math.abs(dx), stepX)) : stepX;
  const clampedY = sign < 0 ? Math.max(-Math.abs(dy), Math.min(Math.abs(dy), stepY)) : stepY;

  const newX = Math.round(targetPos.x + clampedX);
  const newY = Math.round(targetPos.y + clampedY);
  return { x: newX, y: newY };
}
