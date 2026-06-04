import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMapSelectionActionController } from "../../app/components/map/hooks/useMapSelectionActionController";
import type { Token } from "../../app/components/map/types/TacticalMapTypes";

const publishAppEventMock = vi.fn();

vi.mock("../../app/events/appEventBus", () => ({
  publishAppEvent: (...args: any[]) => publishAppEventMock(...args),
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

describe("useMapSelectionActionController", () => {
  beforeEach(() => {
    publishAppEventMock.mockReset();
  });

  it("applies dodge and broadcasts the action", async () => {
    const authedFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    const setTokenStatusEffects = vi.fn();
    const sendMessage = vi.fn();
    const clearSelectionContextMenu = vi.fn();
    const showToast = vi.fn();

    const { result } = renderHook(() =>
      useMapSelectionActionController({
        authedFetch: authedFetch as any,
        campaignId: "7",
        userId: "user-1",
        isDM: true,
        tokens: [createToken({ id: 9, instance_name: "战士" })],
        tokenStatusEffects: {},
        sourceCharacterData: null,
        showToast,
        sendMessage,
        setTokenStatusEffects,
        setTokens: vi.fn(),
        clearSelectionContextMenu,
      }),
    );

    await act(async () => {
      await result.current.handleSelectionStandardAction("dodge", 9);
    });

    expect(setTokenStatusEffects).toHaveBeenCalledWith(expect.any(Function));
    const updater = setTokenStatusEffects.mock.calls[0][0];
    expect(updater({})).toEqual({
      9: [
        expect.objectContaining({
          id: "dodge",
          name: "回避",
          duration: 1,
        }),
      ],
    });
    expect(authedFetch).toHaveBeenCalledWith(
      "/api/tokens/9/active-effects",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "chat",
      }),
    );
    expect(publishAppEventMock).toHaveBeenCalledWith("combatActionUsed", { type: "action" });
    expect(showToast).toHaveBeenCalledWith("战士 采取回避动作", "info");
    expect(clearSelectionContextMenu).toHaveBeenCalled();
  });
});
