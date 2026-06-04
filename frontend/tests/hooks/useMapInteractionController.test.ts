import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publishAppEvent } from "~/events/appEventBus";

import { useMapInteractionController } from "../../app/components/map/hooks/useMapInteractionController";
import type { Position, Token } from "../../app/components/map/types/TacticalMapTypes";

const cacheMocks = vi.hoisted(() => ({
  fetchCampaignMonsterInstancesCached: vi.fn(),
  fetchCampaignShopsCached: vi.fn(),
}));

vi.mock("~/utils/campaignMonsterInstancesCache", () => ({
  fetchCampaignMonsterInstancesCached: cacheMocks.fetchCampaignMonsterInstancesCached,
}));

vi.mock("~/utils/campaignShopsCache", () => ({
  fetchCampaignShopsCached: cacheMocks.fetchCampaignShopsCached,
}));

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

function createContainer() {
  const element = document.createElement("div");
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    top: 0,
    right: 800,
    bottom: 600,
    left: 0,
    toJSON: () => ({}),
  });
  document.body.appendChild(element);
  return element;
}

function okJson(data: any): Response {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

describe("useMapInteractionController", () => {
  beforeEach(() => {
    cacheMocks.fetchCampaignMonsterInstancesCached.mockReset();
    cacheMocks.fetchCampaignShopsCached.mockReset();
    cacheMocks.fetchCampaignMonsterInstancesCached.mockResolvedValue([]);
    cacheMocks.fetchCampaignShopsCached.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("opens DM selection context menus and loads target chest plus source character data", async () => {
    const container = createContainer();
    const setSourceCharacterData = vi.fn();
    const setSourceMonsterData = vi.fn();
    const authedFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/chests/99") {
        return okJson({
          is_locked: true,
          lock_dc: 15,
          state: "closed",
          is_trapped: true,
          trap_detected: false,
        });
      }
      if (url === "/api/characters/101/sheet") {
        return okJson({
          character: {
            id: 101,
            name: "Sir Rowan",
            abilities: { strength: 16 },
            level: 5,
            race_id: "human",
            subrace_id: null,
            class_id: "fighter",
            subclass_id: "battle_master",
            equipment: [],
            selected_cantrips: [],
            prepared_spells: [],
            spell_slots_state: {},
            fighting_style: "defense",
            feats: ["sentinel"],
            class_feature_uses: { action_surge: 1 },
            status_effects: [],
          },
          actions: [{ id: "second_wind", uses: { max: 1 } }],
          maneuvers_data: [],
          derived: { speed: 30, fly_speed: 0 },
        });
      }
      return okJson({});
    });

    const { result, unmount } = renderHook(() =>
      useMapInteractionController({
        isDM: true,
        campaignId: "7",
        userId: "dm",
        selectedCharacterId: null,
        selectedTokenId: 1,
        tokens: [
          createToken({
            id: 1,
            character_id: 101,
            character_name: "Sir Rowan",
            position_x: 1,
            position_y: 1,
          }),
          createToken({
            id: 2,
            chest_id: 99 as any,
            position_x: 4,
            position_y: 5,
          }),
        ],
        controlledCharacterIds: new Set<number>(),
        containerRef: { current: container },
        stagePos: { x: 0, y: 0 },
        stageScale: 1,
        stagePosRef: { current: { x: 0, y: 0 } as Position },
        stageScaleRef: { current: 1 },
        authedFetch,
        getCharacterMovementData: () => ({ speed: 30, fly_speed: 0 }),
        showToast: vi.fn(),
        openTokenPanel: vi.fn(),
        areaSpellMode: null,
        hotbarTargeting: null,
        invokeDuplicityPlacementMode: null,
        manualReactionMode: null,
        sourceCharacterData: null,
        setSourceMonsterData,
        setSourceCharacterData,
      }),
    );

    act(() => {
      result.current.handleContextMenu({
        preventDefault: vi.fn(),
        clientX: 180,
        clientY: 220,
      });
    });

    await waitFor(() => {
      expect(result.current.selectionContextMenu).toEqual(
        expect.objectContaining({
          sourceToken: expect.objectContaining({ id: 1 }),
          targetToken: expect.objectContaining({ id: 2 }),
          targetGridPos: null,
        }),
      );
    });

    await waitFor(() => {
      expect(result.current.targetChestData).toEqual(
        expect.objectContaining({
          is_locked: true,
          lock_dc: 15,
          state: "closed",
        }),
      );
      expect(setSourceCharacterData).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 101,
          name: "Sir Rowan",
          speed: 30,
        }),
      );
    });

    unmount();
  });

  it("loads campaign items when the DM opens a ground context menu", async () => {
    const container = createContainer();
    const authedFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/items/campaign/7") {
        return okJson([
          {
            id: 30,
            name: "Potion of Healing",
            avatar_url: "/icons/potion.png",
          },
        ]);
      }
      return okJson({});
    });

    const { result, unmount } = renderHook(() =>
      useMapInteractionController({
        isDM: true,
        campaignId: "7",
        userId: "dm",
        selectedCharacterId: null,
        selectedTokenId: null,
        tokens: [],
        controlledCharacterIds: new Set<number>(),
        containerRef: { current: container },
        stagePos: { x: 0, y: 0 },
        stageScale: 1,
        stagePosRef: { current: { x: 0, y: 0 } as Position },
        stageScaleRef: { current: 1 },
        authedFetch,
        getCharacterMovementData: () => ({ speed: 30, fly_speed: 0 }),
        showToast: vi.fn(),
        openTokenPanel: vi.fn(),
        areaSpellMode: null,
        hotbarTargeting: null,
        invokeDuplicityPlacementMode: null,
        manualReactionMode: null,
        sourceCharacterData: null,
        setSourceMonsterData: vi.fn(),
        setSourceCharacterData: vi.fn(),
      }),
    );

    act(() => {
      result.current.handleContextMenu({
        preventDefault: vi.fn(),
        clientX: 80,
        clientY: 120,
      });
    });

    await waitFor(() => {
      expect(result.current.contextMenu).toEqual({
        x: 80,
        y: 120,
        gridX: 2,
        gridY: 3,
      });
      expect(result.current.campaignItems).toEqual([
        expect.objectContaining({
          id: 30,
          iconPath: "/icons/potion.png",
        }),
      ]);
    });

    unmount();
  });

  it("opens the DM mobile action modal after a long press on empty ground", async () => {
    vi.useFakeTimers();
    const container = createContainer();

    const { result, unmount } = renderHook(() =>
      useMapInteractionController({
        isDM: true,
        campaignId: "7",
        userId: "dm",
        selectedCharacterId: null,
        selectedTokenId: null,
        tokens: [],
        controlledCharacterIds: new Set<number>(),
        containerRef: { current: container },
        stagePos: { x: 0, y: 0 },
        stageScale: 1,
        stagePosRef: { current: { x: 0, y: 0 } as Position },
        stageScaleRef: { current: 1 },
        authedFetch: vi.fn(async () => okJson({})),
        getCharacterMovementData: () => ({ speed: 30, fly_speed: 0 }),
        showToast: vi.fn(),
        openTokenPanel: vi.fn(),
        areaSpellMode: null,
        hotbarTargeting: null,
        invokeDuplicityPlacementMode: null,
        manualReactionMode: null,
        sourceCharacterData: null,
        setSourceMonsterData: vi.fn(),
        setSourceCharacterData: vi.fn(),
      }),
    );

    act(() => {
      result.current.handleTouchStart({
        touches: [{ clientX: 80, clientY: 120 }],
      } as any);
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.longPressIndicator).toEqual({ x: 80, y: 120 });

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.mobileActionModal).toEqual({ gridX: 2, gridY: 3 });

    unmount();
  });

  it("opens shop and chest modals from global interaction events", async () => {
    const container = createContainer();
    const authedFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/shops/5") {
        return okJson({
          id: 5,
          name: "Arcane Bazaar",
          discount_rate: 0.75,
          accepts_selling: true,
        });
      }
      if (url === "/api/chests/7") {
        return okJson({
          id: 7,
          name: "Old Chest",
          is_locked: false,
        });
      }
      if (url === "/api/chests/11/open") {
        return okJson({ ok: true });
      }
      if (url === "/api/chests/11") {
        return okJson({
          id: 11,
          name: "Unlocked Chest",
          is_locked: false,
        });
      }
      return okJson({});
    });

    const { result, unmount } = renderHook(() =>
      useMapInteractionController({
        isDM: true,
        campaignId: "7",
        userId: "dm",
        selectedCharacterId: null,
        selectedTokenId: null,
        tokens: [],
        controlledCharacterIds: new Set<number>(),
        containerRef: { current: container },
        stagePos: { x: 0, y: 0 },
        stageScale: 1,
        stagePosRef: { current: { x: 0, y: 0 } as Position },
        stageScaleRef: { current: 1 },
        authedFetch,
        getCharacterMovementData: () => ({ speed: 30, fly_speed: 0 }),
        showToast: vi.fn(),
        openTokenPanel: vi.fn(),
        areaSpellMode: null,
        hotbarTargeting: null,
        invokeDuplicityPlacementMode: null,
        manualReactionMode: null,
        sourceCharacterData: null,
        setSourceMonsterData: vi.fn(),
        setSourceCharacterData: vi.fn(),
      }),
    );

    act(() => {
      publishAppEvent("openShopTransaction", {
        shopId: 5,
        tokenId: 77,
      });
      publishAppEvent("openShopTokenModal", {
        tokenId: 88,
      });
      publishAppEvent("openChestInteraction", {
        chestId: 7,
      });
      publishAppEvent("openChestManagement", {
        chestId: 7,
      });
      publishAppEvent("chestOpen", {
        chestId: 11,
        characterId: 301,
      });
    });

    await waitFor(() => {
      expect(result.current.shopTxnOpen).toBe(true);
      expect(result.current.shopTxnShop).toEqual(
        expect.objectContaining({
          id: 5,
          name: "Arcane Bazaar",
        }),
      );
      expect(result.current.shopTxnTokenId).toBe(77);
      expect(result.current.shopTokenModalId).toBe(88);
      expect(result.current.chestModalOpen).toBe(true);
      expect(result.current.chestManageModalOpen).toBe(true);
      expect(result.current.chestManageChest).toEqual(
        expect.objectContaining({ id: 7, name: "Old Chest" }),
      );
      expect(result.current.chestModalChest).toEqual(
        expect.objectContaining({ id: 11, name: "Unlocked Chest" }),
      );
    });

    expect(authedFetch).toHaveBeenCalledWith("/api/chests/11/open", expect.objectContaining({
      method: "POST",
    }));

    unmount();
  });
});
