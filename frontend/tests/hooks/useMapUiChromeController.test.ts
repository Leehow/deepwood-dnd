import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMapUiChromeController } from "../../app/components/map/hooks/useMapUiChromeController";

describe("useMapUiChromeController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects touch devices and keeps the right offset in sync with the sidebar", () => {
    Object.defineProperty(navigator, "maxTouchPoints", {
      value: 2,
      configurable: true,
    });

    const { result, rerender } = renderHook(
      ({ isResizing, showRightSidebar, rightSidebarWidth }) =>
        useMapUiChromeController({
          isResizing,
          showRightSidebar,
          rightSidebarWidth,
        }),
      {
        initialProps: {
          isResizing: false,
          showRightSidebar: true,
          rightSidebarWidth: 320,
        },
      },
    );

    expect(result.current.isTouchDevice).toBe(true);
    expect(result.current.rightOffset).toBe(336);

    rerender({
      isResizing: false,
      showRightSidebar: false,
      rightSidebarWidth: 320,
    });

    expect(result.current.rightOffset).toBe(64);
  });

  it("auto clears the DM bubble after 4 seconds", async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() =>
      useMapUiChromeController({
        isResizing: false,
        showRightSidebar: true,
        rightSidebarWidth: 384,
      }),
    );

    act(() => {
      result.current.setDmBubbleMessage("Strike now");
    });

    expect(result.current.dmBubbleMessage).toBe("Strike now");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });

    expect(result.current.dmBubbleMessage).toBeNull();
  });
});
