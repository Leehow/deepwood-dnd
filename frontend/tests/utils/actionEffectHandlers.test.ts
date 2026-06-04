import { beforeEach, describe, expect, it, vi } from "vitest";

import { executeActionEffect } from "~/utils/actionEffectHandlers";

const getEffectDefinitionMock = vi.fn();
const publishAppEventMock = vi.fn();

vi.mock("~/hooks/useEffectSystem", () => ({
  getEffectDefinition: (...args: any[]) => getEffectDefinitionMock(...args),
}));

vi.mock("~/events/appEventBus", () => ({
  publishAppEvent: (...args: any[]) => publishAppEventMock(...args),
}));

describe("actionEffectHandlers", () => {
  beforeEach(() => {
    getEffectDefinitionMock.mockReset();
    publishAppEventMock.mockReset();
  });

  it("publishes combat bonus action result through the typed event bus", () => {
    getEffectDefinitionMock.mockReturnValue({
      id: "rage",
      name: "狂暴",
      visual: {
        icon: "🔥",
        color: "#ef4444",
      },
      duration: {
        rounds: 10,
      },
      actionEffect: {
        type: "self_buff",
        chatTemplate: "{source} 进入狂暴",
      },
    });

    const setTokenStatusEffects = vi.fn();
    const persistEffects = vi.fn().mockResolvedValue(undefined);

    const handled = executeActionEffect("rage", {
      sourceTokenId: 11,
      sourceName: "野蛮人",
      tokenStatusEffects: {},
      setTokenStatusEffects,
      persistEffects,
      sendChatMessage: vi.fn(),
      showToast: vi.fn(),
      closeMenu: vi.fn(),
      consumeActionType: "bonus_action",
    });

    expect(handled).toBe(true);
    expect(setTokenStatusEffects).toHaveBeenCalledWith(expect.any(Function));
    expect(persistEffects).toHaveBeenCalledWith(
      11,
      [expect.objectContaining({ id: "rage", maxDuration: 10, duration: 10 })],
    );
    expect(publishAppEventMock).toHaveBeenNthCalledWith(1, "combatActionUsed", { type: "bonus_action" });
    expect(publishAppEventMock).toHaveBeenNthCalledWith(2, "combatBonusActionResult", {
      tokenId: 11,
      tokenName: "野蛮人",
      actionName: "狂暴",
      actionIcon: "🔥",
    });
  });
});
