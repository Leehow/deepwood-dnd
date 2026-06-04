import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import type { AttackOption, Maneuver } from "../SelectionContextMenu";
import type { PreparedWeaponAttackAction } from "./useMapWeaponAttackPreparationController";
import type { Token } from "../types/TacticalMapTypes";
import { publishAppEvent } from "~/events/appEventBus";
import { createLogger } from "~/utils/logger";

const logger = createLogger("useMapWeaponAttackExecutionController");

type AuthedFetch = (input: string, init?: RequestInit) => Promise<Response>;

type ShowToast = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

interface DiceRollingState {
  visible: boolean;
  attackerName?: string;
  targetName?: string;
}

interface AttackResultLike {
  hit: boolean;
  critical?: boolean;
  damage_dealt?: number;
  extra_damage_dealt?: number;
  target_defeated?: boolean;
  narrative?: string;
  hp_change?: number;
  new_hp?: number | null;
}

interface UseMapWeaponAttackExecutionControllerArgs {
  authedFetch: AuthedFetch;
  userId?: string | null;
  isDM: boolean;
  showToast: ShowToast;
  setDiceRolling: Dispatch<SetStateAction<DiceRollingState>>;
  lastInitiatedAttackRef: MutableRefObject<{ attackerTokenId: number; targetTokenId: number; timestamp: number } | null>;
  tokens: Token[];
  pendingManeuvers: Record<number, { maneuver: Maneuver; targetTokenId?: number; timestamp: number } | null>;
  sourceCharacterData?: any;
  triggerPendingManeuver: (
    sourceTokenId: number,
    targetTokenId: number,
    triggerTiming: string,
  ) => Promise<{ dieName: string; dieRoll: number } | null>;
  applyManeuverSecondaryEffect: (
    maneuver: Maneuver,
    sourceToken: Token,
    targetToken: Token,
    dieRoll: number,
  ) => Promise<void>;
  showAttackOutcomeFeedback: (args: {
    sourceToken: Token;
    attackerName: string;
    targetName: string;
    result: AttackResultLike;
    maneuverBonusDamage?: number;
  }) => void;
  publishCombatBonusAttackGranted: (message: string) => void;
  publishPromptDivineSmite: (detail: {
    characterId: number;
    targetTokenId: number;
    targetName: string;
    baseDamage: number;
    distanceFeet: number;
    targetMonsterType?: string;
  }) => void;
  publishCombatAttackResult: (args: {
    attackerTokenId: number;
    attackerName: string;
    targetTokenId: number;
    targetName: string;
    attackName: string;
    result: AttackResultLike;
    damageOverride?: number;
    autoApply?: boolean;
  }) => void;
  applyAttackHpChange: (args: {
    autoApply: boolean;
    targetTokenId: number;
    result: AttackResultLike;
  }) => void;
  consumePendingIncomingAttackDisadvantage: (protectedTokenId?: number | null) => Promise<void>;
  runAttackCleanup: (args: {
    attack: AttackOption;
    sourceToken: Token;
    sourceTokenId: number;
    targetToken?: Token | null;
    sourceCharacterData?: any;
    attackerEffects: any[];
    inspirationDie?: string | null;
    pendingAttackBonusEffectId?: string;
    pendingAttackBonusSource?: string;
    cloakOfShadowsActive: boolean;
  }) => Promise<void>;
  playAttackCritical: (attackName: string, damageType: string) => void;
  playAttackHit: (attackName: string, damageType: string) => void;
  playAttackMiss: (attackName: string, damageType: string) => void;
}

