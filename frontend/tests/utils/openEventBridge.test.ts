import { afterEach, describe, expect, it, vi } from "vitest";

import { dispatchOpenEvent } from "~/utils/openEventBridge";
import { subscribeAppEvent } from "~/events/appEventBus";

describe("openEventBridge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes known open events through the typed bus", () => {
    const typedHandler = vi.fn();
    const domHandler = vi.fn();
    const unsubscribe = subscribeAppEvent("arcaneRecoveryTarget", typedHandler);
    window.addEventListener("arcaneRecoveryTarget", domHandler as EventListener);

    const detail = {
      sourceCharacterId: 18,
      resourceId: "arcane_recovery",
      execution: { openEvent: "arcaneRecoveryTarget" },
    };
    dispatchOpenEvent("arcaneRecoveryTarget", detail);

    expect(typedHandler).toHaveBeenCalledWith(detail);
    expect(domHandler).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener("arcaneRecoveryTarget", domHandler as EventListener);
  });

  it("falls back to legacy custom events for unknown open events", () => {
    const domHandler = vi.fn();
    window.addEventListener("mysteryFeatureOpen", domHandler as EventListener);

    const detail = { sourceCharacterId: 7, resourceId: "mystery" };
    dispatchOpenEvent("mysteryFeatureOpen", detail);

    expect(domHandler).toHaveBeenCalledTimes(1);
    expect((domHandler.mock.calls[0]?.[0] as CustomEvent).detail).toEqual(detail);

    window.removeEventListener("mysteryFeatureOpen", domHandler as EventListener);
  });
});
