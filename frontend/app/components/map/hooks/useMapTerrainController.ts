import { useCallback, useEffect, useRef } from "react";

import type { TerrainData } from "../TerrainManager";
import { createLogger } from "~/utils/logger";

const logger = createLogger("useMapTerrainController");

interface UseMapTerrainControllerArgs {
  campaignId: string;
  isDM: boolean;
  currentMapUrl?: string | null;
  authedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  sendMessage: (message: { type: string; data: Record<string, unknown> }) => void;
  setTerrainData: (data: TerrainData) => void;
}

export function useMapTerrainController({
  campaignId,
  isDM,
  currentMapUrl,
  authedFetch,
  sendMessage,
  setTerrainData,
}: UseMapTerrainControllerArgs) {
  const terrainDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (terrainDebounceTimer.current) {
        clearTimeout(terrainDebounceTimer.current);
      }
    };
  }, []);

  const handleTerrainUpdate = useCallback(
    (newTerrainData: TerrainData) => {
      setTerrainData(newTerrainData);

      if (!campaignId || !isDM || !currentMapUrl) return;

      if (terrainDebounceTimer.current) {
        clearTimeout(terrainDebounceTimer.current);
      }

      terrainDebounceTimer.current = setTimeout(async () => {
        try {
          await authedFetch(`/api/campaigns/${campaignId}/terrain`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(newTerrainData),
          });
          sendMessage({
            type: "terrain_update",
            data: {
              terrain_data: newTerrainData,
              map_url: currentMapUrl,
            },
          });
        } catch (error) {
          logger.error("[TacticalMap] Failed to save terrain:", error);
        }
      }, 800);
    },
    [authedFetch, campaignId, currentMapUrl, isDM, sendMessage, setTerrainData],
  );

  return {
    handleTerrainUpdate,
  };
}
