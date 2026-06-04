import { describe, expect, it } from "vitest";

import { buildTokenDisplayStatusEffects } from "~/components/map/utils/runtimeSpellBadgeStatusUtils";

describe("buildTokenDisplayStatusEffects", () => {
  it("prefers target-side runtime spell badges over legacy spell buffs", () => {
    const effects = buildTokenDisplayStatusEffects({
      activeEffects: [
        {
          id: "spell_buff_hex",
          name: "脆弱诅咒",
          icon: "☠️",
          color: "#7c3aed",
          spell_buff: true,
          spell_id: "hex",
        },
        {
          id: "poisoned",
          name: "中毒",
          icon: "🤢",
          color: "#16a34a",
        },
      ],
      spellBadges: [
        {
          runtime_instance_id: 42,
          spell_id: "hex",
          label: "脆弱诅咒（力量）",
          icon: "☠️",
          color: "#9333ea",
          duration_rounds: 600,
          remaining_rounds: 598,
        },
      ],
      spellOverlays: [
        {
          runtime_instance_id: 42,
          spell_id: "hex",
          spell_name: "脆弱诅咒",
          role: "target",
          label: "脆弱诅咒（力量）",
          color: "#9333ea",
          duration_rounds: 600,
          remaining_rounds: 598,
        },
      ],
    });

    expect(effects).toHaveLength(2);
    expect(effects[0]).toMatchObject({
      id: "runtime_spell_badge_42",
      name: "脆弱诅咒（力量）",
      spell_id: "hex",
      duration: 598,
      maxDuration: 600,
      runtime_display_only: true,
    });
    expect(effects[1]).toMatchObject({ id: "poisoned" });
  });

  it("does not create bottom-left runtime badges for source-only overlays", () => {
    const effects = buildTokenDisplayStatusEffects({
      activeEffects: [],
      spellBadges: [
        {
          runtime_instance_id: 7,
          spell_id: "hex",
          label: "脆弱诅咒",
          icon: "☠️",
          color: "#9333ea",
        },
      ],
      spellOverlays: [
        {
          runtime_instance_id: 7,
          spell_id: "hex",
          spell_name: "脆弱诅咒",
          role: "source",
          label: "脆弱诅咒 -> 哥布林",
          color: "#9333ea",
        },
      ],
    });

    expect(effects).toEqual([]);
  });

  it("uses world-time expiry for runtime countdowns and hides expired overlays", () => {
    const activeEffects = buildTokenDisplayStatusEffects({
      activeEffects: [],
      spellBadges: [
        {
          runtime_instance_id: 9,
          spell_id: "hex",
          label: "脆弱诅咒（敏捷）",
          icon: "☠️",
          color: "#9333ea",
          duration_rounds: 600,
          remaining_rounds: 600,
          expires_at: { day: 124, hour: 7, minute: 0, second: 30 },
        },
      ],
      spellOverlays: [
        {
          runtime_instance_id: 9,
          spell_id: "hex",
          spell_name: "脆弱诅咒",
          role: "target",
          label: "脆弱诅咒（敏捷）",
          color: "#9333ea",
          duration_rounds: 600,
          remaining_rounds: 600,
          expires_at: { day: 124, hour: 7, minute: 0, second: 30 },
        },
      ],
      currentWorldTime: { day: 124, hour: 7, minute: 0, second: 0 },
    });

    expect(activeEffects[0]).toMatchObject({
      id: "runtime_spell_badge_9",
      duration: 5,
      expires_at: { day: 124, hour: 7, minute: 0, second: 30 },
    });

    const expiredEffects = buildTokenDisplayStatusEffects({
      activeEffects: [],
      spellBadges: [
        {
          runtime_instance_id: 9,
          spell_id: "hex",
          label: "脆弱诅咒（敏捷）",
          expires_at: { day: 124, hour: 7, minute: 0, second: 30 },
        },
      ],
      spellOverlays: [
        {
          runtime_instance_id: 9,
          spell_id: "hex",
          spell_name: "脆弱诅咒",
          role: "target",
          label: "脆弱诅咒（敏捷）",
          expires_at: { day: 124, hour: 7, minute: 0, second: 30 },
        },
      ],
      currentWorldTime: { day: 124, hour: 7, minute: 0, second: 30 },
    });

    expect(expiredEffects).toEqual([]);
  });
});
