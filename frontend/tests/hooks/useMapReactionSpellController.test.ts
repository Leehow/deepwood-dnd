import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMapReactionSpellController } from "../../app/components/map/hooks/useMapReactionSpellController";

const publishAppEventMock = vi.fn();
const castSpellViaAPIMock = vi.fn();
const syncCharacterSpellSlotsFromBackendMock = vi.fn();

vi.mock("../../app/events/appEventBus", () => ({
  publishAppEvent: (...args: any[]) => publishAppEventMock(...args),
}));

vi.mock("../../app/utils/sidebarCasting", () => ({
  castSpellViaAPI: (...args: any[]) => castSpellViaAPIMock(...args),
  syncCharacterSpellSlotsFromBackend: (...args: any[]) => syncCharacterSpellSlotsFromBackendMock(...args),
}));

describe("useMapReactionSpellController", () => {
  beforeEach(() => {
    publishAppEventMock.mockReset();
    castSpellViaAPIMock.mockReset();
    syncCharacterSpellSlotsFromBackendMock.mockReset();
  });

  it("persists Dampen Elements and emits the reaction event", async () => {
    const persistTokenActiveEffects = vi.fn().mockResolvedValue(undefined);
    const sendMessage = vi.fn();
    const showToast = vi.fn();
    const closeDampenElementsModal = vi.fn();
    const clearReactionUi = vi.fn();

    const { result } = renderHook(() =>
      useMapReactionSpellController({
        dampenElementsModal: {
          sourceTokenId: 11,
          targetTokenId: 12,
          sourceName: "德鲁伊",
          targetName: "战士",
          reactionId: "dampen_elements",
        },
        wrathOfTheStormModal: null,
        tokens: [],
        campaignId: "6",
        gridUnitLength: 5,
        tokenStatusEffects: { 12: [] },
        persistTokenActiveEffects,
        sendMessage,
        showToast,
        consumeCharacterResource: vi.fn().mockResolvedValue(true),
        isPendingDamageResistanceEffect: vi.fn(() => false),
        closeDampenElementsModal,
        closeWrathOfTheStormModal: vi.fn(),
        clearReactionUi,
        clearCloakOfShadowsEffect: vi.fn().mockResolvedValue(undefined),
      }),
    );

    await act(async () => {
      await result.current.handleDampenElementsConfirm("fire");
    });

    expect(persistTokenActiveEffects).toHaveBeenCalledWith(12, expect.arrayContaining([
      expect.objectContaining({
        id: "dampen_elements_pending_fire",
      }),
    ]));
    expect(sendMessage).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("德鲁伊 为 战士 挂上了 火焰 防护", "success");
    expect(closeDampenElementsModal).toHaveBeenCalled();
    expect(clearReactionUi).toHaveBeenCalled();
    expect(publishAppEventMock).toHaveBeenCalledWith("combatReactionUsed", {
      reactor_token_id: 11,
      reaction_id: "dampen_elements",
    });
  });

  it("casts Wrath of the Storm through castSpellViaAPI", async () => {
    castSpellViaAPIMock.mockResolvedValue({ success: true, total_damage: 7, results: [] });
    const consumeCharacterResource = vi.fn().mockResolvedValue(true);
    const closeWrathOfTheStormModal = vi.fn();
    const clearReactionUi = vi.fn();
    const showToast = vi.fn();
    const clearCloakOfShadowsEffect = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useMapReactionSpellController({
        dampenElementsModal: null,
        wrathOfTheStormModal: {
          reactionId: "wrath_of_the_storm",
          sourceTokenId: 11,
          targetTokenId: 12,
          sourceName: "牧师",
          targetName: "骷髅",
        },
        tokens: [
          {
            id: 11,
            character_id: 18,
            position_x: 0,
            position_y: 0,
            token_size: "1x1",
          } as any,
          {
            id: 12,
            position_x: 1,
            position_y: 0,
            token_size: "1x1",
          } as any,
        ],
        campaignId: "6",
        gridUnitLength: 5,
        tokenStatusEffects: {},
        persistTokenActiveEffects: vi.fn().mockResolvedValue(undefined),
        sendMessage: vi.fn(),
        showToast,
        consumeCharacterResource,
        isPendingDamageResistanceEffect: vi.fn(() => false),
        closeDampenElementsModal: vi.fn(),
        closeWrathOfTheStormModal,
        clearReactionUi,
        clearCloakOfShadowsEffect,
      }),
    );

    await act(async () => {
      await result.current.handleWrathOfTheStormConfirm("lightning");
    });

    expect(consumeCharacterResource).toHaveBeenCalledWith(
      18,
      "wrath_of_the_storm",
      { id: "wrath_of_the_storm", resourceId: "wrath_of_the_storm" },
      "风暴之怒",
    );
    expect(castSpellViaAPIMock).toHaveBeenCalledWith(
      "wrath_of_the_storm", 0, 11, [12], "6",
      undefined, true, false, "lightning",
    );
    expect(closeWrathOfTheStormModal).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("牧师 对 骷髅 释放风暴之怒", "success");
    expect(clearCloakOfShadowsEffect).toHaveBeenCalledWith(11, "spell");
    expect(clearReactionUi).toHaveBeenCalled();
    expect(publishAppEventMock).toHaveBeenCalledWith("combatReactionUsed", {
      reactor_token_id: 11,
      reaction_id: "wrath_of_the_storm",
    });
  });
});
