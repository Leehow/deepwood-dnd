import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { subscribeAppEvent } from "~/events/appEventBus";

import { useMapInventoryController } from "../../app/components/map/hooks/useMapInventoryController";
import type { Token } from "../../app/components/map/types/TacticalMapTypes";

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

function okJson(data: any): Response {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

function createHookArgs(
  overrides: Partial<Parameters<typeof useMapInventoryController>[0]> = {},
) {
  return {
    authedFetch: vi.fn(),
    tokens: [] as Token[],
    userId: "u1",
    selectedCharacterId: null,
    setTokens: vi.fn(),
    setLootBagTokenId: vi.fn(),
    showToast: vi.fn(),
    ...overrides,
  };
}

describe("useMapInventoryController", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("picks up currency tokens and publishes equipment refresh", async () => {
    const currencyToken = createToken({
      id: 11,
      item_quantity: 3,
      item_data: {
        name: "金币",
        currencyType: "gp",
      } as any,
    });
    const authedFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/characters?user_id=u1") {
        return okJson([{ id: 42 }]);
      }
      if (url === "/api/characters/42" && !init?.method) {
        return okJson({
          id: 42,
          currency: { gp: 1, sp: 0, cp: 0, ep: 0, pp: 0 },
          equipment: [],
        });
      }
      return okJson({});
    });

    const args = createHookArgs({
      authedFetch,
      tokens: [currencyToken],
    });
    const equipmentHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("characterEquipmentUpdated", equipmentHandler);
    const { result } = renderHook(() => useMapInventoryController(args));

    await act(async () => {
      await result.current.handlePickupItem(11);
    });

    await waitFor(() => {
      expect(equipmentHandler).toHaveBeenCalledWith({ characterId: 42 });
    });
    expect(args.setTokens).toHaveBeenCalled();
    expect(args.showToast).toHaveBeenCalledWith("已捡起 金币 ×3", "success");

    unsubscribe();
  });

  it("removes empty loot bags and refreshes character equipment state", async () => {
    const authedFetch = vi.fn(async () =>
      okJson({
        bag_empty: true,
      }),
    );

    const args = createHookArgs({
      authedFetch,
      tokens: [createToken({ id: 21, loot_bag_data: { items: [], currency: {} } as any })],
    });
    const equipmentHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("characterEquipmentUpdated", equipmentHandler);
    const { result } = renderHook(() => useMapInventoryController(args));

    await act(async () => {
      await result.current.handleLootFromBag(21, 501, null, true);
    });

    expect(args.setTokens).toHaveBeenCalled();
    expect(args.setLootBagTokenId).toHaveBeenCalledWith(null);
    expect(args.showToast).toHaveBeenCalledWith("战利品已全部拾取", "success");
    await waitFor(() => {
      expect(equipmentHandler).toHaveBeenCalledWith({ characterId: 501 });
    });

    unsubscribe();
  });
});