export function useMapWeaponAttackExecutionController({
  authedFetch,
  userId,
  isDM,
  showToast,
  setDiceRolling,
  lastInitiatedAttackRef,
  tokens,
  pendingManeuvers,
  sourceCharacterData,
  triggerPendingManeuver,
  applyManeuverSecondaryEffect,
  showAttackOutcomeFeedback,
  publishCombatBonusAttackGranted,
  publishPromptDivineSmite,
  publishCombatAttackResult,
  applyAttackHpChange,
  consumePendingIncomingAttackDisadvantage,
  runAttackCleanup,
  playAttackCritical,
  playAttackHit,
  playAttackMiss,
}: UseMapWeaponAttackExecutionControllerArgs) {
  const executeAttackAction = useCallback(async (args: {
    attack: AttackOption;
    sourceTokenId: number;
    targetTokenId: number;
    distanceFeet: number;
    inspirationDie?: string | null;
    preparedAttack: PreparedWeaponAttackAction;
  }) => {
    const {
      attack,
      sourceTokenId,
      targetTokenId,
      distanceFeet,
      inspirationDie,
      preparedAttack,
    } = args;

    const {
      sourceToken,
      targetToken,
      attackerData,
      attackRequest,
      attackerEffects,
      cloakOfShadowsActive,
      pendingAttackBonusEffectId,
      pendingAttackBonusSource,
      isRangedAttack,
    } = preparedAttack;

    showToast(`${attackerData.name} 攻击 ${attackRequest.target.name}...`, "info");
    setDiceRolling({ visible: true, attackerName: attackerData.name, targetName: attackRequest.target.name });

    lastInitiatedAttackRef.current = {
      attackerTokenId: sourceTokenId,
      targetTokenId,
      timestamp: Date.now(),
    };

    try {
      const queryParams = new URLSearchParams({
        user_id: userId || "anonymous",
        role: isDM ? "dm" : "player",
      });
      const response = await authedFetch(`/api/combat/attack?${queryParams}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attackRequest),
      });

      if (!response.ok) {
        setDiceRolling({ visible: false });
        const error = await response.json().catch(() => ({}));
        logger.error("[Attack] Request failed", {
          status: response.status,
          error,
        });
        showToast(error.detail || "攻击请求失败", "error");
        return false;
      }

      setDiceRolling({ visible: false });
      const payload = await response.json();
      if (!payload.success || !payload.result) {
        showToast(payload.error || "攻击失败", "error");
        return false;
      }

      const result = payload.result as AttackResultLike;
      showToast(result.narrative || "攻击完成", result.hit ? "success" : "warning", 5000);

      const damageType = attackRequest.attack.damage_type || "钝击";
      if (result.critical) {
        playAttackCritical(attackRequest.attack.name, damageType);
      } else if (result.hit) {
        playAttackHit(attackRequest.attack.name, damageType);
      } else {
        playAttackMiss(attackRequest.attack.name, damageType);
      }

      let maneuverBonusDamage = 0;
      const pendingManeuver = pendingManeuvers[sourceTokenId];
      if (result.hit && pendingManeuver) {
        const maneuverResult = await triggerPendingManeuver(sourceTokenId, targetTokenId, "on_hit");
        if (maneuverResult) {
          maneuverBonusDamage = maneuverResult.dieRoll;
          const sourceCombatToken = tokens.find((token) => token.id === sourceTokenId);
          const targetCombatToken = tokens.find((token) => token.id === targetTokenId);
          if (sourceCombatToken && targetCombatToken) {
            await applyManeuverSecondaryEffect(
              pendingManeuver.maneuver,
              sourceCombatToken,
              targetCombatToken,
              maneuverResult.dieRoll,
            );
          }
        }
      }

      const totalDamage = (result.damage_dealt || 0) + (result.extra_damage_dealt || 0) + maneuverBonusDamage;
      showAttackOutcomeFeedback({
        sourceToken,
        attackerName: attackerData.name,
        targetName: attackRequest.target.name,
        result,
        maneuverBonusDamage,
      });

      const actionType = attack.isBonusAction ? "bonus_action" : "attack";
      publishAppEvent("combatActionUsed", { type: actionType });

      if ((result.critical || result.target_defeated) && !attack.isBonusAction) {
        const hasGWM = sourceCharacterData?.feats?.some((feat: any) => {
          const featValue = typeof feat === "string" ? feat : feat?.value;
          return featValue === "great_weapon_master";
        });
        const props = (attack.properties || []).map((property: string) => property.toLowerCase());
        const isHeavyMelee = props.some((property: string) => property.includes("heavy") || property.includes("重型"))
          && !attack.isRanged;
        if (hasGWM && isHeavyMelee) {
          publishCombatBonusAttackGranted("大武器大师：暴击/击杀，额外攻击(附赠动作)");
        }
      }

      if (result.hit && sourceCharacterData?.class_id === "paladin" && !isRangedAttack && sourceToken.character_id) {
        const hasSpellSlots = sourceCharacterData?.spell_slots_remaining
          && Object.values(sourceCharacterData.spell_slots_remaining).some((value: any) => value > 0);
        if (hasSpellSlots) {
          publishPromptDivineSmite({
            characterId: sourceToken.character_id,
            targetTokenId,
            targetName: targetToken.instance_name || targetToken.monster_name || "目标",
            baseDamage: result.damage_dealt || 0,
            distanceFeet,
            targetMonsterType: (targetToken as any).monster_type || undefined,
          });
        }
      }

      publishCombatAttackResult({
        attackerTokenId: sourceTokenId,
        attackerName: attackerData.name,
        targetTokenId,
        targetName: attackRequest.target.name,
        attackName: attack.name,
        result,
        damageOverride: totalDamage,
        autoApply: attackRequest.auto_apply,
      });

      applyAttackHpChange({
        autoApply: attackRequest.auto_apply,
        targetTokenId,
        result,
      });

      await consumePendingIncomingAttackDisadvantage(targetTokenId);

      await runAttackCleanup({
        attack,
        sourceToken,
        sourceTokenId,
        targetToken,
        sourceCharacterData,
        attackerEffects,
        inspirationDie,
        pendingAttackBonusEffectId,
        pendingAttackBonusSource,
        cloakOfShadowsActive,
      });

      return true;
    } catch (error) {
      setDiceRolling({ visible: false });
      logger.error("Attack action failed", error);
      showToast(`攻击请求失败: ${error instanceof Error ? error.message : String(error)}`, "error");
      return false;
    }
  }, [
    applyAttackHpChange,
    applyManeuverSecondaryEffect,
    authedFetch,
    consumePendingIncomingAttackDisadvantage,
    isDM,
    lastInitiatedAttackRef,
    pendingManeuvers,
    playAttackCritical,
    playAttackHit,
    playAttackMiss,
    publishCombatAttackResult,
    publishCombatBonusAttackGranted,
    publishPromptDivineSmite,
    runAttackCleanup,
    setDiceRolling,
    showAttackOutcomeFeedback,
    showToast,
    sourceCharacterData,
    tokens,
    triggerPendingManeuver,
    userId,
  ]);

  return {
    executeAttackAction,
  };
}
