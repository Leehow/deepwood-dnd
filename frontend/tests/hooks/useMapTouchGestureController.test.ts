import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMapTouchGestureController } from "../../app/components/map/hooks/useMapTouchGestureController";

function createStageStub() {
  let scale = 1;
  let pos = { x: 0, y: 0 };

  return {
    batchDraw: vi.fn(),
    container: vi.fn(() => ({
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 200,
        height: 100,
      }),
    })),
    isDragging: vi.fn(() => false),
    scaleX: vi.fn((next?: number) => {
      if (typeof next === "number") {
        scale = next;
        return undefined as any;
      }
      return scale;
    }),
    scaleY: vi.fn((next?: number) => {
      if (typeof next === "number") {
        scale = next;
        return undefined as any;
      }
      return scale;
    }),
    stopDrag: vi.fn(),
    x: vi.fn((next?: number) => {
      if (typeof next === "number") {
        pos.x = next;
        return undefined as any;
      }
      return pos.x;
    }),
    y: vi.fn((next?: number) => {
      if (typeof next === "number") {
        pos.y = next;
        return undefined as any;
      }
      return pos.y;
    }),
  };
}

describe("useMapTouchGestureController", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("applies touch-action none to canvases and forwards multitouch events", () => {
    const container = document.createElement("div");
    const canvas = document.createElement("canvas");
    container.appendChild(canvas);

    const containerListeners = new Map<string, EventListener>();
    vi.spyOn(container, "addEventListener").mockImplementation(((type: string, listener: EventListener) => {
      containerListeners.set(type, listener);
    }) as any);
    vi.spyOn(container, "removeEventListener").mockImplementation(() => {});
    vi.spyOn(document, "addEventListener").mockImplementation(() => {});
    vi.spyOn(document, "removeEventListener").mockImplementation(() => {});

    const handleNativeTouchMove = vi.fn();
    const handleNativeTouchEnd = vi.fn();

    renderHook(() =>
      useMapTouchGestureController({
        containerRef: { current: container },
        stageRef: { current: createStageStub() as any },
        handleNativeTouchMove,
        handleNativeTouchEnd,
        lastDist: { current: 0 },
        lastCenter: { current: { x: 0, y: 0 } },
        setStageScale: vi.fn(),
        setStagePos: vi.fn(),
      }),
    );

    expect(canvas.style.touchAction).toBe("none");

    const touchMoveHandler = containerListeners.get("touchmove");
    const touchEndHandler = containerListeners.get("touchend");

    act(() => {
      touchMoveHandler?.({
        touches: [{ target: canvas }, { target: canvas }],
        preventDefault: vi.fn(),
      } as any);
      touchEndHandler?.({
        touches: [{ target: canvas }],
      } as any);
    });

    expect(handleNativeTouchMove).toHaveBeenCalled();
    expect(handleNativeTouchEnd).toHaveBeenCalled();
  });

  it("updates the stage for gesture events and ruler pinch movement", () => {
    const container = document.createElement("div");
    const documentListeners = new Map<string, EventListener>();
    vi.spyOn(container, "addEventListener").mockImplementation(() => {});
    vi.spyOn(container, "removeEventListener").mockImplementation(() => {});
    vi.spyOn(document, "addEventListener").mockImplementation(((type: string, listener: EventListener) => {
      documentListeners.set(type, listener);
    }) as any);
    vi.spyOn(document, "removeEventListener").mockImplementation(() => {});

    const stage = createStageStub();
    const setStageScale = vi.fn();
    const setStagePos = vi.fn();
    const lastDist = { current: 0 };
    const lastCenter = { current: { x: 0, y: 0 } };

    const { result } = renderHook(() =>
      useMapTouchGestureController({
        containerRef: { current: container },
        stageRef: { current: stage as any },
        handleNativeTouchMove: vi.fn(),
        handleNativeTouchEnd: vi.fn(),
        lastDist,
        lastCenter,
        setStageScale,
        setStagePos,
      }),
    );

    act(() => {
      documentListeners.get("gesturestart")?.({
        preventDefault: vi.fn(),
        clientX: 50,
        clientY: 20,
      } as any);
      documentListeners.get("gesturechange")?.({
        preventDefault: vi.fn(),
        clientX: 60,
        clientY: 30,
        scale: 2,
      } as any);
    });

    expect(setStageScale).toHaveBeenCalledWith(2);
    expect(setStagePos).toHaveBeenCalledWith({ x: -40, y: -10 });

    act(() => {
      stage.scaleX(1);
      stage.scaleY(1);
      stage.x(0);
      stage.y(0);
    });
    setStageScale.mockClear();
    setStagePos.mockClear();
    lastDist.current = 0;
    lastCenter.current = { x: 0, y: 0 };

    act(() => {
      result.current.handleRulerMultiTouchMove([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]);
      result.current.handleRulerMultiTouchMove([
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ]);
    });

    expect(setStageScale).toHaveBeenCalledWith(2);
    expect(setStagePos).toHaveBeenCalledWith({ x: -5, y: 0 });

    act(() => {
      result.current.handleRulerMultiTouchEnd();
    });

    expect(lastDist.current).toBe(0);
    expect(lastCenter.current).toEqual({ x: 0, y: 0 });
  });
});
