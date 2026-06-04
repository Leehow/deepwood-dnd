import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMapEvents } from "../../app/components/map/hooks/useMapEvents";
import type { Position, Token } from "../../app/components/map/types/TacticalMapTypes";

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

function createHookArgs(overrides: Partial<Parameters<typeof useMapEvents>[0]> = {}) {
  return {
    campaignId: "7",
    currentMapUrl: "map://default",
    userId: "dm",
    isDM: true,
    drawTool: null,
    setFogData: vi.fn(),
    setRulers: vi.fn(),
    setDrawings: vi.fn(),
    setTokens: vi.fn(),
    setEditingTokenId: vi.fn(),
    setEditingTokenHP: vi.fn(),
    setEditingTokenMaxHP: vi.fn(),
    setStagePos: vi.fn(),
    setStageScale: vi.fn(),
    tokens: [] as Token[],
    editingTokenId: null,
    editingTokenHP: 0,
    editingTokenMaxHP: null,
    stagePos: { x: 0, y: 0 } as Position,
    stageScale: 1,
    stageSize: { width: 800, height: 600 },
    stageRef: { current: { scaleX: () => 1, x: () => 0, y: () => 0, getPointerPosition: () => ({ x: 0, y: 0 }), container: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0 }) }) } },
    lastDist: { current: 0 },
    lastCenter: { current: { x: 0, y: 0 } },
    sendMessage: vi.fn(),
    ...overrides,
  };
}

describe("useMapEvents", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    apiClientMocks.apiFetch.mockReset();
  });

  it("persists HP updates and broadcasts live token HP sync", async () => {
    apiClientMocks.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    const token = createToken({
      id: 11,
      current_hp: 18 as any,
      max_hp: 30 as any,
      character_id: 501,
    });
    const args = createHookArgs({
      tokens: [token],
      editingTokenId: 11,
      editingTokenHP: 12,
    });

    const { result } = renderHook(() => useMapEvents(args));

    await act(async () => {
      await result.current.handleUpdateHP();
    });

    expect(args.setTokens).toHaveBeenCalled();
    expect(args.setEditingTokenId).toHaveBeenCalledWith(null);
    expect(args.sendMessage).toHaveBeenCalledWith({
      type: "token_hp_update",
      data: {
        token_id: 11,
        current_hp: 12,
        character_id: 501,
      },
    });
  });

  it("removes tokens after a successful delete", async () => {
    apiClientMocks.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    const args = createHookArgs({
      editingTokenId: 21,
      tokens: [createToken({ id: 21 })],
    });

    const { result } = renderHook(() => useMapEvents(args));

    await act(async () => {
      await result.current.handleRemoveToken();
    });

    expect(args.setTokens).toHaveBeenCalled();
    expect(args.setEditingTokenId).toHaveBeenCalledWith(null);
  });
});
