import { describe, expect, it, vi } from "vitest";

import {
  DM_DICE_REQUEST_DISMISS_EVENT,
  DM_DICE_REQUEST_EVENT,
  DM_DICE_REQUEST_RESPOND_EVENT,
  onDiceRequestBubble,
  onDiceRequestDismiss,
  onDiceRequestRespond,
  showDiceRequestBubble,
  triggerDiceRequestDismiss,
  triggerDiceRequestRespond,
} from "~/utils/diceRequestBubble";

describe("diceRequestBubble", () => {
  it("publishes dice-request bubble events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = onDiceRequestBubble(typedHandler);
    window.addEventListener(DM_DICE_REQUEST_EVENT, domHandler as EventListener);

    showDiceRequestBubble({
      requestId: "req-1",
      messageId: "msg-1",
      checkType: "check",
      skill: "stealth",
      isPrivate: false,
    });

    expect(typedHandler).toHaveBeenCalledTimes(1);
    expect(typedHandler.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      requestId: "req-1",
      messageId: "msg-1",
      checkType: "check",
      skill: "stealth",
      isPrivate: false,
    }));
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener(DM_DICE_REQUEST_EVENT, domHandler as EventListener);
  });

  it("publishes dice-request respond events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = onDiceRequestRespond(typedHandler);
    window.addEventListener(DM_DICE_REQUEST_RESPOND_EVENT, domHandler as EventListener);

    const payload = {
      requestId: "req-2",
      messageId: "msg-2",
      companionActor: { type: "monster" as const, monster_instance_id: 9, name: "狼" },
    };
    triggerDiceRequestRespond(payload.requestId, payload.messageId, payload.companionActor);

    expect(typedHandler).toHaveBeenCalledWith(payload);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener(DM_DICE_REQUEST_RESPOND_EVENT, domHandler as EventListener);
  });

  it("publishes dice-request dismiss events to typed and legacy listeners", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = onDiceRequestDismiss(typedHandler);
    window.addEventListener(DM_DICE_REQUEST_DISMISS_EVENT, domHandler as EventListener);

    triggerDiceRequestDismiss("req-3");

    expect(typedHandler).toHaveBeenCalledWith({ requestId: "req-3" });
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener(DM_DICE_REQUEST_DISMISS_EVENT, domHandler as EventListener);
  });
});
