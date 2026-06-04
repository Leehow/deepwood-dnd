import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useMapInventoryAndPlacementController } from "../../app/components/map/hooks/useMapInventoryAndPlacementController";

vi.mock("../../app/events/appEventBus", () => ({
  publishAppEvent: vi.fn(),
}));

describe("useMapInventoryAndPlacementController", () => {
  it("places an item token onto the current map", async () => {
    const setTokens = vi.fn();
    const showToast = vi.fn();
    const newToken = {
      id: 55,
      position_x: 3,
      position_y: 4,
      item_data: { id: "potion", name: "治疗药水" },
    };

    const authedFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => newToken,
    } as Response);

    const { result } = renderHook(() =>
      useMapInventoryAndPlacementController({
        authedFetch: authedFetch as any,
        campaignId: "7",
        currentMapUrl: "/maps/test-map.png",
        userId: "user-1",
        isDM: true,
        contextMenu: { gridX: 3, gridY: 4 } as any,
        mobileActionModal: null,
        tokens: [],
        campaignItems: [],
        sourceCharacterData: null,
        setSourceCharacterData: vi.fn(),
        sendMessage: vi.fn(),
        setTokens,
        showToast,
      }),
    );

    await act(async () => {
      await result.current.handlePlaceItem("potion", "治疗药水", "/icon.png");
    });

    expect(authedFetch).toHaveBeenCalledWith(
      "/api/tokens/",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(setTokens).toHaveBeenCalledWith(expect.any(Function));
    const updater = setTokens.mock.calls[0][0];
    expect(updater([])).toEqual([newToken]);
    expect(showToast).toHaveBeenCalledWith("已放置 治疗药水", "success");
  });
});
