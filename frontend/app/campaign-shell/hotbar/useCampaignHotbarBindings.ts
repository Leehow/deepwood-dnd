import { useEffect, type Dispatch, type SetStateAction } from "react";
import {
  subscribeAppEvent,
  type ArcaneRecoveryTargetEventPayload,
  type ConsumeSpellSlotEventPayload,
  type EquipmentWeaponUseEventPayload,
  type FlexibleCastingTargetEventPayload,
  type NaturalRecoveryTargetEventPayload,
  type PromptDivineSmiteEventPayload,
} from "~/events/appEventBus";
import type {
  CampaignAbilityConfirm,
  CampaignHotbarTargeting,
  CampaignSourceModalState,
} from "~/campaign-shell/hotbar/hotbarTypes";

function buildAbilityTargetingState(detail: {
  abilityId?: string;
  poolCurrent?: number;
  poolMax?: number;
  sourceCharacterId?: number;
  spellSlotLevel?: number;
}): CampaignHotbarTargeting | null {
  if (!detail.abilityId || detail.sourceCharacterId == null) {
    return null;
  }

  const nameMap: Record<string, string> = {
    lay_on_hands: "圣疗术",
    divine_smite: detail.spellSlotLevel
      ? `神圣惩击（${detail.spellSlotLevel}环位）`
      : "神圣惩击",
  };
  const iconMap: Record<string, string> = {
    lay_on_hands: "✋",
    divine_smite: "⚔",
  };

  return {
    slot: {
      type: "feature",
      id: detail.abilityId,
      name: nameMap[detail.abilityId] || detail.abilityId,
      icon: iconMap[detail.abilityId] || "★",
    },
    slotIndex: -1,
    sourceCharacterId: detail.sourceCharacterId,
    targetingType: "ability",
    abilityData: {
      abilityId: detail.abilityId,
      poolCurrent: detail.poolCurrent ?? 0,
      poolMax: detail.poolMax ?? 0,
      spellSlotLevel: detail.spellSlotLevel,
    },
  };
}

function buildEquipmentWeaponTargeting(detail: any): CampaignHotbarTargeting | null {
  if (detail?.characterId == null || !detail?.item) {
    return null;
  }

  const { characterId, item } = detail;
  const slotPrefix = detail.slot === "off_hand" ? "attack_off_" : "attack_main_";
  const damage = typeof item.damage === "object" ? item.damage?.dice : item.damage;

  let normalRange = 5;
  let maxRange = 5;
  if (typeof item.range === "object" && item.range) {
    normalRange = item.range.normal || 5;
    maxRange = item.range.long || normalRange;
  } else if (typeof item.range === "string") {
    const match = item.range.match(/(\d+)(?:\/(\d+))?/);
    if (match) {
      normalRange = Number(match[1]) || 5;
      maxRange = Number(match[2]) || normalRange;
    }
  }

  return {
    slot: {
      type: "weapon",
      id: `${slotPrefix}${item.id}`,
      name: item.name,
      meta: {
        damage: damage || "",
        damageType: item.damageType || "",
        properties: item.properties || [],
        range: item.range || "",
        normalRange,
        maxRange,
      },
    },
    slotIndex: -1,
    sourceCharacterId: characterId,
  };
}

function getFirstAvailableSpellSlotLevel(hotbarCharacter: any): number | undefined {
  if (!hotbarCharacter?.spell_slots_remaining) {
    return undefined;
  }

  const slots = hotbarCharacter.spell_slots_remaining as Record<string, number>;
  return Object.keys(slots)
    .map(Number)
    .sort((a, b) => a - b)
    .find((level) => slots[String(level)] > 0);
}

interface UseCampaignHotbarBindingsOptions {
  hotbarCharacter?: any | null;
  sendSpellCastChatMessage?: (message: string, spellCastData?: any) => void;
  onConsumeSpellSlot?: (detail: ConsumeSpellSlotEventPayload) => void;
  setHotbarTargeting: Dispatch<SetStateAction<CampaignHotbarTargeting | null>>;
  setAbilityConfirm: Dispatch<SetStateAction<CampaignAbilityConfirm | null>>;
  setArcaneRecoveryOpen?: Dispatch<SetStateAction<CampaignSourceModalState | null>>;
  setFlexibleCastingOpen?: Dispatch<SetStateAction<CampaignSourceModalState | null>>;
  setNaturalRecoveryOpen?: Dispatch<SetStateAction<CampaignSourceModalState | null>>;
}

