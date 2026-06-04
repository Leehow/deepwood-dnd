import { useCallback } from "react";

import type { Token } from "../types/TacticalMapTypes";
import { publishAppEvent } from "~/events/appEventBus";
import type { WebSocketMessage } from "~/hooks/useWebSocket";
import { createLogger } from "~/utils/logger";

const logger = createLogger("useMapTargetSaveEffectController");

type ShowToast = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

type AuthedFetch = (input: string, init?: RequestInit) => Promise<Response>;

type ActionResourceType = "bonus_action" | "action" | "reaction" | "free";

interface UseMapTargetSaveEffectControllerArgs {
  tokens: Token[];
  tokenStatusEffects: Record<number, any[]>;
  sourceCharacterData: any;
  campaignId: string;
  gridUnitLength: number;
  authedFetch: AuthedFetch;
  showToast: ShowToast;
  sendMessage: (payload: WebSocketMessage) => void;
  persistTokenActiveEffects: (tokenId: number, newEffects: any[]) => Promise<void>;
  buildSavingThrowTargetData: (
    targetToken: Token,
    ability: "strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" | "charisma",
  ) => Promise<any>;
  getEffectDefinitionFn: (effectId: string) => any;
  normalizeExecutionSaveAbility: (
    value: unknown,
  ) => "strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" | "charisma";
  resolveExecutionSaveDc: (
    spec: any,
    context: {
      abilityScores?: Record<string, number> | null;
      proficiencyBonus: number;
    },
  ) => number;
  resolveExecutionDurationRounds: (durationSpec: unknown, effectDef?: any) => number | undefined;
  resolveExecutionEffectId: (effectId: unknown) => string;
  formatExecutionText: (template: unknown, values: Record<string, string | number>) => string;
  clearSelectionContextMenu: () => void;
}

function getAbilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

function getProficiencyBonus(level: number): number {
  return Math.floor((Math.max(level, 1) - 1) / 4) + 2;
}

