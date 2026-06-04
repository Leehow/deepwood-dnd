import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { Token } from "../types/TacticalMapTypes";
import { getEdgeToEdgeDistance, parseTokenSize } from "../utils/mapCalculations";
import { publishAppEvent } from "~/events/appEventBus";
import type { WebSocketMessage } from "~/hooks/useWebSocket";

const GUIDED_STRIKE_BONUS_EFFECT_ID = "guided_strike_bonus";
const WAR_GODS_BLESSING_BONUS_EFFECT_ID = "war_gods_blessing_bonus";
const WARDING_FLARE_PENDING_EFFECT_ID = "warding_flare_pending";
const DESTRUCTIVE_WRATH_PENDING_EFFECT_ID = "destructive_wrath_pending";

type ShowToast = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

interface UseMapClericDomainActionControllerArgs {
  tokens: Token[];
  tokenStatusEffects: Record<number, any[]>;
  sourceCharacterData: any;
  gridUnitLength: number;
  showToast: ShowToast;
  sendMessage: (payload: WebSocketMessage) => void;
  persistTokenActiveEffects: (tokenId: number, newEffects: any[]) => Promise<void>;
  consumeCharacterResource: (
    characterId: number,
    resourceId: string,
    action: any,
    failureLabel: string,
  ) => Promise<{ current: number; max: number } | null>;
  setDampenElementsModal: Dispatch<SetStateAction<any>>;
  setWrathOfTheStormModal: Dispatch<SetStateAction<any>>;
  setManualReactionMode: Dispatch<SetStateAction<any>>;
  clearSelectionContextMenu: () => void;
  isWardingFlareDefenseEffect: (effect: any) => boolean;
  isPendingDamageResistanceEffect: (effect: any) => boolean;
  isWarDomainAttackBonusEffect: (effect: any) => boolean;
  isDestructiveWrathPendingEffect: (effect: any) => boolean;
}

