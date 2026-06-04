import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMapTransformationController } from "../../app/components/map/hooks/useMapTransformationController";
import type { Token, TransformationData } from "../../app/components/map/types/TacticalMapTypes";

const publishAppEventMock = vi.fn();

vi.mock("../../app/events/appEventBus", async () => {
  const actual = await vi.importActual<typeof import("../../app/events/appEventBus")>(
    "../../app/events/appEventBus",
  );
  return {
    ...actual,
    publishAppEvent: (...args: any[]) => publishAppEventMock(...args),
  };
});

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

describe("useMapTransformationController", () => {
  beforeEach(() => {
    publishAppEventMock.mockReset();
  });

  it("opens wild shape modal from the legacy event bridge", () => {
    const clearSelectionContextMenu = vi.fn();

    const { result } = renderHook(() => {
      const [tokens, setTokens] = useState<Token[]>([
        createToken({ id: 11, character_id: 18, instance_name: "德鲁伊" }),
      ]);
      const [sourceCharacterData, setSourceCharacterData] = useState<any>({ id: 18, name: "德鲁伊" });
      const controller = useMapTransformationController({
        tokens,
        sourceCharacterData,
        campaignId: "7",
        authedFetch: vi.fn() as any,
        showToast: vi.fn(),
        sendMessage: vi.fn(),
        setTokens,
        setSourceCharacterData,
        clearSelectionContextMenu,
      });
      return controller;
    });

    act(() => {
      window.dispatchEvent(new CustomEvent("wildShapeTarget", {
        detail: {
          sourceCharacterId: 18,
          execution: { configId: "wild_shape" },
        },
      }));
    });

    expect(result.current.transformModalOpen).toBe(true);
    expect(result.current.transformTokenId).toBe(11);
    expect(result.current.transformConfigId).toBe("wild_shape");
    expect(clearSelectionContextMenu).toHaveBeenCalled();
  });

  it("consumes wild shape, persists transformation, and closes the modal", async () => {
    const authedFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ current: 1, max: 2 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });
    const sendMessage = vi.fn();
    const showToast = vi.fn();

    const transformData: TransformationData = {
      type: "full_replace",
      beast_name: "棕熊",
      max_hp: 34,
      ac: 11,
      size: "大型",
      started_at: "2026-03-21T00:00:00.000Z",
      source: {
        config_id: "wild_shape",
        source_type: "class_feature",
        spell_name: "野性形态",
      },
    };

    const { result } = renderHook(() => {
      const [tokens, setTokens] = useState<Token[]>([
        createToken({ id: 11, character_id: 18, instance_name: "德鲁伊" }),
      ]);
      const [sourceCharacterData, setSourceCharacterData] = useState<any>({
        id: 18,
        name: "德鲁伊",
        class_id: "druid",
        subclass_id: "moon",
        level: 3,
        actions: [
          {
            id: "wild_shape",
            name: "野性形态",
            uses: { current: 2, max: 2 },
          },
        ],
      });
      const controller = useMapTransformationController({
        tokens,
        sourceCharacterData,
        campaignId: "7",
        authedFetch: authedFetch as any,
        showToast,
        sendMessage,
        setTokens,
        setSourceCharacterData,
        clearSelectionContextMenu: vi.fn(),
      });
      return {
        ...controller,
        tokens,
        sourceCharacterData,
      };
    });

    act(() => {
      result.current.handleTransform(11, "wild_shape");
    });

    await act(async () => {
      await result.current.handleTransformComplete(transformData);
    });

    expect(authedFetch).toHaveBeenNthCalledWith(1,
      "/api/characters/18/resources/use",
      expect.objectContaining({ method: "POST" }),
    );
    expect(authedFetch).toHaveBeenNthCalledWith(2,
      "/api/tokens/11/transform",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.current.tokens[0].transformation_data).toEqual(transformData);
    expect(result.current.sourceCharacterData.actions[0].uses.current).toBe(1);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "chat" }));
    expect(publishAppEventMock).toHaveBeenCalledWith("combatActionUsed", { type: "bonus_action" });
    expect(result.current.transformModalOpen).toBe(false);
    expect(result.current.transformTokenId).toBeNull();
    expect(result.current.transformTokenIdRef.current).toBeNull();
    expect(showToast).toHaveBeenCalledWith("德鲁伊 变形为 棕熊", "success");
  });

  it("ends transformation and restores original size for modifier forms", async () => {
    const authedFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const clearSelectionContextMenu = vi.fn();
    const sendMessage = vi.fn();

    const transformationData: TransformationData = {
      type: "modifier",
      beast_name: "巨大形态",
      original_size: "中型",
      size: "大型",
      started_at: "2026-03-21T00:00:00.000Z",
      source: {
        config_id: "enlarge-reduce",
        source_type: "spell",
        spell_name: "变巨 / 缩小术",
      },
    };

    const { result } = renderHook(() => {
      const [tokens, setTokens] = useState<Token[]>([
        createToken({
          id: 11,
          character_id: 18,
          instance_name: "战士",
          transformation_data: transformationData,
        }),
      ]);
      const [sourceCharacterData, setSourceCharacterData] = useState<any>({ id: 18, name: "战士" });
      const controller = useMapTransformationController({
        tokens,
        sourceCharacterData,
        campaignId: "7",
        authedFetch: authedFetch as any,
        showToast: vi.fn(),
        sendMessage,
        setTokens,
        setSourceCharacterData,
        clearSelectionContextMenu,
      });
      return {
        ...controller,
        tokens,
      };
    });

    await act(async () => {
      await result.current.handleEndTransformation(11);
    });

    expect(authedFetch).toHaveBeenNthCalledWith(1,
      "/api/tokens/11/transform",
      expect.objectContaining({ method: "POST" }),
    );
    expect(authedFetch).toHaveBeenNthCalledWith(2,
      "/api/tokens/11/size",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(result.current.tokens[0].transformation_data).toBeNull();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "chat" }));
    expect(clearSelectionContextMenu).toHaveBeenCalled();
  });
});
