import { useCallback, useEffect, useState } from "react";
import type { Character } from "../types/Character";
import { apiFetch } from "~/utils/api-client";
import { fetchCampaignMapTokensCached } from "~/utils/mapTokensCache";
import { publishAppEvent } from "~/events/appEventBus";
import { createLogger } from '~/utils/logger';
const logger = createLogger('useMapToken');


interface UseMapTokenArgs {
  character: Character;
  campaignId: string;
  currentMapUrl: string | null;
  userId?: string;
}

export function useMapToken({ character, campaignId, currentMapUrl, userId }: UseMapTokenArgs) {
  const [hasTokenOnMap, setHasTokenOnMap] = useState(false);
  const [_currentTokenId, setCurrentTokenId] = useState<number | null>(null);
  const [placeLoading, setPlaceLoading] = useState(false);
  const [placeSuccess, setPlaceSuccess] = useState(false);
  const authedFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    apiFetch(input, { ...init, userId });

  // Check if character already has a token on the current map
  useEffect(() => {
    const checkToken = async () => {
      if (!currentMapUrl || !campaignId) {
        setHasTokenOnMap(false);
        setCurrentTokenId(null);
        return;
      }
      try {
        const data = await fetchCampaignMapTokensCached(parseInt(campaignId), currentMapUrl, { userId });
        const myToken = (data.tokens || []).find((t: any) => t.character_id === character.id);
        setHasTokenOnMap(!!myToken);
        setCurrentTokenId(myToken?.id || null);
      } catch (e) {
        logger.error("Failed to check token:", e);
        setHasTokenOnMap(false);
        setCurrentTokenId(null);
      }
    };
    checkToken();
  }, [currentMapUrl, campaignId, character.id]);

  const handlePlaceToken = useCallback(async () => {
    if (!currentMapUrl) {
      alert("当前没有地图，等待DM分享地图");
      return;
    }
    try {
      setPlaceLoading(true);
      // Load existing tokens for this map to avoid overlap
      const listData = await fetchCampaignMapTokensCached(parseInt(campaignId), currentMapUrl, { userId });
      const used = new Set<string>((listData.tokens || []).map((t: any) => `${t.position_x},${t.position_y}`));

      // Get viewport center position from TacticalMap
      let cx = 15,
        cy = 10; // Default fallback
      if (typeof (window as any).__getViewportCenterGridPosition === "function") {
        const center = (window as any).__getViewportCenterGridPosition();
        cx = center.x;
        cy = center.y;
        logger.debug("[useMapToken] Using viewport center:", cx, cy);
      } else {
        logger.warn("[useMapToken] Viewport center function not available, using default position");
      }

      const candidates: Array<[number, number]> = [];
      const deltas = [
        [0, 0],
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
        [2, 0],
        [0, 2],
        [-2, 0],
        [0, -2],
        [2, 1],
        [1, 2],
        [-1, 2],
        [-2, 1],
        [-2, -1],
        [-1, -2],
        [1, -2],
        [2, -1],
      ];
      for (const [dx, dy] of deltas) candidates.push([cx + dx, cy + dy]);
      let [nx, ny] = [cx, cy];
      for (const [x, y] of candidates) {
        if (!used.has(`${x},${y}`)) {
          nx = x;
          ny = y;
          break;
        }
      }

      const create = await authedFetch("/api/tokens/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: parseInt(campaignId),
          character_id: character.id,
          user_id: userId,
          map_url: currentMapUrl,
          position_x: nx,
          position_y: ny,
        }),
      });
      if (!create.ok) {
        const t = await create.text();
        logger.error("Place token failed:", t);
        alert("生成到战役地图失败");
        return;
      }
      const result = await create.json();
      setHasTokenOnMap(true);
      setCurrentTokenId(result.id);
      // Notify TacticalMap to reload tokens
      publishAppEvent("tokenPlaced", { token: result });
      // Success feedback
      setPlaceSuccess(true);
      setTimeout(() => setPlaceSuccess(false), 3000);
    } catch (e) {
      logger.error("Place token error:", e);
      alert("生成到战役地图异常");
    } finally {
      setPlaceLoading(false);
    }
  }, [currentMapUrl, campaignId, character.id, userId]);

  return {
    hasTokenOnMap,
    placeLoading,
    placeSuccess,
    handlePlaceToken,
  };
}
