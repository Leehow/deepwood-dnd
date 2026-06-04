import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";

import { GRID_SIZE } from "../types/TacticalMapTypes";
import { createLogger } from "~/utils/logger";

const logger = createLogger("useMapViewStateController");

type StagePosition = { x: number; y: number };
type StageSize = { width: number; height: number };

interface UseMapViewStateControllerArgs {
  containerRef: RefObject<HTMLDivElement | null>;
  stagePos: StagePosition;
  stageScale: number;
  stageSize: StageSize;
  setStageSize: (size: StageSize) => void;
  minimapCollapsed: boolean;
  currentMapUrl?: string | null;
  campaignId: string;
  userId?: string | null;
  viewStateLoadedRef: MutableRefObject<boolean>;
  saveViewStateTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  authedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export function useMapViewStateController({
  containerRef,
  stagePos,
  stageScale,
  stageSize,
  setStageSize,
  minimapCollapsed,
  currentMapUrl,
  campaignId,
  userId,
  viewStateLoadedRef,
  saveViewStateTimerRef,
  authedFetch,
}: UseMapViewStateControllerArgs) {
  const pendingViewStateRef = useRef({
    stagePos,
    stageScale,
    minimapCollapsed,
    currentMapUrl,
    campaignId,
    userId,
  });

  pendingViewStateRef.current = {
    stagePos,
    stageScale,
    minimapCollapsed,
    currentMapUrl,
    campaignId,
    userId,
  };

  useEffect(() => {
    (window as any).__getViewportCenterGridPosition = () => {
      const viewportCenterX = stageSize.width / 2;
      const viewportCenterY = stageSize.height / 2;
      const mapX = (viewportCenterX - stagePos.x) / stageScale;
      const mapY = (viewportCenterY - stagePos.y) / stageScale;
      const gridX = Math.floor(mapX / GRID_SIZE);
      const gridY = Math.floor(mapY / GRID_SIZE);
      return { x: gridX, y: gridY };
    };

    return () => {
      delete (window as any).__getViewportCenterGridPosition;
    };
  }, [stagePos, stageScale, stageSize]);

  useEffect(() => {
    (window as any).__getCurrentMapUrl = () => currentMapUrl;
    return () => {
      delete (window as any).__getCurrentMapUrl;
    };
  }, [currentMapUrl]);

  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const width = Math.max(rect.width, 400);
      const height = Math.max(rect.height, 300);
      setStageSize({ width, height });
    };

    const timer = setTimeout(handleResize, 100);
    window.addEventListener("resize", handleResize);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", handleResize);
    };
  }, [containerRef, setStageSize]);

  useEffect(() => {
    if (!viewStateLoadedRef.current) return;

    if (saveViewStateTimerRef.current) {
      clearTimeout(saveViewStateTimerRef.current);
    }

    saveViewStateTimerRef.current = setTimeout(async () => {
      if (!currentMapUrl || !campaignId || !userId) {
        return;
      }

      try {
        const response = await authedFetch(
          `/api/map-view-state/${campaignId}/me?map_url=${encodeURIComponent(currentMapUrl)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              position_x: stagePos.x,
              position_y: stagePos.y,
              scale: stageScale,
              minimap_collapsed: minimapCollapsed,
            }),
          },
        );
        if (!response.ok) {
          logger.error("[TacticalMap] Failed to save view state, status:", response.status);
        }
      } catch (error) {
        logger.error("[TacticalMap] Failed to save view state:", error);
      }
    }, 1000);

    return () => {
      if (saveViewStateTimerRef.current) {
        clearTimeout(saveViewStateTimerRef.current);
      }
    };
  }, [
    authedFetch,
    campaignId,
    currentMapUrl,
    minimapCollapsed,
    saveViewStateTimerRef,
    stagePos,
    stageScale,
    userId,
    viewStateLoadedRef,
  ]);

  useEffect(() => {
    const flushViewState = () => {
      const {
        stagePos: pos,
        stageScale: scale,
        minimapCollapsed: minimapState,
        currentMapUrl: mapUrl,
        campaignId: campaign,
        userId: user,
      } = pendingViewStateRef.current;

      if (!mapUrl || !campaign || !user || !viewStateLoadedRef.current) return;

      const url = `/api/map-view-state/${campaign}/me?map_url=${encodeURIComponent(mapUrl)}`;
      const body = JSON.stringify({
        position_x: pos.x,
        position_y: pos.y,
        scale,
        minimap_collapsed: minimapState,
      });

      void authedFetch(url, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body,
      });
    };

    window.addEventListener("beforeunload", flushViewState);
    window.addEventListener("pagehide", flushViewState);
    return () => {
      window.removeEventListener("beforeunload", flushViewState);
      window.removeEventListener("pagehide", flushViewState);
    };
  }, [authedFetch, viewStateLoadedRef]);
}
