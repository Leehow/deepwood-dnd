import { useCallback } from "react";

import { createLogger } from "~/utils/logger";

import type {
  ContextMenuState,
  MobileActionModalState,
} from "./useMapInteractionController";
import type { Token } from "../types/TacticalMapTypes";

const logger = createLogger("useMapPlacementController");

type ShowToastFn = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

interface UseMapPlacementControllerArgs {
  authedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  campaignId: string;
  currentMapUrl?: string | null;
  contextMenu: ContextMenuState | null;
  mobileActionModal: MobileActionModalState | null;
  selectedCharacterId?: number | null;
  tokens: Token[];
  setTokens: (updater: (prev: Token[]) => Token[]) => void;
  showToast: ShowToastFn;
  focusToken: (tokenId: number, position: { x: number; y: number }) => void;
}

export function useMapPlacementController({
  authedFetch,
  campaignId,
  currentMapUrl,
  contextMenu,
  mobileActionModal,
  selectedCharacterId,
  tokens,
  setTokens,
  showToast,
  focusToken,
}: UseMapPlacementControllerArgs) {
  const resolveGridPosition = useCallback(
    () => contextMenu || mobileActionModal,
    [contextMenu, mobileActionModal],
  );

  const handlePlaceShop = useCallback(
    async (shopId: number, shopName: string) => {
      const gridPos = resolveGridPosition();
      if (!gridPos || !currentMapUrl) {
        logger.error("[TacticalMap] Cannot place shop - no gridPos or mapUrl", {
          gridPos,
          currentMapUrl,
        });
        return;
      }

      try {
        const response = await authedFetch("/api/tokens/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaign_id: parseInt(campaignId, 10),
            position_x: gridPos.gridX,
            position_y: gridPos.gridY,
            token_size: "1x1",
            shop_id: shopId,
            instance_name: shopName,
            map_url: currentMapUrl,
          }),
        });

        if (response.ok) {
          const newToken = await response.json();
          setTokens((prev) => {
            const exists = prev.some((token) => token.id === newToken.id);
            return exists ? prev : [...prev, newToken];
          });
          showToast(`已放置商店 ${shopName}`, "success");
          return;
        }

        const errorText = await response.text();
        logger.error("[TacticalMap] Failed to place shop:", errorText);
        showToast("放置商店失败", "error");
      } catch (error) {
        logger.error("[TacticalMap] Failed to place shop:", error);
        showToast("放置商店失败", "error");
      }
    },
    [authedFetch, campaignId, currentMapUrl, resolveGridPosition, setTokens, showToast],
  );

  const handlePlaceCharacter = useCallback(
    async (characterId: number | string, characterName: string) => {
      const gridPos = resolveGridPosition();
      if (!gridPos || !currentMapUrl) {
        logger.error("[TacticalMap] Cannot place character - no gridPos or mapUrl", {
          gridPos,
          currentMapUrl,
        });
        return;
      }

      logger.debug("[TacticalMap] Placing character token:", {
        characterId,
        characterName,
        gridX: gridPos.gridX,
        gridY: gridPos.gridY,
      });

      const numericId = typeof characterId === "number" ? characterId : parseInt(characterId, 10);
      if (Number.isNaN(numericId)) {
        showToast("无效的角色ID", "error");
        return;
      }

      const existingToken = tokens.find(
        (token) => token.character_id === numericId && token.map_url === currentMapUrl,
      );
      if (existingToken) {
        showToast(`${characterName} 的Token已在地图上`, "info");
        focusToken(existingToken.id, {
          x: existingToken.position_x,
          y: existingToken.position_y,
        });
        return;
      }

      try {
        const response = await authedFetch("/api/tokens/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaign_id: parseInt(campaignId, 10),
            position_x: gridPos.gridX,
            position_y: gridPos.gridY,
            token_size: "1x1",
            character_id: numericId,
            map_url: currentMapUrl,
          }),
        });

        if (response.ok) {
          const newToken = await response.json();
          logger.debug("[TacticalMap] Character token created:", newToken);
          setTokens((prev) => {
            const exists = prev.some((token) => token.id === newToken.id);
            return exists ? prev : [...prev, newToken];
          });
          showToast(`已放置 ${characterName} 在 (${gridPos.gridX}, ${gridPos.gridY})`, "success");
          focusToken(newToken.id, { x: newToken.position_x, y: newToken.position_y });
          return;
        }

        const errorText = await response.text();
        logger.error("[TacticalMap] Failed to place character token:", errorText);
        showToast("放置角色Token失败", "error");
      } catch (error) {
        logger.error("[TacticalMap] Failed to place character token:", error);
        showToast("放置角色Token失败", "error");
      }
    },
    [
      authedFetch,
      campaignId,
      currentMapUrl,
      focusToken,
      resolveGridPosition,
      setTokens,
      showToast,
      tokens,
    ],
  );

  const handlePlaceMyToken = useCallback(
    async (gridX: number, gridY: number) => {
      if (!selectedCharacterId || !currentMapUrl) {
        showToast("未选择角色", "error");
        return;
      }

      const existingToken = tokens.find(
        (token) => token.character_id === selectedCharacterId && token.map_url === currentMapUrl,
      );
      if (existingToken) {
        showToast("您的Token已在地图上", "info");
        return;
      }

      try {
        const response = await authedFetch("/api/tokens/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaign_id: parseInt(campaignId, 10),
            position_x: gridX,
            position_y: gridY,
            token_size: "1x1",
            character_id: selectedCharacterId,
            map_url: currentMapUrl,
          }),
        });

        if (response.ok) {
          const newToken = await response.json();
          setTokens((prev) => {
            const exists = prev.some((token) => token.id === newToken.id);
            return exists ? prev : [...prev, newToken];
          });
          showToast("已放置您的角色Token", "success");
          return;
        }

        const errorText = await response.text();
        logger.error("[TacticalMap] Failed to place player token:", errorText);
        showToast("放置Token失败", "error");
      } catch (error) {
        logger.error("[TacticalMap] Failed to place player token:", error);
        showToast("放置Token失败", "error");
      }
    },
    [authedFetch, campaignId, currentMapUrl, selectedCharacterId, setTokens, showToast, tokens],
  );

  return {
    handlePlaceCharacter,
    handlePlaceMyToken,
    handlePlaceShop,
  };
}