export function useMapClericDomainActionController({
  tokens,
  tokenStatusEffects,
  sourceCharacterData,
  gridUnitLength,
  showToast,
  sendMessage,
  persistTokenActiveEffects,
  consumeCharacterResource,
  setDampenElementsModal,
  setWrathOfTheStormModal,
  setManualReactionMode,
  clearSelectionContextMenu,
  isWardingFlareDefenseEffect,
  isPendingDamageResistanceEffect,
  isWarDomainAttackBonusEffect,
  isDestructiveWrathPendingEffect,
}: UseMapClericDomainActionControllerArgs) {
  const handleWardingFlareAction = useCallback(async (args: {
    action: any;
    sourceTokenId: number;
    sourceToken: Token;
    sourceName: string;
    targetTokenId?: number;
  }) => {
    const {
      action,
      sourceTokenId,
      sourceToken,
      sourceName,
      targetTokenId,
    } = args;

    const characterId = sourceToken.character_id;
    const targetToken = targetTokenId ? tokens.find((token) => token.id === targetTokenId) : sourceToken;
    const canProtectAllies = (sourceCharacterData?.level || 1) >= 6;
    const normalizedSourceFaction = sourceToken.faction || (sourceToken.character_id ? "player" : "enemy");

    if (!characterId) {
      showToast("只有角色 token 才能使用护卫闪光", "error");
      return false;
    }
    if (!targetToken) {
      showToast("需要选择一个被保护的目标", "warning");
      return false;
    }

    const normalizedTargetFaction = targetToken.faction || (targetToken.character_id ? "player" : "enemy");
    const isSelfTarget = targetToken.id === sourceTokenId;
    if (!isSelfTarget) {
      if (!canProtectAllies) {
        showToast("6级前的护卫闪光只能保护自己", "warning");
        return false;
      }
      if (normalizedTargetFaction !== normalizedSourceFaction) {
        showToast("护卫闪光只能保护自己或友方生物", "warning");
        return false;
      }
    }

    if ((action.uses?.current ?? 0) <= 0) {
      showToast("护卫闪光已用完！需要长休后恢复", "warning");
      return false;
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
    if (!isSelfTarget && distanceFeet > 30) {
      showToast(`目标超出护卫闪光范围（${Math.round(distanceFeet)}尺 > 30尺）`, "error");
      return false;
    }

    const protectedEffects = tokenStatusEffects[targetToken.id] || [];
    if (protectedEffects.some((effect) => isWardingFlareDefenseEffect(effect))) {
      showToast(`${targetToken.instance_name || targetToken.character_name || "该目标"} 已有待结算的护卫闪光`, "warning");
      return false;
    }

    const resourceResult = await consumeCharacterResource(
      characterId,
      "warding_flare",
      action,
      action.name || "护卫闪光",
    );
    if (!resourceResult) return false;

    const protectedName = targetToken.instance_name || targetToken.character_name || targetToken.monster_name || "目标";
    const nextEffects = [...protectedEffects, {
      id: WARDING_FLARE_PENDING_EFFECT_ID,
      name: isSelfTarget ? "护卫闪光" : "护卫闪光（保护）",
      icon: "✨",
      color: "#fbbf24",
      spell_buff: true,
      buff_effects: {
        grantDisadvantage: ["attack"],
      },
      metadata: {
        wardingFlarePending: true,
        sourceName,
        sourceTokenId,
        protectedTokenId: targetToken.id,
        protectedTokenName: protectedName,
      },
    }];

    try {
      await persistTokenActiveEffects(targetToken.id, nextEffects);
    } catch (error) {
      console.error("[Action] Failed to persist Warding Flare effect:", error);
      showToast("保存护卫闪光状态失败", "error");
      return false;
    }

    sendMessage({
      type: "chat",
      data: {
        message: isSelfTarget
          ? `✨ **${sourceName}** 使用【护卫闪光】！\n> 针对 **${sourceName}** 的下一次攻击检定具有劣势。\n> 剩余护卫闪光: ${resourceResult.current}/${resourceResult.max}`
          : `✨ **${sourceName}** 以【护卫闪光】保护 **${protectedName}**！\n> 针对 **${protectedName}** 的下一次攻击检定具有劣势。\n> 剩余护卫闪光: ${resourceResult.current}/${resourceResult.max}`,
        message_type: "combat",
      },
    });
    showToast(
      isSelfTarget
        ? `${sourceName} 激活护卫闪光`
        : `${sourceName} 正在保护 ${protectedName}`,
      "success",
    );
    clearSelectionContextMenu();
    setManualReactionMode(null);
    publishAppEvent("combatReactionUsed", {
      reactor_token_id: sourceTokenId,
      reaction_id: action.id,
    });
    return true;
  }, [
    clearSelectionContextMenu,
    consumeCharacterResource,
    gridUnitLength,
    isWardingFlareDefenseEffect,
    persistTokenActiveEffects,
    sendMessage,
    setManualReactionMode,
    showToast,
    sourceCharacterData?.level,
    tokenStatusEffects,
    tokens,
  ]);

  const handleDampenElementsAction = useCallback((args: {
    action: any;
    sourceTokenId: number;
    sourceToken: Token;
    sourceName: string;
    targetTokenId?: number;
  }) => {
    const {
      action,
      sourceTokenId,
      sourceToken,
      sourceName,
      targetTokenId,
    } = args;

    const targetToken = targetTokenId ? tokens.find((token) => token.id === targetTokenId) : sourceToken;
    const normalizedSourceFaction = sourceToken.faction || (sourceToken.character_id ? "player" : "enemy");

    if (!targetToken) {
      showToast("需要选择一个受保护目标", "warning");
      return false;
    }

    const normalizedTargetFaction = targetToken.faction || (targetToken.character_id ? "player" : "enemy");
    const isSelfTarget = targetToken.id === sourceTokenId;
    if (!isSelfTarget && normalizedTargetFaction !== normalizedSourceFaction) {
      showToast("自然之怒只能保护自己或友方生物", "warning");
      return false;
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
    if (!isSelfTarget && distanceFeet > 30) {
      showToast(`目标超出自然之怒范围（${Math.round(distanceFeet)}尺 > 30尺）`, "error");
      return false;
    }

    const protectedEffects = tokenStatusEffects[targetToken.id] || [];
    if (protectedEffects.some((effect) => isPendingDamageResistanceEffect(effect))) {
      showToast(`${targetToken.instance_name || targetToken.character_name || "该目标"} 已有待触发的元素防护`, "warning");
      return false;
    }

    setDampenElementsModal({
      reactionId: action.id || action.passive_feature_id || "dampen_elements",
      sourceTokenId,
      targetTokenId: targetToken.id,
      sourceName,
      targetName: targetToken.instance_name || targetToken.character_name || targetToken.monster_name || "目标",
    });
    clearSelectionContextMenu();
    return true;
  }, [
    clearSelectionContextMenu,
    gridUnitLength,
    isPendingDamageResistanceEffect,
    setDampenElementsModal,
    showToast,
    tokenStatusEffects,
    tokens,
  ]);

  const handleWrathOfTheStormAction = useCallback((args: {
    action: any;
    sourceTokenId: number;
    sourceToken: Token;
    targetTokenId?: number;
    sourceName: string;
  }) => {
    const {
      action,
      sourceTokenId,
      sourceToken,
      targetTokenId,
      sourceName,
    } = args;

    const targetToken = targetTokenId ? tokens.find((token) => token.id === targetTokenId) : null;
    if (!sourceToken.character_id) {
      showToast("只有角色 token 才能使用风暴之怒", "error");
      return false;
    }
    if (!targetToken) {
      showToast("需要选择触发风暴之怒的相邻目标", "warning");
      return false;
    }
    if ((action.uses?.current ?? 0) <= 0) {
      showToast("风暴之怒已用完！需要长休后恢复", "warning");
      return false;
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
      return false;
    }

    setWrathOfTheStormModal({
      reactionId: action.id || action.passive_feature_id || "wrath_of_the_storm",
      sourceTokenId,
      targetTokenId: targetToken.id,
      sourceName,
      targetName: targetToken.instance_name || targetToken.character_name || targetToken.monster_name || "目标",
    });
    clearSelectionContextMenu();
    return true;
  }, [clearSelectionContextMenu, gridUnitLength, setWrathOfTheStormModal, showToast, tokens]);

  const handleGuidedStrikeAction = useCallback(async (args: {
    action: any;
    sourceTokenId: number;
    sourceToken: Token;
    sourceName: string;
  }) => {
    const { action, sourceTokenId, sourceToken, sourceName } = args;
    const characterId = sourceToken.character_id;
    const currentEffects = tokenStatusEffects[sourceTokenId] || [];

    if (!characterId) {
      showToast("只有角色 token 才能使用战争通道", "error");
      return false;
    }
    if ((action.uses?.current ?? 0) <= 0) {
      showToast("引导神力已用完！需要短休后恢复", "warning");
      return false;
    }
    if (currentEffects.some((effect) => isWarDomainAttackBonusEffect(effect))) {
      showToast("你已经有一个待生效的攻击命中加值", "warning");
      return false;
    }

    const resourceResult = await consumeCharacterResource(
      characterId,
      "channel_divinity_cleric",
      action,
      action.name || "战争通道",
    );
    if (!resourceResult) return false;

    const nextEffects = [...currentEffects, {
      id: GUIDED_STRIKE_BONUS_EFFECT_ID,
      name: "战争通道 +10",
      icon: "🎯",
      color: "#dc2626",
      metadata: {
        attackBonusAdd: 10,
        attackBonusSource: "战争通道",
        sourceName,
        sourceTokenId,
      },
    }];

    try {
      await persistTokenActiveEffects(sourceTokenId, nextEffects);
    } catch (error) {
      console.error("[Action] Failed to persist Guided Strike effect:", error);
      showToast("保存战争通道状态失败", "error");
      return false;
    }

    sendMessage({
      type: "chat",
      data: {
        message: `🎯 **${sourceName}** 使用【战争通道】！\n> 其下一次攻击检定获得 **+10** 命中加值。\n> 剩余引导神力: ${resourceResult.current}/${resourceResult.max}`,
        message_type: "combat",
      },
    });
    showToast(`${sourceName} 激活战争通道，下一次攻击 +10`, "success");
    clearSelectionContextMenu();
    return true;
  }, [
    clearSelectionContextMenu,
    consumeCharacterResource,
    isWarDomainAttackBonusEffect,
    persistTokenActiveEffects,
    sendMessage,
    showToast,
    tokenStatusEffects,
  ]);

  const handleWarGodsBlessingAction = useCallback(async (args: {
    action: any;
    sourceTokenId: number;
    sourceToken: Token;
    sourceName: string;
    targetTokenId?: number;
  }) => {
    const {
      action,
      sourceTokenId,
      sourceToken,
      sourceName,
      targetTokenId,
    } = args;

    const characterId = sourceToken.character_id;
    const targetToken = targetTokenId ? tokens.find((token) => token.id === targetTokenId) : null;
    if (!characterId) {
      showToast("只有角色 token 才能使用战神祝福", "error");
      return false;
    }
    if (!targetToken) {
      showToast("需要选择一个目标来获得战神祝福", "warning");
      return false;
    }
    if ((action.uses?.current ?? 0) <= 0) {
      showToast("引导神力已用完！需要短休后恢复", "warning");
      return false;
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
    if (distanceFeet > 30) {
      showToast(`目标超出战神祝福范围（${Math.round(distanceFeet)}尺 > 30尺）`, "error");
      return false;
    }

    const targetEffects = tokenStatusEffects[targetToken.id] || [];
    const targetName = targetToken.instance_name || targetToken.character_name || targetToken.monster_name || "目标";
    if (targetEffects.some((effect) => isWarDomainAttackBonusEffect(effect))) {
      showToast(`${targetName} 已经有一个待生效的攻击命中加值`, "warning");
      return false;
    }

    const resourceResult = await consumeCharacterResource(
      characterId,
      "channel_divinity_cleric",
      action,
      action.name || "战神祝福",
    );
    if (!resourceResult) return false;

    const nextEffects = [...targetEffects, {
      id: WAR_GODS_BLESSING_BONUS_EFFECT_ID,
      name: "战神祝福 +10",
      icon: "🙏",
      color: "#dc2626",
      metadata: {
        attackBonusAdd: 10,
        attackBonusSource: "战神祝福",
        sourceName,
        sourceTokenId,
      },
    }];

    try {
      await persistTokenActiveEffects(targetToken.id, nextEffects);
    } catch (error) {
      console.error("[Action] Failed to persist War God's Blessing effect:", error);
      showToast("保存战神祝福状态失败", "error");
      return false;
    }

    sendMessage({
      type: "chat",
      data: {
        message: `🙏 **${sourceName}** 赐予 **${targetName}**【战神祝福】！\n> **${targetName}** 的下一次攻击检定获得 **+10** 命中加值。\n> 剩余引导神力: ${resourceResult.current}/${resourceResult.max}`,
        message_type: "combat",
      },
    });
    showToast(`${sourceName} 赐予 ${targetName} 战神祝福，下一次攻击 +10`, "success");
    clearSelectionContextMenu();
    setManualReactionMode(null);
    publishAppEvent("combatReactionUsed", {
      reactor_token_id: sourceTokenId,
      reaction_id: action.id,
    });
    return true;
  }, [
    clearSelectionContextMenu,
    consumeCharacterResource,
    gridUnitLength,
    isWarDomainAttackBonusEffect,
    persistTokenActiveEffects,
    sendMessage,
    setManualReactionMode,
    showToast,
    tokenStatusEffects,
    tokens,
  ]);

  const handleDestructiveWrathAction = useCallback(async (args: {
    action: any;
    sourceTokenId: number;
    sourceToken: Token;
    sourceName: string;
  }) => {
    const { action, sourceTokenId, sourceToken, sourceName } = args;
    const characterId = sourceToken.character_id;
    const currentEffects = tokenStatusEffects[sourceTokenId] || [];

    if (!characterId) {
      showToast("只有角色 token 才能使用破坏之怒通道", "error");
      return false;
    }
    if ((action.uses?.current ?? 0) <= 0) {
      showToast("引导神力已用完！需要短休后恢复", "warning");
      return false;
    }
    if (currentEffects.some((effect) => isDestructiveWrathPendingEffect(effect))) {
      showToast("你已经准备好了破坏之怒", "warning");
      return false;
    }

    const resourceResult = await consumeCharacterResource(
      characterId,
      "channel_divinity_cleric",
      action,
      action.name || "破坏之怒通道",
    );
    if (!resourceResult) return false;

    const nextEffects = [...currentEffects, {
      id: DESTRUCTIVE_WRATH_PENDING_EFFECT_ID,
      name: "破坏之怒通道",
      icon: "🌩️",
      color: "#3b82f6",
      description: "下一次造成的闪电或雷鸣伤害骰取最大值，然后此效果被消耗。",
      metadata: {
        pendingTrigger: "deal_damage",
        pendingEffectType: "maximize_damage",
        triggerDamageTypes: ["lightning", "thunder"],
        sourceFeatureId: "destructive_wrath",
        sourceName,
        sourceTokenId,
      },
    }];

    try {
      await persistTokenActiveEffects(sourceTokenId, nextEffects);
    } catch (error) {
      console.error("[Action] Failed to persist Destructive Wrath effect:", error);
      showToast("保存破坏之怒状态失败", "error");
      return false;
    }

    sendMessage({
      type: "chat",
      data: {
        message: `🌩️ **${sourceName}** 引动【破坏之怒通道】！\n> 下一次造成的 **闪电** 或 **雷鸣** 伤害骰将取最大值。\n> 剩余引导神力: ${resourceResult.current}/${resourceResult.max}`,
        message_type: "combat",
      },
    });
    showToast(`${sourceName} 已准备破坏之怒`, "success");
    clearSelectionContextMenu();
    return true;
  }, [
    clearSelectionContextMenu,
    consumeCharacterResource,
    isDestructiveWrathPendingEffect,
    persistTokenActiveEffects,
    sendMessage,
    showToast,
    tokenStatusEffects,
  ]);

  return {
    handleWardingFlareAction,
    handleDampenElementsAction,
    handleWrathOfTheStormAction,
    handleGuidedStrikeAction,
    handleWarGodsBlessingAction,
    handleDestructiveWrathAction,
  };
}
