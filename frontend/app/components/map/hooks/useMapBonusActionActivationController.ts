import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { Token } from "../types/TacticalMapTypes";
import { publishAppEvent } from "~/events/appEventBus";
import { createLogger } from "~/utils/logger";

const logger = createLogger("useMapBonusActionActivationController");

type ShowToast = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

type AuthedFetch = (input: string, init?: RequestInit) => Promise<Response>;

type ActionResourceType = "bonus_action" | "action" | "reaction" | "free";

interface UseMapBonusActionActivationControllerArgs {
  campaignId: string;
  authedFetch: AuthedFetch;
  showToast: ShowToast;
  sendMessage: (payload: any) => void;
  setSourceCharacterData: Dispatch<SetStateAction<any>>;
  persistTokenActiveEffects: (tokenId: number, newEffects: any[]) => Promise<void>;
  clearSelectionContextMenu: () => void;
  clearManualReactionMode: () => void;
  handleInstantSelfHealAction: (args: {
    action: any;
    execution: any;
    actionResourceType: ActionResourceType;
    sourceTokenId: number;
    sourceToken: Token;
    sourceName: string;
  }) => Promise<boolean>;
  handleBardicInspirationAction: (args: {
    action: any;
    sourceTokenId: number;
    sourceToken: Token;
    sourceName: string;
    targetTokenId: number;
    actionResourceType: ActionResourceType;
  }) => Promise<boolean>;
}

