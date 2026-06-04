import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { Token } from "../types/TacticalMapTypes";
import { publishAppEvent } from "~/events/appEventBus";
import type { WebSocketMessage } from "~/hooks/useWebSocket";
import { castSpellViaAPI } from "~/utils/sidebarCasting";

type ShowToast = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

type AuthedFetch = (input: string, init?: RequestInit) => Promise<Response>;

const UNDEAD_TYPES = ["不死生物", "undead", "Undead"];

interface UseMapChannelDivinityActionControllerArgs {
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
}

export function useMapChannelDivinityActionController({
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
}: UseMapChannelDivinityActionControllerArgs) {
  const syncChannelDivinityUses = useCallback((current: number, max: number) => {
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
                  current,
                  max: max ?? action.uses.max,
                },
              }
            : action,
        ),
      };
    });
  }, [setSourceCharacterData]);

  const persistChannelDivinityUses = useCallback(async (
    characterId: number,
    current: number,
    max: number,
  ) => {
    try {
      const characterResponse = await authedFetch(`/api/characters/${characterId}`);
      if (!characterResponse.ok) {
        return;
      }

      const characterData = await characterResponse.json();
      const currentUses = characterData.class_feature_uses || {};
      const updatedUses = {
        ...currentUses,
        channel_divinity_cleric: { current, max },
      };
      await authedFetch(`/api/characters/${characterId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_feature_uses: updatedUses }),
      });
    } catch (error) {
      console.error("[Action] Failed to persist channel divinity uses:", error);
    }
  }, [authedFetch]);

  const handleCharmAnimalsAndPlantsAction = useCallback(async (args: {
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
    if (!characterId) {
      showToast("只有角色 token 才能使用魅惑动植物通道", "error");
      return false;
    }

    try {
      const response = await authedFetch(`/api/characters/${characterId}/charm-animals-and-plants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: parseInt(campaignId, 10),
          source_token_id: sourceTokenId,
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(result.detail || "使用魅惑动植物通道失败", "error");
        return false;
      }

      syncChannelDivinityUses(
        Number(result.channel_divinity_current ?? 0),
        Number(result.channel_divinity_max ?? 1),
      );

      const updatedTargets = Array.isArray(result.targets) ? result.targets : [];
      const effectsByTokenId = new Map<number, any[]>(
        updatedTargets
          .filter((entry: any) => Array.isArray(entry.active_effects))
          .map((entry: any) => [entry.token_id, entry.active_effects]),
      );

      if (effectsByTokenId.size > 0) {
        for (const [tokenId, effects] of effectsByTokenId.entries()) {
          await persistTokenActiveEffects(tokenId, effects);
        }
      }

      publishAppEvent("combatActionUsed", { type: "action" });
      const failed = Number(result.failed_saves || 0);
      const succeeded = Number(result.successful_saves || 0);
      const immune = Number(result.immune_targets || result.immune_count || 0);
      showToast(
        updatedTargets.length > 0
          ? `${sourceName} 释放魅惑动植物通道：${failed} 魅惑，${succeeded} 成功，${immune} 免疫`
          : `${sourceName} 释放魅惑动植物通道，但30尺内没有野兽或植物生物`,
        "success",
      );
      clearSelectionContextMenu();
      return true;
    } catch (error) {
      console.error("[Action] Charm Animals and Plants failed:", error);
      showToast("使用魅惑动植物通道失败", "error");
      return false;
    }
  }, [
    authedFetch,
    campaignId,
    clearSelectionContextMenu,
    persistTokenActiveEffects,
    setTokens,
    showToast,
    syncChannelDivinityUses,
  ]);

  const handleMasterOfNatureAction = useCallback(async (args: {
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
    if (!characterId) {
      showToast("只有角色 token 才能使用自然大师", "error");
      return false;
    }

    try {
      const response = await authedFetch(`/api/characters/${characterId}/master-of-nature`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: parseInt(campaignId, 10),
          source_token_id: sourceTokenId,
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(result.detail || "使用自然大师失败", "error");
        return false;
      }

      const updatedTargets = Array.isArray(result.controlled_targets) ? result.controlled_targets : [];
      const skippedTargets = Array.isArray(result.skipped_targets) ? result.skipped_targets : [];
      const targetMap = new Map<number, any>(updatedTargets.map((entry: any) => [entry.token_id, entry]));

      if (targetMap.size > 0) {
        setTokens((previous) => previous.map((token) => {
          const updated = targetMap.get(token.id);
          if (!updated) return token;
          return {
            ...token,
            user_id: updated.user_id,
            faction: updated.faction,
            controller_character_id: updated.controller_character_id,
            control_type: updated.control_type,
            active_effects: Array.isArray(updated.active_effects) && updated.active_effects.length > 0
              ? updated.active_effects
              : null,
          };
        }));

        for (const entry of updatedTargets) {
          await persistTokenActiveEffects(
            entry.token_id,
            Array.isArray(entry.active_effects) ? entry.active_effects : [],
          );
        }
      }

      publishAppEvent("combatActionUsed", { type: "bonus_action" });
      publishAppEvent("combatBonusActionResult", {
        tokenId: sourceTokenId,
        tokenName: sourceName,
        actionName: action.name,
        actionIcon: "🌳",
      });

      showToast(
        skippedTargets.length > 0
          ? `${sourceName} 接管了 ${updatedTargets.length} 个目标，${skippedTargets.length} 个未接管`
          : `${sourceName} 接管了 ${updatedTargets.length} 个魅惑目标`,
        "success",
      );
      clearSelectionContextMenu();
      return true;
    } catch (error) {
      console.error("[Action] Master of Nature failed:", error);
      showToast("使用自然大师失败", "error");
      return false;
    }
  }, [
    authedFetch,
    campaignId,
    clearSelectionContextMenu,
    persistTokenActiveEffects,
    setTokens,
    showToast,
  ]);

  const handleTurnUndeadAction = useCallback(async (args: {
    action: any;
    sourceTokenId: number;
    sourceToken: Token;
    sourceName: string;
  }) => {
    const { action, sourceTokenId, sourceToken, sourceName } = args;

    if (action.uses && action.uses.current <= 0) {
      showToast("引导神力已用完！需要短休后恢复", "warning");
      return false;
    }

    // Find undead tokens within 30ft
    const sourceX = sourceToken.position_x || 0;
    const sourceY = sourceToken.position_y || 0;
    const undeadTargetIds: number[] = [];
    for (const token of tokens) {
      if (token.id === sourceTokenId) continue;
      if (!token.monster_type || !UNDEAD_TYPES.includes(token.monster_type)) continue;
      const dx = token.position_x - sourceX;
      const dy = token.position_y - sourceY;
      const distance = Math.max(Math.abs(dx), Math.abs(dy)) * 5;
      if (distance <= 30) undeadTargetIds.push(token.id);
    }

    if (undeadTargetIds.length === 0) {
      showToast("30尺内没有不死生物！", "info");
    }

    // Consume channel divinity resource
    const characterId = sourceToken.character_id;
    const newCurrent = action.uses ? action.uses.current - 1 : 0;
    const maxUses = action.uses?.max || 1;
    if (action.uses) syncChannelDivinityUses(newCurrent, maxUses);
    if (characterId) await persistChannelDivinityUses(characterId, newCurrent, maxUses);

    if (undeadTargetIds.length === 0) {
      sendMessage({
        type: "chat",
        data: {
          message: `✝️ **${sourceName}** 使用【引导神力：驱散不死生物】！\n_(30尺内没有不死生物)_\n> 剩余引导神力: ${newCurrent}/${maxUses}`,
          message_type: "combat",
        },
      });
      publishAppEvent("combatActionUsed", { type: "action" });
      showToast(`${sourceName} 驱散不死生物（无目标）[${newCurrent}/${maxUses}]`, "info");
      clearSelectionContextMenu();
      return true;
    }

    // Cast via unified API — backend handles saves, conditions, Destroy Undead
    const apiResult = await castSpellViaAPI(
      "turn_undead", 0, sourceTokenId, undeadTargetIds, campaignId,
      undefined, true, false,
    );

    if (!apiResult?.success) {
      showToast("驱散不死生物施放失败", "error");
      return false;
    }

    // Build summary from results
    const turnedCount = (apiResult.results || []).filter(
      (r: any) => r.condition_applied,
    ).length;
    const destroyedCount = (apiResult.destroyed_token_ids || []).length;
    const savedCount = (apiResult.results || []).filter(
      (r: any) => r.save_succeeded,
    ).length;

    const summaryText = destroyedCount > 0
      ? `摧毁 ${destroyedCount} 个，驱散 ${turnedCount} 个`
      : turnedCount > 0
        ? `驱散 ${turnedCount} 个不死生物`
        : `${savedCount} 个不死生物豁免成功`;
    showToast(`${sourceName} ${summaryText} [${newCurrent}/${maxUses}]`, "success");
    publishAppEvent("combatActionUsed", { type: "action" });
    clearSelectionContextMenu();
    return true;
  }, [
    campaignId,
    clearSelectionContextMenu,
    persistChannelDivinityUses,
    sendMessage,
    showToast,
    syncChannelDivinityUses,
    tokens,
  ]);

  return {
    handleCharmAnimalsAndPlantsAction,
    handleMasterOfNatureAction,
    handleTurnUndeadAction,
  };
}
