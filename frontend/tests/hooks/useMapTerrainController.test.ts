import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TerrainData } from "../../app/components/map/TerrainManager";
import { useMapTerrainController } from "../../app/components/map/hooks/useMapTerrainController";

function createTerrainData(): TerrainData {
  return {
    mapUrl: "map://default",
    cells: [{ x: 1, y: 2, type: "difficult", properties: { source: "manual" } }],
  };
}

describe("useMapTerrainController", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("updates terrain immediately and persists it after the debounce", async () => {
    vi.useFakeTimers();
    const setTerrainData = vi.fn();
    const authedFetch = vi.fn(async () => ({ ok: true } as Response));
    const sendMessage = vi.fn();

    const { result } = renderHook(() =>
      useMapTerrainController({
        campaignId: "7",
        isDM: true,
        currentMapUrl: "map://default",
        authedFetch,
        sendMessage,
        setTerrainData,
      }),
    );

    const terrainData = createTerrainData();

    act(() => {
      result.current.handleTerrainUpdate(terrainData);
    });

    expect(setTerrainData).toHaveBeenCalledWith(terrainData);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(authedFetch).toHaveBeenCalledWith(
      "/api/campaigns/7/terrain",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify(terrainData),
      }),
    );
    expect(sendMessage).toHaveBeenCalledWith({
      type: "terrain_update",
      data: {
        terrain_data: terrainData,
        map_url: "map://default",
      },
    });
  });

  it("keeps local terrain updates but skips persistence when the user is not the DM", async () => {
    vi.useFakeTimers();
    const setTerrainData = vi.fn();
    const authedFetch = vi.fn();
    const sendMessage = vi.fn();

    const { result } = renderHook(() =>
      useMapTerrainController({
        campaignId: "7",
        isDM: false,
        currentMapUrl: "map://default",
        authedFetch,
        sendMessage,
        setTerrainData,
      }),
    );

    act(() => {
      result.current.handleTerrainUpdate(createTerrainData());
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(setTerrainData).toHaveBeenCalled();
    expect(authedFetch).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