export function useCampaignHotbarBindings({
  hotbarCharacter,
  sendSpellCastChatMessage,
  onConsumeSpellSlot,
  setHotbarTargeting,
  setAbilityConfirm,
  setArcaneRecoveryOpen,
  setFlexibleCastingOpen,
  setNaturalRecoveryOpen,
}: UseCampaignHotbarBindingsOptions): void {
  useEffect(() => {
    return subscribeAppEvent("spellCastChat", ({ message, spellCastData }) => {
      if (message) {
        sendSpellCastChatMessage?.(message, spellCastData);
      }
    });
  }, [sendSpellCastChatMessage]);

  useEffect(() => {
    return subscribeAppEvent("startAbilityTargeting", (detail) => {
      const nextTargeting = buildAbilityTargetingState(detail);
      if (nextTargeting) {
        setHotbarTargeting(nextTargeting);
      }
    });
  }, [setHotbarTargeting]);

  useEffect(() => {
    if (!onConsumeSpellSlot) {
      return;
    }
    return subscribeAppEvent("consumeSpellSlot", onConsumeSpellSlot);
  }, [onConsumeSpellSlot]);

  useEffect(() => {
    return subscribeAppEvent("layOnHandsTarget", (detail) => {
      setAbilityConfirm({
        abilityId: "lay_on_hands",
        sourceCharacterId: detail.sourceCharacterId,
        targetTokenId: detail.targetTokenId,
        targetName: detail.targetName,
        distanceFeet: detail.distanceFeet,
        targetMonsterType: detail.targetMonsterType ?? undefined,
        poolCurrent: detail.poolCurrent,
        poolMax: detail.poolMax,
      });
    });
  }, [setAbilityConfirm]);

  useEffect(() => {
    if (!setArcaneRecoveryOpen) {
      return;
    }
    return subscribeAppEvent("arcaneRecoveryTarget", (detail: ArcaneRecoveryTargetEventPayload) => {
      setArcaneRecoveryOpen({ sourceCharacterId: detail.sourceCharacterId });
    });
  }, [setArcaneRecoveryOpen]);

  useEffect(() => {
    if (!setFlexibleCastingOpen) {
      return;
    }
    return subscribeAppEvent("flexibleCastingTarget", (detail: FlexibleCastingTargetEventPayload) => {
      setFlexibleCastingOpen({ sourceCharacterId: detail.sourceCharacterId });
    });
  }, [setFlexibleCastingOpen]);

  useEffect(() => {
    if (!setNaturalRecoveryOpen) {
      return;
    }
    return subscribeAppEvent("naturalRecoveryTarget", (detail: NaturalRecoveryTargetEventPayload) => {
      setNaturalRecoveryOpen({ sourceCharacterId: detail.sourceCharacterId });
    });
  }, [setNaturalRecoveryOpen]);

  useEffect(() => {
    return subscribeAppEvent("promptDivineSmite", (detail: PromptDivineSmiteEventPayload) => {
      const firstSlotLevel = getFirstAvailableSpellSlotLevel(hotbarCharacter);
      if (!firstSlotLevel) {
        return;
      }
      setAbilityConfirm({
        abilityId: "divine_smite",
        sourceCharacterId: detail.characterId,
        targetTokenId: detail.targetTokenId,
        targetName: detail.targetName,
        distanceFeet: detail.distanceFeet ?? 5,
        targetMonsterType: detail.targetMonsterType,
        poolCurrent: 0,
        poolMax: 0,
        spellSlotLevel: firstSlotLevel,
      });
    });
  }, [hotbarCharacter, setAbilityConfirm]);

  useEffect(() => {
    const handler = (detail: EquipmentWeaponUseEventPayload) => {
      const nextTargeting = buildEquipmentWeaponTargeting(detail);
      if (nextTargeting) {
        setHotbarTargeting(nextTargeting);
      }
    };
    return subscribeAppEvent("equipmentWeaponUse", handler);
  }, [setHotbarTargeting]);
}
