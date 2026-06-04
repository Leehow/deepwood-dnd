import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMapClericDomainActionController } from "../../app/components/map/hooks/useMapClericDomainActionController";
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

describe("useMapClericDomainActionController", () => {
  beforeEach(() => {
    publishAppEventMock.mockReset();
  });

  it("applies Warding Flare and publishes reaction usage", async () => {
    const sourceToken = createToken({ id: 11, character_id: 18, instance_name: "牧师" });
    const persistTokenActiveEffects = vi.fn().mockResolvedValue(undefined);
    const consumeCharacterResource = vi.fn().mockResolvedValue({ current: 2, max: 3 });
    const sendMessage = vi.fn();
    const clearSelectionContextMenu = vi.fn();
    const setManualReactionMode = vi.fn();

    const { result } = renderHook(() =>
      useMapClericDomainActionController({
        tokens: [sourceToken],
        tokenStatusEffects: { 11: [] },
        sourceCharacterData: { level: 6 },
        gridUnitLength: 5,
        showToast: vi.fn(),
        sendMessage,
        persistTokenActiveEffects,
        consumeCharacterResource,
        setDampenElementsModal: vi.fn(),
        setWrathOfTheStormModal: vi.fn(),
        setManualReactionMode,
        clearSelectionContextMenu,
        isWardingFlareDefenseEffect: vi.fn(() => false),
        isPendingDamageResistanceEffect: vi.fn(() => false),
        isWarDomainAttackBonusEffect: vi.fn(() => false),
        isDestructiveWrathPendingEffect: vi.fn(() => false),
      }),
    );

    await act(async () => {
      await result.current.handleWardingFlareAction({
        action: { id: "warding_flare", name: "护卫闪光", uses: { current: 3, max: 3 } },
        sourceTokenId: 11,
        sourceToken,
        sourceName: "牧师",
      });
    });

    expect(consumeCharacterResource).toHaveBeenCalledWith(
      18,
      "warding_flare",
      expect.objectContaining({ id: "warding_flare" }),
      "护卫闪光",
    );
    expect(persistTokenActiveEffects).toHaveBeenCalledWith(11, [
      expect.objectContaining({
        id: "warding_flare_pending",
        metadata: expect.objectContaining({ protectedTokenId: 11 }),
      }),
    ]);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "chat" }));
    expect(clearSelectionContextMenu).toHaveBeenCalled();
    expect(setManualReactionMode).toHaveBeenCalledWith(null);
    expect(publishAppEventMock).toHaveBeenCalledWith("combatReactionUsed", {
      reactor_token_id: 11,
      reaction_id: "warding_flare",
    });
  });

  it("opens Dampen Elements modal for an ally target", () => {
    const sourceToken = createToken({ id: 11, character_id: 18, faction: "player" });
    const allyToken = createToken({ id: 22, position_x: 1, faction: "player", instance_name: "战士" });
    const setDampenElementsModal = vi.fn();
    const clearSelectionContextMenu = vi.fn();

    const { result } = renderHook(() =>
      useMapClericDomainActionController({
        tokens: [sourceToken, allyToken],
        tokenStatusEffects: { 22: [] },
        sourceCharacterData: { level: 6 },
        gridUnitLength: 5,
        showToast: vi.fn(),
        sendMessage: vi.fn(),
        persistTokenActiveEffects: vi.fn().mockResolvedValue(undefined),
        consumeCharacterResource: vi.fn().mockResolvedValue(null),
        setDampenElementsModal,
        setWrathOfTheStormModal: vi.fn(),
        setManualReactionMode: vi.fn(),
        clearSelectionContextMenu,
        isWardingFlareDefenseEffect: vi.fn(() => false),
        isPendingDamageResistanceEffect: vi.fn(() => false),
        isWarDomainAttackBonusEffect: vi.fn(() => false),
        isDestructiveWrathPendingEffect: vi.fn(() => false),
      }),
    );

    act(() => {
      result.current.handleDampenElementsAction({
        action: { id: "dampen_elements", name: "自然之怒" },
        sourceTokenId: 11,
        sourceToken,
        sourceName: "德鲁伊",
        targetTokenId: 22,
      });
    });

    expect(setDampenElementsModal).toHaveBeenCalledWith(expect.objectContaining({
      sourceTokenId: 11,
      targetTokenId: 22,
      targetName: "战士",
    }));
    expect(clearSelectionContextMenu).toHaveBeenCalled();
  });

  it("applies Guided Strike to the source token", async () => {
    const sourceToken = createToken({ id: 11, character_id: 18, instance_name: "牧师" });
    const persistTokenActiveEffects = vi.fn().mockResolvedValue(undefined);
    const consumeCharacterResource = vi.fn().mockResolvedValue({ current: 0, max: 1 });
    const sendMessage = vi.fn();
    const clearSelectionContextMenu = vi.fn();

    const { result } = renderHook(() =>
      useMapClericDomainActionController({
        tokens: [sourceToken],
        tokenStatusEffects: { 11: [] },
        sourceCharacterData: { level: 9 },
        gridUnitLength: 5,
        showToast: vi.fn(),
        sendMessage,
        persistTokenActiveEffects,
        consumeCharacterResource,
        setDampenElementsModal: vi.fn(),
        setWrathOfTheStormModal: vi.fn(),
        setManualReactionMode: vi.fn(),
        clearSelectionContextMenu,
        isWardingFlareDefenseEffect: vi.fn(() => false),
        isPendingDamageResistanceEffect: vi.fn(() => false),
        isWarDomainAttackBonusEffect: vi.fn(() => false),
        isDestructiveWrathPendingEffect: vi.fn(() => false),
      }),
    );

    await act(async () => {
      await result.current.handleGuidedStrikeAction({
        action: { id: "guided_strike", name: "战争通道", uses: { current: 1, max: 1 } },
        sourceTokenId: 11,
        sourceToken,
        sourceName: "牧师",
      });
    });

    expect(persistTokenActiveEffects).toHaveBeenCalledWith(11, [
      expect.objectContaining({
        id: "guided_strike_bonus",
        metadata: expect.objectContaining({ attackBonusAdd: 10 }),
      }),
    ]);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "chat" }));
    expect(clearSelectionContextMenu).toHaveBeenCalled();
  });

  it("applies War God's Blessing to the chosen ally and publishes reaction usage", async () => {
    const sourceToken = createToken({ id: 11, character_id: 18, instance_name: "牧师" });
    const targetToken = createToken({ id: 22, position_x: 2, instance_name: "战士" });
    const persistTokenActiveEffects = vi.fn().mockResolvedValue(undefined);
    const consumeCharacterResource = vi.fn().mockResolvedValue({ current: 0, max: 1 });
    const clearSelectionContextMenu = vi.fn();
    const setManualReactionMode = vi.fn();

    const { result } = renderHook(() =>
      useMapClericDomainActionController({
        tokens: [sourceToken, targetToken],
        tokenStatusEffects: { 22: [] },
        sourceCharacterData: { level: 9 },
        gridUnitLength: 5,
        showToast: vi.fn(),
        sendMessage: vi.fn(),
        persistTokenActiveEffects,
        consumeCharacterResource,
        setDampenElementsModal: vi.fn(),
        setWrathOfTheStormModal: vi.fn(),
        setManualReactionMode,
        clearSelectionContextMenu,
        isWardingFlareDefenseEffect: vi.fn(() => false),
        isPendingDamageResistanceEffect: vi.fn(() => false),
        isWarDomainAttackBonusEffect: vi.fn(() => false),
        isDestructiveWrathPendingEffect: vi.fn(() => false),
      }),
    );

    await act(async () => {
      await result.current.handleWarGodsBlessingAction({
        action: { id: "war_gods_blessing", name: "战神祝福", uses: { current: 1, max: 1 } },
        sourceTokenId: 11,
        sourceToken,
        sourceName: "牧师",
        targetTokenId: 22,
      });
    });

    expect(persistTokenActiveEffects).toHaveBeenCalledWith(22, [
      expect.objectContaining({
        id: "war_gods_blessing_bonus",
      }),
    ]);
    expect(clearSelectionContextMenu).toHaveBeenCalled();
    expect(setManualReactionMode).toHaveBeenCalledWith(null);
    expect(publishAppEventMock).toHaveBeenCalledWith("combatReactionUsed", {
      reactor_token_id: 11,
      reaction_id: "war_gods_blessing",
    });
  });

  it("prepares Destructive Wrath as a pending maximize-damage effect", async () => {
    const sourceToken = createToken({ id: 11, character_id: 18, instance_name: "牧师" });
    const persistTokenActiveEffects = vi.fn().mockResolvedValue(undefined);
    const consumeCharacterResource = vi.fn().mockResolvedValue({ current: 0, max: 1 });

    const { result } = renderHook(() =>
      useMapClericDomainActionController({
        tokens: [sourceToken],
        tokenStatusEffects: { 11: [] },
        sourceCharacterData: { level: 9 },
        gridUnitLength: 5,
        showToast: vi.fn(),
        sendMessage: vi.fn(),
        persistTokenActiveEffects,
        consumeCharacterResource,
        setDampenElementsModal: vi.fn(),
        setWrathOfTheStormModal: vi.fn(),
        setManualReactionMode: vi.fn(),
        clearSelectionContextMenu: vi.fn(),
        isWardingFlareDefenseEffect: vi.fn(() => false),
        isPendingDamageResistanceEffect: vi.fn(() => false),
        isWarDomainAttackBonusEffect: vi.fn(() => false),
        isDestructiveWrathPendingEffect: vi.fn(() => false),
      }),
    );

    await act(async () => {
      await result.current.handleDestructiveWrathAction({
        action: { id: "destructive_wrath", name: "破坏之怒通道", uses: { current: 1, max: 1 } },
        sourceTokenId: 11,
        sourceToken,
        sourceName: "牧师",
      });
    });

    expect(persistTokenActiveEffects).toHaveBeenCalledWith(11, [
      expect.objectContaining({
        id: "destructive_wrath_pending",
        metadata: expect.objectContaining({ pendingEffectType: "maximize_damage" }),
      }),
    ]);
  });
});
