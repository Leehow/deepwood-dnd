import { useCallback, useEffect } from "react";

import type { WebSocketMessage } from "~/hooks/useWebSocket";
import { triggerStartPrivateMessage } from "~/utils/characterBubble";
import { createLogger } from "~/utils/logger";

import { GRID_SIZE, type Token } from "../types/TacticalMapTypes";
import { focusMyToken as utilFocusMyToken } from "../utils/mapCalculations";

const logger = createLogger("useMapFocusController");

type ShowToastFn = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

interface UseMapFocusControllerArgs {
  authedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  campaignId: string;
  currentMapUrl?: string | null;
  userId?: string;
  isDM: boolean;
  selectedCharacterId?: number | null;
  tokens: Token[];
  anchorPosition: { x: number; y: number } | null;
  stagePos: { x: number; y: number };
  stageScale: number;
  stageSize: { width: number; height: number };
  setAnchorPosition: (value: { x: number; y: number } | null) => void;
  setStagePos: (value: { x: number; y: number }) => void;
  setStageScale: (value: number) => void;
  setSelectedTokenId: (tokenId: number | null) => void;
  showToast: ShowToastFn;
  sendMessage: (payload: WebSocketMessage) => void;
  handleExternalTokenSelect: (tokenId: number | null) => void;
}

