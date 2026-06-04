import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMapViewStateController } from "../../app/components/map/hooks/useMapViewStateController";

describe("useMapViewStateController", () => {
  afterEach(() => {
    delete (window as any).__getViewportCenterGridPosition;
    delete (window as any).__getCurrentMapUrl;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("exposes viewport helpers and resizes from the container bounds", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      width: 640,
      height: 480,
      top: 0,
      left: 0,
      right: 640,
      bottom: 480,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const setStageSize = vi.fn();

    const { unmount } = renderHook(() =>
      useMapViewStateController({
        containerRef: { current: container },
        stagePos: { x: 0, y: 0 },
        stageScale: 1,
        stageSize: { width: 200, height: 200 },
        setStageSize,
        minimapCollapsed: false,
        currentMapUrl: "map://default",
        campaignId: "7",
        userId: "u1",
        viewStateLoadedRef: { current: true },
        saveViewStateTimerRef: { current: null },
        authedFetch: vi.fn(async () => ({ ok: true } as Response)),
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(setStageSize).toHaveBeenCalledWith({ width: 640, height: 480 });
    expect((window as any).__getCurrentMapUrl()).toBe("map://default");
    expect((window as any).__getViewportCenterGridPosition()).toEqual({ x: 2, y: 2 });

    unmount();

    expect((window as any).__getCurrentMapUrl).toBeUndefined();
    expect((window as any).__getViewportCenterGridPosition).toBeUndefined();
  });

  it("persists and flushes the current map view state", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      width: 500,
      height: 400,
      top: 0,
      left: 0,
      right: 500,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const authedFetch = vi.fn(async () => ({ ok: true } as Response));
    let pagehideHandler: (() => void) | null = null;
    const originalAddEventListener = window.addEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation(
      ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
        if (type === "pagehide" && typeof listener === "function") {
          pagehideHandler = listener as () => void;
        }
        return originalAddEventListener(type, listener, options);
      }) as typeof window.addEventListener,
    );

    renderHook(() =>
      useMapViewStateController({
        containerRef: { current: container },
        stagePos: { x: 10, y: 20 },
        stageScale: 1.5,
        stageSize: { width: 500, height: 400 },
        setStageSize: vi.fn(),
        minimapCollapsed: true,
        currentMapUrl: "map://forest",
        campaignId: "7",
        userId: "u1",
        viewStateLoadedRef: { current: true },
        saveViewStateTimerRef: { current: null },
        authedFetch,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    expect(authedFetch).toHaveBeenCalledWith(
      "/api/map-view-state/7/me?map_url=map%3A%2F%2Fforest",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          position_x: 10,
          position_y: 20,
          scale: 1.5,
          minimap_collapsed: true,
        }),
      }),
    );

    expect(pagehideHandler).not.toBeNull();
    await act(async () => {
      pagehideHandler?.();
      await Promise.resolve();
    });

    expect(authedFetch).toHaveBeenCalledTimes(2);
    expect(authedFetch).toHaveBeenLastCalledWith(
      "/api/map-view-state/7/me?map_url=map%3A%2F%2Fforest",
      expect.objectContaining({
        method: "POST",
        keepalive: true,
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          position_x: 10,
          position_y: 20,
          scale: 1.5,
          minimap_collapsed: true,
        }),
      }),
    );
  });
});
