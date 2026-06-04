import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { Token } from "../types/TacticalMapTypes";
import { getEdgeToEdgeDistance, parseTokenSize } from "../utils/mapCalculations";
import { publishAppEvent } from "~/events/appEventBus";
import type { WebSocketMessage } from "~/hooks/useWebSocket";
import { castSpellViaAPI } from "~/utils/sidebarCasting";

const CLOAK_OF_SHADOWS_EFFECT_ID = "cloak_of_shadows";
const CLOAK_OF_SHADOWS_DURATION_ROUNDS = 2;
const CLOAK_OF_SHADOWS_SOURCE_NAME = "诡术斗篷";
const BLESSING_OF_THE_TRICKSTER_EFFECT_PREFIX = "blessing_of_the_trickster_";
const BLESSING_OF_THE_TRICKSTER_DURATION_ROUNDS = 600;
const CORONA_OF_LIGHT_EFFECT_ID = "corona_of_light";

type ShowToast = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

type AuthedFetch = (input: string, init?: RequestInit) => Promise<Response>;

interface UseMapTrickeryLightActionControllerArgs {
  tokens: Token[];
  tokenStatusEffects: Record<number, any[]>;
  sourceCharacterData: any;
  campaignId: string;
  gridUnitLength: number;
  authedFetch: AuthedFetch;
  showToast: ShowToast;
  sendMessage: (payload: WebSocketMessage) => void;
  setTokens: Dispatch<SetStateAction<Token[]>>;
  setTokenStatusEffects: Dispatch<SetStateAction<Record<number, any[]>>>;
  setSourceCharacterData: Dispatch<SetStateAction<any>>;
  persistTokenActiveEffects: (tokenId: number, newEffects: any[]) => Promise<void>;
  consumeCharacterResource: (
    characterId: number,
    resourceId: string,
    action: any,
    failureLabel: string,
  ) => Promise<{ current: number; max: number } | null>;
  upsertBlessingOfTheTricksterStatus: (
    characterId: number,
    sourceCharacterId: number,
    sourceName: string,
    apply: boolean,
  ) => Promise<void>;
  upsertCloakOfShadowsCondition: (
    characterId: number,
    apply: boolean,
  ) => Promise<void>;
  clearSelectionContextMenu: () => void;
  isCloakOfShadowsEffect: (effect: any) => boolean;
  isBlessingOfTheTricksterEffect: (effect: any, sourceCharacterId?: number | null) => boolean;
}

