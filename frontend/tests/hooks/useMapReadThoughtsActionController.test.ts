import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMapReadThoughtsActionController } from "../../app/components/map/hooks/useMapReadThoughtsActionController";
import type { Token } from "../../app/components/map/types/TacticalMapTypes";

const publishAppEventMock = vi.fn();
const castSpellViaAPIMock = vi.fn();

vi.mock("../../app/events/appEventBus", () => ({
  publishAppEvent: (...args: any[]) => publishAppEventMock(...args),
}));

vi.mock("../../app/utils/sidebarCasting", () => ({
  castSpellViaAPI: (...args: any[]) => castSpellViaAPIMock(...args),
}));

vi.mock("~/data/rules/spells.json", () => ({
  default: [
    {
      id: "suggestion",
      name: "暗示术",
      level: 2,
      school: "enchantment",
      attack_type: "save",
      save_type: "wisdom",
      save_effect: "none",
      range: "30尺",
      concentration: true,
      is_control_spell: true,
      control_effect: { id: "suggested" },
      effects: [{ id: "suggested" }],
    },
  ],
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

describe("useMapReadThoughtsActionController", () => {
  beforeEach(() => {
    publishAppEventMock.mockReset();
    castSpellViaAPIMock.mockReset();
  });

  it("casts Suggestion via castSpellViaAPI when the target is already linked", async () => {
    castSpellViaAPIMock.mockResolvedValue({ success: true, total_damage: 0, results: [] });
    const sourceToken = createToken({ id: 11, character_id: 18, instance_name: "牧师" });
    const targetToken = createToken({ id: 22, monster_instance_id: 91, position_x: 1, monster_name: "食人魔" });
    const persistTokenActiveEffects = vi.fn().mockResolvedValue(undefined);
    const clearSelectionContextMenu = vi.fn();
    const showToast = vi.fn();

    const { result } = renderHook(() =>
      useMapReadThoughtsActionController({
        tokens: [sourceToken, targetToken],
        tokenStatusEffects: {
          11: [
            {
              id: "read_thoughts_link_22",
              metadata: {
                sourceFeatureId: "read_thoughts",
                targetTokenId: 22,
              },
            },
          ],
        },
        sourceCharacterData: { ability_scores: { wisdom: 18 }, level: 10 },
        campaignId: "7",
        userId: "dm-user",
        isDM: true,
        gridUnitLength: 5,
        authedFetch: vi.fn() as any,
        showToast,
        sendMessage: vi.fn(),
        persistTokenActiveEffects,
        consumeCharacterResource: vi.fn().mockResolvedValue(null),
        buildSavingThrowTargetData: vi.fn(),
        clearSelectionContextMenu,
      }),
    );

    await act(async () => {
      await result.current.handleReadThoughtsAction({
        action: { id: "read_thoughts", name: "阅读思想", uses: { current: 1, max: 1 } },
        sourceTokenId: 11,
        sourceToken,
        sourceName: "牧师",
        targetTokenId: 22,
      });
    });

    expect(castSpellViaAPIMock).toHaveBeenCalledWith(
      "suggestion", 0, 11, [22], "7",
      undefined, true, false, undefined, undefined, undefined, true,
    );
    expect(persistTokenActiveEffects).toHaveBeenCalledWith(11, []);
    expect(clearSelectionContextMenu).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("牧师 借助阅读思想对 食人魔 施放了暗示术", "success");
    expect(publishAppEventMock).toHaveBeenCalledWith("combatActionUsed", { type: "action" });
  });

  it("persists a Read Thoughts link after the target fails the saving throw", async () => {
    const sourceToken = createToken({ id: 11, character_id: 18, instance_name: "牧师" });
    const targetToken = createToken({ id: 22, monster_instance_id: 91, position_x: 1, monster_name: "食人魔" });
    const authedFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: {
          target_results: [{ success: false }],
        },
      }),
    });
    const consumeCharacterResource = vi.fn().mockResolvedValue({ current: 0, max: 1 });
    const persistTokenActiveEffects = vi.fn().mockResolvedValue(undefined);
    const sendMessage = vi.fn();
    const clearSelectionContextMenu = vi.fn();

    const { result } = renderHook(() =>
      useMapReadThoughtsActionController({
        tokens: [sourceToken, targetToken],
        tokenStatusEffects: { 11: [] },
        sourceCharacterData: { ability_scores: { wisdom: 18 }, level: 10 },
        campaignId: "7",
        userId: "dm-user",
        isDM: true,
        gridUnitLength: 5,
        authedFetch: authedFetch as any,
        showToast: vi.fn(),
        sendMessage,
        persistTokenActiveEffects,
        consumeCharacterResource,
        buildSavingThrowTargetData: vi.fn().mockResolvedValue({ token_id: 22 }),
        clearSelectionContextMenu,
      }),
    );

    await act(async () => {
      await result.current.handleReadThoughtsAction({
        action: { id: "read_thoughts", name: "阅读思想", uses: { current: 1, max: 1 } },
        sourceTokenId: 11,
        sourceToken,
        sourceName: "牧师",
        targetTokenId: 22,
      });
    });

    expect(consumeCharacterResource).toHaveBeenCalledWith(
      18,
      "channel_divinity_cleric",
      expect.objectContaining({ id: "read_thoughts" }),
      "阅读思想",
    );
    expect(authedFetch).toHaveBeenCalledWith(
      "/api/combat/saving-throw?user_id=dm-user&role=dm",
      expect.objectContaining({ method: "POST" }),
    );
    expect(persistTokenActiveEffects).toHaveBeenCalledWith(11, [
      expect.objectContaining({
        id: "read_thoughts_link_22",
        metadata: expect.objectContaining({
          sourceFeatureId: "read_thoughts",
          targetTokenId: 22,
        }),
      }),
    ]);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "chat" }));
    expect(clearSelectionContextMenu).toHaveBeenCalled();
    expect(publishAppEventMock).toHaveBeenCalledWith("combatActionUsed", { type: "action" });
  });

  it("shows a warning when the target resists Read Thoughts", async () => {
    const sourceToken = createToken({ id: 11, character_id: 18, instance_name: "牧师" });
    const targetToken = createToken({ id: 22, character_id: 45, position_x: 1, character_name: "游侠" });
    const authedFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: {
          target_results: [{ success: true }],
        },
      }),
    });
    const showToast = vi.fn();
    const sendMessage = vi.fn();

    const { result } = renderHook(() =>
      useMapReadThoughtsActionController({
        tokens: [sourceToken, targetToken],
        tokenStatusEffects: { 11: [] },
        sourceCharacterData: { ability_scores: { wisdom: 16 }, level: 8 },
        campaignId: "7",
        userId: "player-user",
        isDM: false,
        gridUnitLength: 5,
        authedFetch: authedFetch as any,
        showToast,
        sendMessage,
        persistTokenActiveEffects: vi.fn().mockResolvedValue(undefined),
        consumeCharacterResource: vi.fn().mockResolvedValue({ current: 0, max: 1 }),
        buildSavingThrowTargetData: vi.fn().mockResolvedValue({ token_id: 22 }),
        clearSelectionContextMenu: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleReadThoughtsAction({
        action: { id: "read_thoughts", name: "阅读思想", uses: { current: 1, max: 1 } },
        sourceTokenId: 11,
        sourceToken,
        sourceName: "牧师",
        targetTokenId: 22,
      });
    });

    expect(showToast).toHaveBeenCalledWith("游侠 抵抗了阅读思想", "warning");
    expect(sendMessage).not.toHaveBeenCalled();
    expect(publishAppEventMock).toHaveBeenCalledWith("combatActionUsed", { type: "action" });
  });
});
