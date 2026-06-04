import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import type { MonsterAction } from "../SelectionContextMenu";
import type { RangeConfirmModalState } from "../MapMarkerAndConfirmDialogs";
import type { Token } from "../types/TacticalMapTypes";
import { getEdgeToEdgeDistance, parseTokenSize } from "../utils/mapCalculations";
import {
  parseMonsterActionRange,
  parseMonsterAreaAction,
  parseMonsterAttackBonus,
  parseMonsterDamageProfile,
} from "../utils/mapMonsterActionUtils";
import { publishAppEvent } from "~/events/appEventBus";
import { createLogger } from "~/utils/logger";

const logger = createLogger("useMapMonsterActionController");

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

interface SpellBuffSnapshot {
  acBonus: number;
  resistances: string[];
  immunities: string[];
  grantDisadvantage: string[];
}

interface MonsterAttackResultLike {
  hit: boolean;
  critical?: boolean;
  fumble?: boolean;
  damage_dealt?: number;
  extra_damage_dealt?: number;
  extra_damage_type?: string;
  target_defeated?: boolean;
  hp_change?: number;
  new_hp?: number | null;
  narrative?: string;
  [key: string]: unknown;
}

interface MonsterAttackExecutionData {
  action: MonsterAction;
  sourceTokenId: number;
  targetTokenId: number;
  sourceName: string;
  targetName: string;
  damageTypeForSound: string;
  attackRequest: Record<string, unknown>;
}

interface UseMapMonsterActionControllerArgs {
  tokens: Token[];
  campaignId: string;
  gridUnitLength: number;
  userId?: string | null;
  isDM: boolean;
  authedFetch: AuthedFetch;
  showToast: ShowToast;
  setSelectionContextMenu: Dispatch<SetStateAction<any>>;
  setRangeConfirmModal: Dispatch<SetStateAction<RangeConfirmModalState | null>>;
  setDiceRolling: Dispatch<SetStateAction<DiceRollingState>>;
  lastInitiatedAttackRef: MutableRefObject<{ attackerTokenId: number; targetTokenId: number; timestamp: number } | null>;
  getSpellBuffEffects: (token: Token) => SpellBuffSnapshot;
  showAttackOutcomeFeedback: (args: {
    sourceToken: Token;
    attackerName: string;
    targetName: string;
    result: MonsterAttackResultLike;
    outOfRange?: boolean;
    includeExtraDamageHintForDm?: boolean;
  }) => void;
  publishCombatAttackResult: (args: {
    attackerTokenId: number;
    attackerName: string;
    targetTokenId: number;
    targetName: string;
    attackName: string;
    result: MonsterAttackResultLike;
    damageOverride?: number;
    autoApply?: boolean;
  }) => void;
  applyAttackHpChange: (args: {
    autoApply: boolean;
    targetTokenId: number;
    result: MonsterAttackResultLike;
  }) => void;
  consumePendingIncomingAttackDisadvantage: (protectedTokenId?: number | null) => Promise<void>;
  playAttackCritical: (attackName: string, damageType: string) => void;
  playAttackHit: (attackName: string, damageType: string) => void;
  playAttackMiss: (attackName: string, damageType: string) => void;
}

