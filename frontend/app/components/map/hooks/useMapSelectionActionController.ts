import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";

import { publishAppEvent } from "~/events/appEventBus";
import { createLogger } from "~/utils/logger";

import type { AttackOption } from "../SelectionContextMenu";
import type { Token } from "../types/TacticalMapTypes";

const logger = createLogger("useMapSelectionActionController");

type ShowToastFn = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

interface UseMapSelectionActionControllerArgs {
  authedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  campaignId: string;
  userId?: string;
  isDM: boolean;
  tokens: Token[];
  tokenStatusEffects: Record<number, any[]>;
  sourceCharacterData: any;
  showToast: ShowToastFn;
  sendMessage: (payload: any) => void;
  setTokenStatusEffects: Dispatch<SetStateAction<Record<number, any[]>>>;
  setTokens: Dispatch<SetStateAction<Token[]>>;
  clearSelectionContextMenu: () => void;
}

export function useMapSelectionActionController({
  authedFetch,
  campaignId,
  userId,
  isDM,
  tokens,
  tokenStatusEffects,
  sourceCharacterData,
  showToast,
  sendMessage,
  setTokenStatusEffects,
  setTokens,
  clearSelectionContextMenu,
}: UseMapSelectionActionControllerArgs) {
  const ongoingSaveInProgress = useRef<Set<string>>(new Set());

  const handleSelectionStandardAction = useCallback(async (
    actionKey: string,
    sourceTokenId: number,
    targetTokenId?: number,
  ) => {
    const sourceToken = tokens.find((token) => token.id === sourceTokenId);
    const sourceName = sourceToken?.instance_name || sourceToken?.character_name || "源";
    const targetName = targetTokenId
      ? tokens.find((token) => token.id === targetTokenId)?.instance_name || "目标"
      : "无目标";
    const actionNames: Record<string, string> = {
      attack: "攻击",
      cast_spell: "施法",
      dash: "疾走",
      disengage: "撤离",
      dodge: "回避",
      help: "协助",
      hide: "躲藏",
      ready: "预备",
      search: "搜索",
      use_object: "使用物件",
      improvise: "即兴动作",
    };
    const actionName = actionNames[actionKey] || actionKey;

    if (actionKey === "dodge") {
      const currentEffects = tokenStatusEffects[sourceTokenId] || [];
      const existingDodge = currentEffects.find(
        (effect) => effect.id === "dodge" || effect.name === "回避",
      );

      if (existingDodge) {
        showToast(`${sourceName} 已经处于回避状态`, "info");
        clearSelectionContextMenu();
        return;
      }

      const nextEffects = [
        ...currentEffects,
        {
          id: "dodge",
          name: "回避",
          icon: "🛡️",
          color: "#3b82f6",
          duration: 1,
          maxDuration: 1,
        },
      ];

      setTokenStatusEffects((previous) => ({
        ...previous,
        [sourceTokenId]: nextEffects,
      }));

      try {
        await authedFetch(`/api/tokens/${sourceTokenId}/active-effects`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active_effects: nextEffects }),
        });
      } catch (error) {
        logger.error("[useMapSelectionActionController] Failed to persist dodge effect:", error);
      }

      sendMessage({
        type: "chat",
        data: {
          message: `🛡️ **${sourceName}** 采取**回避**动作！\n> 直到下回合开始前，对其的攻击检定具有**劣势**，敏捷豁免具有**优势**`,
          message_type: "combat",
        },
      });

      publishAppEvent("combatActionUsed", { type: "action" });
      showToast(`${sourceName} 采取回避动作`, "info");
      clearSelectionContextMenu();
      return;
    }

    if (actionKey === "dash") {
      const currentMax = (window as any).__combatMovementMax ?? 30;

      sendMessage({
        type: "chat",
        data: {
          message: `💨 **${sourceName}** 采取**疾走**动作！\n> 移动力 +${currentMax}尺`,
          message_type: "combat",
        },
      });

      publishAppEvent("combatActionUsed", { type: "action" });
      publishAppEvent("combatActionUsed", { type: "dash", amount: currentMax });
      (window as any).__combatDashedThisTurn = true;

      showToast(`${sourceName} 疾走！移动力 +${currentMax}尺`, "info");
      clearSelectionContextMenu();
      return;
    }

    showToast(`${sourceName} 对 ${targetName} 使用 ${actionName}`, "info");
    logger.info("[RTS Action]", { action: actionKey, source: sourceTokenId, target: targetTokenId });
    clearSelectionContextMenu();
  }, [authedFetch, clearSelectionContextMenu, sendMessage, setTokenStatusEffects, showToast, tokenStatusEffects, tokens]);

  const handleContestedCheck = useCallback(async (
    attack: AttackOption,
    sourceToken: Token,
    targetToken: Token,
    distanceFeet: number,
  ) => {
    if (distanceFeet > 5) {
      showToast(`${attack.name}只能在5尺内使用`, "error");
      clearSelectionContextMenu();
      return;
    }

    const contestType = attack.key as "grapple" | "shove";
    const actionName = contestType === "grapple" ? "擒抱" : "推撞";
    const attackerAbilityScores = sourceCharacterData?.ability_scores || {
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    };
    const attackerLevel = sourceToken.character_level || 1;
    const attackerProfBonus = Math.floor((attackerLevel - 1) / 4) + 2;
    const attackerProficientSkills: string[] = [];

    if (sourceCharacterData?.skills) {
      for (const [skill, data] of Object.entries(sourceCharacterData.skills)) {
        if (data && typeof data === "object" && "proficient" in data && data.proficient) {
          attackerProficientSkills.push(skill);
        }
      }
    }

    const attacker = {
      name: sourceToken.instance_name || sourceToken.character_name || "攻击者",
      token_id: sourceToken.id,
      character_id: sourceToken.character_id || null,
      monster_instance_id: sourceToken.monster_instance_id || null,
      ability_scores: attackerAbilityScores,
      level: attackerLevel,
      proficiency_bonus: attackerProfBonus,
      proficient_skills: attackerProficientSkills,
      expertise_skills: [] as string[],
    };

    let defenderAbilityScores = {
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    };
    let defenderLevel = 1;
    let defenderProfBonus = 2;
    const defenderProficientSkills: string[] = [];

    if (targetToken.monster_instance_id) {
      try {
        const response = await authedFetch(`/api/monster-instances/${targetToken.monster_instance_id}`);
        if (response.ok) {
          const monsterData = await response.json();
          if (monsterData.monster_data?.ability_scores) {
            defenderAbilityScores = monsterData.monster_data.ability_scores;
          }
        }
      } catch (error) {
        logger.warn("[useMapSelectionActionController] Failed to fetch monster contest data:", error);
      }
    } else if (targetToken.character_id) {
      try {
        const response = await authedFetch(`/api/characters/${targetToken.character_id}`);
        if (response.ok) {
          const characterData = await response.json();
          if (characterData.ability_scores) {
            defenderAbilityScores = characterData.ability_scores;
          }
          defenderLevel = characterData.level || 1;
          defenderProfBonus = Math.floor((defenderLevel - 1) / 4) + 2;
          if (characterData.skills) {
            for (const [skill, data] of Object.entries(characterData.skills)) {
              if (data && typeof data === "object" && "proficient" in data && data.proficient) {
                defenderProficientSkills.push(skill);
              }
            }
          }
        }
      } catch (error) {
        logger.warn("[useMapSelectionActionController] Failed to fetch character contest data:", error);
      }
    }

    const defender = {
      name: targetToken.instance_name || targetToken.monster_name || targetToken.character_name || "目标",
      token_id: targetToken.id,
      character_id: targetToken.character_id || null,
      monster_instance_id: targetToken.monster_instance_id || null,
      ability_scores: defenderAbilityScores,
      level: defenderLevel,
      proficiency_bonus: defenderProfBonus,
      proficient_skills: defenderProficientSkills,
      expertise_skills: [] as string[],
    };

    const contestRequest = {
      campaign_id: parseInt(campaignId, 10),
      contest_type: contestType,
      attacker,
      defender,
      attacker_check_type: "athletics",
      defender_check_type: "athletics",
      shove_effect: contestType === "shove" ? "prone" : undefined,
    };

    clearSelectionContextMenu();
    showToast(`${attacker.name} 尝试${actionName} ${defender.name}...`, "info");

    try {
      const queryParams = new URLSearchParams({
        user_id: userId || "anonymous",
        role: isDM ? "dm" : "player",
      });
      const response = await authedFetch(`/api/combat/contest?${queryParams}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contestRequest),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        showToast(error.detail || `${actionName}失败`, "error");
        return;
      }

      const result = await response.json();
      if (result.success && result.result) {
        const contestResult = result.result;
        showToast(contestResult.narrative, contestResult.attacker_wins ? "success" : "warning", 5000);
        publishAppEvent("combatActionUsed", { type: "attack" });
      }
    } catch (error) {
      logger.error("[useMapSelectionActionController] Contest check failed", error);
      showToast(`${actionName}请求失败`, "error");
    }
  }, [authedFetch, campaignId, clearSelectionContextMenu, isDM, showToast, sourceCharacterData, userId]);

  const handleEscapeAttempt = useCallback(async (tokenId: number, effectId: string) => {
    try {
      const response = await authedFetch(`/api/combat/escape-attempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token_id: tokenId, effect_id: effectId, campaign_id: campaignId }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "挣脱失败");
      }
      const result = await response.json();
      const token = tokens.find((current) => current.id === tokenId);
      const name = token?.instance_name || (token as any)?.character_name || "目标";

      if (result.success) {
        showToast(`${name} 成功挣脱了 ${result.effect_name}！`, "success");
      } else {
        showToast(`${name} 尝试挣脱 ${result.effect_name} 失败 (${result.roll}/${result.dc})`, "warning");
      }
    } catch (error: any) {
      logger.error("[useMapSelectionActionController] Escape attempt failed:", error);
      showToast(error.message || "挣脱检定失败", "error");
    }
  }, [authedFetch, campaignId, showToast, tokens]);

  const handleOngoingSave = useCallback(async (tokenId: number, effectId: string) => {
    const key = `${tokenId}_${effectId}`;
    if (ongoingSaveInProgress.current.has(key)) return;
    ongoingSaveInProgress.current.add(key);

    try {
      const response = await authedFetch(`/api/combat/ongoing-save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token_id: tokenId, effect_id: effectId, campaign_id: campaignId }),
      });
      if (!response.ok) {
        if (response.status === 404) return;
        const error = await response.json();
        throw new Error(error.detail || "豁免失败");
      }

      const result = await response.json();
      const token = tokens.find((current) => current.id === tokenId);
      const name = token?.instance_name || (token as any)?.character_name || "目标";

      if (result.success && result.effect_removed) {
        setTokenStatusEffects((previous) => ({
          ...previous,
          [tokenId]: (previous[tokenId] || []).filter((effect) => effect.id !== effectId),
        }));

        setTokens((previous) => {
          let removedEffect: any = null;

          const nextTokens = previous.map((current) => {
            if (current.id !== tokenId) return current;

            const currentEffects = Array.isArray(current.active_effects) ? current.active_effects : [];
            removedEffect = currentEffects.find((effect: any) => effect.id === effectId) || null;
            const nextEffects = currentEffects.filter((effect: any) => effect.id !== effectId);

            return {
              ...current,
              active_effects: nextEffects.length > 0 ? nextEffects : null,
            };
          });

          const removedSourceTokenId = removedEffect?.source_token_id ?? removedEffect?.sourceTokenId;
          const removedSpellId =
            removedEffect?.spell_id ?? removedEffect?.sourceSpell ?? removedEffect?.spellId;

          if (!removedSourceTokenId || !removedSpellId) {
            return nextTokens;
          }

          return nextTokens.map((current) => {
            if (current.id !== removedSourceTokenId || !current.concentration_spell) {
              return current;
            }

            const concentrationSpell = current.concentration_spell as any;
            const concentrationSpellId =
              concentrationSpell?.spell_id ?? concentrationSpell?.sourceSpell ?? concentrationSpell?.spellId;
            if (concentrationSpellId !== removedSpellId) {
              return current;
            }

            const affectedIdsRaw =
              concentrationSpell?.affected_token_ids ?? concentrationSpell?.affectedTokenIds;
            const affectedIds = Array.isArray(affectedIdsRaw)
              ? affectedIdsRaw.filter((id: number | string) => String(id) !== String(tokenId))
              : [];

            return {
              ...current,
              concentration_spell: affectedIds.length > 0
                ? {
                    ...current.concentration_spell,
                    affected_token_ids: affectedIds,
                    ...(concentrationSpell?.affectedTokenIds !== undefined
                      ? { affectedTokenIds: affectedIds }
                      : {}),
                  }
                : null,
            };
          });
        });
      }

      if (result.success) {
        showToast(`${name} 豁免成功，${result.effect_name} 效果解除！`, "success");
      } else {
        showToast(
          `${name} 豁免失败 (${result.save_total}/${result.save_dc})，${result.effect_name} 持续中`,
          "warning",
        );
      }
    } catch (error: any) {
      logger.error("[useMapSelectionActionController] Ongoing save failed:", error);
      showToast(error.message || "回合豁免失败", "error");
    } finally {
      ongoingSaveInProgress.current.delete(key);
    }
  }, [authedFetch, campaignId, setTokenStatusEffects, setTokens, showToast, tokens]);

  const handleConditionSave = useCallback(async (tokenId: number, effectId: string) => {
    try {
      const response = await authedFetch(`/api/combat/condition-save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token_id: tokenId, effect_id: effectId, campaign_id: campaignId }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "豁免失败");
      }
      const result = await response.json();
      const token = tokens.find((current) => current.id === tokenId);
      const name = token?.instance_name || (token as any)?.character_name || "目标";
      if (result.success) {
        showToast(`${name} 豁免成功，${result.effect_name} 效果解除！`, "success");
      } else {
        showToast(`${name} 豁免失败 (${result.save_total}/${result.save_dc})，${result.effect_name} 持续中`, "warning");
      }
    } catch (error: any) {
      logger.error("[useMapSelectionActionController] Condition save failed:", error);
      showToast(error.message || "豁免失败", "error");
    }
  }, [authedFetch, campaignId, showToast, tokens]);

  const handleWakeUp = useCallback(async (tokenId: number, effectId: string) => {
    try {
      const response = await authedFetch(
        `/api/combat/remove-effect?campaign_id=${campaignId}&token_id=${tokenId}&effect_id=${effectId}&reason=shaken`,
        { method: "POST" },
      );
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "摇醒失败");
      }
      const token = tokens.find((current) => current.id === tokenId);
      const name = token?.instance_name || (token as any)?.character_name || "目标";
      showToast(`${name} 被摇醒了！`, "success");
    } catch (error: any) {
      logger.error("[useMapSelectionActionController] Wake up failed:", error);
      showToast(error.message || "摇醒失败", "error");
    }
  }, [authedFetch, campaignId, showToast, tokens]);

  const handleStandUp = useCallback(async (tokenId: number, effectId: string) => {
    try {
      const token = tokens.find((current) => current.id === tokenId);
      const name = token?.instance_name || (token as any)?.character_name || "目标";
      const inCombat = Boolean((window as any).__combatIsActive);

      if (inCombat) {
        const movementMax = (window as any).__combatMovementMax ?? 30;
        const movementRemaining = (window as any).__combatMovementRemaining ?? 0;
        const halfSpeed = Math.floor(movementMax / 2);
        if (movementRemaining < halfSpeed) {
          showToast(`移动力不足（需要 ${halfSpeed} 尺，剩余 ${movementRemaining} 尺），无法站起来`, "warning");
          return;
        }
        (window as any).__combatDeductMovement?.(halfSpeed);
      }

      const response = await authedFetch(
        `/api/combat/remove-effect?campaign_id=${campaignId}&token_id=${tokenId}&effect_id=${effectId}&reason=stand_up`,
        { method: "POST" },
      );
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "站起失败");
      }

      if (inCombat) {
        const movementMax = (window as any).__combatMovementMax ?? 30;
        const halfSpeed = Math.floor(movementMax / 2);
        showToast(`${name} 站了起来（消耗 ${halfSpeed} 尺移动力）`, "success");
      } else {
        showToast(`${name} 站了起来`, "success");
      }
    } catch (error: any) {
      logger.error("[useMapSelectionActionController] Stand up failed:", error);
      showToast(error.message || "站起失败", "error");
    }
  }, [authedFetch, campaignId, showToast, tokens]);

  return {
    handleConditionSave,
    handleContestedCheck,
    handleEscapeAttempt,
    handleOngoingSave,
    handleSelectionStandardAction,
    handleStandUp,
    handleWakeUp,
  };
}
