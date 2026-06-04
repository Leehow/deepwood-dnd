import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMapWeaponAttackPreparationController } from "../../app/components/map/hooks/useMapWeaponAttackPreparationController";
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

describe("useMapWeaponAttackPreparationController", () => {
  beforeEach(() => {
    publishAppEventMock.mockReset();
  });

  it("prepares attack requests and consumes feature + lucky resources", async () => {
    const authedFetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/characters/18/resources/use") {
        const body = JSON.parse(String(init?.body || "{}"));
        if (body.resource_id === "war_priest") {
          return {
            ok: true,
            json: async () => ({ current: 1 }),
          } as Response;
        }
        if (body.resource_id === "lucky_feat") {
          return {
            ok: true,
            json: async () => ({ current: 2 }),
          } as Response;
        }
      }

      if (input === "/api/characters/22/sheet") {
        return {
          ok: true,
          json: async () => ({
            character: {
              equipment: [
                { id: "shield", equippedSlot: "off_hand" },
                { id: "longsword", equippedSlot: "main_hand", name: "长剑" },
              ],
            },
          }),
        } as Response;
      }

      throw new Error(`Unexpected request: ${input}`);
    }) as any;

    const showToast = vi.fn();

    const { result } = renderHook(() => {
      const [sourceCharacterData, setSourceCharacterData] = useState<any>({
        id: 18,
        name: "牧师",
        class_id: "cleric",
        actions: [
          {
            id: "war_priest_attack",
            name: "War Priest",
            resourceId: "war_priest",
            uses: { current: 2, max: 3, recharge: "long_rest" },
          },
        ],
      });

      return {
        controller: useMapWeaponAttackPreparationController({
          tokens: [
            createToken({ id: 10, character_id: 18, instance_name: "牧师", position_x: 0, position_y: 0 }),
            createToken({ id: 22, character_id: 22, instance_name: "骷髅", position_x: 1, position_y: 0 }),
          ],
          sourceCharacterData,
          tokenStatusEffects: {},
          tokenRollModifier: {},
          campaignId: "7",
          authedFetch,
          showToast,
          clearSelectionContextMenu: vi.fn(),
          setSourceCharacterData,
          getSpellBuffEffects: () => ({
            acBonus: 0,
            attackBonus: 0,
            damageBonus: [],
            speedBonus: 0,
            resistances: [],
            immunities: [],
            advantageOn: [],
            disadvantageOn: [],
            grantDisadvantage: [],
          }),
          isWarDomainAttackBonusEffect: () => false,
          isCloakOfShadowsEffect: () => false,
          gridUnitLength: 5,
        }),
        sourceCharacterData,
      };
    });

    let prepared: any = null;
    await act(async () => {
      prepared = await result.current.controller.prepareAttackAction({
        attack: {
          key: "weapon_mace_main",
          name: "钉头锤",
          weaponName: "钉头锤",
          resourceId: "war_priest",
          featureActionId: "war_priest_attack",
        } as AttackOption,
        sourceTokenId: 10,
        targetTokenId: 22,
        distanceFeet: 5,
        modifiers: { useLucky: true },
      });
      await Promise.resolve();
    });

    expect(prepared).not.toBeNull();
    expect(prepared.attackRequest.target.has_shield).toBe(true);
    expect(prepared.attackRequest.target.equipped_weapon).toBe("长剑");
    expect(prepared.attackRequest.roll_modifier).toBe("advantage");
    expect(result.current.sourceCharacterData.actions[0].uses.current).toBe(1);
    expect(publishAppEventMock).toHaveBeenCalledWith("classFeatureUsesUpdated", { characterId: 18 });
    expect(authedFetch).toHaveBeenCalledWith("/api/characters/18/resources/use", expect.objectContaining({
      method: "POST",
    }));
    expect(authedFetch).toHaveBeenCalledWith("/api/characters/22/sheet");
  });
});
