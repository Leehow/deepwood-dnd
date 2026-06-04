import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { publishAppEvent, subscribeAppEvent } from "~/events/appEventBus";

import { useMapTokenDragController } from "../../app/components/map/hooks/useMapTokenDragController";
import type { Token } from "../../app/components/map/types/TacticalMapTypes";

const apiClientMocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock("~/utils/api-client", () => ({
  apiFetch: apiClientMocks.apiFetch,
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

function createHookArgs(
  overrides: Partial<Parameters<typeof useMapTokenDragController>[0]> = {},
) {
  return {
    campaignId: "7",
    currentMapUrl: null,
    userId: "player-1",
    isDM: false,
    gridUnitLength: 5,
    tokens: [] as Token[],
    setTokens: vi.fn(),
    ...overrides,
  };
}

describe("useMapTokenDragController", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    apiClientMocks.apiFetch.mockReset();
    delete (window as any).__combatIsActive;
    delete (window as any).__combatParticipantTokenIds;
    delete (window as any).__combatMovementRemaining;
  });

  it("publishes movement usage through the app event bus after a successful drag", async () => {
    const movedToken = createToken({
      id: 11,
      position_x: 1,
      position_y: 1,
    });
    apiClientMocks.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    const args = createHookArgs({
      tokens: [movedToken],
    });

    const movementHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("combatActionUsed", movementHandler);
    const { result } = renderHook(() => useMapTokenDragController(args));

    await act(async () => {
      await result.current.handleTokenDragEnd(11, {
        target: {
          x: () => 150,
          y: () => 50,
        },
      });
    });

    await waitFor(() => {
      expect(movementHandler).toHaveBeenCalledWith({
        type: "movement",
        amount: 15,
        tokenId: 11,
      });
    });

    expect(args.setTokens).toHaveBeenCalled();
    unsubscribe();
  });

  it("snaps tokens back when combat movement exceeds remaining speed", async () => {
    (window as any).__combatIsActive = true;
    (window as any).__combatParticipantTokenIds = [11];
    (window as any).__combatMovementRemaining = 5;

    const movedToken = createToken({
      id: 11,
      position_x: 1,
      position_y: 1,
    });
    const target = {
      x: vi.fn(() => 150),
      y: vi.fn(() => 50),
    };

    const args = createHookArgs({
      tokens: [movedToken],
    });
    const toastSpy = vi.spyOn(window, "dispatchEvent");
    const { result } = renderHook(() => useMapTokenDragController(args));

    await act(async () => {
      await result.current.handleTokenDragEnd(11, { target });
    });

    expect(target.x).toHaveBeenCalledWith(40);
    expect(target.y).toHaveBeenCalledWith(40);
    expect(args.setTokens).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "showToast",
      }),
    );

    toastSpy.mockRestore();
  });

  it("checks zone effects when token performed action events arrive through the typed bus", async () => {
    apiClientMocks.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ spell_name: "灵体武器", target_results: [{ target_name: "食尸鬼" }] }),
    } as Response);

    const zoneCaster = createToken({
      id: 20,
      position_x: 1,
      position_y: 1,
      concentration_spell: {
        spell_id: "spiritual_weapon",
        area_effect: {
          map_url: "map://active",
          shape: "sphere",
          center_x: 1.5,
          center_y: 1.5,
          radius: 10,
        },
      } as any,
    });
    const targetToken = createToken({
      id: 11,
      position_x: 1,
      position_y: 1,
    });

    const args = createHookArgs({
      currentMapUrl: "map://active",
      isDM: true,
      tokens: [zoneCaster, targetToken],
    });

    renderHook(() => useMapTokenDragController(args));

    await act(async () => {
      publishAppEvent("tokenPerformedAction", { tokenId: 11 });
    });

    await waitFor(() => {
      expect(apiClientMocks.apiFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/combat/zone-spell-settle"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"timing":"start_turn"'),
        }),
      );
    });
  });

  it("checks zone effects when combat turn started events arrive through the typed bus", async () => {
    apiClientMocks.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ spell_name: "灵体武器", target_results: [{ target_name: "食尸鬼" }] }),
    } as Response);

    const zoneCaster = createToken({
      id: 20,
      position_x: 1,
      position_y: 1,
      concentration_spell: {
        spell_id: "spiritual_weapon",
        area_effect: {
          map_url: "map://active",
          shape: "sphere",
          center_x: 1.5,
          center_y: 1.5,
          radius: 10,
        },
      } as any,
    });
    const targetToken = createToken({
      id: 11,
      position_x: 1,
      position_y: 1,
    });

    const args = createHookArgs({
      currentMapUrl: "map://active",
      isDM: true,
      tokens: [zoneCaster, targetToken],
    });

    renderHook(() => useMapTokenDragController(args));

    await act(async () => {
      publishAppEvent("combatTurnStarted", { tokenId: 11, round: 3 });
    });

    await waitFor(() => {
      expect(apiClientMocks.apiFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/combat/zone-spell-settle"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"timing":"start_turn"'),
        }),
      );
    });
  });

  it("checks zone effects when combat turn ending events arrive through the typed bus", async () => {
    apiClientMocks.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ spell_name: "油腻术", target_results: [{ target_name: "食尸鬼" }] }),
    } as Response);

    const zoneCaster = createToken({
      id: 20,
      position_x: 1,
      position_y: 1,
      active_effects: [
        {
          spell_buff: true,
          spell_id: "grease",
          area_effect: {
            map_url: "map://active",
            shape: "cube",
            center_x: 1.5,
            center_y: 1.5,
            radius: 10,
          },
        },
      ] as any,
    });
    const targetToken = createToken({
      id: 11,
      position_x: 1,
      position_y: 1,
    });

    const args = createHookArgs({
      currentMapUrl: "map://active",
      isDM: true,
      tokens: [zoneCaster, targetToken],
    });

    renderHook(() => useMapTokenDragController(args));

    await act(async () => {
      publishAppEvent("combatTurnEnding", { tokenId: 11, round: 3 });
    });

    await waitFor(() => {
      expect(apiClientMocks.apiFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/combat/zone-spell-settle"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"timing":"end_turn"'),
        }),
      );
    });
  });
});