export function useMapMonsterActionController({
  tokens,
  campaignId,
  gridUnitLength,
  userId,
  isDM,
  authedFetch,
  showToast,
  setSelectionContextMenu,
  setRangeConfirmModal,
  setDiceRolling,
  lastInitiatedAttackRef,
  getSpellBuffEffects,
  showAttackOutcomeFeedback,
  publishCombatAttackResult,
  applyAttackHpChange,
  consumePendingIncomingAttackDisadvantage,
  playAttackCritical,
  playAttackHit,
  playAttackMiss,
}: UseMapMonsterActionControllerArgs) {
  const resolveTargetSnapshot = useCallback(async (targetToken: Token) => {
    let targetAC = 10;
    let targetCurrentHP = targetToken.current_hp ?? null;
    let targetMaxHP = targetToken.max_hp ?? null;
    let targetHasShield: boolean | undefined = undefined;
    let targetEquippedWeapon: string | undefined = undefined;

    if ((targetToken as any).transformation_data) {
      const transformation = (targetToken as any).transformation_data;
      targetAC = transformation.ac || 10;
      targetCurrentHP = transformation.current_hp ?? targetCurrentHP;
      targetMaxHP = transformation.max_hp ?? targetMaxHP;
      targetHasShield = false;
    } else if (targetToken.character_id) {
      try {
        const response = await authedFetch(`/api/characters/${targetToken.character_id}/sheet`);
        if (response.ok) {
          const data = await response.json();
          const character = data?.character || {};
          const equipment = character.equipment || [];
          targetAC = character.armor_class || character.ac || 10;
          if (targetCurrentHP === null) targetCurrentHP = character.current_hp;
          if (targetMaxHP === null) targetMaxHP = character.max_hp;
          targetHasShield = equipment.some((item: any) =>
            item?.equippedSlot === "off_hand" && item.id === "shield",
          );
          const mainHandWeapon = equipment.find((item: any) => item?.equippedSlot === "main_hand");
          targetEquippedWeapon = mainHandWeapon?.name;
        }
      } catch (error) {
        logger.warn("Failed to fetch character defense snapshot", error);
      }
    } else if (targetToken.monster_instance_id) {
      targetHasShield = false;
      try {
        const response = await authedFetch(`/api/monster-instances/${targetToken.monster_instance_id}`);
        if (response.ok) {
          const monster = await response.json();
          targetAC = monster.ac || monster.monster_data?.ac || 10;
          if (targetCurrentHP === null) targetCurrentHP = monster.current_hp;
          if (targetMaxHP === null) targetMaxHP = monster.max_hp;
        }
      } catch (error) {
        logger.warn("Failed to fetch monster defense snapshot", error);
      }
    }

    const targetBuffs = getSpellBuffEffects(targetToken);
    return {
      targetAC: targetAC + targetBuffs.acBonus,
      targetCurrentHP,
      targetMaxHP,
      targetHasShield,
      targetEquippedWeapon,
      targetBuffs,
    };
  }, [authedFetch, getSpellBuffEffects]);

  const executeMonsterAttack = useCallback(async (
    executionData: MonsterAttackExecutionData,
    options?: { outOfRange?: boolean },
  ) => {
    const { action, sourceTokenId, targetTokenId, sourceName, targetName, damageTypeForSound, attackRequest } = executionData;
    const sourceToken = tokens.find((token) => token.id === sourceTokenId);
    if (!sourceToken) {
      showToast("无法找到攻击者", "error");
      return;
    }

    showToast(
      options?.outOfRange
        ? `${sourceName} 强行攻击 ${targetName}（超出射程）...`
        : `${sourceName} 攻击 ${targetName}...`,
      "info",
    );
    setDiceRolling({ visible: true, attackerName: sourceName, targetName });

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
        let errorMessage = "攻击失败";
        if (typeof error.detail === "string") {
          errorMessage = error.detail;
        } else if (Array.isArray(error.detail)) {
          errorMessage = error.detail.map((item: any) => {
            const location = item.loc ? item.loc.join(".") : "";
            return `${location}: ${item.msg || item.message || JSON.stringify(item)}`;
          }).join("; ");
        }
        showToast(errorMessage, "error");
        return;
      }

      setDiceRolling({ visible: false });
      const payload = await response.json();
      if (!payload.success || !payload.result) {
        showToast(payload.error || "攻击失败", "error");
        return;
      }

      const result = payload.result as MonsterAttackResultLike;
      showToast(result.narrative || `${sourceName} 对 ${targetName} 发起攻击`, result.hit ? "success" : "warning", 5000);

      if (result.critical) {
        playAttackCritical(action.name, damageTypeForSound);
      } else if (result.hit) {
        playAttackHit(action.name, damageTypeForSound);
      } else {
        playAttackMiss(action.name, damageTypeForSound);
      }

      const totalDamage = (result.damage_dealt || 0) + (result.extra_damage_dealt || 0);
      showAttackOutcomeFeedback({
        sourceToken,
        attackerName: sourceName,
        targetName,
        result,
        outOfRange: options?.outOfRange,
        includeExtraDamageHintForDm: true,
      });

      publishAppEvent("combatActionUsed", { type: "attack" });
      publishCombatAttackResult({
        attackerTokenId: sourceTokenId,
        attackerName: sourceName,
        targetTokenId,
        targetName,
        attackName: action.name,
        result,
        damageOverride: totalDamage,
        autoApply: true,
      });
      applyAttackHpChange({
        autoApply: true,
        targetTokenId,
        result,
      });
      await consumePendingIncomingAttackDisadvantage(targetTokenId);
    } catch (error) {
      setDiceRolling({ visible: false });
      logger.error("Monster attack failed", error);
      showToast("攻击请求失败", "error");
    }
  }, [
    applyAttackHpChange,
    authedFetch,
    consumePendingIncomingAttackDisadvantage,
    isDM,
    lastInitiatedAttackRef,
    playAttackCritical,
    playAttackHit,
    playAttackMiss,
    publishCombatAttackResult,
    setDiceRolling,
    showAttackOutcomeFeedback,
    showToast,
    tokens,
    userId,
  ]);

  const handleSelectionMonsterAction = useCallback(async (
    action: MonsterAction,
    sourceTokenId: number,
    targetTokenId?: number,
  ) => {
    const sourceToken = tokens.find((token) => token.id === sourceTokenId);
    const targetToken = targetTokenId ? tokens.find((token) => token.id === targetTokenId) : null;
    const sourceName = sourceToken?.instance_name || (sourceToken as any)?.monster_name || "源";
    const targetName = targetToken
      ? (targetToken.instance_name || (targetToken as any)?.character_name || (targetToken as any)?.monster_name || "目标")
      : "无目标";
    const cost = action.cost ? ` (消耗${action.cost}传奇动作)` : "";

    const attackBonus = parseMonsterAttackBonus(action);
    if (attackBonus !== undefined && targetTokenId && targetToken && sourceToken) {
      const sourceSize = parseTokenSize(sourceToken.token_size);
      const targetSize = parseTokenSize(targetToken.token_size);
      const distanceFeet = getEdgeToEdgeDistance(
        sourceToken.position_x,
        sourceToken.position_y,
        sourceSize.width,
        sourceSize.height,
        targetToken.position_x,
        targetToken.position_y,
        targetSize.width,
        targetSize.height,
      ) * gridUnitLength;

      const { targetAC, targetCurrentHP, targetMaxHP, targetHasShield, targetEquippedWeapon, targetBuffs } =
        await resolveTargetSnapshot(targetToken);
      const { damageStr, damageType, extraDamage } = parseMonsterDamageProfile(action);
      const { normalRange, maxRange } = parseMonsterActionRange(action);

      const attackRequest = {
        campaign_id: Number.parseInt(campaignId, 10) || 0,
        attacker_token_id: sourceTokenId,
        attacker_character_id: null,
        attacker_monster_instance_id: sourceToken.monster_instance_id || null,
        target_token_id: targetTokenId,
        attack: {
          key: `monster_${action.name}`,
          name: action.name,
          name_en: action.name,
          icon: "🎯",
          description: action.description || "",
          weapon_name: action.name,
          damage: damageStr,
          damage_type: damageType,
          extra_damage: extraDamage,
          properties: [],
          range: String(action.reach || action.range || (maxRange > 5 ? `${normalRange}/${maxRange}尺` : "5尺")),
          normal_range: normalRange,
          max_range: maxRange,
          needs_ammo: false,
          ammo_count: null,
          is_special: false,
        },
        distance_feet: distanceFeet,
        attacker: {
          name: sourceName,
          level: 1,
          class_id: null,
          class_name: null,
          ability_scores: {
            strength: 10,
            dexterity: 10,
            constitution: 10,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
          proficiency_bonus: 2,
        },
        target: {
          name: targetName,
          ac: targetAC,
          current_hp: targetCurrentHP,
          max_hp: targetMaxHP,
          has_shield: targetHasShield,
          equipped_weapon: targetEquippedWeapon,
          damage_resistances: targetBuffs.resistances.length > 0 ? targetBuffs.resistances : undefined,
          damage_immunities: targetBuffs.immunities.length > 0 ? targetBuffs.immunities : undefined,
        },
        auto_apply: true,
        attack_bonus_override: attackBonus,
        damage_bonus_override: 0,
        roll_modifier: targetBuffs.grantDisadvantage.length > 0 ? "disadvantage" : undefined,
      };

      const executionData: MonsterAttackExecutionData = {
        action,
        sourceTokenId,
        targetTokenId,
        sourceName,
        targetName,
        damageTypeForSound: damageType || action.damage?.type || "钝击",
        attackRequest,
      };

      setSelectionContextMenu(null);
      if (distanceFeet > maxRange) {
        setRangeConfirmModal({
          show: true,
          distanceFeet: Math.round(distanceFeet),
          maxRange,
          attackData: executionData,
          sourceName,
          targetName,
        });
        return;
      }

      await executeMonsterAttack(executionData);
      return;
    }

    if (action.area && action.save) {
      const areaAction = parseMonsterAreaAction(action);
      setSelectionContextMenu(null);
      publishAppEvent("startMonsterAreaAction", {
        sourceTokenId,
        actionName: action.name,
        breathWeapon: {
          shape: areaAction.shape,
          size: `${areaAction.sizeFeet}尺`,
          save: areaAction.saveTypeEn,
          saveCn: areaAction.saveTypeCn,
          shapeCn: areaAction.shape === "line" ? "线" : "锥",
        },
        damageType: areaAction.damageType,
        damageTypeCn: areaAction.damageTypeCn,
        damageDice: areaAction.damageStr,
        saveDC: areaAction.saveDC,
        saveEffect: areaAction.saveEffect,
      });
      return;
    }

    showToast(`${sourceName} 对 ${targetName} 使用 ${action.name}${cost}`, "info");
    logger.info("[Monster Action]", { action, source: sourceTokenId, target: targetTokenId });
    setSelectionContextMenu(null);
  }, [
    campaignId,
    executeMonsterAttack,
    gridUnitLength,
    resolveTargetSnapshot,
    setRangeConfirmModal,
    setSelectionContextMenu,
    showToast,
    tokens,
  ]);

  return {
    handleSelectionMonsterAction,
    executeMonsterAttack,
  };
}
