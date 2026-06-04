import { useCallback, useEffect, type Dispatch, type SetStateAction } from "react";

import type { Token } from "../types/TacticalMapTypes";
import { getEdgeToEdgeDistance, parseTokenSize } from "../utils/mapCalculations";
import {
  getInvokeDuplicityMaxDuplicates,
  INVOKE_DUPLICITY_DURATION_ROUNDS,
  INVOKE_DUPLICITY_RANGE_FEET,
  INVOKE_DUPLICITY_SPELL_ID,
  isInvokeDuplicityConcentration,
  type InvokeDuplicityModalState,
  type InvokeDuplicityPlacementMode,
} from "../utils/mapInvokeDuplicityUtils";
import { publishAppEvent } from "~/events/appEventBus";
import type { WebSocketMessage } from "~/hooks/useWebSocket";

type ShowToast = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

type AuthedFetch = (input: string, init?: RequestInit) => Promise<Response>;

type SetConcentrationOnToken = (
  tokenId: number,
  spell: any,
  level: number,
  userId?: string,
  targetName?: string,
  affectedIds?: number[],
  areaEffect?: any,
  extraData?: {
    linked_token_ids?: number[];
    duration_rounds?: number;
  },
) => Promise<unknown>;

interface UseMapInvokeDuplicityControllerArgs {
  sourceCharacterData: any;
  tokens: Token[];
  campaignId: string;
  currentMapUrl?: string | null;
  userId?: string;
  gridUnitLength: number;
  invokeDuplicityModal: InvokeDuplicityModalState | null;
  setInvokeDuplicityModal: Dispatch<SetStateAction<InvokeDuplicityModalState | null>>;
  invokeDuplicityPlacementMode: InvokeDuplicityPlacementMode | null;
  setInvokeDuplicityPlacementMode: Dispatch<SetStateAction<InvokeDuplicityPlacementMode | null>>;
  authedFetch: AuthedFetch;
  showToast: ShowToast;
  sendMessage: (payload: WebSocketMessage) => void;
  setTokens: Dispatch<SetStateAction<Token[]>>;
  consumeCharacterResource: (
    characterId: number,
    resourceId: string,
    action: any,
    failureLabel: string,
  ) => Promise<{ current: number; max: number } | null>;
  setConcentrationOnTokenFn: SetConcentrationOnToken;
  clearSelectionContextMenu: () => void;
}

