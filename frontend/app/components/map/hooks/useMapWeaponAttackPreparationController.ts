import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { AttackOption, SourceCharacterData } from "../SelectionContextMenu";
import type { Token } from "../types/TacticalMapTypes";
import {
  buildWeaponAttackAttackerData,
  buildWeaponAttackRequest,
  resolveWeaponAttackRollContext,
  type AttackRollModifier,
  type SpellBuffEffects,
  type WeaponAttackTargetSnapshot,
} from "../utils/mapWeaponAttackPreparationUtils";
import { publishAppEvent } from "~/events/appEventBus";
import { createLogger } from "~/utils/logger";

const logger = createLogger("useMapWeaponAttackPreparationController");

type AuthedFetch = (input: string, init?: RequestInit) => Promise<Response>;

type ShowToast = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

export interface PreparedWeaponAttackAction {
  sourceToken: Token;
  targetToken: Token;
  attackerData: any;
  attackRequest: any;
  attackerEffects: any[];
  cloakOfShadowsActive: boolean;
  pendingAttackBonusEffectId?: string;
  pendingAttackBonusSource?: string;
  isRangedAttack: boolean;
}

interface UseMapWeaponAttackPreparationControllerArgs {
  tokens: Token[];
  sourceCharacterData?: SourceCharacterData | null;
  tokenStatusEffects: Record<number, any[]>;
  tokenRollModifier: Record<number, AttackRollModifier>;
  campaignId: string;
  authedFetch: AuthedFetch;
  showToast: ShowToast;
  clearSelectionContextMenu: () => void;
  setSourceCharacterData: Dispatch<SetStateAction<any>>;
  getSpellBuffEffects: (token: Token) => SpellBuffEffects;
  isWarDomainAttackBonusEffect: (effect: any) => boolean;
  isCloakOfShadowsEffect: (effect: any) => boolean;
  gridUnitLength: number;
}

async function resolveTargetSnapshot(
  targetToken: Token,
  authedFetch: AuthedFetch,
  getSpellBuffEffects: (token: Token) => SpellBuffEffects,
): Promise<WeaponAttackTargetSnapshot> {
  let targetAC = 10;
  let targetCurrentHP = targetToken.current_hp ?? null;
  let targetMaxHP = targetToken.max_hp ?? null;
  let targetHasShield: boolean | undefined = undefined;
  let targetEquippedWeapon: string | undefined = undefined;

  if (targetToken.transformation_data) {
    targetAC = targetToken.transformation_data.ac || 10;
    targetCurrentHP = targetToken.transformation_data.current_hp ?? targetCurrentHP;
    targetMaxHP = targetToken.transformation_data.max_hp ?? targetMaxHP;
  } else if (targetToken.monster_instance_id) {
    try {
      const response = await authedFetch(`/api/monster-instances/${targetToken.monster_instance_id}`);
      if (response.ok) {
        const monsterData = await response.json();
        targetAC = monsterData.ac || monsterData.monster_data?.ac || 10;
        if (targetCurrentHP === null) targetCurrentHP = monsterData.current_hp;
        if (targetMaxHP === null) targetMaxHP = monsterData.max_hp;
      }
    } catch (error) {
      logger.warn("Failed to fetch monster AC, using default", error);
    }
  }

  if (targetToken.character_id) {
    try {
      const response = await authedFetch(`/api/characters/${targetToken.character_id}/sheet`);
      if (response.ok) {
        const data = await response.json();
        const targetEquipment = data?.character?.equipment || [];
        targetHasShield = targetEquipment.some((item: any) =>
          item?.equippedSlot === "off_hand" && item.id === "shield",
        );
        const mainHandWeapon = targetEquipment.find((item: any) => item?.equippedSlot === "main_hand");
        if (mainHandWeapon?.name) {
          targetEquippedWeapon = mainHandWeapon.name;
        }
      }
    } catch (error) {
      logger.warn("Failed to fetch target character equipment", error);
    }
  } else {
    targetHasShield = false;
  }

  const targetBuffs = getSpellBuffEffects(targetToken);
  targetAC += targetBuffs.acBonus;

  return {
    targetAC,
    targetCurrentHP,
    targetMaxHP,
    targetHasShield,
    targetEquippedWeapon,
    targetBuffs,
  };
}

