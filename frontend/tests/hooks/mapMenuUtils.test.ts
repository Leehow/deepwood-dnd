import { describe, expect, it } from "vitest";

import {
  buildSelectionCompanionTokens,
  findPlayerControlledToken,
  tokenHasZoneSpellOnMap,
} from "~/components/map/utils/mapMenuUtils";

describe("mapMenuUtils", () => {
  it("detects zone spells on the active map", () => {
    expect(
      tokenHasZoneSpellOnMap(
        {
          id: 1,
          concentration_spell: { area_effect: { map_url: "map://alpha" } },
        } as any,
        "map://alpha",
      ),
    ).toBe(true);

    expect(
      tokenHasZoneSpellOnMap(
        {
          id: 2,
          active_effects: [{ spell_buff: true, area_effect: { map_url: "map://alpha" } }],
        } as any,
        "map://alpha",
      ),
    ).toBe(true);

    expect(
      tokenHasZoneSpellOnMap(
        {
          id: 3,
          concentration_spell: { area_effect: { map_url: "map://beta" } },
        } as any,
        "map://alpha",
      ),
    ).toBe(false);
  });

  it("finds the active player token by selected character or user id", () => {
    const tokens = [
      { id: 1, character_id: 101, user_id: "42" },
      { id: 2, character_id: 202, user_id: "99" },
    ] as any[];

    expect(findPlayerControlledToken(tokens as any, 202, undefined)?.id).toBe(2);
    expect(findPlayerControlledToken(tokens as any, null, "42")?.id).toBe(1);
    expect(findPlayerControlledToken(tokens as any, null, "404")).toBeNull();
  });

  it("derives companion tokens only for player selection menus", () => {
    const tokens = [
      { id: 1, character_id: 101 },
      {
        id: 2,
        monster_instance_id: 501,
        control_type: "companion",
        controller_character_id: 101,
      },
      {
        id: 3,
        monster_instance_id: 502,
        control_type: "companion",
        controller_character_id: 999,
      },
    ] as any[];

    const selectionContextMenu = {
      sourceToken: { id: 1, character_id: 101 },
      targetToken: null,
      targetGridPos: null,
      x: 0,
      y: 0,
    } as any;

    expect(buildSelectionCompanionTokens(false, selectionContextMenu, tokens as any)).toEqual([
      tokens[1],
    ]);
    expect(buildSelectionCompanionTokens(true, selectionContextMenu, tokens as any)).toEqual([]);
  });
});
