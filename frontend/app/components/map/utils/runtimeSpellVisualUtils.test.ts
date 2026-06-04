import { describe, it, expect } from "vitest";
import { mergeProjectedTokenVisuals } from "./runtimeSpellVisualUtils";

describe("mergeProjectedTokenVisuals — v2 spell_visuals (existing behaviour)", () => {
  it("merges a token_filter glow from a v2 spell_visual projection", () => {
    const merged = mergeProjectedTokenVisuals(
      [{ token_filter: { glow: "#ffffff", glowRadius: 8 } } as any],
      null,
    );
    expect(merged?.glow).toBe("#ffffff");
    expect(merged?.glowRadius).toBe(8);
  });

  it("returns null when there are no visuals", () => {
    expect(mergeProjectedTokenVisuals(null, null)).toBeNull();
    expect(mergeProjectedTokenVisuals([], null)).toBeNull();
  });
});

describe("mergeProjectedTokenVisuals — legacy active_effects token filters (BUG A)", () => {
  it("merges glow from a legacy apply_token_filter active_effect (faerie_fire)", () => {
    const activeEffects = [
      {
        id: "faerie_fire_apply_token_filter",
        effect_type: "apply_token_filter",
        filter: { glow: "#a78bfa", glowRadius: 10, glowAnimation: "pulse" },
      },
    ];
    const merged = mergeProjectedTokenVisuals(null, null, activeEffects as any);
    expect(merged).not.toBeNull();
    expect(merged?.glow).toBe("#a78bfa");
    expect(merged?.glowRadius).toBe(10);
    expect(merged?.glowAnimation).toBe("pulse");
  });

  it("ignores active_effects that are not apply_token_filter", () => {
    const activeEffects = [
      { id: "faerie_fire_illumination", effect_type: "apply_illumination", light_type: "light", bright_radius: 0, dim_radius: 10 },
      { id: "faerie_fire_buff", spell_buff: true, conditions: ["invisible"] },
    ];
    expect(mergeProjectedTokenVisuals(null, null, activeEffects as any)).toBeNull();
  });

  it("combines a v2 projection glow and a legacy apply_token_filter glow without double-counting", () => {
    const merged = mergeProjectedTokenVisuals(
      [{ token_filter: { glow: "#ffffff", glowRadius: 6 } } as any],
      null,
      [{ effect_type: "apply_token_filter", filter: { glow: "#a78bfa", glowRadius: 12 } }] as any,
    );
    // widest glow wins (glowRadius 12 from the legacy filter)
    expect(merged?.glow).toBe("#a78bfa");
    expect(merged?.glowRadius).toBe(12);
  });
});