export function useMapTrickeryLightActionController({
  tokens,
  tokenStatusEffects,
  sourceCharacterData,
  campaignId,
  gridUnitLength,
  authedFetch,
  showToast,
  sendMessage,
  setTokens,
  setTokenStatusEffects,
  setSourceCharacterData,
  persistTokenActiveEffects,
  consumeCharacterResource,
  upsertBlessingOfTheTricksterStatus,
  upsertCloakOfShadowsCondition,
  clearSelectionContextMenu,
  isCloakOfShadowsEffect,
  isBlessingOfTheTricksterEffect,
}: UseMapTrickeryLightActionControllerArgs) {
  const handleCloakOfShadowsAction = useCallback(async (args: {
    action: any;
    sourceTokenId: number;
    sourceToken: Token;
    sourceName: string;
  }) => {
    const {
      action,
      sourceTokenId,
      sourceToken,
      sourceName,
    } = args;

    const characterId = sourceToken.character_id;
    const currentEffects = tokenStatusEffects[sourceTokenId] || [];
    if (!characterId) {
      showToast("只有角色 token 才能使用诡术斗篷", "error");
      return false;
    }
    if ((action.uses?.current ?? 0) <= 0) {
      showToast("引导神力已用完！需要短休后恢复", "warning");
      return false;
    }
    if (currentEffects.some((effect) => isCloakOfShadowsEffect(effect))) {
      showToast("诡术斗篷已经处于激活状态", "warning");
      return false;
    }

    const resourceResult = await consumeCharacterResource(
      characterId,
      "channel_divinity_cleric",
      action,
      action.name || CLOAK_OF_SHADOWS_SOURCE_NAME,
    );
    if (!resourceResult) return false;

    const currentRound = typeof window !== "undefined"
      ? Number((window as any).__combatRound || 0)
      : 0;
    const nextEffects = [
      ...currentEffects,
      {
        id: CLOAK_OF_SHADOWS_EFFECT_ID,
        name: CLOAK_OF_SHADOWS_SOURCE_NAME,
        icon: "🌑",
        color: "#6366f1",
        duration: CLOAK_OF_SHADOWS_DURATION_ROUNDS,
        maxDuration: CLOAK_OF_SHADOWS_DURATION_ROUNDS,
        description: "隐形直到你的下一回合结束；当你进行攻击或施放法术时提前结束。",
        spell_buff: true,
        buff_effects: {
          advantageOn: ["attack"],
          grantDisadvantage: ["attack"],
        },
        conditions: ["invisible"],
        metadata: {
          sourceFeatureId: "cloak_of_shadows",
          sourceCharacterId: characterId,
          sourceTokenId,
          sourceName,
          activatedRound: currentRound,
        },
      },
    ];

    try {
      await persistTokenActiveEffects(sourceTokenId, nextEffects);
      await upsertCloakOfShadowsCondition(characterId, true);
    } catch (error) {
      console.error("[Action] Cloak of Shadows failed:", error);
      showToast("激活诡术斗篷失败", "error");
      return false;
    }

    sendMessage({
      type: "chat",
      data: {
        message: `🌑 **${sourceName}** 使用【诡术斗篷】！\n> **${sourceName}** 进入 **隐形** 状态，直到其下一回合结束。\n> 若 **${sourceName}** 进行攻击或施放法术，此效果会提前结束。\n> 剩余引导神力: ${resourceResult.current}/${resourceResult.max}`,
        message_type: "combat",
      },
    });
    showToast(`${sourceName} 进入隐形（诡术斗篷）`, "success");
    publishAppEvent("combatActionUsed", { type: "action" });
    clearSelectionContextMenu();
    return true;
  }, [
    clearSelectionContextMenu,
    consumeCharacterResource,
    isCloakOfShadowsEffect,
    persistTokenActiveEffects,
    sendMessage,
    showToast,
    tokenStatusEffects,
    upsertCloakOfShadowsCondition,
  ]);

  const handleBlessingOfTheTricksterAction = useCallback(async (args: {
    sourceTokenId: number;
    sourceToken: Token;
    targetTokenId?: number;
    sourceName: string;
  }) => {
    const {
      sourceTokenId,
      sourceToken,
      targetTokenId,
      sourceName,
    } = args;

    const sourceCharacterId = sourceToken.character_id;
    const targetToken = targetTokenId ? tokens.find((token) => token.id === targetTokenId) : null;
    if (!sourceCharacterId) {
      showToast("只有角色 token 才能使用诡术祝福", "error");
      return false;
    }
    if (!targetToken) {
      showToast("需要选择一个友方目标", "warning");
      return false;
    }
    if (targetToken.id === sourceTokenId) {
      showToast("诡术祝福不能对自己使用", "warning");
      return false;
    }

    const normalizedSourceFaction = sourceToken.faction || (sourceToken.character_id ? "player" : "enemy");
    const normalizedTargetFaction = targetToken.faction || (targetToken.character_id ? "player" : "enemy");
    if (normalizedTargetFaction !== normalizedSourceFaction) {
      showToast("诡术祝福只能授予友方生物", "warning");
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
      showToast(`目标超出诡术祝福范围（${Math.round(distanceFeet)}尺 > 5尺）`, "error");
      return false;
    }

    const numericSourceCharacterId = Number(sourceCharacterId);
    const previousBlessedTargets = tokens.flatMap((token) => {
      const effects = tokenStatusEffects[token.id] || token.active_effects || [];
      return effects.some((effect) => isBlessingOfTheTricksterEffect(effect, numericSourceCharacterId))
        ? [{ token, effects }]
        : [];
    });
    const previousOtherTargets = previousBlessedTargets.filter(({ token }) => token.id !== targetToken.id);
    const targetEffects = tokenStatusEffects[targetToken.id] || targetToken.active_effects || [];
    const cleanedTargetEffects = targetEffects.filter(
      (effect) => !isBlessingOfTheTricksterEffect(effect, numericSourceCharacterId),
    );
    const nextTargetEffects = [
      ...cleanedTargetEffects,
      {
        id: `${BLESSING_OF_THE_TRICKSTER_EFFECT_PREFIX}${numericSourceCharacterId}`,
        name: "诡术祝福",
        icon: "🎭",
        color: "#6366f1",
        duration: BLESSING_OF_THE_TRICKSTER_DURATION_ROUNDS,
        maxDuration: BLESSING_OF_THE_TRICKSTER_DURATION_ROUNDS,
        description: "隐匿检定具有优势，持续1小时或直到施法者再次使用。",
        metadata: {
          sourceFeatureId: "blessing_of_the_trickster",
          sourceCharacterId: numericSourceCharacterId,
          sourceTokenId,
          sourceName,
        },
      },
    ];

    try {
      for (const { token } of previousBlessedTargets) {
        if (token.character_id && token.character_id !== targetToken.character_id) {
          await upsertBlessingOfTheTricksterStatus(
            token.character_id,
            numericSourceCharacterId,
            sourceName,
            false,
          );
        }
      }

      if (targetToken.character_id) {
        await upsertBlessingOfTheTricksterStatus(
          targetToken.character_id,
          numericSourceCharacterId,
          sourceName,
          true,
        );
      }

      for (const { token, effects } of previousBlessedTargets) {
        const updatedEffects = effects.filter(
          (effect) => !isBlessingOfTheTricksterEffect(effect, numericSourceCharacterId),
        );
        await persistTokenActiveEffects(token.id, updatedEffects);
      }

      await persistTokenActiveEffects(targetToken.id, nextTargetEffects);
    } catch (error) {
      console.error("[Action] Blessing of the Trickster failed:", error);
      showToast("施放诡术祝福失败", "error");
      return false;
    }

    const targetDisplayName = targetToken.instance_name || targetToken.character_name || targetToken.monster_name || "目标";
    const previousOtherNames = previousOtherTargets
      .map(({ token }) => token.instance_name || token.character_name || token.monster_name || "目标");

    sendMessage({
      type: "chat",
      data: {
        message: [
          `🎭 **${sourceName}** 赐予 **${targetDisplayName}**【诡术祝福】！`,
          `> **${targetDisplayName}** 的 **隐匿检定** 具有优势，持续 **1小时**，或直到 **${sourceName}** 再次使用此能力。`,
          ...(previousOtherNames.length > 0
            ? [`> 先前的诡术祝福结束：${previousOtherNames.join("、")}`]
            : []),
        ].join("\n"),
        message_type: "combat",
      },
    });
    showToast(`${sourceName} 对 ${targetDisplayName} 施加诡术祝福`, "success");
    publishAppEvent("combatActionUsed", { type: "action" });
    clearSelectionContextMenu();
    return true;
  }, [
    clearSelectionContextMenu,
    gridUnitLength,
    isBlessingOfTheTricksterEffect,
    persistTokenActiveEffects,
    sendMessage,
    showToast,
    tokenStatusEffects,
    tokens,
    upsertBlessingOfTheTricksterStatus,
  ]);

  const handleRadianceOfTheDawnAction = useCallback(async (args: {
    sourceTokenId: number;
    sourceToken: Token;
    sourceName: string;
  }) => {
    const { sourceTokenId, sourceToken, sourceName } = args;

    const characterId = sourceToken.character_id;
    if (!characterId) {
      showToast("只有角色 token 才能使用光辉通道", "error");
      return false;
    }

    // Pre-select enemy targets within 30ft
    const sourceFaction = sourceToken.faction || (sourceToken.character_id ? "player" : "enemy");
    const sourceSize = parseTokenSize(sourceToken.token_size);
    const enemyTargetIds: number[] = [];
    for (const token of tokens) {
      if (token.id === sourceTokenId) continue;
      if (!token.character_id && !token.monster_instance_id) continue;
      const tokenFaction = token.faction || (token.character_id ? "player" : "enemy");
      if (tokenFaction === "neutral" || tokenFaction === sourceFaction) continue;
      const targetSize = parseTokenSize(token.token_size);
      const dist = getEdgeToEdgeDistance(
        sourceToken.position_x, sourceToken.position_y, sourceSize.width, sourceSize.height,
        token.position_x, token.position_y, targetSize.width, targetSize.height,
      ) * gridUnitLength;
      if (dist <= 30) enemyTargetIds.push(token.id);
    }

    // Consume channel divinity
    const resourceResult = await consumeCharacterResource(
      characterId, "channel_divinity_cleric",
      { id: "radiance_of_the_dawn", resourceId: "channel_divinity_cleric" },
      "光辉通道",
    );
    if (!resourceResult) return false;

    if (enemyTargetIds.length === 0) {
      // Still call API with caster as target — triggers darkness dispelling
      const apiResult = await castSpellViaAPI(
        "radiance_of_the_dawn", 0, sourceTokenId, [sourceTokenId], campaignId,
        undefined, true, false,
      );
      const dispelled = apiResult?.dispelled_darkness_count || 0;
      showToast(
        `${sourceName} 释放光辉通道${dispelled > 0 ? `，驱散黑暗 ${dispelled} 处` : "，但30尺内没有敌对生物"}`,
        "success",
      );
      publishAppEvent("combatActionUsed", { type: "action" });
      clearSelectionContextMenu();
      return true;
    }

    const apiResult = await castSpellViaAPI(
      "radiance_of_the_dawn", 0, sourceTokenId, enemyTargetIds, campaignId,
      undefined, true, false,
    );

    if (!apiResult?.success) {
      showToast("光辉通道施放失败", "error");
      return false;
    }

    const results = apiResult.results || [];
    const failed = results.filter((r: any) => r.damage_dealt > 0 && !r.save_succeeded).length;
    const succeeded = results.filter((r: any) => r.save_succeeded).length;
    const dispelled = apiResult.dispelled_darkness_count || 0;
    showToast(
      `${sourceName} 释放光辉通道：${failed} 失败，${succeeded} 成功${dispelled > 0 ? `，驱散黑暗 ${dispelled} 处` : ""}`,
      "success",
    );
    publishAppEvent("combatActionUsed", { type: "action" });
    clearSelectionContextMenu();
    return true;
  }, [campaignId, clearSelectionContextMenu, consumeCharacterResource, gridUnitLength, showToast, tokens]);

  const handleCoronaOfLightAction = useCallback(async (args: {
    sourceTokenId: number;
    sourceToken: Token;
    sourceName: string;
  }) => {
    const {
      sourceTokenId,
      sourceToken,
      sourceName,
    } = args;

    const characterId = sourceToken.character_id;
    const currentEffects = tokenStatusEffects[sourceTokenId] || [];
    if (!characterId) {
      showToast("只有角色 token 才能激活日冕", "error");
      return false;
    }
    if (currentEffects.some((effect) => effect.id === CORONA_OF_LIGHT_EFFECT_ID)) {
      showToast("日冕已经处于激活状态", "warning");
      return false;
    }

    try {
      const response = await authedFetch(`/api/characters/${characterId}/corona-of-light`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: parseInt(campaignId, 10),
          source_token_id: sourceTokenId,
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(result.detail || "激活日冕失败", "error");
        return false;
      }

      const nextEffects = Array.isArray(result.active_effects)
        ? result.active_effects
        : [...currentEffects, result.effect].filter(Boolean);

      setTokenStatusEffects((previous) => ({
        ...previous,
        [sourceTokenId]: nextEffects,
      }));
      setTokens((previous) => previous.map((token) =>
        token.id === sourceTokenId
          ? { ...token, active_effects: nextEffects.length > 0 ? nextEffects : null }
          : token,
      ));

      publishAppEvent("combatActionUsed", { type: "action" });
      showToast(`${sourceName} 激活日冕`, "success");
      clearSelectionContextMenu();
      return true;
    } catch (error) {
      console.error("[Action] Corona of Light failed:", error);
      showToast("激活日冕失败", "error");
      return false;
    }
  }, [authedFetch, campaignId, clearSelectionContextMenu, setTokenStatusEffects, setTokens, showToast, tokenStatusEffects]);

  return {
    handleCloakOfShadowsAction,
    handleBlessingOfTheTricksterAction,
    handleRadianceOfTheDawnAction,
    handleCoronaOfLightAction,
  };
}
