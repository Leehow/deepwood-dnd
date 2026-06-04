import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMapMonsterActionController } from "../../app/components/map/hooks/useMapMonsterActionController";
import type { RangeConfirmModalState } from "../../app/components/map/MapMarkerAndConfirmDialogs";
import type { MonsterAction } from "../../app/components/map/SelectionContextMenu";
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

describe("useMapMonsterActionController", () => {
  beforeEach(() => {
    publishAppEventMock.mockReset();
  });

  it("opens range confirm for out-of-range monster attacks", async () => {
    const showToast = vi.fn();
    const authedFetch = vi.fn();

    const { result } = renderHook(() => {
      const [rangeConfirmModal, setRangeConfirmModal] = useState<RangeConfirmModalState | null>(null);
      const [selectionContextMenu, setSelectionContextMenu] = useState<any>({ visible: true });
      const [diceRolling, setDiceRolling] = useState({ visible: false });
      const lastInitiatedAttackRef = useRef<{ attackerTokenId: number; targetTokenId: number; timestamp: number } | null>(null);

      const controller = useMapMonsterActionController({
        tokens: [
          createToken({ id: 10, instance_name: "成年黑龙", position_x: 0, position_y: 0 }),
          createToken({ id: 22, instance_name: "圣武士", position_x: 40, position_y: 0 }),
        ],
        campaignId: "7",
        gridUnitLength: 5,
        userId: "tester",
        isDM: true,
        authedFetch,
        showToast,
        setSelectionContextMenu,
        setRangeConfirmModal,
        setDiceRolling,
        lastInitiatedAttackRef,
        getSpellBuffEffects: () => ({
          acBonus: 0,
          resistances: [],
          immunities: [],
          grantDisadvantage: [],
        }),
        showAttackOutcomeFeedback: vi.fn(),
        publishCombatAttackResult: vi.fn(),
        applyAttackHpChange: vi.fn(),
        consumePendingIncomingAttackDisadvantage: vi.fn(async () => {}),
        playAttackCritical: vi.fn(),
        playAttackHit: vi.fn(),
        playAttackMiss: vi.fn(),
      });

      return {
        controller,
        rangeConfirmModal,
        selectionContextMenu,
        diceRolling,
      };
    });

    const action: MonsterAction = {
      name: "长弓",
      description: "远程武器攻击：+7 命中，射程 30/120 尺，单一目标。造成 1d8+4 穿刺伤害。",
      type: "action",
      attack_bonus: 7,
      damage: { dice: "1d8", bonus: 4, type: "piercing" },
      range: "30/120尺",
    };

    await act(async () => {
      await result.current.controller.handleSelectionMonsterAction(action, 10, 22);
    });

    expect(result.current.rangeConfirmModal).toMatchObject({
      show: true,
      maxRange: 120,
      sourceName: "成年黑龙",
      targetName: "圣武士",
    });
    expect(authedFetch).not.toHaveBeenCalled();
  });

  it("executes in-range monster attacks through the combat api and publishes follow-up events", async () => {
    const showToast = vi.fn();
    const authedFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        result: {
          hit: true,
          critical: false,
          damage_dealt: 9,
          extra_damage_dealt: 3,
          narrative: "利爪命中",
          hp_change: 12,
          new_hp: 8,
        },
      }),
    })) as any;
    const showAttackOutcomeFeedback = vi.fn();
    const publishCombatAttackResult = vi.fn();
    const applyAttackHpChange = vi.fn();
    const consumePendingIncomingAttackDisadvantage = vi.fn(async () => {});

    const { result } = renderHook(() => {
      const [, setRangeConfirmModal] = useState<RangeConfirmModalState | null>(null);
      const [, setSelectionContextMenu] = useState<any>({ visible: true });
      const [, setDiceRolling] = useState({ visible: false });
      const lastInitiatedAttackRef = useRef<{ attackerTokenId: number; targetTokenId: number; timestamp: number } | null>(null);

      return useMapMonsterActionController({
        tokens: [
          createToken({ id: 10, instance_name: "石像鬼", position_x: 0, position_y: 0, monster_instance_id: 91 }),
          createToken({ id: 22, instance_name: "法师", position_x: 1, position_y: 0 }),
        ],
        campaignId: "7",
        gridUnitLength: 5,
        userId: "tester",
        isDM: true,
        authedFetch,
        showToast,
        setSelectionContextMenu,
        setRangeConfirmModal,
        setDiceRolling,
        lastInitiatedAttackRef,
        getSpellBuffEffects: () => ({
          acBonus: 0,
          resistances: [],
          immunities: [],
          grantDisadvantage: [],
        }),
        showAttackOutcomeFeedback,
        publishCombatAttackResult,
        applyAttackHpChange,
        consumePendingIncomingAttackDisadvantage,
        playAttackCritical: vi.fn(),
        playAttackHit: vi.fn(),
        playAttackMiss: vi.fn(),
      });
    });

    await act(async () => {
      await result.current.handleSelectionMonsterAction({
        name: "利爪",
        description: "近战武器攻击：+6 命中，触及 5 尺，单一目标。造成 2d6+2 挥砍伤害。",
        type: "action",
        attack_bonus: 6,
        damage: { dice: "2d6", bonus: 2, type: "slashing" },
        reach: "5尺",
      }, 10, 22);
    });

    expect(authedFetch).toHaveBeenCalledTimes(1);
    expect(showAttackOutcomeFeedback).toHaveBeenCalledWith(expect.objectContaining({
      attackerName: "石像鬼",
      targetName: "法师",
      includeExtraDamageHintForDm: true,
    }));
    expect(publishCombatAttackResult).toHaveBeenCalledWith(expect.objectContaining({
      attackerName: "石像鬼",
      targetName: "法师",
      attackName: "利爪",
      damageOverride: 12,
    }));
    expect(applyAttackHpChange).toHaveBeenCalledWith({
      autoApply: true,
      targetTokenId: 22,
      result: expect.objectContaining({
        hp_change: 12,
        new_hp: 8,
      }),
    });
    expect(consumePendingIncomingAttackDisadvantage).toHaveBeenCalledWith(22);
    expect(publishAppEventMock).toHaveBeenCalledWith("combatActionUsed", { type: "attack" });
  });

  it("dispatches area monster actions through the shared event path", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    const { result } = renderHook(() => {
      const [, setRangeConfirmModal] = useState<RangeConfirmModalState | null>(null);
      const [, setSelectionContextMenu] = useState<any>({ visible: true });
      const [, setDiceRolling] = useState({ visible: false });
      const lastInitiatedAttackRef = useRef<{ attackerTokenId: number; targetTokenId: number; timestamp: number } | null>(null);

      return useMapMonsterActionController({
        tokens: [createToken({ id: 10, instance_name: "红龙", position_x: 0, position_y: 0 })],
        campaignId: "7",
        gridUnitLength: 5,
        userId: "tester",
        isDM: true,
        authedFetch: vi.fn() as any,
        showToast: vi.fn(),
        setSelectionContextMenu,
        setRangeConfirmModal,
        setDiceRolling,
        lastInitiatedAttackRef,
        getSpellBuffEffects: () => ({
          acBonus: 0,
          resistances: [],
          immunities: [],
          grantDisadvantage: [],
        }),
        showAttackOutcomeFeedback: vi.fn(),
        publishCombatAttackResult: vi.fn(),
        applyAttackHpChange: vi.fn(),
        consumePendingIncomingAttackDisadvantage: vi.fn(async () => {}),
        playAttackCritical: vi.fn(),
        playAttackHit: vi.fn(),
        playAttackMiss: vi.fn(),
      });
    });

    await act(async () => {
      await result.current.handleSelectionMonsterAction({
        name: "火焰吐息",
        description: "造成 54 (12d8) 点火焰伤害。",
        type: "action",
        area: { shape: "cone", size: "60尺" },
        save: { ability: "dexterity", dc: 21, success_effect: "half" },
        damage: { dice: "12d8", type: "fire" },
      }, 10);
    });

    expect(publishAppEventMock).toHaveBeenCalledWith("startMonsterAreaAction", expect.objectContaining({
      sourceTokenId: 10,
      actionName: "火焰吐息",
      damageType: "fire",
      damageDice: "12d8",
      saveDC: 21,
    }));
  });
});
