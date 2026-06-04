import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMapFeatureAdminController } from "../../app/components/map/hooks/useMapFeatureAdminController";
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

describe("useMapFeatureAdminController", () => {
  beforeEach(() => {
    publishAppEventMock.mockReset();
  });

  it("publishes class feature use updates after editing uses", async () => {
    const authedFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    const showToast = vi.fn();

    const { result } = renderHook(() =>
      useMapFeatureAdminController({
        tokens: [],
        tokenStatusEffects: {},
        sourceCharacterData: null,
        authedFetch: authedFetch as any,
        showToast,
        sendMessage: vi.fn(),
        setTokens: vi.fn(),
        setTokenStatusEffects: vi.fn(),
        clearSelectionContextMenu: vi.fn(),
        isAppearanceIllusionSpell: vi.fn(() => false),
      }),
    );

    await act(async () => {
      await result.current.handleEditActionUses(18, "second_wind", 1, 2);
    });

    expect(authedFetch).toHaveBeenCalledWith(
      "/api/characters/18/feature-uses",
      expect.objectContaining({ method: "POST" }),
    );
    expect(showToast).toHaveBeenCalledWith("使用次数已更新为 1/2", "success");
    expect(publishAppEventMock).toHaveBeenCalledWith("classFeatureUsesUpdated", {
      characterId: 18,
      featureId: "second_wind",
      currentUses: 1,
      maxUses: 2,
    });
  });

  it("toggles ranger abilities and persists active effects", async () => {
    const authedFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    const sendMessage = vi.fn();
    const setTokenStatusEffects = vi.fn();
    const clearSelectionContextMenu = vi.fn();

    const { result } = renderHook(() =>
      useMapFeatureAdminController({
        tokens: [createToken({ id: 11, instance_name: "游侠" })],
        tokenStatusEffects: { 11: [] },
        sourceCharacterData: { favored_enemy: "亡灵" },
        authedFetch: authedFetch as any,
        showToast: vi.fn(),
        sendMessage,
        setTokens: vi.fn(),
        setTokenStatusEffects,
        clearSelectionContextMenu,
        isAppearanceIllusionSpell: vi.fn(() => false),
      }),
    );

    await act(async () => {
      await result.current.handleRangerAbility("favored_enemy", 11, true);
    });

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "chat" }));
    expect(setTokenStatusEffects).toHaveBeenCalledWith(expect.any(Function));
    expect(authedFetch).toHaveBeenCalledWith(
      "/api/tokens/11/active-effects",
      expect.objectContaining({ method: "POST" }),
    );
    expect(clearSelectionContextMenu).toHaveBeenCalled();
  });

  it("removes illusion disguise data when effect duration drops to zero", async () => {
    const setTokenStatusEffects = vi.fn();
    const setTokens = vi.fn();
    const authedFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    const showToast = vi.fn();

    const { result } = renderHook(() =>
      useMapFeatureAdminController({
        tokens: [createToken({ id: 11, disguise_data: { name: "假面" } as any })],
        tokenStatusEffects: {
          11: [
            {
              id: "disguise_self",
              name: "易容术",
              spell_buff: true,
              spell_id: "disguise_self",
            },
          ],
        },
        sourceCharacterData: null,
        authedFetch: authedFetch as any,
        showToast,
        sendMessage: vi.fn(),
        setTokens,
        setTokenStatusEffects,
        clearSelectionContextMenu: vi.fn(),
        isAppearanceIllusionSpell: vi.fn((spellId) => spellId === "disguise_self"),
      }),
    );

    await act(async () => {
      await result.current.handleEditEffectDuration(11, "disguise_self", 0);
    });

    expect(showToast).toHaveBeenCalledWith("易容术 已结束", "info");
    expect(authedFetch).toHaveBeenNthCalledWith(
      1,
      "/api/tokens/11/active-effects",
      expect.objectContaining({ method: "POST" }),
    );
    expect(authedFetch).toHaveBeenNthCalledWith(
      2,
      "/api/tokens/11/disguise",
      expect.objectContaining({ method: "POST" }),
    );
    expect(setTokenStatusEffects).toHaveBeenCalledWith(expect.any(Function));
    expect(setTokens).toHaveBeenCalled();
  });
});
