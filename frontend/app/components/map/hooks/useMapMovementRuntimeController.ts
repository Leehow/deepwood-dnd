import { useCallback, useEffect, type Dispatch, type SetStateAction } from "react";

import { publishAppEvent, subscribeAppEvent } from "~/events/appEventBus";
import { createLogger } from "~/utils/logger";

import type { MoveConfirmModalState } from "../MapMarkerAndConfirmDialogs";
import type { Token } from "../types/TacticalMapTypes";
import { autoSettleZoneSpellsForMove } from "../utils/zoneSettlementRuntimeUtils";

const logger = createLogger("useMapMovementRuntimeController");

type ShowToastFn = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

interface UseMapMovementRuntimeControllerArgs {
  authedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  campaignId: string;
  currentMapUrl?: string | null;
  gridUnitLength: number;
  combatActiveTokenId: number | null;
  moveConfirmModal: MoveConfirmModalState | null;
  tokens: Token[];
  sourceCharacterData: any;
  showToast: ShowToastFn;
  sendMessage: (payload: any) => void;
  setTokens: Dispatch<SetStateAction<Token[]>>;
  setMoveConfirmModal: Dispatch<SetStateAction<MoveConfirmModalState | null>>;
  setSourceCharacterData: Dispatch<SetStateAction<any>>;
  clearSelectionContextMenu: () => void;
  getTokenMovementSpeed: (token: Token) => number;
}

