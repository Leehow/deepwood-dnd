import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMapBonusActionRoutingController } from "../../app/components/map/hooks/useMapBonusActionRoutingController";
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

function createController(overrides: Partial<Parameters<typeof useMapBonusActionRoutingController>[0]> = {}) {
  return renderHook(() =>
    useMapBonusActionRoutingController({
      sourceCharacterData: null,
      showToast: vi.fn(),
      clearSelectionContextMenu: vi.fn(),
      handleTransform: vi.fn(),
      handleTargetSaveEffect: vi.fn().mockResolvedValue(true),
      openPreserveLifeModal: vi.fn(),
      openInvokeDuplicityModal: vi.fn(),
      handleWardingFlareAction: vi.fn().mockResolvedValue(undefined),
      handleDampenElementsAction: vi.fn(),
      handleWrathOfTheStormAction: vi.fn(),
      handleGuidedStrikeAction: vi.fn().mockResolvedValue(undefined),
      handleWarGodsBlessingAction: vi.fn().mockResolvedValue(undefined),
      handleDestructiveWrathAction: vi.fn().mockResolvedValue(undefined),
      openKnowledgeOfTheAgesModal: vi.fn(() => true),
      openVisionsOfThePastModal: vi.fn(() => true),
      handleReadThoughtsAction: vi.fn().mockResolvedValue(undefined),
      handleCharmAnimalsAndPlantsAction: vi.fn().mockResolvedValue(undefined),
      handleMasterOfNatureAction: vi.fn().mockResolvedValue(undefined),
      handleTurnUndeadAction: vi.fn().mockResolvedValue(undefined),
      handleCloakOfShadowsAction: vi.fn().mockResolvedValue(undefined),
      handleBlessingOfTheTricksterAction: vi.fn().mockResolvedValue(undefined),
      handleRadianceOfTheDawnAction: vi.fn().mockResolvedValue(undefined),
      handleCoronaOfLightAction: vi.fn().mockResolvedValue(undefined),
      knowledgeOfTheAgesFeatureId: "knowledge_of_the_ages",
      ...overrides,
    }),
  );
}

describe("useMapBonusActionRoutingController", () => {
  beforeEach(() => {
    publishAppEventMock.mockReset();
  });

  it("routes typed openEvent through appEventBus", async () => {
    const clearSelectionContextMenu = vi.fn();
    const { result } = createController({ clearSelectionContextMenu });

    const handled = await result.current.handleBonusActionRoute({
      action: { id: "wild_shape", name: "野性变形", resourceId: "wild_shape" },
      execution: { openEvent: "wildShapeTarget" },
      actionResourceType: "bonus_action",
      sourceTokenId: 11,
      sourceToken: createToken({ id: 11, character_id: 18 }),
      sourceName: "德鲁伊",
    });

    expect(handled).toBe(true);
    expect(publishAppEventMock).toHaveBeenCalledWith("wildShapeTarget", {
      sourceCharacterId: 18,
      resourceId: "wild_shape",
      execution: { openEvent: "wildShapeTarget" },
    });
    expect(clearSelectionContextMenu).toHaveBeenCalled();
  });

  it("routes target_save_effect to the dedicated controller", async () => {
    const handleTargetSaveEffect = vi.fn().mockResolvedValue(true);
    const { result } = createController({ handleTargetSaveEffect });

    const sourceToken = createToken({ id: 11, instance_name: "牧师" });
    const handled = await result.current.handleBonusActionRoute({
      action: { id: "guiding_word", name: "引导词" },
      execution: { type: "target_save_effect" },
      actionResourceType: "bonus_action",
      sourceTokenId: 11,
      sourceToken,
      sourceName: "牧师",
      targetTokenId: 22,
    });

    expect(handled).toBe(true);
    expect(handleTargetSaveEffect).toHaveBeenCalledWith({
      action: { id: "guiding_word", name: "引导词" },
      execution: { type: "target_save_effect" },
      actionResourceType: "bonus_action",
      sourceTokenId: 11,
      sourceToken,
      sourceName: "牧师",
      targetTokenId: 22,
    });
  });

  it("routes preserve life and knowledge modal openers", async () => {
    const openPreserveLifeModal = vi.fn();
    const openKnowledgeOfTheAgesModal = vi.fn(() => true);
    const { result } = createController({
      openPreserveLifeModal,
      openKnowledgeOfTheAgesModal,
    });

    const sourceToken = createToken({ id: 11, character_id: 18, instance_name: "牧师" });

    await act(async () => {
      await result.current.handleBonusActionRoute({
        action: { id: "preserve_life", name: "保命通道" },
        execution: {},
        actionResourceType: "action",
        sourceTokenId: 11,
        sourceToken,
        sourceName: "牧师",
      });
    });

    await act(async () => {
      await result.current.handleBonusActionRoute({
        action: { id: "knowledge_of_the_ages", name: "知识通道" },
        execution: {},
        actionResourceType: "action",
        sourceTokenId: 11,
        sourceToken,
        sourceName: "牧师",
      });
    });

    expect(openPreserveLifeModal).toHaveBeenCalledWith({ id: "preserve_life", name: "保命通道" }, 11);
    expect(openKnowledgeOfTheAgesModal).toHaveBeenCalledWith({
      action: { id: "knowledge_of_the_ages", name: "知识通道" },
      sourceTokenId: 11,
      sourceToken,
      sourceName: "牧师",
    });
  });

  it("returns false when the action does not match a special route", async () => {
    const { result } = createController();

    const handled = await result.current.handleBonusActionRoute({
      action: { id: "generic_feature", name: "普通特性" },
      execution: {},
      actionResourceType: "bonus_action",
      sourceTokenId: 11,
      sourceToken: createToken({ id: 11, instance_name: "战士" }),
      sourceName: "战士",
    });

    expect(handled).toBe(false);
  });
});
