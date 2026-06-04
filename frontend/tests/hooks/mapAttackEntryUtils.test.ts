import { describe, expect, it } from "vitest";

import type { Token } from "../../app/components/map/types/TacticalMapTypes";
import { findTokenOccupyingGrid, getWeaponAttackDistanceFeet } from "../../app/components/map/utils/mapAttackEntryUtils";

function createToken(overrides: Partial<Token>): Token {
  return {
    id: 1,
    campaign_id: 7,
    map_url: "/maps/test-map.png",
    position_x: 0,
    position_y: 0,
    token_size: "1x1",
    ...overrides,
  } as Token;
}

describe("mapAttackEntryUtils", () => {
  it("finds target tokens occupying a multi-cell grid square and ignores the source token", () => {
    const sourceToken = createToken({ id: 10, position_x: 2, position_y: 2 });
    const largeTarget = createToken({ id: 22, position_x: 4, position_y: 5, token_size: "2x2" });

    expect(findTokenOccupyingGrid({
      tokens: [sourceToken, largeTarget],
      sourceTokenId: 10,
      gridX: 5,
      gridY: 6,
    })?.id).toBe(22);

    expect(findTokenOccupyingGrid({
      tokens: [sourceToken, largeTarget],
      sourceTokenId: 10,
      gridX: 2,
      gridY: 2,
    })).toBeUndefined();
  });

  it("computes edge-to-edge distance for weapon attacks", () => {
    const sourceToken = createToken({ id: 10, position_x: 0, position_y: 0, token_size: "1x1" });
    const targetToken = createToken({ id: 22, position_x: 2, position_y: 0, token_size: "2x2" });

    expect(getWeaponAttackDistanceFeet({
      sourceToken,
      targetToken,
      gridUnitLength: 5,
    })).toBe(10);
  });
});