export function useMapFocusController({
  authedFetch,
  campaignId,
  currentMapUrl,
  userId,
  isDM,
  selectedCharacterId,
  tokens,
  anchorPosition,
  stagePos,
  stageScale,
  stageSize,
  setAnchorPosition,
  setStagePos,
  setStageScale,
  setSelectedTokenId,
  showToast,
  sendMessage,
  handleExternalTokenSelect,
}: UseMapFocusControllerArgs) {
  const handleMinimapNavigate = useCallback((canvasX: number, canvasY: number) => {
    setStagePos({
      x: -canvasX * stageScale + stageSize.width / 2,
      y: -canvasY * stageScale + stageSize.height / 2,
    });
  }, [setStagePos, stageScale, stageSize.height, stageSize.width]);

  const focusMyToken = useCallback(() => {
    utilFocusMyToken(
      tokens,
      stageSize,
      stageScale,
      setStagePos,
      userId,
      selectedCharacterId ?? undefined,
    );
  }, [selectedCharacterId, setStagePos, stageScale, stageSize, tokens, userId]);

  const jumpToAnchor = useCallback(() => {
    if (!anchorPosition) {
      showToast("当前地图未设置锚点", "info");
      return;
    }
    const px = anchorPosition.x * GRID_SIZE + GRID_SIZE / 2;
    const py = anchorPosition.y * GRID_SIZE + GRID_SIZE / 2;
    setStagePos({
      x: stageSize.width / 2 - px * stageScale,
      y: stageSize.height / 2 - py * stageScale,
    });
    showToast("已跳转到锚点", "success");
  }, [anchorPosition, setStagePos, showToast, stageScale, stageSize.height, stageSize.width]);

  const clearAnchor = useCallback(() => {
    if (!anchorPosition) {
      showToast("当前地图未设置锚点", "info");
      return;
    }
    if (!currentMapUrl) return;

    authedFetch(`/api/map-settings/${campaignId}/${encodeURIComponent(currentMapUrl)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anchor_x: null, anchor_y: null }),
    })
      .then(() => {
        setAnchorPosition(null);
        showToast("锚点已清除", "success");
        sendMessage({
          type: "anchor_update",
          data: { map_url: currentMapUrl, anchor_x: null, anchor_y: null },
        });
      })
      .catch(() => showToast("锚点清除失败", "error"));
  }, [anchorPosition, authedFetch, campaignId, currentMapUrl, sendMessage, setAnchorPosition, showToast]);

  const focusToken = useCallback((tokenId: number, position: { x: number; y: number }) => {
    const tokenSize = { width: 1, height: 1 };
    const tokenX = position.x * GRID_SIZE + (tokenSize.width * GRID_SIZE) / 2;
    const tokenY = position.y * GRID_SIZE + (tokenSize.height * GRID_SIZE) / 2;
    const newX = stageSize.width / 2 - tokenX * stageScale;
    const newY = stageSize.height / 2 - tokenY * stageScale;
    setStagePos({ x: newX, y: newY });
    logger.debug("[TacticalMap] Focused on token:", tokenId, "at", position.x, position.y);
  }, [setStagePos, stageScale, stageSize.height, stageSize.width]);

  const focusAllPlayers = useCallback(() => {
    const playerTokens = tokens.filter((token) => token.character_id);
    if (playerTokens.length === 0) {
      showToast("地图上没有玩家Token", "info");
      logger.debug("[TacticalMap] No player tokens to focus on");
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    playerTokens.forEach((token) => {
      const x = token.position_x * GRID_SIZE;
      const y = token.position_y * GRID_SIZE;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + GRID_SIZE);
      maxY = Math.max(maxY, y + GRID_SIZE);
    });

    const padding = GRID_SIZE * 2;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    const boundsWidth = maxX - minX;
    const boundsHeight = maxY - minY;
    const scaleX = stageSize.width / boundsWidth;
    const scaleY = stageSize.height / boundsHeight;
    const newScale = Math.min(scaleX, scaleY, 1.5);

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const newX = stageSize.width / 2 - centerX * newScale;
    const newY = stageSize.height / 2 - centerY * newScale;

    setStageScale(newScale);
    setStagePos({ x: newX, y: newY });
    showToast(`已定位 ${playerTokens.length} 个玩家Token`, "success");
    logger.debug("[TacticalMap] Focused on", playerTokens.length, "player tokens at bounds:", {
      minX,
      minY,
      maxX,
      maxY,
    });
  }, [setStagePos, setStageScale, showToast, stageSize.height, stageSize.width, tokens]);

  const handleAvatarClick = useCallback(async (characterId: number | string) => {
    if (typeof characterId === "string" && characterId.startsWith("m_")) {
      return;
    }

    const charId = typeof characterId === "number" ? characterId : parseInt(characterId, 10);
    if (Number.isNaN(charId)) return;

    if (isDM) {
      const token = tokens.find((candidate) => candidate.character_id === charId);
      if (token) {
        focusToken(token.id, { x: token.position_x, y: token.position_y });
        setSelectedTokenId(token.id);
        showToast(`已定位到 ${token.character_name || token.instance_name}`, "success");
      } else {
        showToast("该角色的Token不在当前地图上", "info");
      }
      return;
    }

    try {
      const response = await authedFetch(`/api/characters/${charId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.user_id) {
          triggerStartPrivateMessage({
            targetUserId: data.user_id,
            targetName: data.name || "未知角色",
          });
        }
      }
    } catch (error) {
      logger.error("Failed to load character data:", error);
    }
  }, [authedFetch, focusToken, isDM, setSelectedTokenId, showToast, tokens]);

  useEffect(() => {
    (window as any).__focusMyToken = focusMyToken;
    (window as any).__jumpToAnchor = jumpToAnchor;
    (window as any).__clearAnchor = clearAnchor;
    (window as any).__focusToken = focusToken;
    (window as any).__focusAllPlayers = focusAllPlayers;
    (window as any).__selectToken = (tokenId: number | null, skipFocus?: boolean) => {
      handleExternalTokenSelect(tokenId);

      if (tokenId && !skipFocus) {
        const token = tokens.find((candidate) => candidate.id === tokenId);
        if (token && token.position_x != null && token.position_y != null) {
          focusToken(tokenId, { x: token.position_x, y: token.position_y });
        }
      }
    };

    return () => {
      delete (window as any).__focusMyToken;
      delete (window as any).__jumpToAnchor;
      delete (window as any).__clearAnchor;
      delete (window as any).__focusToken;
      delete (window as any).__focusAllPlayers;
      delete (window as any).__selectToken;
    };
  }, [clearAnchor, focusAllPlayers, focusMyToken, focusToken, handleExternalTokenSelect, jumpToAnchor, tokens]);

  return {
    clearAnchor,
    focusAllPlayers,
    focusMyToken,
    focusToken,
    handleAvatarClick,
    handleMinimapNavigate,
    jumpToAnchor,
  };
}
