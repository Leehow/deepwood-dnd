import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Token } from "../../app/components/map/types/TacticalMapTypes";
import {
  resolveTokenOpenAction,
  useMapTokenInteractionController,
} from "../../app/components/map/hooks/useMapTokenInteractionController";

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

function createHookArgs(overrides: Partial<Parameters<typeof useMapTokenInteractionController>[0]> = {}) {
  return {
    isDM: true,
    userId: "dm",
    selectedCharacterId: null,
    selectedTool: "token",
    tokenMode: "place" as const,
    tokens: [] as Token[],
    longPressTriggeredRef: { current: false },
    setSelectedTokenId: vi.fn(),
    clearInteractionMenus: vi.fn(),
    loadSourceTokenData: vi.fn(async () => {}),
    fetchCompanionData: vi.fn(),
    setCompanionMonsterDataMap: vi.fn(),
    setSourceMonsterData: vi.fn(),
    setSourceCharacterData: vi.fn(),
    handleTargetingTokenSelection: vi.fn(() => false),
    handleRemoveToken: vi.fn(),
    setItemDetailTokenId: vi.fn(),
    setIllusionEditTokenId: vi.fn(),
    setLootBagTokenId: vi.fn(),
    openTokenPanel: vi.fn(),
    setActiveTokenId: vi.fn(),
    setPlayerNoteTokenId: vi.fn(),
    ...overrides,
  };
}

describe("useMapTokenInteractionController", () => {
  it("resolves token open actions for DM deletion, player ownership, disguise illusions, and shop/item tokens", () => {
    const hero = createToken({
      id: 10,
      character_id: 501,
      user_id: "u1",
    });
    const disguised = createToken({
      id: 20,
      disguise_data: {
        caster_character_id: 501,
        spell_id: "major_image",
      } as any,
    });
    const caster = createToken({
      id: 30,
      character_id: 501,
      user_id: "u1",
      concentration_spell: {
        malleable: true,
      } as any,
    });
    const itemToken = createToken({
      id: 40,
      item_data: {
        type: "weapon",
      } as any,
    });
    const shopToken = createToken({
      id: 41,
      shop_id: 77 as any,
    });

    expect(
      resolveTokenOpenAction({
        token: hero,
        tokens: [hero],
        isDM: true,
        selectedTool: "token",
        tokenMode: "delete",
      }),
    ).toEqual({ type: "remove-token", tokenId: 10 });

    expect(
      resolveTokenOpenAction({
        token: hero,
        tokens: [hero],
        isDM: false,
        userId: "u1",
        selectedCharacterId: 501,
        selectedTool: "token",
        tokenMode: "place",
      }),
    ).toEqual({ type: "open-active-token", tokenId: 10 });

    expect(
      resolveTokenOpenAction({
        token: disguised,
        tokens: [disguised, caster],
        isDM: false,
        userId: "u1",
        selectedTool: "token",
        tokenMode: "place",
      }),
    ).toEqual({ type: "edit-illusion", tokenId: 20 });

    expect(
      resolveTokenOpenAction({
        token: itemToken,
        tokens: [itemToken],
        isDM: true,
        selectedTool: "token",
        tokenMode: "place",
      }),
    ).toEqual({ type: "open-item-detail", tokenId: 40 });

    expect(
      resolveTokenOpenAction({
        token: shopToken,
        tokens: [shopToken],
        isDM: true,
        selectedTool: "token",
        tokenMode: "place",
      }),
    ).toEqual({ type: "open-shop-token-modal", tokenId: 41 });
  });

  it("selects tokens by clearing menus and preloading source data", async () => {
    const hero = createToken({
      id: 11,
      character_id: 900,
      user_id: "u2",
    });
    const args = createHookArgs({
      isDM: true,
      tokens: [hero],
    });

    const { result } = renderHook(() => useMapTokenInteractionController(args));

    await act(async () => {
      result.current.handleTokenSelect(11);
    });

    expect(args.setSelectedTokenId).toHaveBeenCalledWith(11);
    expect(args.clearInteractionMenus).toHaveBeenCalled();
    expect(args.loadSourceTokenData).toHaveBeenCalledWith(hero);
  });

  it("opens chest interactions through the correct event path", () => {
    const chestToken = createToken({
      id: 44,
      chest_id: 7 as any,
    });
    const args = createHookArgs({
      isDM: false,
      userId: "p1",
      tokens: [chestToken],
    });

    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const { result } = renderHook(() => useMapTokenInteractionController(args));

    act(() => {
      result.current.handleTokenOpen(44);
    });

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "openChestInteraction",
        detail: { chestId: 7, tokenId: 44 },
      }),
    );

    dispatchSpy.mockRestore();
  });

  it("opens item detail and DM shop token modal through a single execution path", () => {
    const itemToken = createToken({
      id: 61,
      item_data: {
        type: "potion",
      } as any,
    });
    const shopToken = createToken({
      id: 62,
      shop_id: 14 as any,
    });
    const args = createHookArgs({
      isDM: true,
      tokens: [itemToken, shopToken],
    });

    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const { result } = renderHook(() => useMapTokenInteractionController(args));

    act(() => {
      result.current.handleTokenOpen(61);
      result.current.handleTokenOpen(62);
    });

    expect(args.setItemDetailTokenId).toHaveBeenCalledWith(61);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "openShopTokenModal",
        detail: { tokenId: 62 },
      }),
    );

    dispatchSpy.mockRestore();
  });

  it("opens illusion editing without falling through to the normal token click path", () => {
    const illusion = createToken({
      id: 51,
      item_data: {
        type: "illusion",
        caster_id: 900,
      } as any,
    });
    const caster = createToken({
      id: 52,
      character_id: 900,
      user_id: "u9",
    });
    const args = createHookArgs({
      isDM: false,
      userId: "u9",
      tokens: [illusion, caster],
    });

    const { result } = renderHook(() => useMapTokenInteractionController(args));

    act(() => {
      result.current.handleTokenOpen(51);
    });

    expect(args.setIllusionEditTokenId).toHaveBeenCalledWith(51);
    expect(args.setItemDetailTokenId).not.toHaveBeenCalled();
  });
});
