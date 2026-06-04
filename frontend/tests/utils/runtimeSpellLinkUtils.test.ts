import { describe, expect, it } from "vitest";

import type { Token } from "~/components/map/types/TacticalMapTypes";
import { buildRuntimeSpellLinks } from "~/components/map/utils/runtimeSpellLinkUtils";

function createToken(overrides: Partial<Token>): Token {
  return {
    id: 1,
    campaign_id: 7,
    map_url: "test-map",
    position_x: 0,
    position_y: 0,
    token_size: "1x1",
    active_effects: [],
    ...overrides,
  } as Token;
}

describe("buildRuntimeSpellLinks", () => {
  it("creates a dashed link from runtime source token to visible target token", () => {
    const source = createToken({
      id: 10,
      position_x: 2,
      position_y: 3,
      spell_overlays: [
        {
          runtime_instance_id: 42,
          spell_id: "hex",
          spell_name: "脆弱诅咒",
          role: "source",
          label: "脆弱诅咒 -> 目标",
          color: "#9333ea",
          target_token_id: 11,
        },
      ],
    });
    const target = createToken({
      id: 11,
      position_x: 6,
      position_y: 3,
      spell_overlays: [
        {
          runtime_instance_id: 42,
          spell_id: "hex",
          spell_name: "脆弱诅咒",
          role: "target",
          label: "脆弱诅咒（力量）",
          color: "#9333ea",
        },
      ],
    });

    const links = buildRuntimeSpellLinks([source, target]);

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      kind: "token",
      sourceTokenId: 10,
      targetTokenId: 11,
      spellId: "hex",
      spellName: "脆弱诅咒",
      color: "#9333ea",
    });
    expect(links[0].points).toEqual([100, 140, 260, 140]);
  });

  it("creates an area link for concentration zones away from the caster", () => {
    const source = createToken({
      id: 20,
      position_x: 1,
      position_y: 1,
      concentration_spell: {
        spell_id: "fog-cloud",
        spell_name: "云雾术",
        slot_level: 1,
        con_save_bonus: 2,
        has_advantage: false,
        area_effect: {
          shape: "sphere",
          center_x: 5,
          center_y: 4,
          radius: 20,
          map_url: "test-map",
        },
      },
    });

    const links = buildRuntimeSpellLinks([source]);

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      kind: "area",
      sourceTokenId: 20,
      spellId: "fog-cloud",
      spellName: "云雾术",
    });
    expect(links[0].points).toEqual([60, 60, 220, 180]);
  });
});
