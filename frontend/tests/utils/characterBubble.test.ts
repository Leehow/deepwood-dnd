import { describe, expect, it, vi } from "vitest";

import {
  CHARACTER_BUBBLE_EVENT,
  onCharacterBubble,
  onReplyToMessage,
  onStartPrivateMessage,
  REPLY_TO_MESSAGE_EVENT,
  showCharacterBubble,
  START_PRIVATE_MESSAGE_EVENT,
  triggerReplyToMessage,
  triggerStartPrivateMessage,
} from "~/utils/characterBubble";

describe("characterBubble", () => {
  it("publishes character bubbles to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = onCharacterBubble(typedHandler);
    window.addEventListener(CHARACTER_BUBBLE_EVENT, domHandler as EventListener);

    showCharacterBubble({
      characterId: 7,
      characterName: "艾拉",
      message: "命中了！",
      type: "combat",
    });

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      characterId: 7,
      characterName: "艾拉",
      message: "命中了！",
      type: "combat",
    }));
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener(CHARACTER_BUBBLE_EVENT, domHandler as EventListener);
  });

  it("publishes reply-to-message events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = onReplyToMessage(typedHandler);
    window.addEventListener(REPLY_TO_MESSAGE_EVENT, domHandler as EventListener);

    const payload = {
      messageId: "msg-1",
      senderUserId: "u-1",
      senderName: "DM",
      content: "准备好了吗？",
    };
    triggerReplyToMessage(payload);

    expect(typedHandler).toHaveBeenCalledWith(payload);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener(REPLY_TO_MESSAGE_EVENT, domHandler as EventListener);
  });

  it("publishes start-private-message events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = onStartPrivateMessage(typedHandler);
    window.addEventListener(START_PRIVATE_MESSAGE_EVENT, domHandler as EventListener);

    const payload = {
      targetUserId: "u-2",
      targetName: "米拉",
    };
    triggerStartPrivateMessage(payload);

    expect(typedHandler).toHaveBeenCalledWith(payload);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener(START_PRIVATE_MESSAGE_EVENT, domHandler as EventListener);
  });
});
