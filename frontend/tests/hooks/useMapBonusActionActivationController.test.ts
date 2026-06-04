import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMapBonusActionActivationController } from "../../app/components/map/hooks/useMapBonusActionActivationController";
import type { Token } from "../../app/components/map/types/TacticalMapTypes";

const publishAppEventMock = vi.fn();

vi.mock("../../app/events/appEventBus", () => ({
  publishAppEvent: (...args: any[]) => publishAppEventMock(...args),
}));

function createToken(overrides: Partial<Token>): Token {
  return {
    id: 1,
    campaign_id: 7,
    map_url: "/maps/test-map.png",
    position_x: 0,
    position_y: 0,
    token_size: "1x1",
    ...overrides,
  } as Token;
}

describe("useMapBonusActionActivationController", () => {
  beforeEach(() => {
    publishAppEventMock.mockReset();
  });

  it("consumes unified resources and persists duration effects", async () => {
    const authedFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current: 1, max: 2 }),
    });
    const setSourceCharacterData = vi.fn();
    const persistTokenActiveEffects = vi.fn().mockResolvedValue(undefined);
    const sendMessage = vi.fn();
    const clearSelectionContextMenu = vi.fn();

    const { result } = renderHook(() =>
      useMapBonusActionActivationController({
        campaignId: "7",
        authedFetch: authedFetch as any,
        showToast: vi.fn(),
        sendMessage,
        setSourceCharacterData,
        persistTokenActiveEffects,
        clearSelectionContextMenu,
        clearManualReactionMode: vi.fn(),
        handleInstantSelfHealAction: vi.fn().mockResolvedValue(true),
        handleBardicInspirationAction: vi.fn().mockResolvedValue(true),
      }),
    );

    const handled = await result.current.handleGenericBonusActionActivation({
      action: {
        id: "rage",
        name: "狂暴",
        resourceId: "rage",
        uses: { current: 2, max: 2, recharge: "long_rest" },
      },
      execution: {},
      effectKey: "rage",
      effectDef: {
        icon: "🔥",
        color: "#ef4444",
        duration: 10,
        resourceId: "rage",
      },
      currentEffects: [],
      actionResourceType: "bonus_action",
      actionUsageLabel: "附赠动作",
      sourceTokenId: 11,
      sourceToken: createToken({ id: 11, character_id: 18, instance_name: "野蛮人" }),
      sourceName: "野蛮人",
      resolveExecutionEffectId: vi.fn((value) => String(value || "")),
    });

    expect(handled).toBe(true);
    expect(authedFetch).toHaveBeenCalledWith(
      "/api/characters/18/resources/use",
      expect.objectContaining({ method: "POST" }),
    );
    expect(setSourceCharacterData).toHaveBeenCalledWith(expect.any(Function));
    expect(persistTokenActiveEffects).toHaveBeenCalledWith(11, [
      expect.objectContaining({
        id: "rage",
        duration: 10,
        maxDuration: 10,
      }),
    ]);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "chat" }));
    expect(publishAppEventMock).toHaveBeenNthCalledWith(1, "combatActionUsed", { type: "bonus_action" });
    expect(publishAppEventMock).toHaveBeenNthCalledWith(2, "combatBonusActionResult", {
      tokenId: 11,
      tokenName: "野蛮人",
      actionName: "狂暴",
      actionIcon: "🔥",
    });
    expect(clearSelectionContextMenu).toHaveBeenCalled();
  });

  it("delegates self-heal after legacy use consumption", async () => {
    const handleInstantSelfHealAction = vi.fn().mockResolvedValue(true);
    const setSourceCharacterData = vi.fn();

    const { result } = renderHook(() =>
      useMapBonusActionActivationController({
        campaignId: "7",
        authedFetch: vi.fn() as any,
        showToast: vi.fn(),
        sendMessage: vi.fn(),
        setSourceCharacterData,
        persistTokenActiveEffects: vi.fn().mockResolvedValue(undefined),
        clearSelectionContextMenu: vi.fn(),
        clearManualReactionMode: vi.fn(),
        handleInstantSelfHealAction,
        handleBardicInspirationAction: vi.fn().mockResolvedValue(true),
      }),
    );

    const sourceToken = createToken({ id: 11, instance_name: "战士" });
    const handled = await result.current.handleGenericBonusActionActivation({
      action: {
        id: "second_wind",
        name: "复原之风",
        uses: { current: 2, max: 2, recharge: "short_rest" },
      },
      execution: { type: "self_heal", heal: { dice: "1d10" } },
      effectKey: "second_wind",
      effectDef: null,
      currentEffects: [],
      actionResourceType: "bonus_action",
      actionUsageLabel: "附赠动作",
      sourceTokenId: 11,
      sourceToken,
      sourceName: "战士",
      resolveExecutionEffectId: vi.fn((value) => String(value || "")),
    });

    expect(handled).toBe(true);
    expect(setSourceCharacterData).toHaveBeenCalledWith(expect.any(Function));
    expect(handleInstantSelfHealAction).toHaveBeenCalledWith({
      action: {
        id: "second_wind",
        name: "复原之风",
        uses: { current: 2, max: 2, recharge: "short_rest" },
      },
      execution: { type: "self_heal", heal: { dice: "1d10" } },
      actionResourceType: "bonus_action",
      sourceTokenId: 11,
      sourceToken,
      sourceName: "战士",
    });
  });

  it("publishes reaction usage and clears manual reaction mode", async () => {
    const clearManualReactionMode = vi.fn();
    const clearSelectionContextMenu = vi.fn();
    const sendMessage = vi.fn();

    const { result } = renderHook(() =>
      useMapBonusActionActivationController({
        campaignId: "7",
        authedFetch: vi.fn() as any,
        showToast: vi.fn(),
        sendMessage,
        setSourceCharacterData: vi.fn(),
        persistTokenActiveEffects: vi.fn().mockResolvedValue(undefined),
        clearSelectionContextMenu,
        clearManualReactionMode,
        handleInstantSelfHealAction: vi.fn().mockResolvedValue(true),
        handleBardicInspirationAction: vi.fn().mockResolvedValue(true),
      }),
    );

    const handled = await result.current.handleGenericBonusActionActivation({
      action: { id: "shield_reaction", name: "护盾术反应" },
      execution: {},
      effectKey: "shield_reaction",
      effectDef: null,
      currentEffects: [],
      actionResourceType: "reaction",
      actionUsageLabel: "反应",
      sourceTokenId: 14,
      sourceToken: createToken({ id: 14, instance_name: "法师" }),
      sourceName: "法师",
      resolveExecutionEffectId: vi.fn((value) => String(value || "")),
    });

    expect(handled).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "chat" }));
    expect(clearManualReactionMode).toHaveBeenCalled();
    expect(publishAppEventMock).toHaveBeenCalledWith("combatReactionUsed", {
      reactor_token_id: 14,
      reaction_id: "shield_reaction",
    });
    expect(clearSelectionContextMenu).toHaveBeenCalled();
  });
});
