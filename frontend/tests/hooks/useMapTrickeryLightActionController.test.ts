import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMapTrickeryLightActionController } from "../../app/components/map/hooks/useMapTrickeryLightActionController";
import type { Token } from "../../app/components/map/types/TacticalMapTypes";

const publishAppEventMock = vi.fn();
const castSpellViaAPIMock = vi.fn();

vi.mock("../../app/events/appEventBus", () => ({
  publishAppEvent: (...args: any[]) => publishAppEventMock(...args),
}));

vi.mock("../../app/utils/sidebarCasting", () => ({
  castSpellViaAPI: (...args: any[]) => castSpellViaAPIMock(...args),
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

describe("useMapTrickeryLightActionController", () => {
  beforeEach(() => {
    publishAppEventMock.mockReset();
    castSpellViaAPIMock.mockReset();
  });

  it("applies Cloak of Shadows and updates character condition state", async () => {
    const sourceToken = createToken({ id: 11, character_id: 18, instance_name: "牧师" });
    const persistTokenActiveEffects = vi.fn().mockResolvedValue(undefined);
    const consumeCharacterResource = vi.fn().mockResolvedValue({ current: 0, max: 1 });
    const upsertCloakOfShadowsCondition = vi.fn().mockResolvedValue(undefined);
    const sendMessage = vi.fn();
    const clearSelectionContextMenu = vi.fn();

    const { result } = renderHook(() =>
      useMapTrickeryLightActionController({
        tokens: [sourceToken],
        tokenStatusEffects: { 11: [] },
        sourceCharacterData: { class_id: "cleric" },
        campaignId: "7",
        gridUnitLength: 5,
        authedFetch: vi.fn() as any,
        showToast: vi.fn(),
        sendMessage,
        setTokens: vi.fn(),
        setTokenStatusEffects: vi.fn(),
        setSourceCharacterData: vi.fn(),
        persistTokenActiveEffects,
        consumeCharacterResource,
        upsertBlessingOfTheTricksterStatus: vi.fn().mockResolvedValue(undefined),
        upsertCloakOfShadowsCondition,
        clearSelectionContextMenu,
        isCloakOfShadowsEffect: vi.fn(() => false),
        isBlessingOfTheTricksterEffect: vi.fn(() => false),
      }),
    );

    await act(async () => {
      await result.current.handleCloakOfShadowsAction({
        action: { id: "cloak_of_shadows", name: "诡术斗篷", uses: { current: 1, max: 1 } },
        sourceTokenId: 11,
        sourceToken,
        sourceName: "牧师",
      });
    });

    expect(consumeCharacterResource).toHaveBeenCalled();
    expect(persistTokenActiveEffects).toHaveBeenCalledWith(11, [
      expect.objectContaining({
        id: "cloak_of_shadows",
        conditions: ["invisible"],
      }),
    ]);
    expect(upsertCloakOfShadowsCondition).toHaveBeenCalledWith(18, true);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "chat" }));
    expect(clearSelectionContextMenu).toHaveBeenCalled();
    expect(publishAppEventMock).toHaveBeenCalledWith("combatActionUsed", { type: "action" });
  });

  it("moves Blessing of the Trickster to the new ally target", async () => {
    const sourceToken = createToken({ id: 11, character_id: 18, faction: "player", instance_name: "牧师" });
    const oldTarget = createToken({ id: 22, character_id: 33, faction: "player", instance_name: "游荡者" });
    const newTarget = createToken({ id: 44, character_id: 55, position_x: 1, faction: "player", instance_name: "战士" });
    const persistTokenActiveEffects = vi.fn().mockResolvedValue(undefined);
    const upsertBlessingOfTheTricksterStatus = vi.fn().mockResolvedValue(undefined);
    const sendMessage = vi.fn();
    const clearSelectionContextMenu = vi.fn();

    const { result } = renderHook(() =>
      useMapTrickeryLightActionController({
        tokens: [sourceToken, oldTarget, newTarget],
        tokenStatusEffects: {
          22: [{ id: "blessing_of_the_trickster_18" }],
          44: [],
        },
        sourceCharacterData: { class_id: "cleric" },
        campaignId: "7",
        gridUnitLength: 5,
        authedFetch: vi.fn() as any,
        showToast: vi.fn(),
        sendMessage,
        setTokens: vi.fn(),
        setTokenStatusEffects: vi.fn(),
        setSourceCharacterData: vi.fn(),
        persistTokenActiveEffects,
        consumeCharacterResource: vi.fn().mockResolvedValue(null),
        upsertBlessingOfTheTricksterStatus,
        upsertCloakOfShadowsCondition: vi.fn().mockResolvedValue(undefined),
        clearSelectionContextMenu,
        isCloakOfShadowsEffect: vi.fn(() => false),
        isBlessingOfTheTricksterEffect: vi.fn((effect: any, sourceCharacterId?: number | null) =>
          String(effect?.id || "").startsWith("blessing_of_the_trickster_")
          && Number(sourceCharacterId) === 18,
        ),
      }),
    );

    await act(async () => {
      await result.current.handleBlessingOfTheTricksterAction({
        sourceTokenId: 11,
        sourceToken,
        targetTokenId: 44,
        sourceName: "牧师",
      });
    });

    expect(upsertBlessingOfTheTricksterStatus).toHaveBeenNthCalledWith(1, 33, 18, "牧师", false);
    expect(upsertBlessingOfTheTricksterStatus).toHaveBeenNthCalledWith(2, 55, 18, "牧师", true);
    expect(persistTokenActiveEffects).toHaveBeenNthCalledWith(1, 22, []);
    expect(persistTokenActiveEffects).toHaveBeenNthCalledWith(2, 44, [
      expect.objectContaining({
        id: "blessing_of_the_trickster_18",
      }),
    ]);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "chat" }));
    expect(clearSelectionContextMenu).toHaveBeenCalled();
    expect(publishAppEventMock).toHaveBeenCalledWith("combatActionUsed", { type: "action" });
  });

  it("calls castSpellViaAPI for Radiance of the Dawn with enemy targets", async () => {
    castSpellViaAPIMock.mockResolvedValue({
      success: true,
      total_damage: 15,
      results: [{ damage_dealt: 15, save_succeeded: false }],
      dispelled_darkness_count: 0,
    });
    const sourceToken = createToken({ id: 11, character_id: 18, instance_name: "牧师", faction: "player" });
    const enemyToken = createToken({ id: 22, monster_instance_id: 50, position_x: 2, faction: "enemy" });
    const allyToken = createToken({ id: 33, character_id: 20, position_x: 1, faction: "player" });
    const consumeCharacterResource = vi.fn().mockResolvedValue({ current: 0, max: 1 });
    const clearSelectionContextMenu = vi.fn();

    const { result } = renderHook(() =>
      useMapTrickeryLightActionController({
        tokens: [sourceToken, enemyToken, allyToken],
        tokenStatusEffects: {},
        sourceCharacterData: { class_id: "cleric" },
        campaignId: "7",
        gridUnitLength: 5,
        authedFetch: vi.fn() as any,
        showToast: vi.fn(),
        sendMessage: vi.fn(),
        setTokens: vi.fn(),
        setTokenStatusEffects: vi.fn(),
        setSourceCharacterData: vi.fn(),
        persistTokenActiveEffects: vi.fn().mockResolvedValue(undefined),
        consumeCharacterResource,
        upsertBlessingOfTheTricksterStatus: vi.fn().mockResolvedValue(undefined),
        upsertCloakOfShadowsCondition: vi.fn().mockResolvedValue(undefined),
        clearSelectionContextMenu,
        isCloakOfShadowsEffect: vi.fn(() => false),
        isBlessingOfTheTricksterEffect: vi.fn(() => false),
      }),
    );

    await act(async () => {
      await result.current.handleRadianceOfTheDawnAction({
        sourceTokenId: 11,
        sourceToken,
        sourceName: "牧师",
      });
    });

    expect(consumeCharacterResource).toHaveBeenCalledWith(
      18, "channel_divinity_cleric",
      expect.objectContaining({ id: "radiance_of_the_dawn" }),
      "光辉通道",
    );
    // Should only target enemy (22), not ally (33)
    expect(castSpellViaAPIMock).toHaveBeenCalledWith(
      "radiance_of_the_dawn", 0, 11, [22], "7",
      undefined, true, false,
    );
    expect(clearSelectionContextMenu).toHaveBeenCalled();
    expect(publishAppEventMock).toHaveBeenCalledWith("combatActionUsed", { type: "action" });
  });

  it("activates Corona of Light with returned active effects", async () => {
    const sourceToken = createToken({ id: 11, character_id: 18, instance_name: "牧师" });
    const authedFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        active_effects: [{ id: "corona_of_light", name: "日冕" }],
      }),
    });
    const setTokenStatusEffects = vi.fn();
    const setTokens = vi.fn();
    const clearSelectionContextMenu = vi.fn();

    const { result } = renderHook(() =>
      useMapTrickeryLightActionController({
        tokens: [sourceToken],
        tokenStatusEffects: { 11: [] },
        sourceCharacterData: { class_id: "cleric" },
        campaignId: "7",
        gridUnitLength: 5,
        authedFetch: authedFetch as any,
        showToast: vi.fn(),
        sendMessage: vi.fn(),
        setTokens,
        setTokenStatusEffects,
        setSourceCharacterData: vi.fn(),
        persistTokenActiveEffects: vi.fn().mockResolvedValue(undefined),
        consumeCharacterResource: vi.fn().mockResolvedValue(null),
        upsertBlessingOfTheTricksterStatus: vi.fn().mockResolvedValue(undefined),
        upsertCloakOfShadowsCondition: vi.fn().mockResolvedValue(undefined),
        clearSelectionContextMenu,
        isCloakOfShadowsEffect: vi.fn(() => false),
        isBlessingOfTheTricksterEffect: vi.fn(() => false),
      }),
    );

    await act(async () => {
      await result.current.handleCoronaOfLightAction({
        sourceTokenId: 11,
        sourceToken,
        sourceName: "牧师",
      });
    });

    expect(setTokenStatusEffects).toHaveBeenCalledWith(expect.any(Function));
    expect(setTokens).toHaveBeenCalledWith(expect.any(Function));
    expect(clearSelectionContextMenu).toHaveBeenCalled();
    expect(publishAppEventMock).toHaveBeenCalledWith("combatActionUsed", { type: "action" });
  });
});
