import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useMapMarkerController } from "../../app/components/map/hooks/useMapMarkerController";

function okJson(data: any): Response {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

describe("useMapMarkerController", () => {
  it("toggles marker selection for the DM", () => {
    const { result } = renderHook(() =>
      useMapMarkerController({
        isDM: true,
        campaignId: "7",
        currentMapUrl: "map://default",
        markerIcon: "📍",
        markerColor: "#ff0",
        authedFetch: vi.fn(),
        setMarkers: vi.fn(),
        showToast: vi.fn(),
      }),
    );

    act(() => {
      result.current.handleMarkerClick({ id: 8 });
    });
    expect(result.current.selectedMarkerId).toBe(8);

    act(() => {
      result.current.handleMarkerClick({ id: 8 });
    });
    expect(result.current.selectedMarkerId).toBeNull();
  });

  it("creates a marker and clears dialog state", async () => {
    const setMarkers = vi.fn();
    const showToast = vi.fn();

    const { result } = renderHook(() =>
      useMapMarkerController({
        isDM: true,
        campaignId: "7",
        currentMapUrl: "map://default",
        markerIcon: "📍",
        markerColor: "#ff0",
        authedFetch: vi.fn(async () => okJson({ id: 9, label: "Ambush" })),
        setMarkers,
        showToast,
      }),
    );

    act(() => {
      result.current.setPendingMarkerPos({ x: 2, y: 3 });
      result.current.setMarkerLabelInput("Ambush");
      result.current.setShowMarkerDialog(true);
    });

    await act(async () => {
      await result.current.handleCreateMarker();
    });

    expect(setMarkers).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('标记 "Ambush" 已创建', "success");
    expect(result.current.showMarkerDialog).toBe(false);
    expect(result.current.pendingMarkerPos).toBeNull();
    expect(result.current.markerLabelInput).toBe("");
  });

  it("deletes the selected marker and clears the selection", async () => {
    const setMarkers = vi.fn();
    const showToast = vi.fn();

    const { result } = renderHook(() =>
      useMapMarkerController({
        isDM: true,
        campaignId: "7",
        currentMapUrl: "map://default",
        markerIcon: "📍",
        markerColor: "#ff0",
        authedFetch: vi.fn(async () => ({ ok: true } as Response)),
        setMarkers,
        showToast,
      }),
    );

    act(() => {
      result.current.setSelectedMarkerId(9);
    });

    await act(async () => {
      await result.current.handleDeleteMarker();
    });

    expect(setMarkers).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("标记已删除", "success");
    expect(result.current.selectedMarkerId).toBeNull();
  });
});
