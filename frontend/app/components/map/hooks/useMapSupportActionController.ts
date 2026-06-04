import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { KnowledgeOfTheAgesSubmitPayload } from "../KnowledgeOfTheAgesModal";
import type { PendingToolCheckRequest, ToolCheckSubmitPayload } from "../ToolCheckModal";
import type { VisionsOfThePastSubmitPayload } from "../VisionsOfThePastModal";
import type { Token } from "../types/TacticalMapTypes";
import { getEdgeToEdgeDistance, parseTokenSize } from "../utils/mapCalculations";
import { publishAppEvent } from "~/events/appEventBus";
import type { WebSocketMessage } from "~/hooks/useWebSocket";
import { tProficiency } from "~/utils/i18n";
import { applyKnowledgeOfTheAgesBuff, getKnowledgeOfTheAgesSelection } from "~/utils/specialBuffs";

type ShowToast = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((entry) => String(entry || "").trim()).filter(Boolean)));
}

function applyKnowledgeOfTheAgesToLocalCharacter(
  characterData: any,
  nextStatus: any,
  selection: { kind: "skill" | "tool"; proficiencyId: string },
) {
  if (!characterData) return characterData;

  const previousKnowledge = getKnowledgeOfTheAgesSelection(characterData.status_effects?.special_buffs);
  const nextSkillProficiencies = new Set(normalizeStringList(characterData.proficient_skills));
  const nextToolProficiencies = new Set(normalizeStringList(characterData.proficient_tools));

  if (previousKnowledge?.kind === "skill") {
    nextSkillProficiencies.delete(previousKnowledge.id);
  } else if (previousKnowledge?.kind === "tool") {
    nextToolProficiencies.delete(previousKnowledge.id);
  }

  if (selection.kind === "skill") {
    nextSkillProficiencies.add(selection.proficiencyId);
  } else {
    nextToolProficiencies.add(selection.proficiencyId);
  }

  return {
    ...characterData,
    proficient_skills: Array.from(nextSkillProficiencies),
    proficient_tools: Array.from(nextToolProficiencies),
    status_effects: nextStatus,
  };
}

interface UseMapSupportActionControllerArgs {
  tokens: Token[];
  sourceCharacterData: any;
  campaignId: string;
  currentMapUrl?: string | null;
  gridUnitLength: number;
  isConnected: boolean;
  authedFetch: (input: string, init?: RequestInit) => Promise<Response>;
  showToast: ShowToast;
  sendMessage: (payload: WebSocketMessage) => void;
  setTokens: Dispatch<SetStateAction<Token[]>>;
  setSourceCharacterData: Dispatch<SetStateAction<any>>;
  preserveLifeModal: any;
  setPreserveLifeModal: Dispatch<SetStateAction<any>>;
  knowledgeOfTheAgesModal: any;
  setKnowledgeOfTheAgesModal: Dispatch<SetStateAction<any>>;
  visionsOfThePastModal: any;
  setVisionsOfThePastModal: Dispatch<SetStateAction<any>>;
  setToolCheckRequest: Dispatch<SetStateAction<PendingToolCheckRequest | null>>;
  consumeCharacterResource: (
    characterId: number,
    resourceId: string,
    action: any,
    failureLabel: string,
  ) => Promise<{ current: number; max: number } | null>;
  clearSelectionContextMenu: () => void;
}

