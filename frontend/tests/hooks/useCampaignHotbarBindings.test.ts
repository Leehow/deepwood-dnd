import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useCampaignHotbarBindings } from "../../app/campaign-shell/hotbar/useCampaignHotbarBindings";
import { publishAppEvent } from "../../app/events/appEventBus";
import type {
  CampaignAbilityConfirm,
  CampaignHotbarTargeting,
  CampaignSourceModalState,
} from "../../app/campaign-shell/hotbar/hotbarTypes";

describe("useCampaignHotbarBindings", () => {
  it("routes typed recovery target events into the matching source modals", () => {
    const { result } = renderHook(() => {
      const [hotbarTargeting, setHotbarTargeting] = useState<CampaignHotbarTargeting | null>(null);
      const [abilityConfirm, setAbilityConfirm] = useState<CampaignAbilityConfirm | null>(null);
      const [arcaneRecoveryOpen, setArcaneRecoveryOpen] = useState<CampaignSourceModalState | null>(null);
      const [flexibleCastingOpen, setFlexibleCastingOpen] = useState<CampaignSourceModalState | null>(null);
      const [naturalRecoveryOpen, setNaturalRecoveryOpen] = useState<CampaignSourceModalState | null>(null);

      useCampaignHotbarBindings({
        hotbarCharacter: null,
        sendSpellCastChatMessage: vi.fn(),
        onConsumeSpellSlot: vi.fn(),
        setHotbarTargeting,
        setAbilityConfirm,
        setArcaneRecoveryOpen,
        setFlexibleCastingOpen,
        setNaturalRecoveryOpen,
      });

      return {
        hotbarTargeting,
        abilityConfirm,
        arcaneRecoveryOpen,
        flexibleCastingOpen,
        naturalRecoveryOpen,
      };
    });

    act(() => {
      publishAppEvent("arcaneRecoveryTarget", { sourceCharacterId: 18 });
      publishAppEvent("flexibleCastingTarget", { sourceCharacterId: 19 });
      publishAppEvent("naturalRecoveryTarget", { sourceCharacterId: 20 });
    });

    expect(result.current.arcaneRecoveryOpen).toEqual({ sourceCharacterId: 18 });
    expect(result.current.flexibleCastingOpen).toEqual({ sourceCharacterId: 19 });
    expect(result.current.naturalRecoveryOpen).toEqual({ sourceCharacterId: 20 });
  });

  it("still handles legacy recovery DOM events through the event bus bridge", () => {
    const { result } = renderHook(() => {
      const [hotbarTargeting, setHotbarTargeting] = useState<CampaignHotbarTargeting | null>(null);
      const [abilityConfirm, setAbilityConfirm] = useState<CampaignAbilityConfirm | null>(null);
      const [arcaneRecoveryOpen, setArcaneRecoveryOpen] = useState<CampaignSourceModalState | null>(null);

      useCampaignHotbarBindings({
        hotbarCharacter: null,
        sendSpellCastChatMessage: vi.fn(),
        onConsumeSpellSlot: vi.fn(),
        setHotbarTargeting,
        setAbilityConfirm,
        setArcaneRecoveryOpen,
      });

      return {
        hotbarTargeting,
        abilityConfirm,
        arcaneRecoveryOpen,
      };
    });

    act(() => {
      window.dispatchEvent(new CustomEvent("arcaneRecoveryTarget", {
        detail: { sourceCharacterId: 77 },
      }));
    });

    expect(result.current.arcaneRecoveryOpen).toEqual({ sourceCharacterId: 77 });
  });

  it("opens divine smite confirm from the typed prompt event", () => {
    const { result } = renderHook(() => {
      const [hotbarTargeting, setHotbarTargeting] = useState<CampaignHotbarTargeting | null>(null);
      const [abilityConfirm, setAbilityConfirm] = useState<CampaignAbilityConfirm | null>(null);

      useCampaignHotbarBindings({
        hotbarCharacter: {
          spell_slots_remaining: {
            "1": 2,
          },
        } as any,
        sendSpellCastChatMessage: vi.fn(),
        onConsumeSpellSlot: vi.fn(),
        setHotbarTargeting,
        setAbilityConfirm,
      });

      return {
        hotbarTargeting,
        abilityConfirm,
      };
    });

    act(() => {
      publishAppEvent("promptDivineSmite", {
        characterId: 18,
        targetTokenId: 22,
        targetName: "食尸鬼",
        distanceFeet: 5,
      });
    });

    expect(result.current.abilityConfirm).toEqual({
      abilityId: "divine_smite",
      sourceCharacterId: 18,
      targetTokenId: 22,
      targetName: "食尸鬼",
      distanceFeet: 5,
      targetMonsterType: undefined,
      poolCurrent: 0,
      poolMax: 0,
      spellSlotLevel: 1,
    });
  });

  it("routes equipment weapon use through the typed bus into hotbar targeting", () => {
    const { result } = renderHook(() => {
      const [hotbarTargeting, setHotbarTargeting] = useState<CampaignHotbarTargeting | null>(null);
      const [abilityConfirm, setAbilityConfirm] = useState<CampaignAbilityConfirm | null>(null);

      useCampaignHotbarBindings({
        hotbarCharacter: null,
        sendSpellCastChatMessage: vi.fn(),
        onConsumeSpellSlot: vi.fn(),
        setHotbarTargeting,
        setAbilityConfirm,
      });

      return { hotbarTargeting, abilityConfirm };
    });

    act(() => {
      publishAppEvent("equipmentWeaponUse", {
        characterId: 18,
        item: {
          id: "shortbow",
          name: "短弓",
          damage: { dice: "1d6" },
          damageType: "piercing",
          range: "80/320",
          properties: ["ammunition", "two_handed"],
        },
        slot: "main_hand",
      });
    });

    expect(result.current.hotbarTargeting).toEqual({
      slot: {
        type: "weapon",
        id: "attack_main_shortbow",
        name: "短弓",
        meta: {
          damage: "1d6",
          damageType: "piercing",
          properties: ["ammunition", "two_handed"],
          range: "80/320",
          normalRange: 80,
          maxRange: 320,
        },
      },
      slotIndex: -1,
      sourceCharacterId: 18,
    });
  });
});
