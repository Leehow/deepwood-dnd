import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMapWeaponAttackExecutionController } from "../../app/components/map/hooks/useMapWeaponAttackExecutionController";
import type { AttackOption } from "../../app/components/map/SelectionContextMenu";
import type { PreparedWeaponAttackAction } from "../../app/components/map/hooks/useMapWeaponAttackPreparationController";
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

describe("useMapWeaponAttackExecutionController", () => {
  beforeEach(() => {
    publishAppEventMock.mockReset();
  });

  it("dispatches successful attack follow-ups through the extracted controller", async () => {
    const authedFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        result: {
          hit: true,
          critical: true,
          damage_dealt: 12,
          extra_damage_dealt: 3,
          target_defeated: true,
          narrative: "攻击命中",
          hp_change: 15,
          new_hp: 0,
        },
      }),
    })) as any;

    const publishCombatBonusAttackGranted = vi.fn();
    const publishPromptDivineSmite = vi.fn();
    const publishCombatAttackResult = vi.fn();
    const applyAttackHpChange = vi.fn();
    const consumePendingIncomingAttackDisadvantage = vi.fn(async () => {});
    const runAttackCleanup = vi.fn(async () => {});

    const { result } = renderHook(() => {
      const [diceRolling, setDiceRolling] = useState({ visible: false });
      const lastInitiatedAttackRef = useRef<{ attackerTokenId: number; targetTokenId: number; timestamp: number } | null>(null);

      return {
        controller: useMapWeaponAttackExecutionController({
          authedFetch,
          userId: "tester",
          isDM: true,
          showToast: vi.fn(),
          setDiceRolling,
          lastInitiatedAttackRef,
          tokens: [
            createToken({ id: 10, character_id: 18, instance_name: "圣武士", position_x: 0, position_y: 0 }),
            createToken({ id: 22, monster_instance_id: 91, instance_name: "食尸鬼", monster_name: "食尸鬼", position_x: 1, position_y: 0 }),
          ],
          pendingManeuvers: {},
          sourceCharacterData: {
            class_id: "paladin",
            feats: [{ value: "great_weapon_master" }],
            spell_slots_remaining: { "1": 2 },
          },
          triggerPendingManeuver: vi.fn(async () => null),
          applyManeuverSecondaryEffect: vi.fn(async () => {}),
          showAttackOutcomeFeedback: vi.fn(),
          publishCombatBonusAttackGranted,
          publishPromptDivineSmite,
          publishCombatAttackResult,
          applyAttackHpChange,
          consumePendingIncomingAttackDisadvantage,
          runAttackCleanup,
          playAttackCritical: vi.fn(),
          playAttackHit: vi.fn(),
          playAttackMiss: vi.fn(),
        }),
        diceRolling,
      };
    });

    const preparedAttack: PreparedWeaponAttackAction = {
      sourceToken: createToken({ id: 10, character_id: 18, instance_name: "圣武士" }),
      targetToken: createToken({ id: 22, monster_instance_id: 91, instance_name: "食尸鬼", monster_name: "食尸鬼" }),
      attackerData: { name: "圣武士" },
      attackRequest: {
        target: { name: "食尸鬼" },
        attack: { name: "巨剑", damage_type: "挥砍" },
        auto_apply: true,
      },
      attackerEffects: [],
      cloakOfShadowsActive: false,
      pendingAttackBonusEffectId: undefined,
      pendingAttackBonusSource: undefined,
      isRangedAttack: false,
    };

    await act(async () => {
      await result.current.controller.executeAttackAction({
        attack: {
          key: "weapon_greatsword_main",
          name: "巨剑",
          properties: ["heavy", "two-handed"],
        } as AttackOption,
        sourceTokenId: 10,
        targetTokenId: 22,
        distanceFeet: 5,
        preparedAttack,
      });
    });

    expect(publishAppEventMock).toHaveBeenCalledWith("combatActionUsed", { type: "attack" });
    expect(publishCombatBonusAttackGranted).toHaveBeenCalledWith("大武器大师：暴击/击杀，额外攻击(附赠动作)");
    expect(publishPromptDivineSmite).toHaveBeenCalledWith({
      characterId: 18,
      targetTokenId: 22,
      targetName: "食尸鬼",
      baseDamage: 12,
      distanceFeet: 5,
      targetMonsterType: undefined,
    });
    expect(publishCombatAttackResult).toHaveBeenCalledWith(expect.objectContaining({
      attackerName: "圣武士",
      targetName: "食尸鬼",
      damageOverride: 15,
    }));
    expect(applyAttackHpChange).toHaveBeenCalledWith({
      autoApply: true,
      targetTokenId: 22,
      result: expect.objectContaining({
        new_hp: 0,
      }),
    });
    expect(consumePendingIncomingAttackDisadvantage).toHaveBeenCalledWith(22);
    expect(runAttackCleanup).toHaveBeenCalled();
  });
});
