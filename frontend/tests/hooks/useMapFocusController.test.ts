import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMapFocusController } from "../../app/components/map/hooks/useMapFocusController";
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

describe("useMapFocusController", () => {
  afterEach(() => {
    delete (window as any).__focusMyToken;
    delete (window as any).__jumpToAnchor;
    delete (window as any).__clearAnchor;
    delete (window as any).__focusToken;
    delete (window as any).__focusAllPlayers;
    delete (window as any).__selectToken;
  });

  it("centers the viewport when focusing a token", () => {
    const setStagePos = vi.fn();

    const { result } = renderHook(() =>
      useMapFocusController({
        authedFetch: vi.fn(),
        campaignId: "7",
        currentMapUrl: "map://default",
        userId: "u1",
        isDM: false,
        selectedCharacterId: 9,
        tokens: [],
        anchorPosition: null,
        stagePos: { x: 0, y: 0 },
        stageScale: 2,
        stageSize: { width: 800, height: 600 },
        setAnchorPosition: vi.fn(),
        setStagePos,
        setStageScale: vi.fn(),
        setSelectedTokenId: vi.fn(),
        showToast: vi.fn(),
        sendMessage: vi.fn(),
        handleExternalTokenSelect: vi.fn(),
      }),
    );

    act(() => {
      result.current.focusToken(42, { x: 3, y: 4 });
    });

    expect(setStagePos).toHaveBeenCalledWith({ x: 120, y: -60 });
  });

  it("focuses and selects the token when the DM clicks an avatar", async () => {
    const setStagePos = vi.fn();
    const setSelectedTokenId = vi.fn();
    const showToast = vi.fn();
    const token = createToken({
      id: 22,
      character_id: 101,
      character_name: "Rowan",
      position_x: 5,
      position_y: 6,
    });

    const { result } = renderHook(() =>
      useMapFocusController({
        authedFetch: vi.fn(),
        campaignId: "7",
        currentMapUrl: "map://default",
        userId: "dm",
        isDM: true,
        selectedCharacterId: null,
        tokens: [token],
        anchorPosition: null,
        stagePos: { x: 0, y: 0 },
        stageScale: 1,
        stageSize: { width: 800, height: 600 },
        setAnchorPosition: vi.fn(),
        setStagePos,
        setStageScale: vi.fn(),
        setSelectedTokenId,
        showToast,
        sendMessage: vi.fn(),
        handleExternalTokenSelect: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleAvatarClick(101);
    });

    expect(setSelectedTokenId).toHaveBeenCalledWith(22);
    expect(showToast).toHaveBeenCalledWith("已定位到 Rowan", "success");
    expect(setStagePos).toHaveBeenCalledWith({ x: 180, y: 40 });
  });
});
