import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { publishAppEvent } from "../../app/events/appEventBus";
import { useMapCombatRuntimeController } from "../../app/components/map/hooks/useMapCombatRuntimeController";
import { fetchCampaignCombatStateCached } from "../../app/utils/combatStateCache";

vi.mock("../../app/utils/combatStateCache", () => ({
  fetchCampaignCombatStateCached: vi.fn(),
}));

describe("useMapCombatRuntimeController", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tracks manual reaction mode and clears it after the reaction is consumed", async () => {
    vi.mocked(fetchCampaignCombatStateCached).mockResolvedValue(null as any);
    const showToast = vi.fn();
    const changedListener = vi.fn();
    const startListener = vi.fn();
    window.addEventListener("manualReactionModeChanged", changedListener as EventListener);
    window.addEventListener("manualReactionModeStart", startListener as EventListener);

    const { result, unmount } = renderHook(() =>
      useMapCombatRuntimeController({
        campaignId: "7",
        userId: "dm",
        showToast,
      }),
    );

    act(() => {
      publishAppEvent("manualReactionModeStart", {
        sourceTokenId: 18,
        sourceCharacterId: 101,
      });
    });

    expect(result.current.manualReactionMode).toEqual({
      sourceTokenId: 18,
      sourceCharacterId: 101,
    });
    expect(showToast).toHaveBeenCalledWith(
      "反应行动模式已开启，右键地图目标以选择反应。",
      "info",
    );

    act(() => {
      publishAppEvent("combatReactionUsed", {
        reactor_token_id: 18,
      } as any);
    });

    await waitFor(() => {
      expect(result.current.manualReactionMode).toBeNull();
    });

    const startEvent = startListener.mock.calls.at(-1)?.[0] as CustomEvent | undefined;
    expect(startEvent?.detail).toEqual({
      sourceTokenId: 18,
      sourceCharacterId: 101,
    });

    const lastEvent = changedListener.mock.calls.at(-1)?.[0] as CustomEvent | undefined;
    expect(lastEvent?.detail).toEqual({
      active: false,
      sourceTokenId: undefined,
    });

    unmount();
    window.removeEventListener("manualReactionModeStart", startListener as EventListener);
    window.removeEventListener("manualReactionModeChanged", changedListener as EventListener);
  });

  it("loads and updates the active combat token from storage events", async () => {
    vi.mocked(fetchCampaignCombatStateCached).mockResolvedValue({
      is_active: true,
      data: {
        status: "in_progress",
        order: [11, 22, 33],
        current_index: 1,
      },
    } as any);

    const { result } = renderHook(() =>
      useMapCombatRuntimeController({
        campaignId: "7",
        userId: "dm",
        showToast: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.combatActiveTokenId).toBe(22);
    });

    act(() => {
      publishAppEvent("combatStorageUpdated", {
        object_type: "combat",
        object_id: "current",
        is_active: true,
        data: {
          status: "in_progress",
          order: [44, 55],
          current_index: 0,
        },
      });
    });

    await waitFor(() => {
      expect(result.current.combatActiveTokenId).toBe(44);
    });

    act(() => {
      publishAppEvent("combatStorageDeleted", {
        data: { object_type: "combat" },
      });
    });

    await waitFor(() => {
      expect(result.current.combatActiveTokenId).toBeNull();
    });
  });
});
