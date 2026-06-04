import { describe, expect, it } from "vitest";

import { mergeProjectedTokenVisuals } from "~/components/map/utils/runtimeSpellVisualUtils";

describe("mergeProjectedTokenVisuals", () => {
  it("merges projected spell visuals instead of reading legacy active_effects", () => {
    const merged = mergeProjectedTokenVisuals([
      {
        visual_id: "blur",
        spell_id: "blur",
        spell_name: "朦胧术",
        token_filter: { blur: 3, opacity: 0.75 },
      },
      {
        visual_id: "shield_of_faith",
        spell_id: "shield_of_faith",
        spell_name: "护盾术",
        token_filter: { glow: "#60a5fa", glowRadius: 14, overlay: "rgba(96,165,250,0.15)" },
      },
    ]);

    expect(merged).toMatchObject({
      blur: 3,
      opacity: 0.75,
      glow: "#60a5fa",
      glowRadius: 14,
      overlays: ["rgba(96,165,250,0.15)"],
    });
  });

  it("ignores expired projected spell visuals by world time", () => {
    const merged = mergeProjectedTokenVisuals(
      [
        {
          visual_id: "expired_blur",
          spell_id: "blur",
          spell_name: "朦胧术",
          token_filter: { blur: 3 },
          expires_at: { day: 124, hour: 7, minute: 0, second: 30 },
        },
      ],
      { day: 124, hour: 7, minute: 0, second: 30 },
    );

    expect(merged).toBeNull();
  });
});
