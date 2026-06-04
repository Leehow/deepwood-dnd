import equipmentData from "~/data/rules/equipment.json";

export interface HotbarRangeSlot {
  id?: string;
  type: string;
  meta?: Record<string, any>;
}

export interface TargetingRangeState {
  hasRange: boolean;
  inNormal: boolean;
  inLong: boolean;
  outOfRange: boolean;
}

export interface AttackDistanceCursorPresentation {
  distanceLabel: string;
  lineColor: string;
  textColor: string;
  fontStyle: "normal" | "bold";
  fontSize: number;
  strokeWidth: number;
  opacity: number;
  isLongRange: boolean;
  isOutOfRange: boolean;
}

export function resolveHotbarRange(
  slot: HotbarRangeSlot,
  targetingType?: string,
): { normalR: number; maxR: number } {
  if (targetingType === "ability") return { normalR: 5, maxR: 5 };
  let nr = slot.meta?.normalRange as number | undefined;
  let mr = slot.meta?.maxRange as number | undefined;

  if (nr == null && mr == null) {
    const rangeVal = slot.meta?.range;
    if (rangeVal && typeof rangeVal === "object" && rangeVal.normal) {
      nr = rangeVal.normal;
      mr = rangeVal.long || nr;
    } else if (rangeVal && typeof rangeVal === "string") {
      const match = rangeVal.match(/(\d+)(?:\/(\d+))?/);
      if (match) {
        nr = parseInt(match[1], 10);
        mr = match[2] ? parseInt(match[2], 10) : nr;
      }
    }
  }

  if (nr == null && mr == null && slot.type === "weapon" && slot.id) {
    const stripped = slot.id.replace(
      /^(?:attack_main_|attack_off_|throw_main_|throw_off_|improvthrow_main_|improvthrow_off_)/,
      "",
    );
    const isThrowSlot = slot.id.startsWith("throw_") || slot.id.startsWith("improvthrow_");
    const candidates = stripped !== slot.id ? [stripped] : [slot.id];
    const eqRules = equipmentData as any;
    let found: any = null;
    let foundIsMelee = false;

    for (const weaponId of candidates) {
      for (const proficiency of ["simple", "martial"]) {
        for (const weaponType of ["melee", "ranged"]) {
          const match = (eqRules.weapons?.[proficiency]?.[weaponType] || []).find(
            (weapon: any) => weapon.id?.toLowerCase() === weaponId.toLowerCase(),
          );
          if (match) {
            found = match;
            foundIsMelee = weaponType === "melee";
            break;
          }
        }
        if (found) break;
      }
      if (found) break;
    }

    if (found?.range && typeof found.range === "object") {
      if (isThrowSlot || !foundIsMelee) {
        nr = found.range.normal;
        mr = found.range.long || nr;
      }
    }

    if (
      nr == null
      && found?.properties?.some((property: string) => property === "reach" || property.includes("长柄"))
    ) {
      nr = 10;
      mr = 10;
    }
  }

  if (nr == null && mr == null && slot.type === "weapon") {
    nr = 5;
    mr = 5;
  }

  return { normalR: nr ?? mr ?? 999, maxR: mr ?? nr ?? 999 };
}

export function getTargetingRangeState(
  distanceFeet: number,
  normalR: number,
  maxR: number,
): TargetingRangeState {
  const inNormal = distanceFeet <= normalR;
  const inLong = !inNormal && maxR > normalR && distanceFeet <= maxR;
  return {
    hasRange: normalR < 999,
    inNormal,
    inLong,
    outOfRange: !inNormal && !inLong,
  };
}

export function parseSpellRange(range?: string): number | undefined {
  if (!range) return undefined;
  if (range.includes("自身") || range.toLowerCase().includes("self")) return undefined;
  if (range.includes("触及") || range.toLowerCase().includes("touch")) return 5;
  const match = range.match(/(\d+)\s*(尺|英尺|feet|ft)/i);
  return match ? parseInt(match[1], 10) : undefined;
}

export function getAttackDistanceCursorPresentation(
  distanceFeet: number,
  normalRange: number,
  maxRange: number,
): AttackDistanceCursorPresentation {
  const { inLong, outOfRange } = getTargetingRangeState(distanceFeet, normalRange, maxRange);
  return {
    distanceLabel: outOfRange
      ? `${distanceFeet}尺 > 最大${maxRange}尺 超距!`
      : inLong
        ? `${distanceFeet}尺 (劣势 >${normalRange}尺)`
        : `${distanceFeet}尺`,
    lineColor: outOfRange ? "#ef4444" : inLong ? "#eab308" : "rgba(255,255,255,0.6)",
    textColor: outOfRange ? "#ef4444" : inLong ? "#eab308" : "#d1d5db",
    fontStyle: outOfRange ? "bold" : "normal",
    fontSize: outOfRange ? 12 : 11,
    strokeWidth: outOfRange ? 2 : 1.5,
    opacity: outOfRange ? 0.9 : 0.7,
    isLongRange: inLong,
    isOutOfRange: outOfRange,
  };
}
