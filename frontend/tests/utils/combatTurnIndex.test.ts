import { describe, expect, it } from "vitest";

import {
  getCombatTurnIndex,
  withCombatTurnIndex,
} from "../../app/utils/combatTurnIndex";

describe("getCombatTurnIndex", () => {
  it("reads legacy current_index when present", () => {
    expect(getCombatTurnIndex({ current_index: 3 })).toBe(3);
  });

  it("reads current_turn_index when current_index is absent", () => {
    expect(getCombatTurnIndex({ current_turn_index: 2 })).toBe(2);
  });

  it("prefers current_turn_index over current_index when both exist", () => {
    // Matches backend combat_turn_trigger_hooks.py precedence.
    expect(
      getCombatTurnIndex({ current_index: 4, current_turn_index: 1 }),
    ).toBe(1);
  });

  it("falls back to 0 when both fields are missing or invalid", () => {
    expect(getCombatTurnIndex({})).toBe(0);
    expect(getCombatTurnIndex(null)).toBe(0);
    expect(getCombatTurnIndex(undefined)).toBe(0);
    expect(getCombatTurnIndex({ current_index: null })).toBe(0);
    expect(getCombatTurnIndex({ current_index: "abc" as any })).toBe(0);
    expect(getCombatTurnIndex({ current_index: Number.NaN })).toBe(0);
  });

  it("clamps to bounds when orderLength is supplied", () => {
    expect(getCombatTurnIndex({ current_index: -2 }, 3)).toBe(0);
    expect(getCombatTurnIndex({ current_index: 99 }, 3)).toBe(2);
    expect(getCombatTurnIndex({ current_turn_index: 2 }, 3)).toBe(2);
  });

  it("truncates non-integer values", () => {
    expect(getCombatTurnIndex({ current_index: 1.9 })).toBe(1);
  });
});

describe("withCombatTurnIndex", () => {
  it("sets both current_index and current_turn_index", () => {
    const result = withCombatTurnIndex({ order: [1, 2, 3], round: 1 }, 2);
    expect(result.current_index).toBe(2);
    expect(result.current_turn_index).toBe(2);
    expect(result.order).toEqual([1, 2, 3]);
    expect(result.round).toBe(1);
  });

  it("overwrites pre-existing index fields with the new value", () => {
    const result = withCombatTurnIndex(
      { current_index: 5, current_turn_index: 0 },
      1,
    );
    expect(result.current_index).toBe(1);
    expect(result.current_turn_index).toBe(1);
  });
});
