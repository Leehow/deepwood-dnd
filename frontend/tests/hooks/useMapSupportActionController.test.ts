import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMapSupportActionController } from "../../app/components/map/hooks/useMapSupportActionController";

const publishAppEventMock = vi.fn();

vi.mock("../../app/events/appEventBus", () => ({
  publishAppEvent: (...args: any[]) => publishAppEventMock(...args),
}));

describe("useMapSupportActionController", () => {
  beforeEach(() => {
    publishAppEventMock.mockReset();
  });

  it("opens Preserve Life modal with nearby valid targets", () => {
    const setPreserveLifeModal = vi.fn();
    const clearSelectionContextMenu = vi.fn();

    const { result } = renderHook(() =>
      useMapSupportActionController({
        tokens: [
          {
            id: 1,
            character_id: 18,
            instance_name: "牧师",
            position_x: 0,
            position_y: 0,
            token_size: "1x1",
            current_hp: 20,
            max_hp: 30,
          } as any,
          {
            id: 2,
            instance_name: "战士",
            position_x: 2,
            position_y: 0,
            token_size: "1x1",
            current_hp: 4,
            max_hp: 20,
          } as any,
          {
            id: 3,
            instance_name: "骷髅",
            monster_type: "undead",
            position_x: 2,
            position_y: 0,
            token_size: "1x1",
            current_hp: 4,
            max_hp: 20,
          } as any,
        ],
        sourceCharacterData: { level: 5, name: "牧师" },
        campaignId: "7",
        gridUnitLength: 5,
        isConnected: true,
        authedFetch: vi.fn() as any,
        showToast: vi.fn(),
        sendMessage: vi.fn(),
        setTokens: vi.fn(),
        setSourceCharacterData: vi.fn(),
        preserveLifeModal: null,
        setPreserveLifeModal,
        knowledgeOfTheAgesModal: null,
        setKnowledgeOfTheAgesModal: vi.fn(),
        visionsOfThePastModal: null,
        setVisionsOfThePastModal: vi.fn(),
        setToolCheckRequest: vi.fn(),
        consumeCharacterResource: vi.fn().mockResolvedValue(null),
        clearSelectionContextMenu,
      }),
    );

    act(() => {
      result.current.openPreserveLifeModal({ uses: { current: 1, max: 2 } }, 1);
    });

    expect(setPreserveLifeModal).toHaveBeenCalledWith(expect.objectContaining({
      sourceCharacterId: 18,
      totalPool: 25,
      targets: [
        expect.objectContaining({ tokenId: 2, name: "战士" }),
      ],
    }));
    expect(clearSelectionContextMenu).toHaveBeenCalled();
  });

  it("submits tool checks through dice_execute", () => {
    const sendMessage = vi.fn();
    const showToast = vi.fn();
    const setToolCheckRequest = vi.fn();

    const { result } = renderHook(() =>
      useMapSupportActionController({
        tokens: [],
        sourceCharacterData: null,
        campaignId: "7",
        gridUnitLength: 5,
        isConnected: true,
        authedFetch: vi.fn() as any,
        showToast,
        sendMessage,
        setTokens: vi.fn(),
        setSourceCharacterData: vi.fn(),
        preserveLifeModal: null,
        setPreserveLifeModal: vi.fn(),
        knowledgeOfTheAgesModal: null,
        setKnowledgeOfTheAgesModal: vi.fn(),
        visionsOfThePastModal: null,
        setVisionsOfThePastModal: vi.fn(),
        setToolCheckRequest,
        consumeCharacterResource: vi.fn().mockResolvedValue(null),
        clearSelectionContextMenu: vi.fn(),
      }),
    );

    act(() => {
      result.current.handleSubmitToolCheck({
        characterId: 18,
        toolId: "thieves_tools",
        ability: "dexterity",
        dc: 15,
        description: "开锁",
        context: { source: "trap" },
      });
    });

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "dice_execute",
    }));
    expect(showToast).toHaveBeenCalledWith("正在进行开锁检定 (DC 15)...", "info");
    expect(setToolCheckRequest).toHaveBeenCalledWith(null);
  });

  it("opens Knowledge of the Ages modal for valid character sources", () => {
    const setKnowledgeOfTheAgesModal = vi.fn();
    const clearSelectionContextMenu = vi.fn();

    const { result } = renderHook(() =>
      useMapSupportActionController({
        tokens: [],
        sourceCharacterData: null,
        campaignId: "7",
        gridUnitLength: 5,
        isConnected: true,
        authedFetch: vi.fn() as any,
        showToast: vi.fn(),
        sendMessage: vi.fn(),
        setTokens: vi.fn(),
        setSourceCharacterData: vi.fn(),
        preserveLifeModal: null,
        setPreserveLifeModal: vi.fn(),
        knowledgeOfTheAgesModal: null,
        setKnowledgeOfTheAgesModal,
        visionsOfThePastModal: null,
        setVisionsOfThePastModal: vi.fn(),
        setToolCheckRequest: vi.fn(),
        consumeCharacterResource: vi.fn().mockResolvedValue(null),
        clearSelectionContextMenu,
      }),
    );

    const opened = result.current.openKnowledgeOfTheAgesModal({
      action: { id: "knowledge_of_the_ages", name: "知识通道", uses: { current: 1, max: 1 } },
      sourceTokenId: 3,
      sourceToken: {
        id: 3,
        character_id: 18,
        instance_name: "牧师",
      } as any,
      sourceName: "牧师",
    });

    expect(opened).toBe(true);
    expect(setKnowledgeOfTheAgesModal).toHaveBeenCalledWith({
      sourceTokenId: 3,
      sourceCharacterId: 18,
      sourceName: "牧师",
      action: { id: "knowledge_of_the_ages", name: "知识通道", uses: { current: 1, max: 1 } },
    });
    expect(clearSelectionContextMenu).toHaveBeenCalled();
  });

  it("opens Visions of the Past modal with suggested object focus", () => {
    const setVisionsOfThePastModal = vi.fn();
    const clearSelectionContextMenu = vi.fn();

    const { result } = renderHook(() =>
      useMapSupportActionController({
        tokens: [
          {
            id: 9,
            instance_name: "古老祭坛",
            position_x: 6,
            position_y: 8,
            token_size: "1x1",
          } as any,
        ],
        sourceCharacterData: null,
        campaignId: "7",
        currentMapUrl: "/maps/temple-sanctum.png",
        gridUnitLength: 5,
        isConnected: true,
        authedFetch: vi.fn() as any,
        showToast: vi.fn(),
        sendMessage: vi.fn(),
        setTokens: vi.fn(),
        setSourceCharacterData: vi.fn(),
        preserveLifeModal: null,
        setPreserveLifeModal: vi.fn(),
        knowledgeOfTheAgesModal: null,
        setKnowledgeOfTheAgesModal: vi.fn(),
        visionsOfThePastModal: null,
        setVisionsOfThePastModal,
        setToolCheckRequest: vi.fn(),
        consumeCharacterResource: vi.fn().mockResolvedValue(null),
        clearSelectionContextMenu,
      }),
    );

    const opened = result.current.openVisionsOfThePastModal({
      action: { id: "visions_of_the_past", name: "异象", uses: { current: 1, max: 1 } },
      sourceTokenId: 1,
      sourceToken: {
        id: 1,
        character_id: 18,
        instance_name: "牧师",
        position_x: 4,
        position_y: 5,
      } as any,
      sourceName: "牧师",
      targetTokenId: 9,
    });

    expect(opened).toBe(true);
    expect(setVisionsOfThePastModal).toHaveBeenCalledWith({
      sourceTokenId: 1,
      sourceCharacterId: 18,
      sourceName: "牧师",
      action: { id: "visions_of_the_past", name: "异象", uses: { current: 1, max: 1 } },
      suggestedMode: "object",
      suggestedFocus: "古老祭坛",
    });
    expect(clearSelectionContextMenu).toHaveBeenCalled();
  });

  it("handles Knowledge of the Ages confirmation and clears modal state", async () => {
    const consumeCharacterResource = vi.fn().mockResolvedValue({ current: 0, max: 1 });
    const authedFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status_effects: { special_buffs: {} },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });
    const setSourceCharacterData = vi.fn();
    const sendMessage = vi.fn();
    const showToast = vi.fn();
    const setKnowledgeOfTheAgesModal = vi.fn();
    const clearSelectionContextMenu = vi.fn();

    const { result } = renderHook(() =>
      useMapSupportActionController({
        tokens: [],
        sourceCharacterData: null,
        campaignId: "7",
        gridUnitLength: 5,
        isConnected: true,
        authedFetch: authedFetch as any,
        showToast,
        sendMessage,
        setTokens: vi.fn(),
        setSourceCharacterData,
        preserveLifeModal: null,
        setPreserveLifeModal: vi.fn(),
        knowledgeOfTheAgesModal: {
          sourceTokenId: 1,
          sourceCharacterId: 18,
          sourceName: "牧师",
          action: { id: "channel_divinity_cleric", name: "知识通道" },
        },
        setKnowledgeOfTheAgesModal,
        visionsOfThePastModal: null,
        setVisionsOfThePastModal: vi.fn(),
        setToolCheckRequest: vi.fn(),
        consumeCharacterResource,
        clearSelectionContextMenu,
      }),
    );

    await act(async () => {
      await result.current.handleKnowledgeOfTheAgesConfirm({
        kind: "skill",
        proficiencyId: "arcana",
        label: "奥秘",
      });
    });

    expect(consumeCharacterResource).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalled();
    expect(setSourceCharacterData).toHaveBeenCalledWith(expect.any(Function));
    expect(showToast).toHaveBeenCalledWith("牧师 获得 奥秘 熟练（10分钟）", "success");
    expect(publishAppEventMock).toHaveBeenCalledWith("combatActionUsed", { type: "action" });
    expect(setKnowledgeOfTheAgesModal).toHaveBeenCalledWith(null);
    expect(clearSelectionContextMenu).toHaveBeenCalled();
  });

  it("handles Visions of the Past confirmation", async () => {
    const authedFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    const sendMessage = vi.fn();
    const showToast = vi.fn();
    const setVisionsOfThePastModal = vi.fn();
    const clearSelectionContextMenu = vi.fn();

    const { result } = renderHook(() =>
      useMapSupportActionController({
        tokens: [],
        sourceCharacterData: null,
        campaignId: "7",
        gridUnitLength: 5,
        isConnected: true,
        authedFetch: authedFetch as any,
        showToast,
        sendMessage,
        setTokens: vi.fn(),
        setSourceCharacterData: vi.fn(),
        preserveLifeModal: null,
        setPreserveLifeModal: vi.fn(),
        knowledgeOfTheAgesModal: null,
        setKnowledgeOfTheAgesModal: vi.fn(),
        visionsOfThePastModal: {
          sourceCharacterId: 18,
          sourceName: "牧师",
          action: {
            id: "visions_of_the_past",
            name: "异象",
            uses: { current: 1, max: 1, recharge: "short_rest" },
          },
        },
        setVisionsOfThePastModal,
        setToolCheckRequest: vi.fn(),
        consumeCharacterResource: vi.fn().mockResolvedValue(null),
        clearSelectionContextMenu,
      }),
    );

    await act(async () => {
      await result.current.handleVisionsOfThePastConfirm({
        mode: "area",
        focus: "祭坛大厅",
        details: "最近的血祭",
        question: "谁主持了仪式？",
      });
    });

    expect(sendMessage).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("牧师 触发了异象：地点回溯", "success");
    expect(publishAppEventMock).toHaveBeenCalledWith("combatActionUsed", { type: "action" });
    expect(setVisionsOfThePastModal).toHaveBeenCalledWith(null);
    expect(clearSelectionContextMenu).toHaveBeenCalled();
  });
});
