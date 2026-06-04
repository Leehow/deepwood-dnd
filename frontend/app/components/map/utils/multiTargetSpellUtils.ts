/**
 * Helpers for interpreting multi-target spell metadata (e.g. Bless).
 *
 * Looks at the spell's first `on_cast` effect block — if its `target.type`
 * is `"multiple"`, the cast supports a batch of targets up to a base
 * `max_targets` plus the scaling block's `extra_targets` per slot above the
 * spell's base level.
 */

export interface MultiTargetSpec {
  /** True when the spell is configured for multi-target selection. */
  isMultiTarget: boolean;
  /** Total max targets at this slot level (>= 1). */
  maxTargets: number;
}

const DEFAULT_BASE_MAX = 3;

export function resolveMultiTargetSpec(
  spell: any,
  slotLevel: number,
): MultiTargetSpec {
  if (!spell) {
    return { isMultiTarget: false, maxTargets: 1 };
  }
  const effects: any[] = Array.isArray(spell.effects) ? spell.effects : [];
  const onCast = effects.find((e) => e?.trigger === "on_cast") || effects[0];
  if (!onCast || typeof onCast !== "object") {
    return { isMultiTarget: false, maxTargets: 1 };
  }
  const targetType = onCast?.target?.type;
  if (targetType !== "multiple") {
    return { isMultiTarget: false, maxTargets: 1 };
  }
  const baseMax = Number(onCast?.target?.max_targets ?? DEFAULT_BASE_MAX) || DEFAULT_BASE_MAX;
  const scaling = onCast?.scaling || {};
  const perSlot = Number(scaling?.per_slot_above ?? 1) || 1;
  const extraPer = Number(scaling?.extra_targets ?? 0) || 0;
  const baseLevel = Number(spell?.level ?? 1) || 1;
  const effectiveLevel = Number(slotLevel ?? baseLevel) || baseLevel;
  const slotsAbove = Math.max(0, effectiveLevel - baseLevel);
  const extra = perSlot > 0 ? Math.floor(slotsAbove / perSlot) * extraPer : 0;
  const maxTargets = Math.max(1, baseMax + extra);
  return { isMultiTarget: true, maxTargets };
}
