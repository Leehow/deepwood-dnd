import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMapTargetSaveEffectController } from "../../app/components/map/hooks/useMapTargetSaveEffectController";
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

describe("useMapTargetSaveEffectController", () => {
  beforeEach(() => {
    publishAppEventMock.mockReset();
  });

  it("rejects out-of-range targets before rolling saves", async () => {
    const buildSavingThrowTargetData = vi.fn();
    const showToast = vi.fn();

    const { result } = renderHook(() =>
      useMapTargetSaveEffectController({
        tokens: [
          createToken({ id: 11, instance_name: "法师", position_x: 0, position_y: 0 }),
          createToken({ id: 22, instance_name: "兽人", position_x: 10, position_y: 0 }),
        ],
        tokenStatusEffects: {},
        sourceCharacterData: { level: 5, ability_scores: { wis: 16 } },
        campaignId: "7",
        gridUnitLength: 5,
        authedFetch: vi.fn() as any,
        showToast,
        sendMessage: vi.fn(),
        persistTokenActiveEffects: vi.fn().mockResolvedValue(undefined),
        buildSavingThrowTargetData,
        getEffectDefinitionFn: vi.fn(),
        normalizeExecutionSaveAbility: vi.fn(() => "wisdom" as const),
        resolveExecutionSaveDc: vi.fn(() => 14),
        resolveExecutionDurationRounds: vi.fn(() => 10),
        resolveExecutionEffectId: vi.fn((value) => String(value || "")),
        formatExecutionText: vi.fn(() => ""),
        clearSelectionContextMenu: vi.fn(),
      }),
    );

    const handled = await result.current.handleTargetSaveEffect({
      action: { id: "guiding_word", name: "引导词" },
      execution: {
        type: "target_save_effect",
        target: { rangeFeet: 20, allowSelf: false },
      },
      actionResourceType: "bonus_action",
      sourceTokenId: 11,
      sourceToken: createToken({ id: 11, instance_name: "法师", position_x: 0, position_y: 0 }),
      sourceName: "法师",
      targetTokenId: 22,
    });

    expect(handled).toBe(false);
    expect(showToast).toHaveBeenCalledWith("目标超出 20 尺范围", "error");
    expect(buildSavingThrowTargetData).not.toHaveBeenCalled();
  });

  it("applies on-fail effects and publishes bonus action usage", async () => {
    const persistTokenActiveEffects = vi.fn().mockResolvedValue(undefined);
    const sendMessage = vi.fn();
    const showToast = vi.fn();
    const clearSelectionContextMenu = vi.fn();

    const { result } = renderHook(() =>
      useMapTargetSaveEffectController({
        tokens: [
          createToken({ id: 11, instance_name: "法师", position_x: 0, position_y: 0, character_level: 5 }),
          createToken({ id: 22, instance_name: "兽人", position_x: 1, position_y: 0 }),
        ],
        tokenStatusEffects: { 22: [] },
        sourceCharacterData: { level: 5, ability_scores: { wis: 16 } },
        campaignId: "7",
        gridUnitLength: 5,
        authedFetch: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            result: {
              target_results: [{ success: false, save_total: 7 }],
            },
          }),
        }) as any,
        showToast,
        sendMessage,
        persistTokenActiveEffects,
        buildSavingThrowTargetData: vi.fn().mockResolvedValue({ token_id: 22 }),
        getEffectDefinitionFn: vi.fn(() => ({ name: "失能", visual: { icon: "✨", color: "#a855f7" } })),
        normalizeExecutionSaveAbility: vi.fn(() => "wisdom" as const),
        resolveExecutionSaveDc: vi.fn(() => 14),
        resolveExecutionDurationRounds: vi.fn(() => 3),
        resolveExecutionEffectId: vi.fn((value) => String(value || "")),
        formatExecutionText: vi.fn((template, values) =>
          typeof template === "string"
            ? template.replace("{target}", String(values.target ?? ""))
            : "",
        ),
        clearSelectionContextMenu,
      }),
    );

    const handled = await result.current.handleTargetSaveEffect({
      action: { id: "guiding_word", name: "引导词", description: "迫使目标豁免" },
      execution: {
        type: "target_save_effect",
        target: { rangeFeet: 30, allowSelf: false },
        save: { ability: "wisdom", dc: { fixed: 14 } },
        onFail: {
          applyEffect: {
            id: "guided_debuff",
            name: "引导失能",
            metadata: { sourceFeatureId: "guiding_word" },
          },
          chatMessage: "{target} 未通过豁免",
          toastMessage: "{target} 被命中",
        },
      },
      actionResourceType: "bonus_action",
      sourceTokenId: 11,
      sourceToken: createToken({ id: 11, instance_name: "法师", position_x: 0, position_y: 0, character_level: 5 }),
      sourceName: "法师",
      targetTokenId: 22,
    });

    expect(handled).toBe(true);
    expect(persistTokenActiveEffects).toHaveBeenCalledWith(22, [
      expect.objectContaining({
        id: "guided_debuff",
        metadata: expect.objectContaining({
          sourceTokenId: 11,
          sourceName: "法师",
        }),
      }),
    ]);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "chat" }));
    expect(showToast).toHaveBeenCalledWith("兽人 被命中", "warning");
    expect(publishAppEventMock).toHaveBeenCalledWith("combatActionUsed", { type: "bonus_action" });
    expect(publishAppEventMock).toHaveBeenCalledWith("combatBonusActionResult", {
      tokenId: 11,
      tokenName: "法师",
      actionName: "引导词",
      actionIcon: "🎯",
    });
    expect(clearSelectionContextMenu).toHaveBeenCalled();
  });

  it("sends success messaging without applying an effect", async () => {
    const sendMessage = vi.fn();
    const showToast = vi.fn();

    const { result } = renderHook(() =>
      useMapTargetSaveEffectController({
        tokens: [
          createToken({ id: 11, instance_name: "牧师", position_x: 0, position_y: 0, character_level: 5 }),
          createToken({ id: 22, instance_name: "强盗", position_x: 1, position_y: 1 }),
        ],
        tokenStatusEffects: {},
        sourceCharacterData: { level: 5, ability_scores: { wis: 16 } },
        campaignId: "7",
        gridUnitLength: 5,
        authedFetch: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            result: {
              target_results: [{ success: true, save_total: 18 }],
            },
          }),
        }) as any,
        showToast,
        sendMessage,
        persistTokenActiveEffects: vi.fn().mockResolvedValue(undefined),
        buildSavingThrowTargetData: vi.fn().mockResolvedValue({ token_id: 22 }),
        getEffectDefinitionFn: vi.fn(),
        normalizeExecutionSaveAbility: vi.fn(() => "wisdom" as const),
        resolveExecutionSaveDc: vi.fn(() => 14),
        resolveExecutionDurationRounds: vi.fn(),
        resolveExecutionEffectId: vi.fn((value) => String(value || "")),
        formatExecutionText: vi.fn((template, values) =>
          typeof template === "string"
            ? template.replace("{target}", String(values.target ?? ""))
            : "",
        ),
        clearSelectionContextMenu: vi.fn(),
      }),
    );

    const handled = await result.current.handleTargetSaveEffect({
      action: { id: "guiding_word", name: "引导词", description: "迫使目标豁免" },
      execution: {
        type: "target_save_effect",
        target: { rangeFeet: 30, allowSelf: false },
        save: { ability: "wisdom", dc: { fixed: 14 } },
        onSuccess: {
          chatMessage: "{target} 成功豁免",
          toastMessage: "{target} 顶住了效果",
        },
      },
      actionResourceType: "action",
      sourceTokenId: 11,
      sourceToken: createToken({ id: 11, instance_name: "牧师", position_x: 0, position_y: 0, character_level: 5 }),
      sourceName: "牧师",
      targetTokenId: 22,
    });

    expect(handled).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "chat" }));
    expect(showToast).toHaveBeenCalledWith("强盗 顶住了效果", "success");
    expect(publishAppEventMock).toHaveBeenCalledWith("combatActionUsed", { type: "action" });
  });
});
