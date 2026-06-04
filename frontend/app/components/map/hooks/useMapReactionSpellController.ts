import { useCallback } from "react";

import type { DampenElementsDamageType } from "../DampenElementsModal";
import type { WrathOfTheStormDamageType } from "../WrathOfTheStormModal";
import type { Token } from "../types/TacticalMapTypes";
import { getEdgeToEdgeDistance, parseTokenSize } from "../utils/mapCalculations";
import { publishAppEvent } from "~/events/appEventBus";
import type { WebSocketMessage } from "~/hooks/useWebSocket";
import {
  castSpellViaAPI,
  syncCharacterSpellSlotsFromBackend,
} from "~/utils/sidebarCasting";

const DAMPEN_ELEMENTS_PENDING_EFFECT_PREFIX = "dampen_elements_pending_";
const DAMPEN_ELEMENTS_DAMAGE_LABEL: Record<DampenElementsDamageType, string> = {
  acid: "强酸",
  cold: "冰冷",
  fire: "火焰",
  lightning: "闪电",
  thunder: "雷鸣",
};
const DAMPEN_ELEMENTS_DAMAGE_ICON: Record<DampenElementsDamageType, string> = {
  acid: "🧪",
  cold: "❄️",
  fire: "🔥",
  lightning: "⚡",
  thunder: "🌩️",
};

type ShowToast = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

interface UseMapReactionSpellControllerArgs {
  dampenElementsModal: {
    sourceTokenId: number;
    targetTokenId: number;
    sourceName: string;
    targetName: string;
    reactionId: string;
  } | null;
  wrathOfTheStormModal: {
    reactionId: string;
    sourceTokenId: number;
    targetTokenId: number;
    sourceName: string;
    targetName: string;
  } | null;
  tokens: Token[];
  campaignId: string;
  gridUnitLength: number;
  tokenStatusEffects: Record<number, any[]>;
  persistTokenActiveEffects: (tokenId: number, newEffects: any[]) => Promise<void>;
  sendMessage: (payload: WebSocketMessage) => void;
  showToast: ShowToast;
  consumeCharacterResource: (
    characterId: number,
    resourceId: string,
    source: any,
    sourceName: string,
  ) => Promise<unknown>;
  isPendingDamageResistanceEffect: (effect: any) => boolean;
  closeDampenElementsModal: () => void;
  closeWrathOfTheStormModal: () => void;
  clearReactionUi: () => void;
  clearCloakOfShadowsEffect: (
    tokenId: number,
    reason: "attack" | "spell" | "turn_end" | "manual",
  ) => Promise<unknown>;
}

