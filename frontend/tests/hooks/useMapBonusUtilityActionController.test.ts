import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMapBonusUtilityActionController } from "../../app/components/map/hooks/useMapBonusUtilityActionController";
import type { Token } from "../../app/components/map/types/TacticalMapTypes";

const publishAppEventMock = vi.fn();
const showCharacterBubbleMock = vi.fn();
const showDamageNumberMock = vi.fn();

vi.mock("../../app/events/appEventBus", () => ({
  publishAppEvent: (...args: any[]) => publishAppEventMock(...args),
}));

vi.mock("../../app/components/map/DamageNumberOverlay", () => ({
  showDamageNumber: (...args: any[]) => showDamageNumberMock(...args),
}));

vi.mock("~/utils/characterBubble", () => ({
  showCharacterBubble: (...args: any[]) => showCharacterBubbleMock(...args),
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

describe("useMapBonusUtilityActionController", () => {
  beforeEach(() => {
    publishAppEventMock.mockReset();
    showCharacterBubbleMock.mockReset();
    showDamageNumberMock.mockReset();
  });

  it("handles instant self-heal and emits bonus action result", async () => {
    const sourceToken = createToken({
      id: 11,
      character_id: 18,
      instance_name: "战士",
      current_hp: 5,
      max_hp: 15,
      avatar: "/avatar.png",
    });
    const authedFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    const setTokens = vi.fn();
    const sendMessage = vi.fn();
    const clearSelectionContextMenu = vi.fn();

    const { result } = renderHook(() =>
      useMapBonusUtilityActionController({
        tokens: [sourceToken],
        tokenStatusEffects: {},
        sourceCharacterData: { level: 5 },
        campaignId: "7",
        authedFetch: authedFetch as any,
        showToast: vi.fn(),
        sendMessage,
        setTokens,
        setSourceCharacterData: vi.fn(),
        persistTokenActiveEffects: vi.fn().mockResolvedValue(undefined),
        clearSelectionContextMenu,
        rollSimpleDice: vi.fn().mockReturnValue({ total: 8, rolls: [8] }),
        resolveExecutionScalar: vi.fn().mockReturnValue(2),
      }),
    );

    await act(async () => {
      await result.current.handleInstantSelfHealAction({
        action: { id: "second_wind", name: "复原之风" },
        execution: { heal: { dice: "1d10", bonus: { type: "class_level" } } },
        actionResourceType: "bonus_action",
        sourceTokenId: 11,
        sourceToken,
        sourceName: "战士",
      });
    });

    expect(setTokens).toHaveBeenCalledWith(expect.any(Function));
    const updater = setTokens.mock.calls[0][0];
    expect(updater([sourceToken])[0]).toEqual(expect.objectContaining({ current_hp: 15 }));
    expect(authedFetch).toHaveBeenCalledWith(
      "/api/tokens/11/hp",
      expect.objectContaining({ method: "POST" }),
    );
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "chat" }));
    expect(showDamageNumberMock).toHaveBeenCalled();
    expect(showCharacterBubbleMock).toHaveBeenCalled();
    expect(publishAppEventMock).toHaveBeenNthCalledWith(1, "combatActionUsed", { type: "bonus_action" });
    expect(publishAppEventMock).toHaveBeenNthCalledWith(2, "combatBonusActionResult", {
      tokenId: 11,
      tokenName: "战士",
      actionName: "复原之风",
      actionIcon: "💨",
    });
    expect(clearSelectionContextMenu).toHaveBeenCalled();
  });

  it("handles Bardic Inspiration and persists the target effect", async () => {
    const sourceToken = createToken({ id: 11, character_id: 18, instance_name: "吟游诗人" });
    const targetToken = createToken({ id: 22, character_id: 45, position_x: 1, character_name: "游侠" });
    const authedFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ class_feature_uses: {} }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });
    const persistTokenActiveEffects = vi.fn().mockResolvedValue(undefined);
    const setSourceCharacterData = vi.fn();
    const sendMessage = vi.fn();
    const clearSelectionContextMenu = vi.fn();

    const { result } = renderHook(() =>
      useMapBonusUtilityActionController({
        tokens: [sourceToken, targetToken],
        tokenStatusEffects: { 22: [] },
        sourceCharacterData: {
          level: 8,
          actions: [{ id: "bardic_inspiration", uses: { current: 3, max: 3 } }],
        },
        campaignId: "7",
        authedFetch: authedFetch as any,
        showToast: vi.fn(),
        sendMessage,
        setTokens: vi.fn(),
        setSourceCharacterData,
        persistTokenActiveEffects,
        clearSelectionContextMenu,
        rollSimpleDice: vi.fn(),
        resolveExecutionScalar: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleBardicInspirationAction({
        action: { id: "bardic_inspiration", name: "激励", uses: { current: 3, max: 3, recharge: "long_rest" } },
        sourceTokenId: 11,
        sourceToken,
        sourceName: "吟游诗人",
        targetTokenId: 22,
        actionResourceType: "bonus_action",
      });
    });

    expect(setSourceCharacterData).toHaveBeenCalledWith(expect.any(Function));
    expect(authedFetch).toHaveBeenNthCalledWith(1, "/api/characters/18");
    expect(authedFetch).toHaveBeenNthCalledWith(
      2,
      "/api/characters/18",
      expect.objectContaining({ method: "POST" }),
    );
    expect(persistTokenActiveEffects).toHaveBeenCalledWith(22, [
      expect.objectContaining({
        id: "bardic_inspiration",
        metadata: expect.objectContaining({
          source: "吟游诗人",
          diceSize: "d8",
        }),
      }),
    ]);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "chat" }));
    expect(publishAppEventMock).toHaveBeenNthCalledWith(1, "combatActionUsed", { type: "bonus_action" });
    expect(publishAppEventMock).toHaveBeenNthCalledWith(2, "combatBonusActionResult", {
      tokenId: 11,
      tokenName: "吟游诗人",
      actionName: "激励 → 游侠",
      actionIcon: "🎵",
    });
    expect(clearSelectionContextMenu).toHaveBeenCalled();
  });
});
