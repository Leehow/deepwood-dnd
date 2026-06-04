import { describe, expect, it } from "vitest";

import {
  getAttackDistanceCursorPresentation,
  getTargetingRangeState,
  parseSpellRange,
  resolveHotbarRange,
} from "../../app/components/map/utils/mapTargetingUtils";

describe("mapTargetingUtils", () => {
  it("parses common spell range formats", () => {
    expect(parseSpellRange("120 尺")).toBe(120);
    expect(parseSpellRange("触及")).toBe(5);
    expect(parseSpellRange("Self")).toBeUndefined();
    expect(parseSpellRange("自身 15 尺锥状")).toBeUndefined();
  });

  it("derives normal, long, and out-of-range states", () => {
    expect(getTargetingRangeState(20, 30, 120)).toEqual({
      hasRange: true,
      inNormal: true,
      inLong: false,
      outOfRange: false,
    });
    expect(getTargetingRangeState(60, 30, 120)).toEqual({
      hasRange: true,
      inNormal: false,
      inLong: true,
      outOfRange: false,
    });
    expect(getTargetingRangeState(140, 30, 120)).toEqual({
      hasRange: true,
      inNormal: false,
      inLong: false,
      outOfRange: true,
    });
  });

  it("falls back to melee defaults for weapon slots without explicit ranges", () => {
    expect(
      resolveHotbarRange({
        id: "attack_main_unknown_blade",
        type: "weapon",
        meta: {},
      }),
    ).toEqual({ normalR: 5, maxR: 5 });
  });

  it("formats attack distance cursor presentation for long and out-of-range states", () => {
    expect(getAttackDistanceCursorPresentation(40, 30, 120)).toMatchObject({
      distanceLabel: "40尺 (劣势 >30尺)",
      lineColor: "#eab308",
      textColor: "#eab308",
      isLongRange: true,
      isOutOfRange: false,
    });

    expect(getAttackDistanceCursorPresentation(130, 30, 120)).toMatchObject({
      distanceLabel: "130尺 > 最大120尺 超距!",
      lineColor: "#ef4444",
      textColor: "#ef4444",
      fontStyle: "bold",
      isOutOfRange: true,
    });
  });
});
