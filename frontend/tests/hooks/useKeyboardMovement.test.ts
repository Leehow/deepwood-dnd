import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { publishAppEvent } from "../../app/events/appEventBus";
import { useKeyboardMovement } from "../../app/components/map/hooks/useKeyboardMovement";
import type { Token } from "../../app/components/map/types/TacticalMapTypes";

const apiClientMocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock("~/utils/api-client", () => ({
  apiFetch: apiClientMocks.apiFetch,
}));

vi.mock("../../app/events/appEventBus", () => ({
  publishAppEvent: vi.fn(),
}));

function createToken(overrides: Partial<Token>): Token {
  return {
    id: 1,
    campaign_id: 7,
    map_url: "/maps/test-map.png",
    position_x: 0,
    position_y: 0,
    token_size: "1x1",
    character_id: 42,
    ...overrides,
  } as Token;
}

describe("useKeyboardMovement", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    apiClientMocks.apiFetch.mockReset();
    delete (window as any).__combatIsActive;
    delete (window as any).__combatParticipantTokenIds;
    delete (window as any).__combatMovementRemaining;
    delete (window as any).__combatTurnUserId;
    delete (window as any).__combatActiveTokenId;
  });

  it("auto-settles zone spells after keyboard movement into a zone", async () => {
    apiClientMocks.apiFetch
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ spell_name: "蛛网术", target_results: [{ target_name: "游侠" }] }),
      } as Response);

    const zoneCaster = createToken({
      id: 20,
      character_id: undefined,
      position_x: 4,
      position_y: 4,
      concentration_spell: {
        spell_id: "web",
        area_effect: {
          map_url: "/maps/test-map.png",
          shape: "cube",
          center_x: 1.5,
          center_y: 0.5,
          radius: 20,
        },
      } as any,
    });
    const playerToken = createToken({
      id: 7,
      character_id: 42,
      position_x: 0,
      position_y: 0,
    });

    renderHook(() =>
      useKeyboardMovement({
        campaignId: "7",
        currentMapUrl: "/maps/test-map.png",
        tokens: [zoneCaster, playerToken],
        setTokens: vi.fn(),
        userId: "player-1",
        selectedCharacterId: 42,
        isDM: false,
        gridUnitLength: 5,
        mapImage: null,
        mapImageScale: 1,
      }),
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));

    await waitFor(() => {
      expect(apiClientMocks.apiFetch).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("/api/combat/zone-spell-settle"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"timing":"enter"'),
        }),
      );
    });

    expect(publishAppEvent).toHaveBeenCalledWith(
      "combatActionUsed",
      expect.objectContaining({ amount: 5 }),
    );
  });
});