export function useMapSupportActionController({
  tokens,
  sourceCharacterData,
  campaignId,
  currentMapUrl,
  gridUnitLength,
  isConnected,
  authedFetch,
  showToast,
  sendMessage,
  setTokens,
  setSourceCharacterData,
  preserveLifeModal,
  setPreserveLifeModal,
  knowledgeOfTheAgesModal,
  setKnowledgeOfTheAgesModal,
  visionsOfThePastModal,
  setVisionsOfThePastModal,
  setToolCheckRequest,
  consumeCharacterResource,
  clearSelectionContextMenu,
}: UseMapSupportActionControllerArgs) {
  const handleOpenToolCheck = useCallback((request: PendingToolCheckRequest) => {
    setToolCheckRequest(request);
  }, [setToolCheckRequest]);

  const handleSubmitToolCheck = useCallback((payload: ToolCheckSubmitPayload) => {
    if (!isConnected) {
      showToast("工具检定失败：未连接到服务器", "error");
      return;
    }

    sendMessage({
      type: "dice_execute",
      data: {
        check: {
          type: "check",
          tool: payload.toolId,
          ability: payload.ability,
          ...(payload.dc != null ? { dc: payload.dc } : {}),
          ...(payload.description ? { description: payload.description } : {}),
        },
        actor: {
          type: "player",
          character_id: payload.characterId,
        },
        ...(payload.context ? { context: payload.context } : {}),
      },
    });

    const toolLabel = tProficiency(payload.toolId);
    const dcText = payload.dc != null ? ` (DC ${payload.dc})` : "";
    showToast(`正在进行${payload.description || toolLabel}检定${dcText}...`, "info");
    setToolCheckRequest(null);
  }, [isConnected, sendMessage, setToolCheckRequest, showToast]);

  const openPreserveLifeModal = useCallback((action: any, sourceTokenId: number) => {
    const sourceToken = tokens.find((token) => token.id === sourceTokenId);
    if (!sourceToken || !sourceToken.character_id || !sourceCharacterData) {
      showToast("未找到施法者数据", "error");
      return;
    }

    const currentUses = action.uses?.current ?? 0;
    if (currentUses <= 0) {
      showToast("引导神力已用完！需要短休后恢复", "warning");
      return;
    }

    const totalPool = 5 * (sourceCharacterData.level || 1);
    const candidates = tokens
      .filter((token) => token.current_hp !== null && token.current_hp !== undefined)
      .map((token) => {
        const sourceSize = parseTokenSize(sourceToken.token_size);
        const targetSize = parseTokenSize(token.token_size);
        const distanceFeet = getEdgeToEdgeDistance(
          sourceToken.position_x,
          sourceToken.position_y,
          sourceSize.width,
          sourceSize.height,
          token.position_x,
          token.position_y,
          targetSize.width,
          targetSize.height,
        ) * gridUnitLength;
        const maxHp = token.max_hp ?? token.current_hp ?? 0;
        const currentHp = token.current_hp ?? 0;
        const typeText = `${token.monster_type || ""}`.toLowerCase();
        const isInvalidType =
          typeText.includes("undead") ||
          typeText.includes("不死") ||
          typeText.includes("construct") ||
          typeText.includes("构装");
        const maxHealable = Math.max(0, Math.floor(maxHp / 2) - currentHp);
        return {
          tokenId: token.id,
          name: token.instance_name || token.character_name || token.monster_name || "目标",
          currentHp,
          maxHp,
          maxHealable,
          distanceFeet,
          isInvalidType,
        };
      })
      .filter((target) => target.distanceFeet <= 30 && !target.isInvalidType && target.maxHealable > 0)
      .sort((left, right) => left.distanceFeet - right.distanceFeet || left.name.localeCompare(right.name, "zh-CN"));

    setPreserveLifeModal({
      sourceTokenId,
      sourceCharacterId: sourceToken.character_id,
      sourceName: sourceToken.instance_name || sourceToken.character_name || sourceCharacterData.name || "牧师",
      totalPool,
      channelDivinityCurrent: currentUses,
      channelDivinityMax: action.uses?.max || currentUses,
      targets: candidates.map(({ tokenId, name, currentHp, maxHp, maxHealable, distanceFeet }) => ({
        tokenId,
        name,
        currentHp,
        maxHp,
        maxHealable,
        distanceFeet,
      })),
    });
    clearSelectionContextMenu();
  }, [clearSelectionContextMenu, gridUnitLength, setPreserveLifeModal, showToast, sourceCharacterData, tokens]);

  const openKnowledgeOfTheAgesModal = useCallback((args: {
    action: any;
    sourceTokenId: number;
    sourceToken: Token;
    sourceName: string;
  }) => {
    const { action, sourceTokenId, sourceToken, sourceName } = args;
    const characterId = sourceToken.character_id;
    if (!characterId) {
      showToast("只有角色 token 才能使用知识通道", "error");
      return false;
    }
    if ((action.uses?.current ?? 0) <= 0) {
      showToast("引导神力已用完！需要短休后恢复", "warning");
      return false;
    }

    setKnowledgeOfTheAgesModal({
      sourceTokenId,
      sourceCharacterId: characterId,
      sourceName,
      action,
    });
    clearSelectionContextMenu();
    return true;
  }, [clearSelectionContextMenu, setKnowledgeOfTheAgesModal, showToast]);

  const openVisionsOfThePastModal = useCallback((args: {
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
    if (!characterId) {
      showToast("只有角色 token 才能使用异象", "error");
      return false;
    }
    if ((action.uses?.current ?? 1) <= 0) {
      showToast("异象已用完！需要短休后恢复", "warning");
      return false;
    }

    const targetToken = targetTokenId ? tokens.find((token) => token.id === targetTokenId) : null;
    const suggestedObjectFocus = targetToken && !targetToken.character_id && !targetToken.monster_instance_id
      ? (targetToken.instance_name || targetToken.monster_name || targetToken.item_data?.name || "附近物品")
      : "";
    const suggestedAreaFocus = `地图 ${currentMapUrl || "当前区域"} · (${sourceToken.position_x}, ${sourceToken.position_y}) 附近`;

    setVisionsOfThePastModal({
      sourceTokenId,
      sourceCharacterId: characterId,
      sourceName,
      action,
      suggestedMode: suggestedObjectFocus ? "object" : "area",
      suggestedFocus: suggestedObjectFocus || suggestedAreaFocus,
    });
    clearSelectionContextMenu();
    return true;
  }, [clearSelectionContextMenu, currentMapUrl, setVisionsOfThePastModal, showToast, tokens]);

  const handlePreserveLifeConfirm = useCallback(async (
    allocations: Array<{ targetTokenId: number; healAmount: number }>,
  ) => {
    if (!preserveLifeModal) return;
    if (allocations.length === 0) {
      showToast("请至少为一个目标分配治疗量", "warning");
      return;
    }

    try {
      const response = await authedFetch(`/api/characters/${preserveLifeModal.sourceCharacterId}/preserve-life`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: parseInt(campaignId, 10),
          allocations: allocations.map((entry) => ({
            target_token_id: entry.targetTokenId,
            heal_amount: entry.healAmount,
          })),
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(result.detail || "使用保命通道失败", "error");
        return;
      }

      const healedTargets = Array.isArray(result.targets) ? result.targets : [];
      const healedByTokenId = new Map<number, any>(healedTargets.map((entry: any) => [entry.token_id, entry]));

      setSourceCharacterData((previous: any) => {
        if (!previous?.actions) return previous;
        return {
          ...previous,
          actions: previous.actions.map((action: any) =>
            (action.id === "channel_divinity_cleric" || action.resourceId === "channel_divinity_cleric") && action.uses
              ? {
                  ...action,
                  uses: {
                    ...action.uses,
                    current: result.channel_divinity_current,
                    max: result.channel_divinity_max ?? action.uses.max,
                  },
                }
              : action,
          ),
        };
      });

      setTokens((previous) => previous.map((token) => {
        const healed = healedByTokenId.get(token.id);
        if (!healed) return token;
        return {
          ...token,
          current_hp: healed.current_hp,
          ...(healed.max_hp !== undefined ? { max_hp: healed.max_hp } : {}),
        };
      }));

      publishAppEvent("combatActionUsed", { type: "action" });
      const totalHealed = healedTargets.reduce(
        (sum: number, entry: any) => sum + (entry.healed_amount || 0),
        0,
      );
      showToast(
        `${preserveLifeModal.sourceName} 使用保命通道，治疗 ${healedTargets.length} 个目标，共恢复 ${totalHealed} HP`,
        "success",
      );
      setPreserveLifeModal(null);
    } catch {
      showToast("使用保命通道失败", "error");
    }
  }, [authedFetch, campaignId, preserveLifeModal, setPreserveLifeModal, setSourceCharacterData, setTokens, showToast]);

  const consumeFeatureUse = useCallback(async (
    characterId: number,
    action: { id?: string; name?: string; uses?: { current?: number; max?: number; recharge?: string } },
    fallbackLabel: string,
  ) => {
    const current = action.uses?.current ?? 0;
    const max = action.uses?.max ?? 0;
    const recharge = action.uses?.recharge === "long_rest" ? "长休" : "短休";
    if (current <= 0) {
      showToast(`${fallbackLabel}已用完！需要${recharge}后恢复`, "warning");
      return null;
    }
    if (!action.id) {
      showToast(`无法扣除 ${fallbackLabel} 次数`, "error");
      return null;
    }

    const nextCurrent = current - 1;
    const response = await authedFetch(`/api/characters/${characterId}/feature-uses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feature_id: action.id,
        current_uses: nextCurrent,
        max_uses: max,
      }),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      showToast(errorData.detail || `使用 ${fallbackLabel} 失败`, "error");
      return null;
    }

    setSourceCharacterData((previous: any) => {
      if (!previous?.actions) return previous;
      return {
        ...previous,
        actions: previous.actions.map((entry: any) =>
          entry.id === action.id && entry.uses
            ? {
                ...entry,
                uses: {
                  ...entry.uses,
                  current: nextCurrent,
                  max,
                },
              }
            : entry,
        ),
      };
    });

    return { current: nextCurrent, max };
  }, [authedFetch, setSourceCharacterData, showToast]);

  const upsertKnowledgeOfTheAgesStatus = useCallback(async (
    characterId: number,
    selection: KnowledgeOfTheAgesSubmitPayload,
  ) => {
    const characterResponse = await authedFetch(`/api/characters/${characterId}`);
    if (!characterResponse.ok) {
      throw new Error("加载角色状态失败");
    }

    const characterData = await characterResponse.json();
    const currentStatus = { ...(characterData.status_effects || {}) } as any;
    const currentSpecialBuffs = { ...(currentStatus.special_buffs || {}) };
    const nextSpecialBuffs = applyKnowledgeOfTheAgesBuff(currentSpecialBuffs, {
      kind: selection.kind,
      id: selection.proficiencyId,
      label: selection.label,
    });
    const nextStatus = {
      ...currentStatus,
      custom_effects: Array.isArray(currentStatus.custom_effects) ? currentStatus.custom_effects : [],
      active_conditions: Array.isArray(currentStatus.active_conditions) ? currentStatus.active_conditions : [],
      exhaustion_level: typeof currentStatus.exhaustion_level === "number" ? currentStatus.exhaustion_level : 0,
      special_buffs: nextSpecialBuffs,
    };

    const updateResponse = await authedFetch(`/api/characters/${characterId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status_effects: nextStatus,
        broadcast_campaign_id: campaignId,
      }),
    });
    if (!updateResponse.ok) {
      throw new Error("保存角色状态失败");
    }

    return nextStatus;
  }, [authedFetch, campaignId]);

  const handleKnowledgeOfTheAgesConfirm = useCallback(async (selection: KnowledgeOfTheAgesSubmitPayload) => {
    const request = knowledgeOfTheAgesModal;
    if (!request) return;

    const resourceResult = await consumeCharacterResource(
      request.sourceCharacterId,
      "channel_divinity_cleric",
      request.action,
      request.action.name || "知识通道",
    );
    if (!resourceResult) return;

    try {
      const nextStatus = await upsertKnowledgeOfTheAgesStatus(request.sourceCharacterId, selection);
      setSourceCharacterData((previous: any) => (
        previous?.id === request.sourceCharacterId
          ? applyKnowledgeOfTheAgesToLocalCharacter(previous, nextStatus, selection)
          : previous
      ));

      sendMessage({
        type: "chat",
        data: {
          message: `🧠 **${request.sourceName}** 使用【知识通道】！\n> 获得 **${selection.label}** 的${selection.kind === "skill" ? "技能" : "工具"}熟练，持续 **10 分钟**。\n> 剩余引导神力: ${resourceResult.current}/${resourceResult.max}`,
          message_type: "combat",
        },
      });
      showToast(`${request.sourceName} 获得 ${selection.label} 熟练（10分钟）`, "success");
      publishAppEvent("combatActionUsed", { type: "action" });
      setKnowledgeOfTheAgesModal(null);
      clearSelectionContextMenu();
    } catch {
      showToast("保存知识通道状态失败", "error");
    }
  }, [
    clearSelectionContextMenu,
    consumeCharacterResource,
    knowledgeOfTheAgesModal,
    sendMessage,
    setKnowledgeOfTheAgesModal,
    setSourceCharacterData,
    showToast,
    upsertKnowledgeOfTheAgesStatus,
  ]);

  const handleVisionsOfThePastConfirm = useCallback(async (payload: VisionsOfThePastSubmitPayload) => {
    const request = visionsOfThePastModal;
    if (!request) return;

    let useResult: { current: number; max: number } | null = null;
    if (request.action.uses) {
      useResult = await consumeFeatureUse(
        request.sourceCharacterId,
        request.action,
        request.action.name || "异象",
      );
      if (!useResult) return;
    }

    const readingLabel = payload.mode === "object" ? "物品回溯" : "地点回溯";
    const detailsLine = payload.details ? `> 聚焦描述：${payload.details}` : null;
    const questionLine = payload.question ? `> 玩家最想知道：${payload.question}` : null;
    const usesLine = useResult ? `> 剩余次数：${useResult.current}/${useResult.max}（短休恢复）` : null;

    sendMessage({
      type: "chat",
      data: {
        message: [
          `👁️ **${request.sourceName}** 使用【异象】进行 **${readingLabel}**！`,
          `> 聚焦目标：**${payload.focus}**`,
          detailsLine,
          questionLine,
          `> DM 提示：请描述与该${payload.mode === "object" ? "物品" : "地点"}相关的过去事件异象。`,
          usesLine,
        ].filter(Boolean).join("\n"),
        message_type: "combat",
      },
    });

    showToast(`${request.sourceName} 触发了异象：${readingLabel}`, "success");
    publishAppEvent("combatActionUsed", { type: "action" });
    setVisionsOfThePastModal(null);
    clearSelectionContextMenu();
  }, [clearSelectionContextMenu, consumeFeatureUse, sendMessage, setVisionsOfThePastModal, showToast, visionsOfThePastModal]);

  return {
    handleOpenToolCheck,
    handleSubmitToolCheck,
    openPreserveLifeModal,
    openKnowledgeOfTheAgesModal,
    openVisionsOfThePastModal,
    handlePreserveLifeConfirm,
    handleKnowledgeOfTheAgesConfirm,
    handleVisionsOfThePastConfirm,
  };
}