export function useMapMovementRuntimeController({
  authedFetch,
  campaignId,
  currentMapUrl,
  gridUnitLength,
  combatActiveTokenId,
  moveConfirmModal,
  tokens,
  sourceCharacterData,
  showToast,
  sendMessage,
  setTokens,
  setMoveConfirmModal,
  setSourceCharacterData,
  clearSelectionContextMenu,
  getTokenMovementSpeed,
}: UseMapMovementRuntimeControllerArgs) {
  useEffect(() => {
    const handleRestoreMovement = async ({
      tokenId,
      toX,
      toY,
      restoreDistance,
    }: {
      tokenId: number;
      toX: number;
      toY: number;
      restoreDistance: number;
    }) => {
      setTokens((prev) =>
        prev.map((token) =>
          token.id === tokenId ? { ...token, position_x: toX, position_y: toY } : token,
        ),
      );

      try {
        const response = await authedFetch(`/api/tokens/${tokenId}/position`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position_x: toX, position_y: toY }),
        });

        if (!response.ok) {
          showToast("恢复移动失败", "error");
          return;
        }

        sendMessage({
          type: "token_move",
          data: { token_id: tokenId, position: { x: toX, y: toY } },
        });

        publishAppEvent("combatActionUsed", {
          type: "movement",
          amount: -restoreDistance,
        });
        showToast("已恢复移动", "success");
      } catch {
        showToast("恢复移动失败", "error");
      }
    };

    return subscribeAppEvent("combatRestoreMovement", handleRestoreMovement);
  }, [authedFetch, sendMessage, setTokens, showToast]);

  useEffect(() => {
    const handleEquipmentUpdate = ({
      characterId,
      equipment,
      needsBroadcast,
    }: {
      characterId?: number | string;
      equipment?: unknown;
      needsBroadcast?: boolean;
    }) => {
      if (needsBroadcast && characterId) {
        sendMessage({
          type: "character_equipment_updated",
          data: {
            character_id: characterId,
            equipment,
          },
        });
      }

      if (sourceCharacterData?.id !== characterId) {
        return;
      }

      if (equipment) {
        setSourceCharacterData((previous: any) => ({
          ...previous,
          equipment,
        }));
        return;
      }

      authedFetch(`/api/characters/${characterId}/sheet`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data?.character) {
            setSourceCharacterData(data.character);
          }
        })
        .catch((error) => {
          logger.warn("[useMapMovementRuntimeController] Failed to refresh character data:", error);
        });
    };

    return subscribeAppEvent("characterEquipmentUpdated", handleEquipmentUpdate);
  }, [authedFetch, sendMessage, setSourceCharacterData, sourceCharacterData?.id]);

  const handleMoveSpellArea = useCallback(async (tokenId: number, newCenterX: number, newCenterY: number) => {
    try {
      const response = await authedFetch(`/api/tokens/${tokenId}/area-effect-position`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ center_x: newCenterX, center_y: newCenterY }),
      });
      if (!response.ok) throw new Error("Failed to move spell area");

      const casterToken = tokens.find((token) => token.id === tokenId);
      const illusionTokenId = casterToken?.concentration_spell?.area_effect?.illusion_token_id;

      if (illusionTokenId) {
        const illusionToken = tokens.find((token) => token.id === illusionTokenId);
        const parts = (illusionToken?.token_size || "1x1").split("x");
        const sizeW = parseInt(parts[0], 10) || 1;
        const sizeH = parseInt(parts[1], 10) || parseInt(parts[0], 10) || 1;
        const newTokenX = Math.round(newCenterX - sizeW / 2);
        const newTokenY = Math.round(newCenterY - sizeH / 2);
        void authedFetch(`/api/tokens/${illusionTokenId}/position`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position_x: newTokenX, position_y: newTokenY }),
        }).catch(() => {});
      }

      setTokens((prev) =>
        prev.map((token) => {
          if (token.id === tokenId && token.concentration_spell?.area_effect) {
            return {
              ...token,
              concentration_spell: {
                ...token.concentration_spell,
                area_effect: {
                  ...token.concentration_spell.area_effect,
                  center_x: newCenterX,
                  center_y: newCenterY,
                },
              },
            };
          }

          if (illusionTokenId && token.id === illusionTokenId) {
            const parts = (token.token_size || "1x1").split("x");
            const sizeW = parseInt(parts[0], 10) || 1;
            const sizeH = parseInt(parts[1], 10) || parseInt(parts[0], 10) || 1;
            return {
              ...token,
              position_x: Math.round(newCenterX - sizeW / 2),
              position_y: Math.round(newCenterY - sizeH / 2),
            };
          }

          return token;
        }),
      );
    } catch {
      showToast("移动法术区域失败", "error");
    }
  }, [authedFetch, setTokens, showToast, tokens]);

  const executeMove = useCallback(async (
    gridX: number,
    gridY: number,
    sourceTokenId: number,
    token: Token,
  ) => {
    logger.info("[Move To]", {
      source: sourceTokenId,
      from: { x: token.position_x, y: token.position_y },
      to: { x: gridX, y: gridY },
    });

    const dx = gridX - token.position_x;
    const dy = gridY - token.position_y;
    const distanceFeet = Math.round(Math.max(Math.abs(dx), Math.abs(dy)) * gridUnitLength);

    const movementRemaining = (window as any).__combatMovementRemaining;
    if (typeof movementRemaining === "number" && distanceFeet > 0) {
      if (movementRemaining <= 0) {
        alert("移动力已用尽！如需继续移动请使用疾走动作。");
        clearSelectionContextMenu();
        return;
      }
      if (distanceFeet > movementRemaining) {
        const confirmMove = confirm(
          `此次移动需要 ${distanceFeet} 尺，但剩余移动力只有 ${movementRemaining} 尺。是否继续？`,
        );
        if (!confirmMove) {
          clearSelectionContextMenu();
          return;
        }
      }
    }

    setTokens((prev) =>
      prev.map((current) =>
        current.id === sourceTokenId ? { ...current, position_x: gridX, position_y: gridY } : current,
      ),
    );

    try {
      const response = await authedFetch(`/api/tokens/${sourceTokenId}/position`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position_x: gridX, position_y: gridY }),
      });

      if (!response.ok) {
        setTokens((prev) =>
          prev.map((current) =>
            current.id === sourceTokenId
              ? { ...current, position_x: token.position_x, position_y: token.position_y }
              : current,
          ),
        );
        showToast("移动失败", "error");
        return;
      }

      sendMessage({
        type: "token_move",
        data: { token_id: sourceTokenId, position: { x: gridX, y: gridY } },
      });

      publishAppEvent("combatActionUsed", {
        type: "movement",
        amount: distanceFeet,
      });

      if (distanceFeet > 0 && currentMapUrl) {
        void autoSettleZoneSpellsForMove({
          authedFetch,
          campaignId,
          currentMapUrl,
          gridUnitLength,
          tokens,
          tokenId: sourceTokenId,
          newX: gridX,
          newY: gridY,
        }).catch((error) => {
          logger.error("[useMapMovementRuntimeController] Auto zone-settle failed:", error);
        });
      }

      const tokenName = token.instance_name || token.monster_name || token.character_name || "单位";
      publishAppEvent("combatMoveResult", {
        tokenId: sourceTokenId,
        tokenName,
        fromX: token.position_x,
        fromY: token.position_y,
        toX: gridX,
        toY: gridY,
        distance: distanceFeet,
      });
    } catch {
      setTokens((prev) =>
        prev.map((current) =>
          current.id === sourceTokenId
            ? { ...current, position_x: token.position_x, position_y: token.position_y }
            : current,
        ),
      );
      showToast("移动失败", "error");
    }

    clearSelectionContextMenu();
  }, [authedFetch, campaignId, clearSelectionContextMenu, currentMapUrl, gridUnitLength, sendMessage, setTokens, showToast, tokens]);

  const handleSelectionMoveTo = useCallback(async (gridX: number, gridY: number, sourceTokenId: number) => {
    const token = tokens.find((current) => current.id === sourceTokenId);
    if (!token) return;

    const dx = gridX - token.position_x;
    const dy = gridY - token.position_y;
    const distanceFeet = Math.round(Math.max(Math.abs(dx), Math.abs(dy)) * gridUnitLength);
    const movementSpeed = getTokenMovementSpeed(token);
    const sourceName =
      token.instance_name || (token as any).monster_name || (token as any).character_name || "单位";

    if (combatActiveTokenId !== null && distanceFeet > movementSpeed) {
      clearSelectionContextMenu();
      setMoveConfirmModal({
        show: true,
        distanceFeet,
        movementSpeed,
        moveData: { gridX, gridY, sourceTokenId, token },
        sourceName,
      });
      return;
    }

    await executeMove(gridX, gridY, sourceTokenId, token);
  }, [
    clearSelectionContextMenu,
    combatActiveTokenId,
    executeMove,
    getTokenMovementSpeed,
    gridUnitLength,
    setMoveConfirmModal,
    tokens,
  ]);

  const handleMoveConfirm = useCallback(() => {
    if (moveConfirmModal?.moveData) {
      const { gridX, gridY, sourceTokenId, token } = moveConfirmModal.moveData;
      void executeMove(gridX, gridY, sourceTokenId, token);
    }
    setMoveConfirmModal(null);
  }, [executeMove, moveConfirmModal, setMoveConfirmModal]);

  const handleMoveCancel = useCallback(() => {
    setMoveConfirmModal(null);
  }, [setMoveConfirmModal]);

  return {
    handleMoveCancel,
    handleMoveConfirm,
    handleMoveSpellArea,
    handleSelectionMoveTo,
  };
}