export function useMapInvokeDuplicityController({
  sourceCharacterData,
  tokens,
  campaignId,
  currentMapUrl,
  userId,
  gridUnitLength,
  invokeDuplicityModal,
  setInvokeDuplicityModal,
  invokeDuplicityPlacementMode,
  setInvokeDuplicityPlacementMode,
  authedFetch,
  showToast,
  sendMessage,
  setTokens,
  consumeCharacterResource,
  setConcentrationOnTokenFn,
  clearSelectionContextMenu,
}: UseMapInvokeDuplicityControllerArgs) {
  const openInvokeDuplicityModal = useCallback((args: {
    action: any;
    sourceTokenId: number;
    sourceToken: Token;
    sourceName: string;
  }) => {
    const { action, sourceTokenId, sourceToken, sourceName } = args;
    const characterId = sourceToken.character_id;
    if (!characterId) {
      showToast("只有角色 token 才能使用诡术通道", "error");
      return false;
    }
    if ((action.uses?.current ?? 0) <= 0) {
      showToast("引导神力已用完！需要短休后恢复", "warning");
      return false;
    }
    if (isInvokeDuplicityConcentration(sourceToken.concentration_spell)) {
      showToast("你已经维持着诡术通道，先结束专注再重新施放", "warning");
      return false;
    }

    setInvokeDuplicityModal({
      sourceTokenId,
      sourceCharacterId: characterId,
      sourceName,
      action,
      maxDuplicates: getInvokeDuplicityMaxDuplicates(sourceCharacterData),
    });
    clearSelectionContextMenu();
    return true;
  }, [clearSelectionContextMenu, setInvokeDuplicityModal, showToast, sourceCharacterData]);

  const handleInvokeDuplicityModalConfirm = useCallback((count: number) => {
    if (!invokeDuplicityModal) return;

    setInvokeDuplicityPlacementMode({
      sourceTokenId: invokeDuplicityModal.sourceTokenId,
      sourceCharacterId: invokeDuplicityModal.sourceCharacterId,
      sourceName: invokeDuplicityModal.sourceName,
      action: invokeDuplicityModal.action,
      requestedCount: Math.min(Math.max(count, 1), invokeDuplicityModal.maxDuplicates),
      positions: [],
      previewPos: null,
    });
    setInvokeDuplicityModal(null);
  }, [invokeDuplicityModal, setInvokeDuplicityModal, setInvokeDuplicityPlacementMode]);

  const handleInvokeDuplicityPlacementCancel = useCallback(() => {
    setInvokeDuplicityPlacementMode(null);
  }, [setInvokeDuplicityPlacementMode]);

  const handleInvokeDuplicityPlacementUndo = useCallback(() => {
    setInvokeDuplicityPlacementMode((previous) => {
      if (!previous) return null;
      return {
        ...previous,
        positions: previous.positions.slice(0, -1),
      };
    });
  }, [setInvokeDuplicityPlacementMode]);

  const handleInvokeDuplicityPlacementMouseMove = useCallback((gridX: number, gridY: number) => {
    if (!invokeDuplicityPlacementMode) return;
    setInvokeDuplicityPlacementMode((previous) => previous ? {
      ...previous,
      previewPos: { x: Math.floor(gridX), y: Math.floor(gridY) },
    } : null);
  }, [invokeDuplicityPlacementMode, setInvokeDuplicityPlacementMode]);

  const handleInvokeDuplicityPlacementConfirm = useCallback((gridX: number, gridY: number) => {
    if (!invokeDuplicityPlacementMode) return;

    const sourceToken = tokens.find((token) => token.id === invokeDuplicityPlacementMode.sourceTokenId);
    if (!sourceToken) {
      showToast("无法找到诡术通道的来源 token", "error");
      return;
    }

    if (invokeDuplicityPlacementMode.positions.length >= invokeDuplicityPlacementMode.requestedCount) {
      return;
    }

    const snapped = { x: Math.floor(gridX), y: Math.floor(gridY) };
    const sourceSize = parseTokenSize(sourceToken.token_size);
    const distanceFeet = getEdgeToEdgeDistance(
      sourceToken.position_x,
      sourceToken.position_y,
      sourceSize.width,
      sourceSize.height,
      snapped.x,
      snapped.y,
      1,
      1,
    ) * gridUnitLength;

    if (distanceFeet > INVOKE_DUPLICITY_RANGE_FEET) {
      showToast(`分身超出诡术通道范围（${Math.round(distanceFeet)}尺 > ${INVOKE_DUPLICITY_RANGE_FEET}尺）`, "error");
      return;
    }

    const duplicateKey = `${snapped.x},${snapped.y}`;
    if (invokeDuplicityPlacementMode.positions.some((position) => `${position.x},${position.y}` === duplicateKey)) {
      showToast("这个格子已经放过一个分身了", "warning");
      return;
    }

    setInvokeDuplicityPlacementMode((previous) => previous ? {
      ...previous,
      positions: [...previous.positions, snapped],
      previewPos: snapped,
    } : null);
  }, [gridUnitLength, invokeDuplicityPlacementMode, setInvokeDuplicityPlacementMode, showToast, tokens]);

  const handleInvokeDuplicityCreate = useCallback(async () => {
    if (!invokeDuplicityPlacementMode) return;

    const {
      sourceTokenId,
      sourceCharacterId,
      sourceName,
      action,
      requestedCount,
      positions,
    } = invokeDuplicityPlacementMode;

    if (positions.length !== requestedCount) {
      showToast(`请先放置完全部 ${requestedCount} 个分身`, "warning");
      return;
    }

    const sourceToken = tokens.find((token) => token.id === sourceTokenId);
    if (!sourceToken) {
      showToast("无法找到诡术通道的来源 token", "error");
      return;
    }

    if ((action.uses?.current ?? 0) <= 0) {
      showToast("引导神力已用完！需要短休后恢复", "warning");
      return;
    }

    if (isInvokeDuplicityConcentration(sourceToken.concentration_spell)) {
      showToast("你已经维持着诡术通道，先结束专注再重新施放", "warning");
      return;
    }

    const resourceResult = await consumeCharacterResource(
      sourceCharacterId,
      "channel_divinity_cleric",
      action,
      action.name || "诡术通道",
    );
    if (!resourceResult) return;

    const createdTokenIds: number[] = [];
    const duplicateAvatar = sourceToken.avatar_large || sourceToken.avatar || "";
    const mapUrl = sourceToken.map_url || currentMapUrl || "";

    try {
      for (let index = 0; index < positions.length; index += 1) {
        const position = positions[index];
        const response = await authedFetch("/api/tokens", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaign_id: parseInt(campaignId, 10),
            map_url: mapUrl,
            position_x: position.x,
            position_y: position.y,
            token_size: "1x1",
            user_id: userId,
            instance_name: positions.length > 1 ? `${sourceName}的分身 ${index + 1}` : `${sourceName}的分身`,
            item_data: {
              type: "illusion",
              subtype: INVOKE_DUPLICITY_SPELL_ID,
              spell_id: INVOKE_DUPLICITY_SPELL_ID,
              icon: duplicateAvatar,
              avatar_url: duplicateAvatar,
              avatar_url_large: duplicateAvatar,
              description: "诡术通道创造的幻影分身",
              caster_character_id: sourceCharacterId,
              caster_token_id: sourceTokenId,
            },
          }),
        });

        if (!response.ok) {
          throw new Error("创建幻影分身失败");
        }

        const duplicateToken = await response.json();
        if (!duplicateToken?.id) {
          throw new Error("分身 token 返回数据不完整");
        }
        createdTokenIds.push(Number(duplicateToken.id));
        setTokens((previous) => previous.some((token) => token.id === duplicateToken.id) ? previous : [...previous, duplicateToken]);
      }

      const concentrationSpell = {
        spell_id: INVOKE_DUPLICITY_SPELL_ID,
        spell_name: action.name || "诡术通道",
        slot_level: 0,
        duration_rounds: INVOKE_DUPLICITY_DURATION_ROUNDS,
        current_round: 0,
        affected_token_ids: [],
        linked_token_ids: createdTokenIds,
        con_save_bonus: 0,
        has_advantage: false,
      };

      const concentrationApplied = await setConcentrationOnTokenFn(
        sourceTokenId,
        {
          id: INVOKE_DUPLICITY_SPELL_ID,
          name: action.name || "诡术通道",
          duration: "1 分钟",
        },
        0,
        userId,
        undefined,
        [],
        undefined,
        {
          linked_token_ids: createdTokenIds,
          duration_rounds: INVOKE_DUPLICITY_DURATION_ROUNDS,
        },
      );

      if (!concentrationApplied) {
        throw new Error("设置诡术通道专注失败");
      }

      setTokens((previous) => previous.map((token) =>
        token.id === sourceTokenId
          ? { ...token, concentration_spell: concentrationSpell }
          : token,
      ));

      sendMessage({
        type: "chat",
        data: {
          message: [
            `👥 **${sourceName}** 使用【诡术通道】！`,
            `> 在 30 尺内创造了 **${createdTokenIds.length}** 个幻影分身，持续 **1分钟（专注）**。`,
            "> 现在可以将法术视为从分身位置施放；当你与分身同时贴近目标时，攻击检定具有优势。",
            `> 剩余引导神力: ${resourceResult.current}/${resourceResult.max}`,
          ].join("\n"),
          message_type: "combat",
        },
      });

      showToast(`${sourceName} 创建了 ${createdTokenIds.length} 个诡术分身`, "success");
      publishAppEvent("combatActionUsed", { type: "action" });
      setInvokeDuplicityPlacementMode(null);
      clearSelectionContextMenu();
    } catch (error) {
      console.error("[Action] Invoke Duplicity failed:", error);
      if (createdTokenIds.length > 0) {
        setTokens((previous) => previous.filter((token) => !createdTokenIds.includes(token.id)));
      }
      await Promise.all(createdTokenIds.map(async (tokenId) => {
        try {
          await authedFetch(`/api/tokens/${tokenId}`, { method: "DELETE" });
        } catch {
          // Best-effort cleanup only.
        }
      }));
      showToast("诡术通道失败，已停止创建分身", "error");
    }
  }, [
    authedFetch,
    campaignId,
    clearSelectionContextMenu,
    consumeCharacterResource,
    currentMapUrl,
    invokeDuplicityPlacementMode,
    sendMessage,
    setConcentrationOnTokenFn,
    setInvokeDuplicityPlacementMode,
    setTokens,
    showToast,
    tokens,
    userId,
  ]);

  useEffect(() => {
    if (!invokeDuplicityPlacementMode) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleInvokeDuplicityPlacementCancel();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleInvokeDuplicityPlacementCancel, invokeDuplicityPlacementMode]);

  return {
    openInvokeDuplicityModal,
    handleInvokeDuplicityModalConfirm,
    handleInvokeDuplicityPlacementCancel,
    handleInvokeDuplicityPlacementUndo,
    handleInvokeDuplicityPlacementMouseMove,
    handleInvokeDuplicityPlacementConfirm,
    handleInvokeDuplicityCreate,
  };
}