export function useMapReactionSpellController({
  dampenElementsModal,
  wrathOfTheStormModal,
  tokens,
  campaignId,
  gridUnitLength,
  tokenStatusEffects,
  persistTokenActiveEffects,
  sendMessage,
  showToast,
  consumeCharacterResource,
  isPendingDamageResistanceEffect,
  closeDampenElementsModal,
  closeWrathOfTheStormModal,
  clearReactionUi,
  clearCloakOfShadowsEffect,
}: UseMapReactionSpellControllerArgs) {
  const handleDampenElementsConfirm = useCallback(async (damageType: DampenElementsDamageType) => {
    if (!dampenElementsModal) return;

    const {
      sourceTokenId,
      targetTokenId,
      sourceName,
      targetName,
      reactionId,
    } = dampenElementsModal;
    const currentEffects = tokenStatusEffects[targetTokenId] || [];
    if (currentEffects.some((effect) => isPendingDamageResistanceEffect(effect))) {
      showToast(`${targetName} 已经有一个待触发的元素防护效果`, "warning");
      return;
    }

    const damageLabel = DAMPEN_ELEMENTS_DAMAGE_LABEL[damageType];
    const damageIcon = DAMPEN_ELEMENTS_DAMAGE_ICON[damageType];
    const nextEffects = [
      ...currentEffects,
      {
        id: `${DAMPEN_ELEMENTS_PENDING_EFFECT_PREFIX}${damageType}`,
        name: `自然之怒（${damageLabel}）`,
        icon: damageIcon,
        color: "#16a34a",
        description: `下一次受到${damageLabel}伤害时获得抗性，然后此效果被消耗。`,
        metadata: {
          pendingTrigger: "damage_received",
          pendingEffectType: "grant_resistance",
          triggerDamageTypes: [damageType],
          sourceFeatureId: "dampen_elements",
          sourceName,
          sourceTokenId,
          protectedTokenId: targetTokenId,
          protectedTokenName: targetName,
        },
      },
    ];

    try {
      await persistTokenActiveEffects(targetTokenId, nextEffects);
    } catch {
      showToast("保存自然之怒状态失败", "error");
      return;
    }

    sendMessage({
      type: "chat",
      data: {
        message: `🛡️ **${sourceName}** 对 **${targetName}** 使用【自然之怒】！\n> 已准备抵御下一次 **${damageLabel}** 伤害。\n> 该次伤害将获得抗性，触发后自动消耗。`,
        message_type: "combat",
      },
    });
    showToast(`${sourceName} 为 ${targetName} 挂上了 ${damageLabel} 防护`, "success");
    closeDampenElementsModal();
    clearReactionUi();
    publishAppEvent("combatReactionUsed", {
      reactor_token_id: sourceTokenId,
      reaction_id: reactionId,
    });
  }, [
    clearReactionUi,
    closeDampenElementsModal,
    dampenElementsModal,
    isPendingDamageResistanceEffect,
    persistTokenActiveEffects,
    sendMessage,
    showToast,
    tokenStatusEffects,
  ]);

  const handleWrathOfTheStormConfirm = useCallback(async (damageType: WrathOfTheStormDamageType) => {
    if (!wrathOfTheStormModal) return;

    const {
      reactionId,
      sourceTokenId,
      targetTokenId,
      sourceName,
      targetName,
    } = wrathOfTheStormModal;
    const sourceToken = tokens.find((token) => token.id === sourceTokenId);
    const targetToken = tokens.find((token) => token.id === targetTokenId);

    if (!sourceToken || !targetToken) {
      showToast("未找到风暴之怒的来源或目标", "error");
      return;
    }
    if (!sourceToken.character_id) {
      showToast("只有角色 token 才能使用风暴之怒", "error");
      return;
    }

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
    if (distanceFeet > 5) {
      showToast(`目标超出风暴之怒范围（${Math.round(distanceFeet)}尺 > 5尺）`, "error");
      return;
    }

    const resourceResult = await consumeCharacterResource(
      sourceToken.character_id,
      "wrath_of_the_storm",
      { id: reactionId, resourceId: "wrath_of_the_storm" },
      "风暴之怒",
    );
    if (!resourceResult) return;

    closeWrathOfTheStormModal();

    const apiResult = await castSpellViaAPI(
      "wrath_of_the_storm",
      0,
      sourceTokenId,
      [targetTokenId],
      campaignId,
      undefined,
      true, // freecast
      false,
      damageType, // selectedOption: "lightning" or "thunder"
    );

    if (!apiResult?.success) {
      showToast("风暴之怒施放失败", "error");
      return;
    }

    showToast(`${sourceName} 对 ${targetName} 释放风暴之怒`, "success");
    await clearCloakOfShadowsEffect(sourceTokenId, "spell");
    clearReactionUi();
    publishAppEvent("combatReactionUsed", {
      reactor_token_id: sourceTokenId,
      reaction_id: reactionId,
    });
  }, [
    campaignId,
    clearCloakOfShadowsEffect,
    clearReactionUi,
    closeWrathOfTheStormModal,
    consumeCharacterResource,
    gridUnitLength,
    showToast,
    tokens,
    wrathOfTheStormModal,
  ]);

  return {
    handleDampenElementsConfirm,
    handleWrathOfTheStormConfirm,
  };
}