export function useMapTargetSaveEffectController({
  tokens,
  tokenStatusEffects,
  sourceCharacterData,
  campaignId,
  gridUnitLength,
  authedFetch,
  showToast,
  sendMessage,
  persistTokenActiveEffects,
  buildSavingThrowTargetData,
  getEffectDefinitionFn,
  normalizeExecutionSaveAbility,
  resolveExecutionSaveDc,
  resolveExecutionDurationRounds,
  resolveExecutionEffectId,
  formatExecutionText,
  clearSelectionContextMenu,
}: UseMapTargetSaveEffectControllerArgs) {
  const handleTargetSaveEffect = useCallback(async (args: {
    action: any;
    execution: any;
    actionResourceType: ActionResourceType;
    sourceTokenId: number;
    sourceToken: Token;
    sourceName: string;
    targetTokenId?: number;
  }) => {
    const {
      action,
      execution,
      actionResourceType,
      sourceTokenId,
      sourceToken,
      sourceName,
      targetTokenId,
    } = args;

    const targetConfig = execution.target || {};
    if (!targetTokenId || (targetConfig.allowSelf === false && targetTokenId === sourceTokenId)) {
      showToast(targetConfig.errorMessage || "请选择一个有效目标", "warning");
      return false;
    }

    const targetToken = tokens.find((token) => token.id === targetTokenId);
    if (!targetToken) {
      showToast("未找到目标 token", "error");
      return false;
    }

    const rangeFeet = Number(targetConfig.rangeFeet || 0);
    if (
      rangeFeet > 0
      && sourceToken.position_x != null
      && sourceToken.position_y != null
      && targetToken.position_x != null
      && targetToken.position_y != null
    ) {
      const dx = Math.abs((sourceToken.position_x || 0) - (targetToken.position_x || 0));
      const dy = Math.abs((sourceToken.position_y || 0) - (targetToken.position_y || 0));
      const distanceFeet = Math.max(dx, dy) * gridUnitLength;
      if (distanceFeet > rangeFeet) {
        showToast(`目标超出 ${rangeFeet} 尺范围`, "error");
        return false;
      }
    }

    const saveAbility = normalizeExecutionSaveAbility(execution.save?.ability);
    const proficiencyBonus = getProficiencyBonus(sourceCharacterData?.level || sourceToken.character_level || 1);
    const sourceAbilityScores = (
      sourceCharacterData?.ability_scores
      || sourceCharacterData?.abilities
      || {}
    ) as Record<string, number>;
    const saveDc = resolveExecutionSaveDc(execution.save?.dc, {
      abilityScores: sourceAbilityScores,
      proficiencyBonus,
    });
    const targetDisplayName = targetToken.instance_name || targetToken.character_name || targetToken.monster_name || "目标";

    try {
      const targetData = await buildSavingThrowTargetData(targetToken, saveAbility);
      const response = await authedFetch("/api/combat/saving-throw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: campaignId,
          source_name: sourceName,
          source_token_id: sourceTokenId,
          effect_name: action.name,
          effect_description: action.description || "",
          save_type: saveAbility,
          save_dc: saveDc,
          half_on_success: false,
          auto_apply: false,
          targets: [targetData],
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || error.error || "执行目标豁免失败");
      }

      const payload = await response.json();
      const targetResult = payload?.result?.target_results?.[0];
      if (!targetResult) {
        throw new Error("缺少豁免结果");
      }

      if (!targetResult.success) {
        const applyEffectConfig = execution.onFail?.applyEffect || execution.applyEffect;
        if (applyEffectConfig?.id) {
          const appliedEffectId = resolveExecutionEffectId(applyEffectConfig.id);
          const appliedEffectDef = getEffectDefinitionFn(appliedEffectId);
          const durationRounds = resolveExecutionDurationRounds(
            applyEffectConfig.durationRounds ?? applyEffectConfig.duration,
            appliedEffectDef,
          );
          const baseMetadata = (
            applyEffectConfig.metadata && typeof applyEffectConfig.metadata === "object"
              ? applyEffectConfig.metadata
              : {}
          ) as Record<string, unknown>;
          const nextEffect = {
            id: appliedEffectId,
            name: applyEffectConfig.name || appliedEffectDef?.name || appliedEffectId,
            icon: applyEffectConfig.icon || appliedEffectDef?.visual.icon || "✨",
            color: applyEffectConfig.color || appliedEffectDef?.visual.color || "#a855f7",
            ...(durationRounds ? { duration: durationRounds, maxDuration: durationRounds } : {}),
            metadata: {
              ...baseMetadata,
              sourceTokenId,
              sourceName,
              sourceFeatureId: baseMetadata.sourceFeatureId || action.id,
            },
          };
          const targetEffects = tokenStatusEffects[targetTokenId] || [];
          const updatedEffects = [
            ...targetEffects.filter((effect) => effect.id !== nextEffect.id),
            nextEffect,
          ];
          await persistTokenActiveEffects(targetTokenId, updatedEffects);
        }

        const failChat = formatExecutionText(execution.onFail?.chatMessage, {
          source: sourceName,
          target: targetDisplayName,
          effectName: action.name,
          saveTotal: targetResult.save_total,
          saveDc,
        });
        if (failChat) {
          sendMessage({
            type: "chat",
            data: { message: failChat, message_type: "combat" },
          });
        }
        const failToast = formatExecutionText(execution.onFail?.toastMessage, {
          source: sourceName,
          target: targetDisplayName,
          effectName: action.name,
          saveTotal: targetResult.save_total,
          saveDc,
        });
        if (failToast) {
          showToast(failToast, "warning");
        }
      } else {
        const successChat = formatExecutionText(execution.onSuccess?.chatMessage, {
          source: sourceName,
          target: targetDisplayName,
          effectName: action.name,
          saveTotal: targetResult.save_total,
          saveDc,
        });
        if (successChat) {
          sendMessage({
            type: "chat",
            data: { message: successChat, message_type: "combat" },
          });
        }
        const successToast = formatExecutionText(execution.onSuccess?.toastMessage, {
          source: sourceName,
          target: targetDisplayName,
          effectName: action.name,
          saveTotal: targetResult.save_total,
          saveDc,
        });
        if (successToast) {
          showToast(successToast, "success");
        }
      }
    } catch (error: any) {
      logger.error("[Bonus Action] Target save effect failed:", error);
      showToast(error?.message || "执行目标豁免失败", "error");
      return false;
    }

    if (actionResourceType === "bonus_action") {
      publishAppEvent("combatActionUsed", { type: "bonus_action" });
      publishAppEvent("combatBonusActionResult", {
        tokenId: sourceTokenId,
        tokenName: sourceName,
        actionName: action.name,
        actionIcon: "🎯",
      });
    } else if (actionResourceType !== "free") {
      publishAppEvent("combatActionUsed", { type: "action" });
    }

    logger.info("[Bonus Action] Target save effect resolved", {
      action: action.name,
      source: sourceTokenId,
      target: targetTokenId,
    });
    clearSelectionContextMenu();
    return true;
  }, [
    authedFetch,
    buildSavingThrowTargetData,
    campaignId,
    clearSelectionContextMenu,
    formatExecutionText,
    getEffectDefinitionFn,
    gridUnitLength,
    normalizeExecutionSaveAbility,
    persistTokenActiveEffects,
    resolveExecutionDurationRounds,
    resolveExecutionEffectId,
    resolveExecutionSaveDc,
    sendMessage,
    showToast,
    sourceCharacterData,
    tokenStatusEffects,
    tokens,
  ]);

  return { handleTargetSaveEffect };
}
