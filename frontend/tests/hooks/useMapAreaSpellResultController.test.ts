import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMapAreaSpellResultController } from "../../app/components/map/hooks/useMapAreaSpellResultController";

const showDamageNumberMock = vi.fn();
const showCharacterBubbleMock = vi.fn();
const publishAppEventMock = vi.fn();

vi.mock("../../app/components/map/DamageNumberOverlay", () => ({
  showDamageNumber: (...args: any[]) => showDamageNumberMock(...args),
}));

vi.mock("../../app/utils/characterBubble", () => ({
  showCharacterBubble: (...args: any[]) => showCharacterBubbleMock(...args),
}));

vi.mock("../../app/events/appEventBus", () => ({
  publishAppEvent: (...args: any[]) => publishAppEventMock(...args),
}));

describe("useMapAreaSpellResultController", () => {
  beforeEach(() => {
    showDamageNumberMock.mockReset();
    showCharacterBubbleMock.mockReset();
    publishAppEventMock.mockReset();
  });

  it("processes hp updates, control effects, and persistence side-effects", async () => {
    const authedFetch = vi.fn().mockResolvedValue({ ok: true });
    const consumeAreaSpellSlot = vi.fn().mockResolvedValue({
      "1": { current: 1, max: 4 },
    });
    const persistAreaEffect = vi.fn().mockResolvedValue(undefined);
    const setTokens = vi.fn();
    const setTokenStatusEffects = vi.fn();
    const sendMessage = vi.fn();

    const { result } = renderHook(() =>
      useMapAreaSpellResultController({
        authedFetch: authedFetch as any,
        showToast: vi.fn(),
        sendMessage,
        playEffect: vi.fn(),
        playHit: vi.fn(),
        clearCloakOfShadowsEffect: vi.fn().mockResolvedValue(undefined),
        clearReadyCast: vi.fn().mockResolvedValue(undefined),
        consumePendingDestructiveWrath: vi.fn().mockResolvedValue(undefined),
        consumeAreaSpellSlot,
        persistAreaEffect,
        setTokens,
        setTokenStatusEffects,
        tokenStatusEffects: { 2: [] },
        resolveEffectDefinition: vi.fn(() => ({
          id: "restrained",
          name: "束缚",
          visual: { icon: "🕸️", color: "#22c55e" },
          duration: { rounds: 10 },
        } as any)),
      }),
    );

    await act(async () => {
      await result.current.processAreaSpellSuccess({
        result: {
          narrative: "火焰吞没了区域",
          hits: 1,
          total_damage: 18,
          damage_roll: "8d6",
          hp_updates: [{ token_id: 2, damage_dealt: 18, new_hp: 4 }],
          target_results: [{ target_token_id: 2, save_succeeded: false }],
        },
        spell: {
          id: "entangle",
          name: "纠缠术",
          damageType: "fire",
          duration: "1分钟",
          concentration: false,
          areaOfEffect: { type: "sphere", size: 20 },
        },
        finalTargets: [{ id: 2, instance_name: "骷髅" }] as any,
        sourceToken: { id: 1, character_id: 18 } as any,
        sourceTokenId: 1,
        casterName: "德鲁伊",
        slotLevel: 1,
        areaSpellMode: { freecast: false, ritualCast: false },
        sourceCharacterSpellSlotsState: { "1": { current: 2, max: 4 } },
        shapeType: "sphere",
        centerPos: { x: 8, y: 8 },
        originPos: null,
        sizeFeet: 20,
        direction: 0,
        spellEffectMapping: { effectId: "restrained", duration: 3 },
        maximizeDamage: false,
        cloakOfShadowsActive: false,
      });
    });

    expect(setTokens).toHaveBeenCalledWith(expect.any(Function));
    const tokensUpdater = setTokens.mock.calls[0][0];
    expect(tokensUpdater([{ id: 2, current_hp: 22 }])).toEqual([{ id: 2, current_hp: 4 }]);

    expect(showDamageNumberMock).toHaveBeenCalledWith(expect.objectContaining({
      targetTokenId: 2,
      damage: 18,
    }));
    expect(showCharacterBubbleMock).toHaveBeenCalled();

    expect(setTokenStatusEffects).toHaveBeenCalledWith(expect.any(Function));
    const effectsUpdater = setTokenStatusEffects.mock.calls[0][0];
    expect(effectsUpdater({ 2: [] })[2]).toEqual([
      expect.objectContaining({
        id: "restrained",
        metadata: { source: "纠缠术", caster: "德鲁伊" },
      }),
    ]);

    expect(authedFetch).toHaveBeenCalledWith(
      "/api/tokens/2/active-effects",
      expect.objectContaining({ method: "POST" }),
    );
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "chat",
    }));
    expect(publishAppEventMock).toHaveBeenCalledWith("spellSlotsUpdate", {
      character_id: 18,
      spell_slots_state: {
        "1": { current: 1, max: 4 },
      },
    });
    expect(consumeAreaSpellSlot).toHaveBeenCalled();
    expect(persistAreaEffect).toHaveBeenCalled();
  });
});
