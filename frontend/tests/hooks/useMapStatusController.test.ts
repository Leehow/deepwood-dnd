import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useMapStatusController } from "../../app/components/map/hooks/useMapStatusController";
import type { Token } from "../../app/components/map/types/TacticalMapTypes";

function createToken(overrides: Partial<Token>): Token {
  return {
    id: 1,
    campaign_id: 1,
    map_url: "map://default",
    position_x: 0,
    position_y: 0,
    token_size: "1x1",
    ...overrides,
  } as Token;
}

describe("useMapStatusController", () => {
  it("opens spell detail for spell buffs and falls back to status effect detail", () => {
    const spellList = [{ id: "bless", name: "Bless", nameEn: "Bless" }];

    const { result } = renderHook(() =>
      useMapStatusController({
        authedFetch: vi.fn(),
        campaignId: "7",
        spellList,
        tokens: [],
        setTokens: vi.fn(),
        setTokenStatusEffects: vi.fn(),
        showToast: vi.fn(),
        handleAreaSpellSelect: vi.fn(),
      }),
    );

    act(() => {
      result.current.handleTokenStatusEffectClick({
        id: "spell_buff_bless",
        name: "Bless",
        spell_buff: true,
        spell_id: "bless",
      });
    });

    expect(result.current.concentrationSpellDetail).toEqual(spellList[0]);

    act(() => {
      result.current.handleTokenStatusEffectClick({
        id: "poisoned",
        name: "Poisoned",
        icon: "☠️",
        color: "#0f0",
      });
    });

    expect(result.current.statusEffectDetail).toEqual(
      expect.objectContaining({ id: "poisoned", name: "Poisoned" }),
    );
  });

  it("forwards stored casting.area_effect to handleAreaSpellSelect on ready release", async () => {
    // Alarm ritual: caster picked the cube at start-cast time; the backend
    // stored it on casting_in_progress.area_effect. When the DM confirms
    // 立即完成施法 from the ready state, the controller must replay the area
    // through handleAreaSpellSelect so the picker re-renders pre-placed and
    // 施法 is available without another map click.
    const handleAreaSpellSelect = vi.fn();
    const storedArea = {
      shape: "cube",
      center_x: 32,
      center_y: 40,
      radius: 20,
      map_url: "map://default",
    };
    const token = createToken({
      id: 50,
      casting_in_progress: {
        spell_id: "alarm",
        spell_name: "警报术",
        slot_level: 1,
        cast_mode: "ritual",
        status: "ready",
        selected_option: null,
        material_id: "component_pouch",
        area_effect: storedArea,
      } as any,
    });
    const spellList = [
      {
        id: "alarm",
        name: "警报术",
        nameEn: "Alarm",
        areaOfEffect: { type: "cube", size: 20 },
      },
    ];

    const { result } = renderHook(() =>
      useMapStatusController({
        authedFetch: vi.fn(),
        campaignId: "7",
        spellList,
        tokens: [token],
        setTokens: vi.fn(),
        setTokenStatusEffects: vi.fn(),
        showToast: vi.fn(),
        handleAreaSpellSelect,
      }),
    );

    act(() => {
      result.current.handleTokenCastingCompleteNow(50);
    });
    await act(async () => {
      await result.current.handleConfirmCastingComplete();
    });

    expect(handleAreaSpellSelect).toHaveBeenCalledTimes(1);
    const call = handleAreaSpellSelect.mock.calls[0];
    expect(call[1]).toBe(50); // sourceTokenId
    expect(call[2]).toBe(1); // slot_level
    expect(call[3]).toBe(true); // resolveAsFreecast (ritual)
    expect(call[8]).toBe("component_pouch"); // materialId
    expect(call[9]).toBe(true); // ritualCast
    expect(call[10]).toBeUndefined(); // longCast must NOT be set during release
    expect(call[12]).toEqual(storedArea); // preselected area replayed
    expect((call[0] as any).__readyCastTokenId).toBe(50);
  });

  it("opens ritual info, cancel confirm, and duration edit state from token status", () => {
    const token = createToken({
      id: 12,
      instance_name: "Mira",
      casting_in_progress: {
        cast_mode: "ritual",
        spell_name: "Detect Magic",
        status: "casting",
      } as any,
      concentration_spell: {
        spell_name: "Bless",
        duration_rounds: 10,
        current_round: 4,
      } as any,
    });

    const { result } = renderHook(() =>
      useMapStatusController({
        authedFetch: vi.fn(),
        campaignId: "7",
        spellList: [],
        tokens: [token],
        setTokens: vi.fn(),
        setTokenStatusEffects: vi.fn(),
        showToast: vi.fn(),
        handleAreaSpellSelect: vi.fn(),
      }),
    );

    act(() => {
      result.current.handleTokenCastingModeInfoClick(12);
      result.current.handleTokenCastingCancel(12);
      result.current.handleTokenConcentrationDurationEdit(12, 6);
    });

    expect(result.current.ritualCastingInfo).toEqual({
      tokenName: "Mira",
      spellName: "Detect Magic",
    });
    expect(result.current.castingCancelConfirm).toEqual({
      tokenId: 12,
      tokenName: "Mira",
      spellName: "Detect Magic",
    });
    expect(result.current.concDurationEdit).toEqual({
      tokenId: 12,
      currentRemaining: 6,
    });
    expect(result.current.concDurationInput).toBe("6");
  });
});
