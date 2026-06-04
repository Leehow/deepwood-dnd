import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMapChannelDivinityActionController } from "../../app/components/map/hooks/useMapChannelDivinityActionController";
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

describe("useMapChannelDivinityActionController", () => {
  beforeEach(() => {
    publishAppEventMock.mockReset();
    castSpellViaAPIMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles Charm Animals and Plants and syncs returned active effects", async () => {
    const sourceToken = createToken({ id: 11, character_id: 18, instance_name: "德鲁伊" });
    const targetToken = createToken({ id: 22, monster_name: "狼", monster_type: "beast" });
    const authedFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        channel_divinity_current: 0,
        channel_divinity_max: 1,
        targets: [{ token_id: 22, active_effects: [{ id: "charmed" }] }],
        failed_saves: 1,
        successful_saves: 0,
        immune_targets: 0,
      }),
    });
    const persistTokenActiveEffects = vi.fn().mockResolvedValue(undefined);
    const clearSelectionContextMenu = vi.fn();
    const setSourceCharacterData = vi.fn();

    const { result } = renderHook(() =>
      useMapChannelDivinityActionController({
        tokens: [sourceToken, targetToken],
        tokenStatusEffects: {},
        sourceCharacterData: { actions: [{ id: "channel_divinity_cleric", uses: { current: 1, max: 1 } }] },
        campaignId: "7",
        authedFetch: authedFetch as any,
        showToast: vi.fn(),
        sendMessage: vi.fn(),
        setTokens: vi.fn(),
        setSourceCharacterData,
        persistTokenActiveEffects,
        clearSelectionContextMenu,
      }),
    );

    await act(async () => {
      await result.current.handleCharmAnimalsAndPlantsAction({
        sourceTokenId: 11,
        sourceToken,
        sourceName: "德鲁伊",
      });
    });

    expect(authedFetch).toHaveBeenCalledWith(
      "/api/characters/18/charm-animals-and-plants",
      expect.objectContaining({ method: "POST" }),
    );
    expect(setSourceCharacterData).toHaveBeenCalledWith(expect.any(Function));
    expect(persistTokenActiveEffects).toHaveBeenCalledWith(22, [{ id: "charmed" }]);
    expect(clearSelectionContextMenu).toHaveBeenCalled();
    expect(publishAppEventMock).toHaveBeenCalledWith("combatActionUsed", { type: "action" });
  });

  it("handles Master of Nature and emits typed bonus-action result", async () => {
    const sourceToken = createToken({ id: 11, character_id: 18, instance_name: "德鲁伊" });
    const targetToken = createToken({ id: 22, monster_name: "狼" });
    const authedFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        controlled_targets: [{
          token_id: 22,
          user_id: "dm",
          faction: "player",
          controller_character_id: 18,
          control_type: "charmed",
          active_effects: [{ id: "master_of_nature" }],
        }],
        skipped_targets: [],
      }),
    });
    const setTokens = vi.fn();
    const persistTokenActiveEffects = vi.fn().mockResolvedValue(undefined);
    const clearSelectionContextMenu = vi.fn();

    const { result } = renderHook(() =>
      useMapChannelDivinityActionController({
        tokens: [sourceToken, targetToken],
        tokenStatusEffects: {},
        sourceCharacterData: {},
        campaignId: "7",
        authedFetch: authedFetch as any,
        showToast: vi.fn(),
        sendMessage: vi.fn(),
        setTokens,
        setSourceCharacterData: vi.fn(),
        persistTokenActiveEffects,
        clearSelectionContextMenu,
      }),
    );

    await act(async () => {
      await result.current.handleMasterOfNatureAction({
        action: { id: "master_of_nature", name: "自然大师" },
        sourceTokenId: 11,
        sourceToken,
        sourceName: "德鲁伊",
      });
    });

    expect(setTokens).toHaveBeenCalledWith(expect.any(Function));
    expect(persistTokenActiveEffects).toHaveBeenCalledWith(22, [{ id: "master_of_nature" }]);
    expect(publishAppEventMock).toHaveBeenNthCalledWith(1, "combatActionUsed", { type: "bonus_action" });
    expect(publishAppEventMock).toHaveBeenNthCalledWith(2, "combatBonusActionResult", {
      tokenId: 11,
      tokenName: "德鲁伊",
      actionName: "自然大师",
      actionIcon: "🌳",
    });
    expect(clearSelectionContextMenu).toHaveBeenCalled();
  });

  it("calls castSpellViaAPI for Turn Undead with undead targets in range", async () => {
    castSpellViaAPIMock.mockResolvedValue({
      success: true,
      results: [{ condition_applied: "turned", target_token_id: 22 }],
      destroyed_token_ids: [],
    });
    const sourceToken = createToken({ id: 11, character_id: 18, instance_name: "牧师" });
    const undeadToken = createToken({
      id: 22,
      position_x: 1,
      monster_name: "骷髅",
      monster_type: "undead",
    });
    const authedFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ class_feature_uses: {} }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const setSourceCharacterData = vi.fn();
    const clearSelectionContextMenu = vi.fn();

    const { result } = renderHook(() =>
      useMapChannelDivinityActionController({
        tokens: [sourceToken, undeadToken],
        tokenStatusEffects: { 22: [] },
        sourceCharacterData: {
          level: 4,
          ability_scores: { wisdom: 16 },
          actions: [{ id: "channel_divinity_cleric", uses: { current: 1, max: 1 } }],
        },
        campaignId: "7",
        authedFetch: authedFetch as any,
        showToast: vi.fn(),
        sendMessage: vi.fn(),
        setTokens: vi.fn(),
        setSourceCharacterData,
        persistTokenActiveEffects: vi.fn().mockResolvedValue(undefined),
        clearSelectionContextMenu,
      }),
    );

    await act(async () => {
      await result.current.handleTurnUndeadAction({
        action: { id: "turn_undead", name: "驱散不死生物", uses: { current: 1, max: 1 } },
        sourceTokenId: 11,
        sourceToken,
        sourceName: "牧师",
      });
    });

    expect(setSourceCharacterData).toHaveBeenCalledWith(expect.any(Function));
    expect(castSpellViaAPIMock).toHaveBeenCalledWith(
      "turn_undead", 0, 11, [22], "7",
      undefined, true, false,
    );
    expect(clearSelectionContextMenu).toHaveBeenCalled();
    expect(publishAppEventMock).toHaveBeenCalledWith("combatActionUsed", { type: "action" });
  });
});
