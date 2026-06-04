import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useMapAreaSpellCombatDispatchController } from "../../app/components/map/hooks/useMapAreaSpellCombatDispatchController";

describe("useMapAreaSpellCombatDispatchController", () => {
  it("dispatches area-spell combat requests and forwards success payloads", async () => {
    const authedFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        results: {
          narrative: "火球吞没了敌人",
          hits: 2,
          total_damage: 21,
        },
      }),
    });
    const showToast = vi.fn();
    const playAttackSwing = vi.fn();
    const playCast = vi.fn();
    const setDiceRolling = vi.fn();
    const handleAreaSpellCancel = vi.fn();
    const processAreaSpellSuccess = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useMapAreaSpellCombatDispatchController({
        authedFetch: authedFetch as any,
        userId: "42",
        isDM: false,
        showToast,
        playAttackSwing,
        playCast,
        setDiceRolling,
        handleAreaSpellCancel,
        processAreaSpellSuccess,
      }),
    );

    let dispatched = false;
    await act(async () => {
      dispatched = await result.current.dispatchAreaSpellCombat({
        areaSpellRequest: { spell: { id: "fireball" } },
        spell: {
          id: "fireball",
          name: "火球术",
          damageType: "fire",
        } as any,
        finalTargets: [{ id: 2 }, { id: 3 }] as any,
        sourceToken: { id: 1, character_id: 18 } as any,
        sourceTokenId: 1,
        casterData: { name: "法师" },
        slotLevel: 3,
        areaSpellMode: { freecast: false, ritualCast: false },
        sourceCharacterSpellSlotsState: { "3": { current: 2, max: 3 } },
        shapeType: "sphere",
        centerPos: { x: 8, y: 8 },
        originPos: null,
        sizeFeet: 20,
        direction: 0,
        spellEffectMapping: { effectId: "burning" },
        maximizeDamage: false,
        cloakOfShadowsActive: false,
        readyCastTokenId: 77,
      });
    });

    expect(dispatched).toBe(true);
    expect(handleAreaSpellCancel).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      "法师 施放 火球术 (3环)，影响 2 个目标...",
      "info",
    );
    expect(playCast).toHaveBeenCalledWith("fireball", "fire");
    expect(playAttackSwing).not.toHaveBeenCalled();
    expect(setDiceRolling).toHaveBeenNthCalledWith(1, {
      visible: true,
      attackerName: "法师",
      targetName: "2个目标",
    });
    expect(setDiceRolling).toHaveBeenNthCalledWith(2, { visible: false });
    expect(authedFetch).toHaveBeenCalledWith(
      "/api/combat/spell-area?user_id=42&role=player",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ spell: { id: "fireball" } }),
      }),
    );
    expect(processAreaSpellSuccess).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({ total_damage: 21 }),
      sourceTokenId: 1,
      casterName: "法师",
      readyCastTokenId: 77,
    }));
  });

  it("handles failed responses and breath-weapon sound selection", async () => {
    const authedFetch = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => "boom",
    });
    const showToast = vi.fn();
    const playAttackSwing = vi.fn();
    const playCast = vi.fn();
    const setDiceRolling = vi.fn();
    const processAreaSpellSuccess = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useMapAreaSpellCombatDispatchController({
        authedFetch: authedFetch as any,
        userId: "gm-1",
        isDM: true,
        showToast,
        playAttackSwing,
        playCast,
        setDiceRolling,
        handleAreaSpellCancel: vi.fn(),
        processAreaSpellSuccess,
      }),
    );

    let dispatched = true;
    await act(async () => {
      dispatched = await result.current.dispatchAreaSpellCombat({
        areaSpellRequest: { spell: { id: "breath_weapon_fire" } },
        spell: {
          id: "breath_weapon_fire",
          name: "火焰吐息",
          damageTypeCn: "火焰",
        } as any,
        finalTargets: [{ id: 2 }] as any,
        sourceToken: { id: 1 } as any,
        sourceTokenId: 1,
        casterData: { name: "红龙" },
        slotLevel: 0,
        areaSpellMode: { freecast: true, ritualCast: false },
        shapeType: "cone",
        centerPos: null,
        originPos: { x: 5, y: 5 },
        sizeFeet: 30,
        direction: 90,
        maximizeDamage: false,
        cloakOfShadowsActive: false,
      });
    });

    expect(dispatched).toBe(false);
    expect(playAttackSwing).toHaveBeenCalledWith("吐息武器", "火焰");
    expect(playCast).not.toHaveBeenCalled();
    expect(setDiceRolling).toHaveBeenNthCalledWith(1, {
      visible: true,
      attackerName: "红龙",
      targetName: "1个目标",
    });
    expect(setDiceRolling).toHaveBeenNthCalledWith(2, { visible: false });
    expect(showToast).toHaveBeenCalledWith("范围法术施放失败: boom", "error");
    expect(processAreaSpellSuccess).not.toHaveBeenCalled();
  });
});
