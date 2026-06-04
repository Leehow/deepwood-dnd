import { describe, expect, it } from "vitest";

import {
  computeForcedMovementDestination,
  findForcedMovementIntents,
  isForcedMovementIntentEntry,
} from "../../app/utils/forcedMovement";

const thornWhipEffect = {
  id: "thorn_whip_forced_movement",
  spell_id: "thorn_whip",
  effect_type: "forced_movement",
  direction: "pull",
  distance: 10,
  relative_to: "caster",
  source_token_id: 527,
  transient: true,
};

describe("findForcedMovementIntents", () => {
  it("extracts a Thorn Whip pull intent from a single-entry active_effects list", () => {
    const intents = findForcedMovementIntents([thornWhipEffect]);
    expect(intents).toEqual([
      {
        effectId: "thorn_whip_forced_movement",
        sourceTokenId: 527,
        direction: "pull",
        distanceFeet: 10,
        relativeTo: "caster",
        point: null,
      },
    ]);
  });

  it("returns an empty array for null or non-array input", () => {
    expect(findForcedMovementIntents(null)).toEqual([]);
    expect(findForcedMovementIntents(undefined)).toEqual([]);
    expect(findForcedMovementIntents("not-an-array" as unknown as unknown[])).toEqual([]);
  });

  it("ignores non-transient forced_movement entries and unrelated effects", () => {
    const effects = [
      { id: "rage", name: "Rage" },
      { ...thornWhipEffect, transient: false },
      { effect_type: "forced_movement", direction: "pull", distance: 5 }, // no transient
    ];
    expect(findForcedMovementIntents(effects)).toEqual([]);
  });

  it("ignores invalid directions and non-positive distances", () => {
    expect(
      findForcedMovementIntents([
        { ...thornWhipEffect, direction: "sideways" },
      ]),
    ).toEqual([]);
    expect(
      findForcedMovementIntents([
        { ...thornWhipEffect, distance: 0 },
      ]),
    ).toEqual([]);
    expect(
      findForcedMovementIntents([
        { ...thornWhipEffect, distance: "not-a-number" },
      ]),
    ).toEqual([]);
  });

  it("falls back to a synthetic effect id when none is provided", () => {
    const intents = findForcedMovementIntents([{
      spell_id: "thunderwave",
      effect_type: "forced_movement",
      direction: "push",
      distance: 10,
      relative_to: "caster",
      source_token_id: 100,
      transient: true,
    }]);
    expect(intents).toHaveLength(1);
    expect(intents[0].effectId).toBe("thunderwave_forced_movement");
    expect(intents[0].direction).toBe("push");
  });

  it("preserves a toward_point payload when point coordinates are valid", () => {
    const intents = findForcedMovementIntents([{
      ...thornWhipEffect,
      direction: "toward_point",
      point: { x: 12, y: 7 },
    }]);
    expect(intents).toHaveLength(1);
    expect(intents[0].point).toEqual({ x: 12, y: 7 });
    expect(intents[0].direction).toBe("toward_point");
  });
});

describe("isForcedMovementIntentEntry", () => {
  it("returns true only for transient forced_movement entries", () => {
    expect(isForcedMovementIntentEntry(thornWhipEffect)).toBe(true);
    expect(isForcedMovementIntentEntry({ ...thornWhipEffect, transient: false })).toBe(false);
    expect(isForcedMovementIntentEntry({ id: "rage" })).toBe(false);
    expect(isForcedMovementIntentEntry(null)).toBe(false);
  });
});

describe("computeForcedMovementDestination", () => {
  it("pulls a Thorn Whip target from (35,38) toward source (30,38) by 10 ft -> (33,38)", () => {
    const destination = computeForcedMovementDestination({
      sourcePos: { x: 30, y: 38 },
      targetPos: { x: 35, y: 38 },
      intent: { direction: "pull", distanceFeet: 10, point: null },
      gridUnitLength: 5,
    });
    expect(destination).toEqual({ x: 33, y: 38 });
  });

  it("pushes a Thunderwave target the opposite way along the source ray", () => {
    const destination = computeForcedMovementDestination({
      sourcePos: { x: 30, y: 38 },
      targetPos: { x: 35, y: 38 },
      intent: { direction: "push", distanceFeet: 10, point: null },
      gridUnitLength: 5,
    });
    expect(destination).toEqual({ x: 37, y: 38 });
  });

  it("never overshoots the source when pulling further than the available distance", () => {
    // Target only 1 square (5ft) away — a 10ft pull should clamp at the source square.
    const destination = computeForcedMovementDestination({
      sourcePos: { x: 30, y: 38 },
      targetPos: { x: 31, y: 38 },
      intent: { direction: "pull", distanceFeet: 10, point: null },
      gridUnitLength: 5,
    });
    expect(destination).toEqual({ x: 30, y: 38 });
  });

  it("returns null when source position is missing for caster-relative direction", () => {
    const destination = computeForcedMovementDestination({
      sourcePos: null,
      targetPos: { x: 35, y: 38 },
      intent: { direction: "pull", distanceFeet: 10, point: null },
      gridUnitLength: 5,
    });
    expect(destination).toBeNull();
  });

  it("returns null when source coincides with target (no defined direction)", () => {
    const destination = computeForcedMovementDestination({
      sourcePos: { x: 30, y: 38 },
      targetPos: { x: 30, y: 38 },
      intent: { direction: "pull", distanceFeet: 10, point: null },
      gridUnitLength: 5,
    });
    expect(destination).toBeNull();
  });

  it("returns null for toward_point when point is missing", () => {
    const destination = computeForcedMovementDestination({
      sourcePos: { x: 30, y: 38 },
      targetPos: { x: 35, y: 38 },
      intent: { direction: "toward_point", distanceFeet: 10, point: null },
      gridUnitLength: 5,
    });
    expect(destination).toBeNull();
  });

  it("uses the supplied point for toward_point and moves the target toward it", () => {
    const destination = computeForcedMovementDestination({
      sourcePos: null,
      targetPos: { x: 35, y: 38 },
      intent: { direction: "toward_point", distanceFeet: 10, point: { x: 25, y: 38 } },
      gridUnitLength: 5,
    });
    expect(destination).toEqual({ x: 33, y: 38 });
  });

  it("falls back to a 5-foot square when gridUnitLength is invalid", () => {
    const destination = computeForcedMovementDestination({
      sourcePos: { x: 30, y: 38 },
      targetPos: { x: 35, y: 38 },
      intent: { direction: "pull", distanceFeet: 10, point: null },
      gridUnitLength: 0,
    });
    expect(destination).toEqual({ x: 33, y: 38 });
  });

  it("returns null when distance is below half a square (rounds to zero)", () => {
    const destination = computeForcedMovementDestination({
      sourcePos: { x: 30, y: 38 },
      targetPos: { x: 35, y: 38 },
      intent: { direction: "pull", distanceFeet: 2, point: null },
      gridUnitLength: 5,
    });
    expect(destination).toBeNull();
  });
});
