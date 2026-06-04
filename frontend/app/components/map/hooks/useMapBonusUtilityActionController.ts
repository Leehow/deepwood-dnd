import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { Token } from "../types/TacticalMapTypes";
import { publishAppEvent } from "~/events/appEventBus";
import type { WebSocketMessage } from "~/hooks/useWebSocket";
import { showCharacterBubble } from "~/utils/characterBubble";
import { showDamageNumber } from "../DamageNumberOverlay";

type ShowToast = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

type AuthedFetch = (input: string, init?: RequestInit) => Promise<Response>;

interface UseMapBonusUtilityActionControllerArgs {
  tokens: Token[];
  tokenStatusEffects: Record<number, any[]>;
  sourceCharacterData: any;
  campaignId: string;
  authedFetch: AuthedFetch;
  showToast: ShowToast;
  sendMessage: (payload: WebSocketMessage) => void;
  setTokens: Dispatch<SetStateAction<Token[]>>;
  setSourceCharacterData: Dispatch<SetStateAction<any>>;
  persistTokenActiveEffects: (tokenId: number, newEffects: any[]) => Promise<void>;
  clearSelectionContextMenu: () => void;
  rollSimpleDice: (formula: string) => { total: number; rolls: number[] } | null;
  resolveExecutionScalar: (spec: any, context: { classLevel: number }) => number;
}

