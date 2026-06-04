import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import type { Token, TransformationData } from "../types/TacticalMapTypes";
import { dndSizeToTokenSize } from "../utils/mapCalculations";
import { publishAppEvent, subscribeAppEvent } from "~/events/appEventBus";
import type { WebSocketMessage } from "~/hooks/useWebSocket";
import { createLogger } from "~/utils/logger";

const logger = createLogger("useMapTransformationController");

type ShowToast = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

type AuthedFetch = (input: string, init?: RequestInit) => Promise<Response>;

interface UseMapTransformationControllerArgs {
  tokens: Token[];
  sourceCharacterData: any;
  campaignId: string;
  authedFetch: AuthedFetch;
  showToast: ShowToast;
  sendMessage: (payload: WebSocketMessage) => void;
  setTokens: Dispatch<SetStateAction<Token[]>>;
  setSourceCharacterData: Dispatch<SetStateAction<any>>;
  clearSelectionContextMenu: () => void;
}

export function useMapTransformationController({
  tokens,
  sourceCharacterData,
  campaignId,
  authedFetch,
  showToast,
  sendMessage,
  setTokens,
  setSourceCharacterData,
  clearSelectionContextMenu,
}: UseMapTransformationControllerArgs) {
  const [transformModalOpen, setTransformModalOpen] = useState(false);
  const [transformTokenId, setTransformTokenId] = useState<number | null>(null);
  const [transformConfigId, setTransformConfigId] = useState<string>("wild_shape");
  const transformTokenIdRef = useRef<number | null>(null);

  const closeTransformModal = useCallback(() => {
    setTransformModalOpen(false);
    setTransformTokenId(null);
    transformTokenIdRef.current = null;
  }, []);

  const handleTransform = useCallback((tokenId: number, configId: string) => {
    transformTokenIdRef.current = tokenId;
    setTransformTokenId(tokenId);
    setTransformConfigId(configId);
    setTransformModalOpen(true);
    clearSelectionContextMenu();
  }, [clearSelectionContextMenu]);

  const handleWildShape = useCallback((sourceTokenId: number) => {
    handleTransform(sourceTokenId, "wild_shape");
  }, [handleTransform]);

  useEffect(() => {
    return subscribeAppEvent("wildShapeTarget", (detail) => {
      const sourceCharacterId = Number(detail?.sourceCharacterId || 0);
      if (!sourceCharacterId) return;

      const sourceToken = tokens.find((token) => token.character_id === sourceCharacterId);
      if (!sourceToken) {
        showToast("未找到该角色在当前地图上的 token，无法执行变形", "warning");
        return;
      }
      if (sourceToken.transformation_data) {
        showToast("该角色已经处于变形状态", "warning");
        return;
      }

      const configId = typeof detail.execution?.configId === "string"
        ? detail.execution.configId
        : "wild_shape";
      handleTransform(sourceToken.id, configId);
    });
  }, [handleTransform, showToast, tokens]);

  const handleTransformComplete = useCallback(async (transformData: TransformationData) => {
    const tokenId = transformTokenIdRef.current;
    if (!tokenId) {
      logger.error("[Transform] No tokenId available");
      return;
    }

    const sourceToken = tokens.find((token) => token.id === tokenId);
    const sourceName = sourceToken?.instance_name || sourceCharacterData?.name || "目标";
    const configId = transformData.source?.config_id || "wild_shape";
    const spellName = transformData.source?.spell_name || "变化";

    if (configId === "wild_shape" && sourceToken?.character_id) {
      try {
        const response = await authedFetch(`/api/characters/${sourceToken.character_id}/resources/use`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resource_id: "wild_shape",
            amount: 1,
            campaign_id: parseInt(campaignId, 10),
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          showToast(errorData.detail || "野性形态次数不足", "error");
          return;
        }

        const result = await response.json();
        const newCurrent = result.current;
        const maxUses = result.max;
        setSourceCharacterData((previous: any) => {
          if (!previous?.actions) return previous;
          return {
            ...previous,
            actions: previous.actions.map((actionItem: any) =>
              (actionItem.id === "wild_shape" || actionItem.resourceId === "wild_shape") && actionItem.uses
                ? { ...actionItem, uses: { ...actionItem.uses, current: newCurrent } }
                : actionItem,
            ),
          };
        });

        const usesCombatWildShape = sourceCharacterData?.class_id === "druid"
          && sourceCharacterData?.subclass_id === "moon"
          && (sourceCharacterData?.level || 0) >= 2;
        publishAppEvent("combatActionUsed", {
          type: usesCombatWildShape ? "bonus_action" : "action",
        });
        showToast(`${sourceName} 使用野性形态 (${newCurrent}/${maxUses})`, "info");
      } catch (error) {
        logger.error("[Transform] Failed to use Wild Shape resource:", error);
        showToast("使用野性形态失败", "error");
        return;
      }
    }

    setTokens((previous) => previous.map((token) =>
      token.id === tokenId ? { ...token, transformation_data: transformData } : token,
    ));

    try {
      await authedFetch(`/api/tokens/${tokenId}/transform`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transformation_data: transformData }),
      });
      logger.info("[Transform] Transformation persisted:", {
        tokenId,
        creature: transformData.beast_name,
        configId,
      });
    } catch (error) {
      logger.error("[Transform] Failed to persist transformation:", error);
    }

    const icon = configId === "wild_shape"
      ? "🐺"
      : configId === "polymorph"
        ? "✨"
        : configId === "true_polymorph"
          ? "🌟"
          : "🔮";
    sendMessage({
      type: "chat",
      data: {
        message: `${icon} **${sourceName}** 通过【${spellName}】变形为【${transformData.beast_name}】！\n> HP: ${transformData.max_hp} | AC: ${transformData.ac} | ${transformData.size}`,
        message_type: "combat",
      },
    });

    showToast(`${sourceName} 变形为 ${transformData.beast_name}`, "success");
    closeTransformModal();
  }, [
    authedFetch,
    campaignId,
    closeTransformModal,
    sendMessage,
    setSourceCharacterData,
    setTokens,
    showToast,
    sourceCharacterData,
    tokens,
  ]);

  const handleEndTransformation = useCallback(async (sourceTokenId: number) => {
    const sourceToken = tokens.find((token) => token.id === sourceTokenId);
    if (!sourceToken?.transformation_data) return;

    const sourceName = sourceToken.instance_name || sourceCharacterData?.name || "目标";
    const transformType = sourceToken.transformation_data.type;
    const beastName = sourceToken.transformation_data.beast_name;
    const spellName = sourceToken.transformation_data.source?.spell_name || "变化";
    const originalSize = sourceToken.transformation_data.original_size;

    setTokens((previous) => previous.map((token) =>
      token.id === sourceTokenId ? { ...token, transformation_data: null } : token,
    ));

    try {
      await authedFetch(`/api/tokens/${sourceTokenId}/transform`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transformation_data: null }),
      });
    } catch (error) {
      logger.error("[Transform] Failed to end transformation:", error);
    }

    if (transformType === "modifier" && originalSize) {
      try {
        await authedFetch(`/api/tokens/${sourceTokenId}/size`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token_size: dndSizeToTokenSize(originalSize) }),
        });
      } catch {
        // Best effort.
      }
    }

    const desc = transformType === "modifier"
      ? `🔄 **${sourceName}** 的${spellName}效果结束，恢复原始体型`
      : `🔄 **${sourceName}** 结束了${spellName}（${beastName}），恢复原形态`;
    sendMessage({
      type: "chat",
      data: {
        message: desc,
        message_type: "combat",
      },
    });

    showToast(`${sourceName} 恢复原形态`, "info");
    clearSelectionContextMenu();
  }, [authedFetch, clearSelectionContextMenu, sendMessage, setTokens, showToast, sourceCharacterData, tokens]);

  return {
    transformModalOpen,
    setTransformModalOpen,
    transformTokenId,
    setTransformTokenId,
    transformConfigId,
    transformTokenIdRef,
    handleTransform,
    handleWildShape,
    handleTransformComplete,
    handleEndTransformation,
    handleEndWildShape: handleEndTransformation,
    closeTransformModal,
  };
}
