import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMapInvokeDuplicityController } from "../../app/components/map/hooks/useMapInvokeDuplicityController";
import type { Token } from "../../app/components/map/types/TacticalMapTypes";
import {
  INVOKE_DUPLICITY_SPELL_ID,
  type InvokeDuplicityModalState,
  type InvokeDuplicityPlacementMode,
} from "../../app/components/map/utils/mapInvokeDuplicityUtils";

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

describe("useMapInvokeDuplicityController", () => {
  beforeEach(() => {
    publishAppEventMock.mockReset();
  });

  it("opens invoke duplicity modal with trickery duplicate cap", () => {
    const clearSelectionContextMenu = vi.fn();
    const sourceToken = createToken({ id: 11, character_id: 18, instance_name: "牧师" });

    const { result } = renderHook(() => {
      const [invokeDuplicityModal, setInvokeDuplicityModal] = useState<InvokeDuplicityModalState | null>(null);
      const [invokeDuplicityPlacementMode, setInvokeDuplicityPlacementMode] = useState<InvokeDuplicityPlacementMode | null>(null);
      const [tokens, setTokens] = useState<Token[]>([sourceToken]);
      const controller = useMapInvokeDuplicityController({
        sourceCharacterData: { level: 17, subclass_id: "trickery" },
        tokens,
        campaignId: "7",
        currentMapUrl: "/maps/test-map.png",
        userId: "42",
        gridUnitLength: 5,
        invokeDuplicityModal,
        setInvokeDuplicityModal,
        invokeDuplicityPlacementMode,
        setInvokeDuplicityPlacementMode,
        authedFetch: vi.fn() as any,
        showToast: vi.fn(),
        sendMessage: vi.fn(),
        setTokens,
        consumeCharacterResource: vi.fn().mockResolvedValue(null),
        setConcentrationOnTokenFn: vi.fn().mockResolvedValue(true),
        clearSelectionContextMenu,
      });
      return { ...controller, invokeDuplicityModal };
    });

    act(() => {
      result.current.openInvokeDuplicityModal({
        action: { id: "invoke_duplicity", name: "诡术通道", uses: { current: 1, max: 1 } },
        sourceTokenId: 11,
        sourceToken,
        sourceName: "牧师",
      });
    });

    expect(result.current.invokeDuplicityModal).toEqual(expect.objectContaining({
      sourceTokenId: 11,
      sourceCharacterId: 18,
      maxDuplicates: 4,
    }));
    expect(clearSelectionContextMenu).toHaveBeenCalled();
  });

  it("promotes modal state into placement mode and supports undo/cancel", () => {
    const sourceToken = createToken({ id: 11, character_id: 18, instance_name: "牧师" });
    const showToast = vi.fn();

    const { result } = renderHook(() => {
      const [invokeDuplicityModal, setInvokeDuplicityModal] = useState<InvokeDuplicityModalState | null>({
        sourceTokenId: 11,
        sourceCharacterId: 18,
        sourceName: "牧师",
        action: { id: "invoke_duplicity", name: "诡术通道", uses: { current: 1, max: 1 } } as any,
        maxDuplicates: 4,
      });
      const [invokeDuplicityPlacementMode, setInvokeDuplicityPlacementMode] = useState<InvokeDuplicityPlacementMode | null>(null);
      const [tokens, setTokens] = useState<Token[]>([sourceToken]);
      const controller = useMapInvokeDuplicityController({
        sourceCharacterData: { level: 17, subclass_id: "trickery" },
        tokens,
        campaignId: "7",
        currentMapUrl: "/maps/test-map.png",
        userId: "42",
        gridUnitLength: 5,
        invokeDuplicityModal,
        setInvokeDuplicityModal,
        invokeDuplicityPlacementMode,
        setInvokeDuplicityPlacementMode,
        authedFetch: vi.fn() as any,
        showToast,
        sendMessage: vi.fn(),
        setTokens,
        consumeCharacterResource: vi.fn().mockResolvedValue(null),
        setConcentrationOnTokenFn: vi.fn().mockResolvedValue(true),
        clearSelectionContextMenu: vi.fn(),
      });
      return {
        ...controller,
        invokeDuplicityModal,
        invokeDuplicityPlacementMode,
      };
    });

    act(() => {
      result.current.handleInvokeDuplicityModalConfirm(2);
    });

    expect(result.current.invokeDuplicityModal).toBeNull();
    expect(result.current.invokeDuplicityPlacementMode).toEqual(expect.objectContaining({
      requestedCount: 2,
      positions: [],
    }));

    act(() => {
      result.current.handleInvokeDuplicityPlacementMouseMove(2.9, 3.1);
      result.current.handleInvokeDuplicityPlacementConfirm(2.9, 3.1);
    });

    expect(result.current.invokeDuplicityPlacementMode?.positions).toEqual([{ x: 2, y: 3 }]);

    act(() => {
      result.current.handleInvokeDuplicityPlacementUndo();
    });

    expect(result.current.invokeDuplicityPlacementMode?.positions).toEqual([]);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(result.current.invokeDuplicityPlacementMode).toBeNull();
    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining("超出诡术通道范围"), "error");
  });

  it("rejects out-of-range placement", () => {
    const sourceToken = createToken({ id: 11, character_id: 18, position_x: 0, position_y: 0 });
    const showToast = vi.fn();

    const { result } = renderHook(() => {
      const [invokeDuplicityModal, setInvokeDuplicityModal] = useState<InvokeDuplicityModalState | null>(null);
      const [invokeDuplicityPlacementMode, setInvokeDuplicityPlacementMode] = useState<InvokeDuplicityPlacementMode | null>({
        sourceTokenId: 11,
        sourceCharacterId: 18,
        sourceName: "牧师",
        action: { id: "invoke_duplicity", name: "诡术通道", uses: { current: 1, max: 1 } } as any,
        requestedCount: 1,
        positions: [],
        previewPos: null,
      });
      const [tokens, setTokens] = useState<Token[]>([sourceToken]);
      const controller = useMapInvokeDuplicityController({
        sourceCharacterData: { level: 9, subclass_id: "trickery" },
        tokens,
        campaignId: "7",
        currentMapUrl: "/maps/test-map.png",
        userId: "42",
        gridUnitLength: 5,
        invokeDuplicityModal,
        setInvokeDuplicityModal,
        invokeDuplicityPlacementMode,
        setInvokeDuplicityPlacementMode,
        authedFetch: vi.fn() as any,
        showToast,
        sendMessage: vi.fn(),
        setTokens,
        consumeCharacterResource: vi.fn().mockResolvedValue(null),
        setConcentrationOnTokenFn: vi.fn().mockResolvedValue(true),
        clearSelectionContextMenu: vi.fn(),
      });
      return {
        ...controller,
        invokeDuplicityPlacementMode,
      };
    });

    act(() => {
      result.current.handleInvokeDuplicityPlacementConfirm(10, 0);
    });

    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("超出诡术通道范围"), "error");
    expect(result.current.invokeDuplicityPlacementMode?.positions).toEqual([]);
  });

  it("creates duplicate tokens, applies concentration, and publishes combat action usage", async () => {
    const sourceToken = createToken({
      id: 11,
      character_id: 18,
      instance_name: "牧师",
      avatar: "https://cdn.example.com/cleric.png",
      map_url: "/maps/test-map.png",
    });
    const authedFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 101, instance_name: "牧师的分身" }),
    });
    const sendMessage = vi.fn();
    const showToast = vi.fn();
    const consumeCharacterResource = vi.fn().mockResolvedValue({ current: 0, max: 1 });
    const setConcentrationOnTokenFn = vi.fn().mockResolvedValue(true);
    const clearSelectionContextMenu = vi.fn();

    const { result } = renderHook(() => {
      const [invokeDuplicityModal, setInvokeDuplicityModal] = useState<InvokeDuplicityModalState | null>(null);
      const [invokeDuplicityPlacementMode, setInvokeDuplicityPlacementMode] = useState<InvokeDuplicityPlacementMode | null>({
        sourceTokenId: 11,
        sourceCharacterId: 18,
        sourceName: "牧师",
        action: { id: "invoke_duplicity", name: "诡术通道", uses: { current: 1, max: 1 } } as any,
        requestedCount: 1,
        positions: [{ x: 2, y: 3 }],
        previewPos: { x: 2, y: 3 },
      });
      const [tokens, setTokens] = useState<Token[]>([sourceToken]);
      const controller = useMapInvokeDuplicityController({
        sourceCharacterData: { level: 9, subclass_id: "trickery" },
        tokens,
        campaignId: "7",
        currentMapUrl: "/maps/test-map.png",
        userId: "42",
        gridUnitLength: 5,
        invokeDuplicityModal,
        setInvokeDuplicityModal,
        invokeDuplicityPlacementMode,
        setInvokeDuplicityPlacementMode,
        authedFetch: authedFetch as any,
        showToast,
        sendMessage,
        setTokens,
        consumeCharacterResource,
        setConcentrationOnTokenFn,
        clearSelectionContextMenu,
      });
      return {
        ...controller,
        invokeDuplicityPlacementMode,
        tokens,
      };
    });

    await act(async () => {
      await result.current.handleInvokeDuplicityCreate();
    });

    expect(consumeCharacterResource).toHaveBeenCalledWith(
      18,
      "channel_divinity_cleric",
      expect.objectContaining({ name: "诡术通道" }),
      "诡术通道",
    );
    expect(authedFetch).toHaveBeenCalledWith(
      "/api/tokens",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const createPayload = JSON.parse(authedFetch.mock.calls[0][1].body);
    expect(createPayload.item_data.spell_id).toBe(INVOKE_DUPLICITY_SPELL_ID);
    expect(setConcentrationOnTokenFn).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ id: INVOKE_DUPLICITY_SPELL_ID }),
      0,
      "42",
      undefined,
      [],
      undefined,
      expect.objectContaining({ linked_token_ids: [101] }),
    );
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "chat",
    }));
    expect(showToast).toHaveBeenCalledWith("牧师 创建了 1 个诡术分身", "success");
    expect(publishAppEventMock).toHaveBeenCalledWith("combatActionUsed", { type: "action" });
    expect(clearSelectionContextMenu).toHaveBeenCalled();
    expect(result.current.invokeDuplicityPlacementMode).toBeNull();
    expect(result.current.tokens.map((token) => token.id)).toEqual(expect.arrayContaining([11, 101]));
    expect(result.current.tokens.find((token) => token.id === 11)?.concentration_spell).toEqual(
      expect.objectContaining({
        spell_id: INVOKE_DUPLICITY_SPELL_ID,
        linked_token_ids: [101],
      }),
    );
  });
});
