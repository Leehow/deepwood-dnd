import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { buildChestModalCharacters, useMapModalData } from "../../app/components/map/hooks/useMapModalData";
import type { PlayerAvatar, Token } from "../../app/components/map/types/TacticalMapTypes";

function createToken(overrides: Partial<Token>): Token {
  return {
    id: 1,
    campaign_id: 1,
    map_url: "map://default",
    position_x: 0,
    position_y: 0,
    token_size: "1x1",
    ...overrides,
  } as Token;
}

describe("useMapModalData", () => {
  it("builds chest modal characters from player avatars or token fallbacks", () => {
    const playerAvatars: PlayerAvatar[] = [
      { id: 7, name: "Ari", type: "player", userId: 12 },
      { id: "m_1", name: "Wolf", type: "monster" },
    ];

    expect(buildChestModalCharacters(playerAvatars, [])).toEqual([
      { id: 7, name: "Ari", user_id: "12" },
    ]);

    const fallbackTokens = [
      createToken({ id: 20, character_id: 101, character_name: "Rowan", user_id: "3" }),
      createToken({ id: 21, character_id: 101, character_name: "Rowan", user_id: "3" }),
      createToken({ id: 22, character_id: 202, character_name: "Mira", user_id: "4" }),
    ];

    expect(buildChestModalCharacters([], fallbackTokens)).toEqual([
      { id: 101, name: "Rowan", user_id: "3" },
      { id: 202, name: "Mira", user_id: "4" },
    ]);
  });

  it("returns modal tokens from the current token set", () => {
    const playerNoteToken = createToken({ id: 11 });
    const illusionEditToken = createToken({ id: 12, disguise_data: {} as any });
    const itemDetailToken = createToken({ id: 13, item_data: { type: "weapon" } as any });
    const lootBagToken = createToken({ id: 14, loot_bag_data: { items: [] } as any });
    const shopToken = createToken({ id: 15, shop_id: 88 as any });

    const { result } = renderHook(() =>
      useMapModalData({
        tokens: [playerNoteToken, illusionEditToken, itemDetailToken, lootBagToken, shopToken],
        playerAvatars: [],
        playerNoteTokenId: 11,
        illusionEditTokenId: 12,
        itemDetailTokenId: 13,
        lootBagTokenId: 14,
        shopTokenModalId: 15,
      }),
    );

    expect(result.current.playerNoteToken).toBe(playerNoteToken);
    expect(result.current.illusionEditToken).toBe(illusionEditToken);
    expect(result.current.itemDetailToken).toBe(itemDetailToken);
    expect(result.current.lootBagToken).toBe(lootBagToken);
    expect(result.current.shopToken).toBe(shopToken);
  });
});