export function useMapBonusUtilityActionController({
  tokens,
  tokenStatusEffects,
  sourceCharacterData,
  campaignId,
  authedFetch,
  showToast,
  sendMessage,
  setTokens,
  setSourceCharacterData,
  persistTokenActiveEffects,
  clearSelectionContextMenu,
  rollSimpleDice,
  resolveExecutionScalar,
}: UseMapBonusUtilityActionControllerArgs) {
  const dispatchCombatUsage = useCallback((args: {
    actionResourceType: "bonus_action" | "action" | "reaction" | "free";
    sourceTokenId: number;
    sourceName: string;
    actionName: string;
    actionIcon: string;
  }) => {
    const {
      actionResourceType,
      sourceTokenId,
      sourceName,
      actionName,
      actionIcon,
    } = args;

    if (actionResourceType === "bonus_action") {
      publishAppEvent("combatActionUsed", { type: "bonus_action" });
      publishAppEvent("combatBonusActionResult", {
        tokenId: sourceTokenId,
        tokenName: sourceName,
        actionName,
        actionIcon,
      });
    } else if (actionResourceType === "action") {
      publishAppEvent("combatActionUsed", { type: "action" });
    }
  }, []);

  const handleInstantSelfHealAction = useCallback(async (args: {
    action: any;
    execution: any;
    actionResourceType: "bonus_action" | "action" | "reaction" | "free";
    sourceTokenId: number;
    sourceToken: Token;
    sourceName: string;
  }) => {
    const {
      action,
      execution,
      actionResourceType,
      sourceTokenId,
      sourceToken,
      sourceName,
    } = args;

    const classLevel = sourceCharacterData?.level || 1;
    const healSpec = execution.heal || {};
    const diceResult = typeof healSpec.dice === "string" ? rollSimpleDice(healSpec.dice) : null;
    const diceTotal = diceResult?.total || 0;
    const flatBonus = resolveExecutionScalar(healSpec.bonus, { classLevel });
    const healingAmount = diceTotal + flatBonus;

    const currentHp = sourceToken.current_hp ?? 0;
    const maxHp = sourceToken.max_hp ?? currentHp;
    const newHp = Math.min(currentHp + healingAmount, maxHp);
    const actualHealing = newHp - currentHp;

    setTokens((previous) => previous.map((token) =>
      token.id === sourceTokenId ? { ...token, current_hp: newHp } : token,
    ));

    if (actualHealing > 0) {
      showDamageNumber({
        targetTokenId: sourceTokenId,
        damage: actualHealing,
        hit: true,
        critical: false,
        fumble: false,
        heal: true,
      });
    }

    try {
      await authedFetch(`/api/tokens/${sourceTokenId}/hp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_hp: newHp }),
      });
    } catch (error) {
      console.error("[Bonus Action] Failed to update HP:", error);
    }

    const rollText = diceResult
      ? `${healSpec.dice}(${diceResult.rolls.join(",")})`
      : `${diceTotal}`;
    const bonusText = flatBonus > 0 ? ` + ${flatBonus}` : "";
    sendMessage({
      type: "chat",
      data: {
        message: `💨 **${sourceName}** 使用【${action.name}】恢复生命值！\n🎲 ${rollText}${bonusText} = **${healingAmount}** 点治疗\n❤️ HP: ${currentHp} → ${newHp}/${maxHp}${actualHealing < healingAmount ? " (已满)" : ""}`,
        message_type: "combat",
      },
    });

    if (sourceToken.character_id) {
      showCharacterBubble({
        characterId: sourceToken.character_id,
        characterName: sourceName,
        message: `💨 ${action.name}！恢复 ${actualHealing} HP (${currentHp}→${newHp})`,
        type: "combat",
        avatarUrl: sourceToken.avatar ?? undefined,
      });
    }

    dispatchCombatUsage({
      actionResourceType,
      sourceTokenId,
      sourceName,
      actionName: action.name,
      actionIcon: "💨",
    });
    showToast(`${action.name} 恢复 ${actualHealing} 点生命值！`, "success");
    clearSelectionContextMenu();
    return true;
  }, [
    authedFetch,
    clearSelectionContextMenu,
    dispatchCombatUsage,
    resolveExecutionScalar,
    rollSimpleDice,
    sendMessage,
    setTokens,
    showToast,
    sourceCharacterData,
  ]);

  const handleBardicInspirationAction = useCallback(async (args: {
    action: any;
    sourceTokenId: number;
    sourceToken: Token;
    sourceName: string;
    targetTokenId: number;
    actionResourceType: "bonus_action" | "action" | "reaction" | "free";
  }) => {
    const {
      action,
      sourceTokenId,
      sourceToken,
      sourceName,
      targetTokenId,
      actionResourceType,
    } = args;

    if (targetTokenId === sourceTokenId) {
      return false;
    }

    const targetToken = tokens.find((token) => token.id === targetTokenId);
    const targetName = targetToken?.instance_name || targetToken?.character_name || targetToken?.monster_name || "目标";

    if (action.uses && action.uses.current <= 0) {
      const rechargeText = action.uses.recharge === "short_rest" ? "短休" : "长休";
      showToast(`激励骰已用完！需要${rechargeText}后恢复`, "warning");
      return false;
    }

    const bardLevel = sourceCharacterData?.level || 1;
    let diceSize = "d6";
    if (bardLevel >= 15) diceSize = "d12";
    else if (bardLevel >= 10) diceSize = "d10";
    else if (bardLevel >= 5) diceSize = "d8";

    const targetEffects = tokenStatusEffects[targetTokenId] || targetToken?.active_effects || [];
    if (targetEffects.some((effect) => effect.id === "bardic_inspiration")) {
      showToast(`${targetName} 已经拥有激励骰！`, "warning");
      return false;
    }

    const characterId = sourceToken.character_id;
    const newCurrent = action.uses ? action.uses.current - 1 : 0;
    const maxUses = action.uses?.max || 1;

    if (action.uses) {
      setSourceCharacterData((previous: any) => {
        if (!previous?.actions) return previous;
        return {
          ...previous,
          actions: previous.actions.map((entry: any) =>
            entry.id === action.id
              ? { ...entry, uses: { ...entry.uses, current: newCurrent } }
              : entry,
          ),
        };
      });
    }

    if (characterId) {
      try {
        const characterResponse = await authedFetch(`/api/characters/${characterId}`);
        if (characterResponse.ok) {
          const characterData = await characterResponse.json();
          const currentUses = characterData.class_feature_uses || {};
          const updatedUses = {
            ...currentUses,
            bardic_inspiration: { current: newCurrent, max: maxUses },
          };
          await authedFetch(`/api/characters/${characterId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ class_feature_uses: updatedUses }),
          });
        }
      } catch (error) {
        console.error("[Bonus Action] Failed to persist bardic inspiration uses:", error);
      }
    }

    const nextTargetEffects = [
      ...targetEffects,
      {
        id: "bardic_inspiration",
        name: `激励 (${diceSize})`,
        icon: "🎵",
        color: "#a855f7",
        duration: 100,
        maxDuration: 100,
        usesRemaining: 1,
        metadata: {
          source: sourceName,
          sourceCharacterId: sourceToken.character_id,
          diceSize,
        },
      },
    ];

    sendMessage({
      type: "chat",
      data: {
        message: `🎵 **${sourceName}** 给予 **${targetName}** 一颗激励骰 (${diceSize})！\n> 在接下来10分钟内，${targetName}可以在一次攻击检定、属性检定或豁免检定中加上激励骰的结果。\n> 剩余激励骰: ${newCurrent}/${maxUses}`,
        message_type: "combat",
      },
    });

    try {
      await persistTokenActiveEffects(targetTokenId, nextTargetEffects);
    } catch (error) {
      console.error("[Bonus Action] Failed to persist bardic inspiration:", error);
    }

    dispatchCombatUsage({
      actionResourceType,
      sourceTokenId,
      sourceName,
      actionName: `激励 → ${targetName}`,
      actionIcon: "🎵",
    });
    showToast(`${sourceName} 给予 ${targetName} 激励骰 (${diceSize}) [${newCurrent}/${maxUses}]`, "success");
    clearSelectionContextMenu();
    return true;
  }, [
    authedFetch,
    clearSelectionContextMenu,
    dispatchCombatUsage,
    persistTokenActiveEffects,
    sendMessage,
    setSourceCharacterData,
    showToast,
    sourceCharacterData,
    tokenStatusEffects,
    tokens,
  ]);

  return {
    handleInstantSelfHealAction,
    handleBardicInspirationAction,
  };
}
