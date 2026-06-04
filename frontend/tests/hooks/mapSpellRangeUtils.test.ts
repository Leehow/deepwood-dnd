import { describe, expect, it } from "vitest";

import { resolveSpellCastDistance } from "../../app/components/map/utils/mapSpellRangeUtils";

describe("resolveSpellCastDistance", () => {
  it("reports range errors for non-DM casts beyond spell range", () => {
    const result = resolveSpellCastDistance({
      spell: {
        id: "guiding-bolt",
        name: "引导箭",
        range: "30尺",
        attackType: "ranged_spell",
      } as any,
      sourceToken: {
        id: 1,
        position_x: 0,
        position_y: 0,
        token_size: "1x1",
      } as any,
      targetToken: {
        id: 2,
        position_x: 10,
        position_y: 0,
        token_size: "1x1",
      } as any,
      sourceTokenId: 1,
      gridUnitLength: 5,
      sourceCharacterData: null,
      isDM: false,
      getBestInvokeDuplicityDistanceToToken: () => null,
    });

    expect(result.spellRange).toBe(30);
    expect(result.rangeError).toBe("超出法术射程 (50尺 > 射程30尺)");
  });

  it("applies Spell Sniper when calculating spell range", () => {
    const result = resolveSpellCastDistance({
      spell: {
        id: "ray-of-frost",
        name: "冷冻射线",
        range: "30尺",
        attackType: "ranged_spell",
      } as any,
      sourceToken: {
        id: 1,
        position_x: 0,
        position_y: 0,
        token_size: "1x1",
      } as any,
      targetToken: {
        id: 2,
        position_x: 10,
        position_y: 0,
        token_size: "1x1",
      } as any,
      sourceTokenId: 1,
      gridUnitLength: 5,
      sourceCharacterData: {
        feats: [{ value: "spell_sniper" }],
      },
      isDM: false,
      getBestInvokeDuplicityDistanceToToken: () => null,
    });

    expect(result.spellRange).toBe(60);
    expect(result.rangeError).toBeNull();
  });
});
