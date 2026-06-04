import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMapWeaponAttackCleanupController } from "../../app/components/map/hooks/useMapWeaponAttackCleanupController";
import type { AttackOption } from "../../app/components/map/SelectionContextMenu";
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

describe("useMapWeaponAttackCleanupController", () => {
  beforeEach(() => {
    publishAppEventMock.mockReset();
  });

  it("consumes transient attack effects and clears cloak of shadows", async () => {
    const persistTokenActiveEffects = vi.fn(async () => {});
    const clearCloakOfShadowsEffect = vi.fn(async () => true);
    const showToast = vi.fn();

    const { result } = renderHook(() => {
      const [tokens, setTokens] = useState<Token[]>([]);
      const [sourceCharacterData, setSourceCharacterData] = useState<any>(null);
      return {
        controller: useMapWeaponAttackCleanupController({
          authedFetch: vi.fn() as any,
          campaignId: "7",
          currentMapUrl: "/maps/test-map.png",
          showToast,
          setTokens,
          setSourceCharacterData,
          persistTokenActiveEffects,
          clearCloakOfShadowsEffect,
        }),
        tokens,
        sourceCharacterData,
      };
    });

    await act(async () => {
      await result.current.controller.runAttackCleanup({
        attack: { key: "weapon_longsword_main", name: "长剑" } as AttackOption,
        sourceToken: createToken({ id: 10, character_id: 18 }),
        sourceTokenId: 10,
        attackerEffects: [
          { id: "bardic_inspiration" },
          { id: "war_bonus" },
          { id: "keep_me" },
        ],
        inspirationDie: "d8",
        pendingAttackBonusEffectId: "war_bonus",
        pendingAttackBonusSource: "神圣命中",
        cloakOfShadowsActive: true,
      });
    });

    expect(persistTokenActiveEffects).toHaveBeenCalledWith(10, [{ id: "keep_me" }]);
    expect(showToast).toHaveBeenCalledWith("激励骰已使用！", "info");
    expect(showToast).toHaveBeenCalledWith("神圣命中已结算", "info");
    expect(clearCloakOfShadowsEffect).toHaveBeenCalledWith(10, "attack");
  });

  it("consumes ammunition and updates source character equipment", async () => {
    const authedFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })) as any;

    const { result } = renderHook(() => {
      const [tokens, setTokens] = useState<Token[]>([]);
      const [sourceCharacterData, setSourceCharacterData] = useState<any>({
        id: 18,
        equipment: [
          { id: "arrows", equippedSlot: "ammo", quantity: 3 },
        ],
      });

      return {
        controller: useMapWeaponAttackCleanupController({
          authedFetch,
          campaignId: "7",
          currentMapUrl: "/maps/test-map.png",
          showToast: vi.fn(),
          setTokens,
          setSourceCharacterData,
          persistTokenActiveEffects: vi.fn(async () => {}),
          clearCloakOfShadowsEffect: vi.fn(async () => true),
        }),
        sourceCharacterData,
      };
    });

    await act(async () => {
      await result.current.controller.runAttackCleanup({
        attack: {
          key: "weapon_longbow_main",
          name: "长弓",
          needsAmmo: true,
          ammoName: "箭矢",
        } as AttackOption,
        sourceToken: createToken({ id: 10, character_id: 18 }),
        sourceTokenId: 10,
        sourceCharacterData: result.current.sourceCharacterData,
        attackerEffects: [],
        cloakOfShadowsActive: false,
      });
    });

    expect(authedFetch).toHaveBeenCalledWith("/api/characters/18", expect.objectContaining({
      method: "POST",
    }));
    expect(result.current.sourceCharacterData.equipment).toEqual([
      { id: "arrows", equippedSlot: "ammo", quantity: 2 },
    ]);
  });

  it("drops thrown weapons near the target and publishes equipment updates", async () => {
    const authedFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 99, position_x: 5, position_y: 4 }),
      });

    const { result } = renderHook(() => {
      const [tokens, setTokens] = useState<Token[]>([]);
      const [sourceCharacterData, setSourceCharacterData] = useState<any>({
        id: 18,
        equipment: [
          { id: "javelin", name: "标枪", equippedSlot: "main_hand", quantity: 2 },
        ],
      });

      return {
        controller: useMapWeaponAttackCleanupController({
          authedFetch,
          campaignId: "7",
          currentMapUrl: "/maps/test-map.png",
          showToast: vi.fn(),
          setTokens,
          setSourceCharacterData,
          persistTokenActiveEffects: vi.fn(async () => {}),
          clearCloakOfShadowsEffect: vi.fn(async () => true),
        }),
        tokens,
        sourceCharacterData,
      };
    });

    await act(async () => {
      await result.current.controller.runAttackCleanup({
        attack: {
          key: "weapon_javelin_main",
          name: "标枪",
          isThrown: true,
          thrownWeaponItem: {
            id: "javelin",
            name: "标枪",
            equippedSlot: "main_hand",
          },
        } as AttackOption,
        sourceToken: createToken({ id: 10, character_id: 18 }),
        sourceTokenId: 10,
        targetToken: createToken({ id: 22, position_x: 4, position_y: 4, token_size: "1x1" }),
        sourceCharacterData: result.current.sourceCharacterData,
        attackerEffects: [],
        cloakOfShadowsActive: false,
      });
    });

    expect(publishAppEventMock).toHaveBeenCalledWith("characterEquipmentUpdated", {
      characterId: 18,
      needsBroadcast: true,
    });
    expect(result.current.sourceCharacterData.equipment).toEqual([
      { id: "javelin", name: "标枪", equippedSlot: "main_hand", quantity: 1 },
    ]);
    expect(result.current.tokens).toEqual([
      expect.objectContaining({ id: 99 }),
    ]);
  });
});
