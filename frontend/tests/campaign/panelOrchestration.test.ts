import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishAppEvent } from "~/events/appEventBus";

let privateMessageCallback: (() => void) | null = null;

vi.mock("~/utils/characterBubble", () => ({
  onStartPrivateMessage: (callback: () => void) => {
    privateMessageCallback = callback;
    return vi.fn();
  },
}));

import { useCampaignPanelOrchestration } from "~/campaign-shell/panel/useCampaignPanelOrchestration";

describe("useCampaignPanelOrchestration", () => {
  beforeEach(() => {
    privateMessageCallback = null;
  });

  it("collapses the right sidebar on phone-like layouts", () => {
    const setShowRightSidebar = vi.fn();

    renderHook(() =>
      useCampaignPanelOrchestration({
        isPhoneLike: true,
        setShowRightSidebar,
      }),
    );

    expect(setShowRightSidebar).toHaveBeenCalledWith(false);
  });

  it("opens chat when a private message starts", () => {
    const setShowRightSidebar = vi.fn();
    const openChatTab = vi.fn();

    renderHook(() =>
      useCampaignPanelOrchestration({
        isPhoneLike: false,
        setShowRightSidebar,
        openChatTab,
        listenForPrivateMessages: true,
      }),
    );

    act(() => {
      privateMessageCallback?.();
    });

    expect(setShowRightSidebar).toHaveBeenCalledWith(true);
    expect(openChatTab).toHaveBeenCalled();
  });

  it("opens chat when the global panel event requests the chat tab", () => {
    const setShowRightSidebar = vi.fn();
    const openChatTab = vi.fn();

    renderHook(() =>
      useCampaignPanelOrchestration({
        isPhoneLike: false,
        setShowRightSidebar,
        openChatTab,
        listenForOpenRightPanelTab: true,
      }),
    );

    act(() => {
      window.dispatchEvent(new CustomEvent("openRightPanelTab", { detail: { tab: "chat" } }));
    });

    expect(setShowRightSidebar).toHaveBeenCalledWith(true);
    expect(openChatTab).toHaveBeenCalledTimes(1);
  });

  it("opens chat when the typed panel event requests the chat tab", () => {
    const setShowRightSidebar = vi.fn();
    const openChatTab = vi.fn();

    renderHook(() =>
      useCampaignPanelOrchestration({
        isPhoneLike: false,
        setShowRightSidebar,
        openChatTab,
        listenForOpenRightPanelTab: true,
      }),
    );

    act(() => {
      publishAppEvent("openRightPanelTab", { tab: "chat" });
    });

    expect(setShowRightSidebar).toHaveBeenCalledWith(true);
    expect(openChatTab).toHaveBeenCalledTimes(1);
  });
});
