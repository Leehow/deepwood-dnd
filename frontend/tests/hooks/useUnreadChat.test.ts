import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { publishAppEvent } from "../../app/events/appEventBus";
import { useUnreadChat } from "../../app/hooks/useUnreadChat";

describe("useUnreadChat", () => {
  it("increments unread count for typed ws chat messages when chat is hidden", () => {
    const { result } = renderHook(() =>
      useUnreadChat({
        userId: "self-user",
        floatingChat: { stage: "closed" } as any,
        currentTab: "map",
        isSidebarExpanded: false,
      }),
    );

    act(() => {
      publishAppEvent("wsChatMessage", {
        user_id: "other-user",
        text: "hello",
      });
    });

    expect(result.current.unreadCount).toBe(1);
  });

  it("ignores own typed ws chat messages", () => {
    const { result } = renderHook(() =>
      useUnreadChat({
        userId: "self-user",
        floatingChat: { stage: "closed" } as any,
        currentTab: "map",
        isSidebarExpanded: false,
      }),
    );

    act(() => {
      publishAppEvent("wsChatMessage", {
        user_id: "self-user",
        text: "my own message",
      });
    });

    expect(result.current.unreadCount).toBe(0);
  });

  it("still handles legacy ws-chat-message DOM events through the event bus bridge", () => {
    const { result } = renderHook(() =>
      useUnreadChat({
        userId: "self-user",
        floatingChat: { stage: "closed" } as any,
        currentTab: "map",
        isSidebarExpanded: false,
      }),
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent("ws-chat-message", {
          detail: { user_id: "other-user", text: "legacy message" },
        }),
      );
    });

    expect(result.current.unreadCount).toBe(1);
  });
});