export function useMapWeaponAttackPreparationController({
  tokens,
  sourceCharacterData,
  tokenStatusEffects,
  tokenRollModifier,
  campaignId,
  authedFetch,
  showToast,
  clearSelectionContextMenu,
  setSourceCharacterData,
  getSpellBuffEffects,
  isWarDomainAttackBonusEffect,
  isCloakOfShadowsEffect,
  gridUnitLength,
}: UseMapWeaponAttackPreparationControllerArgs) {
  const consumeAttackResource = useCallback(async (
    attack: AttackOption,
    sourceCharacterId: number,
  ) => {
    if (!attack.resourceId) return true;

    try {
      const response = await authedFetch(`/api/characters/${sourceCharacterId}/resources/use`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resource_id: attack.resourceId,
          amount: 1,
          campaign_id: parseInt(campaignId, 10),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        showToast(errorData.detail || `${attack.weaponName || attack.name} 使用失败`, "error");
        return false;
      }

      const result = await response.json();
      const newCurrent = result.current;

      setSourceCharacterData((previous: any) => {
        if (!previous?.actions) return previous;
        return {
          ...previous,
          actions: previous.actions.map((actionItem: any) =>
            (
              actionItem.id === attack.featureActionId
              || actionItem.name === attack.featureActionName
              || actionItem.resourceId === attack.resourceId
            ) && actionItem.uses
              ? { ...actionItem, uses: { ...actionItem.uses, current: newCurrent } }
              : actionItem,
          ),
        };
      });

      return true;
    } catch (error) {
      logger.error("[Attack] Failed to use feature resource:", error);
      showToast(`${attack.weaponName || attack.name} 使用失败`, "error");
      return false;
    }
  }, [authedFetch, campaignId, setSourceCharacterData, showToast]);

  const prepareAttackAction = useCallback(async (args: {
    attack: AttackOption;
    sourceTokenId: number;
    targetTokenId: number;
    distanceFeet: number;
    inspirationDie?: string | null;
    modifiers?: { powerAttack?: boolean; useLucky?: boolean };
  }): Promise<PreparedWeaponAttackAction | null> => {
    const {
      attack,
      sourceTokenId,
      targetTokenId,
      distanceFeet,
      inspirationDie,
      modifiers,
    } = args;

    const sourceToken = tokens.find((token) => token.id === sourceTokenId);
    const targetToken = tokens.find((token) => token.id === targetTokenId);

    if (!sourceToken || !targetToken) {
      showToast("无法找到攻击者或目标", "error");
      clearSelectionContextMenu();
      return null;
    }

    if (attack.resourceId && sourceToken.character_id) {
      const resourceConsumed = await consumeAttackResource(attack, sourceToken.character_id);
      if (!resourceConsumed) {
        return null;
      }
    }

    const attackerData = buildWeaponAttackAttackerData(sourceToken, sourceCharacterData);
    const sourceBuffs = getSpellBuffEffects(sourceToken);
    const targetSnapshot = await resolveTargetSnapshot(targetToken, authedFetch, getSpellBuffEffects);
    const attackerEffects = tokenStatusEffects[sourceTokenId] || [];
    const cloakOfShadowsActive = attackerEffects.some((effect) => isCloakOfShadowsEffect(effect));
    const pendingAttackBonusEffect = attackerEffects.find((effect) => isWarDomainAttackBonusEffect(effect));
    const pendingAttackBonusAdd = Number(pendingAttackBonusEffect?.metadata?.attackBonusAdd || 0);
    const pendingAttackBonusSource = pendingAttackBonusEffect?.metadata?.attackBonusSource as string | undefined;

    const rollContext = resolveWeaponAttackRollContext({
      attack,
      sourceCharacterData,
      sourceTokenId,
      targetTokenId,
      targetToken,
      tokens,
      gridUnitLength,
      sourceBuffs,
      targetBuffs: targetSnapshot.targetBuffs,
      distanceFeet,
      initialRollModifier: tokenRollModifier[sourceTokenId] || null,
      pendingAttackBonusAdd,
      pendingAttackBonusSource,
      modifiers,
    });

    for (const toast of rollContext.toastMessages) {
      showToast(toast.message, toast.type);
    }

    if (rollContext.shouldConsumeLucky && sourceToken.character_id) {
      void authedFetch(`/api/characters/${sourceToken.character_id}/resources/use`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resource_id: "lucky_feat",
          amount: 1,
          campaign_id: parseInt(campaignId, 10),
        }),
      }).then(() => {
        publishAppEvent("classFeatureUsesUpdated", { characterId: sourceToken.character_id as number });
      }).catch(() => {});
    }

    const attackRequest = buildWeaponAttackRequest({
      campaignId,
      attack,
      sourceToken,
      sourceTokenId,
      targetTokenId,
      distanceFeet,
      attackerData,
      targetName: targetToken.instance_name || targetToken.monster_name || "目标",
      targetSnapshot,
      rollModifier: rollContext.computedRollModifier,
      advantageReasons: rollContext.advantageReasons,
      pendingAttackBonusAdd,
      pendingAttackBonusSource,
      inspirationDie,
      sourceBuffs,
      modifiers,
      sneakAttackEligible: rollContext.sneakAttackEligible,
    });

    return {
      sourceToken,
      targetToken,
      attackerData,
      attackRequest,
      attackerEffects,
      cloakOfShadowsActive,
      pendingAttackBonusEffectId: pendingAttackBonusEffect?.id,
      pendingAttackBonusSource,
      isRangedAttack: rollContext.isRangedAttack,
    };
  }, [
    authedFetch,
    campaignId,
    clearSelectionContextMenu,
    consumeAttackResource,
    getSpellBuffEffects,
    gridUnitLength,
    isCloakOfShadowsEffect,
    isWarDomainAttackBonusEffect,
    showToast,
    sourceCharacterData,
    tokenRollModifier,
    tokenStatusEffects,
    tokens,
  ]);

  return {
    prepareAttackAction,
  };
}