export function useMapBonusActionActivationController({
  campaignId,
  authedFetch,
  showToast,
  sendMessage,
  setSourceCharacterData,
  persistTokenActiveEffects,
  clearSelectionContextMenu,
  clearManualReactionMode,
  handleInstantSelfHealAction,
  handleBardicInspirationAction,
}: UseMapBonusActionActivationControllerArgs) {
  const handleGenericBonusActionActivation = useCallback(async (args: {
    action: any;
    execution: any;
    effectKey: string;
    effectDef: any;
    currentEffects: any[];
    actionResourceType: ActionResourceType;
    actionUsageLabel: string;
    sourceTokenId: number;
    sourceToken: Token;
    sourceName: string;
    targetTokenId?: number;
    resolveExecutionEffectId: (effectId: unknown) => string;
  }) => {
    const {
      action,
      execution,
      effectKey,
      effectDef,
      currentEffects,
      actionResourceType,
      actionUsageLabel,
      sourceTokenId,
      sourceToken,
      sourceName,
      targetTokenId,
      resolveExecutionEffectId,
    } = args;

    const resourceId = effectDef?.resourceId || action.resourceId;
    const characterId = sourceToken?.character_id;

    if (resourceId && characterId) {
      const currentUses = action.uses?.current ?? action.current ?? 0;
      if (currentUses <= 0) {
        const rechargeType = action.uses?.recharge || action.recharge || "long_rest";
        showToast(`${action.name} 已用完，需要${rechargeType === "short_rest" ? "短休" : "长休"}恢复`, "error");
        return false;
      }

      try {
        const response = await authedFetch(`/api/characters/${characterId}/resources/use`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resource_id: resourceId,
            amount: 1,
            campaign_id: campaignId,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          showToast(errorData.detail || `使用 ${action.name} 失败`, "error");
          return false;
        }

        const result = await response.json();
        const newCurrent = result.current;
        const maxUses = result.max;

        setSourceCharacterData((previous: any) => {
          if (!previous?.actions) return previous;
          return {
            ...previous,
            actions: previous.actions.map((entry: any) =>
              (entry.id === action.id || entry.resourceId === resourceId) && entry.uses
                ? { ...entry, uses: { ...entry.uses, current: newCurrent } }
                : entry,
            ),
          };
        });

        showToast(`${sourceName} 使用${actionUsageLabel}: ${action.name} (${newCurrent}/${maxUses})`, "info");
      } catch (error) {
        logger.error("[Bonus Action] Failed to use resource:", error);
        showToast(`使用 ${action.name} 失败`, "error");
        return false;
      }
    } else if (action.uses) {
      if (action.uses.current <= 0) {
        showToast(`${action.name} 已用完，需要${action.uses.recharge === "short_rest" ? "短休" : "长休"}恢复`, "error");
        return false;
      }

      const newCurrent = action.uses.current - 1;
      setSourceCharacterData((previous: any) => {
        if (!previous?.actions) return previous;
        return {
          ...previous,
          actions: previous.actions.map((entry: any) =>
            entry.id === action.id && entry.uses
              ? { ...entry, uses: { ...entry.uses, current: newCurrent } }
              : entry,
          ),
        };
      });

      showToast(`${sourceName} 使用${actionUsageLabel}: ${action.name} (${newCurrent}/${action.uses.max})`, "info");

      if (characterId) {
        try {
          const characterResponse = await authedFetch(`/api/characters/${characterId}`);
          if (characterResponse.ok) {
            const characterData = await characterResponse.json();
            const currentUses = characterData.class_feature_uses || {};
            const updatedUses = {
              ...currentUses,
              [action.id]: { current: newCurrent, max: action.uses.max },
            };
            await authedFetch(`/api/characters/${characterId}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ class_feature_uses: updatedUses }),
            });
          }
        } catch (error) {
          logger.error("[Bonus Action] Failed to persist class feature uses:", error);
        }
      }
    } else {
      showToast(`${sourceName} 使用${actionUsageLabel}: ${action.name}`, "info");
    }

    if (execution.type === "self_heal") {
      return handleInstantSelfHealAction({
        action,
        execution,
        actionResourceType,
        sourceTokenId,
        sourceToken,
        sourceName,
      });
    }

    const isBardicInspiration = action.name === "激励" || action.name === "Bardic Inspiration" || action.id === "bardic_inspiration";
    if (isBardicInspiration && targetTokenId && targetTokenId !== sourceTokenId) {
      return handleBardicInspirationAction({
        action,
        sourceTokenId,
        sourceToken,
        sourceName,
        targetTokenId,
        actionResourceType,
      });
    }

    if (effectDef && effectDef.duration !== undefined) {
      const storedEffectId = resolveExecutionEffectId(effectKey) || action.id;
      const effectMetadata = {
        ...(execution.parentEffectId ? { parentEffectId: resolveExecutionEffectId(execution.parentEffectId) } : {}),
        ...(execution.onParentEffectEnd ? { onParentEffectEnd: execution.onParentEffectEnd } : {}),
      };
      const nextEffects = [
        ...currentEffects,
        {
          id: storedEffectId,
          name: action.name,
          icon: effectDef.icon,
          color: effectDef.color,
          duration: effectDef.duration,
          maxDuration: effectDef.duration,
          ...(Object.keys(effectMetadata).length > 0 ? { metadata: effectMetadata } : {}),
        },
      ];

      let chatMessage = `${effectDef.icon} **${sourceName}** 激活了【${action.name}】！持续 ${effectDef.duration} 轮`;
      if (typeof execution.activationWarning === "string" && execution.activationWarning.trim()) {
        chatMessage += `\n> ${execution.activationWarning}`;
      }

      sendMessage({
        type: "chat",
        data: { message: chatMessage, message_type: "combat" },
      });

      try {
        await persistTokenActiveEffects(sourceTokenId, nextEffects);
      } catch (error) {
        logger.error("[Bonus Action] Failed to persist active effects:", error);
        showToast("保存状态效果失败", "error");
        return false;
      }
    } else {
      const icon = effectDef?.icon || "⚡";
      sendMessage({
        type: "chat",
        data: { message: `${icon} **${sourceName}** 使用了【${action.name}】`, message_type: "combat" },
      });
    }

    if (actionResourceType === "bonus_action") {
      publishAppEvent("combatActionUsed", { type: "bonus_action" });
      publishAppEvent("combatBonusActionResult", {
        tokenId: sourceTokenId,
        tokenName: sourceName,
        actionName: action.name,
        actionIcon: effectDef?.icon || "⚡",
      });
    } else if (actionResourceType === "reaction") {
      clearManualReactionMode();
      publishAppEvent("combatReactionUsed", {
        reactor_token_id: sourceTokenId,
        reaction_id: action.id,
      });
    } else if (actionResourceType === "action") {
      publishAppEvent("combatActionUsed", { type: "action" });
    }

    logger.info("[Bonus Action] Generic activation resolved", {
      action: action.name,
      source: sourceTokenId,
      target: targetTokenId,
    });
    clearSelectionContextMenu();
    return true;
  }, [
    authedFetch,
    campaignId,
    clearManualReactionMode,
    clearSelectionContextMenu,
    handleBardicInspirationAction,
    handleInstantSelfHealAction,
    persistTokenActiveEffects,
    sendMessage,
    setSourceCharacterData,
    showToast,
  ]);

  return { handleGenericBonusActionActivation };
}
