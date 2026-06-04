import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { publishAppEvent } from "../../app/events/appEventBus";
import { useMapMovementRuntimeController } from "../../app/components/map/hooks/useMapMovementRuntimeController";
import type { Token } from "../../app/components/map/types/TacticalMapTypes";

vi.mock("../../app/events/appEventBus", () => ({
  publishAppEvent: vi.fn(),
  subscribeAppEvent: vi.fn(() => () => {}),
}));

function createToken(overrides: Partial<Token>): Token {
  return {
    id: 1,
    campaign_id: 7,
    map_url: "/maps/test-map.png",
    position_x: 0,
    position_y: 0,
    token_size: "1x1",
    ...overrides,
  } as Token;
}

describe("useMapMovementRuntimeController", () => {
  it("opens the move confirm modal when a combat move exceeds speed", async () => {
    const setMoveConfirmModal = vi.fn();
    const clearSelectionContextMenu = vi.fn();

    const { result } = renderHook(() =>
      useMapMovementRuntimeController({
        authedFetch: vi.fn() as any,
        campaignId: "7",
        currentMapUrl: "/maps/test-map.png",
        gridUnitLength: 5,
        combatActiveTokenId: 9,
        moveConfirmModal: null,
        tokens: [createToken({ id: 7, instance_name: "牧师" })],
        sourceCharacterData: null,
        showToast: vi.fn(),
        sendMessage: vi.fn(),
        setTokens: vi.fn(),
        setMoveConfirmModal,
        setSourceCharacterData: vi.fn(),
        clearSelectionContextMenu,
        getTokenMovementSpeed: () => 30,
      }),
    );

    await act(async () => {
      await result.current.handleSelectionMoveTo(8, 0, 7);
    });

    expect(clearSelectionContextMenu).toHaveBeenCalled();
    expect(setMoveConfirmModal).toHaveBeenCalledWith(
      expect.objectContaining({
        show: true,
        distanceFeet: 40,
        movementSpeed: 30,
        sourceName: "牧师",
        moveData: expect.objectContaining({
          gridX: 8,
          gridY: 0,
          sourceTokenId: 7,
        }),
      }),
    );
  });

  it("auto-settles zone spells after right-click movement in non-combat", async () => {
    const authedFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ spell_name: "蛛网术", target_results: [{ target_name: "游侠" }] }),
      } as Response);

    const zoneCaster = createToken({
      id: 20,
      position_x: 4,
      position_y: 4,
      concentration_spell: {
        spell_id: "web",
        area_effect: {
          map_url: "/maps/test-map.png",
          shape: "cube",
          center_x: 6.5,
          center_y: 6.5,
          radius: 20,
        },
      } as any,
    });
    const movedToken = createToken({
      id: 7,
      character_name: "游侠",
      position_x: 1,
      position_y: 1,
    });

    const { result } = renderHook(() =>
      useMapMovementRuntimeController({
        authedFetch: authedFetch as any,
        campaignId: "7",
        currentMapUrl: "/maps/test-map.png",
        gridUnitLength: 5,
        combatActiveTokenId: null,
        moveConfirmModal: null,
        tokens: [zoneCaster, movedToken],
        sourceCharacterData: null,
        showToast: vi.fn(),
        sendMessage: vi.fn(),
        setTokens: vi.fn(),
        setMoveConfirmModal: vi.fn(),
        setSourceCharacterData: vi.fn(),
        clearSelectionContextMenu: vi.fn(),
        getTokenMovementSpeed: () => 30,
      }),
    );

    await act(async () => {
      await result.current.handleSelectionMoveTo(6, 6, 7);
    });

    expect(authedFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/api/combat/zone-spell-settle"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"timing":"enter"'),
      }),
    );
    expect(publishAppEvent).toHaveBeenCalledWith(
      "combatMoveResult",
      expect.objectContaining({ tokenId: 7, toX: 6, toY: 6 }),
    );
  });
});
