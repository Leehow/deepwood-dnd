/**
 * useMapEvents Hook
 * Handles all user interaction events for the TacticalMap component
 */

import { useCallback, useEffect, useRef, MutableRefObject } from "react";
import type { Token, Ruler, Drawing, FogData, Position } from "../types/TacticalMapTypes";
import { getDistance, getCenter } from "../utils/mapCalculations";
import {
  createCircleDrawing,
  createSketchDrawing,
  createArrowDrawing,
  deleteDrawing,
} from "~/utils/drawingAPI";
import { apiFetch } from "~/utils/api-client";
import { createLogger } from '~/utils/logger';

const logger = createLogger('useMapEvents');

interface UseMapEventsProps {
  campaignId: string;
  currentMapUrl?: string | null;
  userId?: string;
  isDM: boolean;
  drawTool?: "circle" | "sketch" | "arrow" | "eraser" | null;

  // State setters
  setFogData: (data: FogData | null) => void;
  setRulers: (updater: (prev: Ruler[]) => Ruler[]) => void;
  setDrawings: (updater: (prev: Drawing[]) => Drawing[]) => void;
  setTokens: (updater: (prev: Token[]) => Token[]) => void;
  setEditingTokenId: (id: number | null) => void;
  setEditingTokenHP: (hp: number) => void;
  setEditingTokenMaxHP: (hp: number | null) => void;
  setStagePos: (pos: Position) => void;
  setStageScale: (scale: number) => void;

  // State values
  tokens: Token[];
  editingTokenId: number | null;
  editingTokenHP: number;
  editingTokenMaxHP: number | null;
  stagePos: Position;
  stageScale: number;
  stageSize: { width: number; height: number };

  // Refs
  stageRef: MutableRefObject<any>;
  lastDist: MutableRefObject<number>;
  lastCenter: MutableRefObject<{ x: number; y: number }>;

  // WebSocket
  sendMessage: (message: any) => void;
}

export function useMapEvents({
  campaignId,
  currentMapUrl,
  userId,
  isDM,
  drawTool,
  setFogData,
  setRulers,
  setDrawings,
  setTokens,
  setEditingTokenId,
  setEditingTokenHP,
  setEditingTokenMaxHP,
  setStagePos,
  setStageScale,
  tokens,
  editingTokenId,
  editingTokenHP,
  editingTokenMaxHP,
  stagePos,
  stageScale,
  stageSize,
  stageRef,
  lastDist,
  lastCenter,
  sendMessage,
}: UseMapEventsProps) {
  const authedFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    apiFetch(input, { ...init, userId });

  // Debounce timer for fog updates - batch network ops to reduce flickering on player side
  const fogDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const FOG_DEBOUNCE_MS = 800;

  // helper: broadcast HP change over WS for live sync between DM and players
  const broadcastHP = useCallback((tokenId: number, current: number, max: number | null) => {
    const t = tokens.find(tt => tt.id === tokenId);
    sendMessage({
      type: "token_hp_update",
      data: {
        token_id: tokenId,
        current_hp: current,
        ...(max !== null ? { max_hp: max } : {}),
        ...(t?.character_id ? { character_id: t.character_id } : {}),
      },
    });
  }, [sendMessage, tokens]);

  // ==================== Fog of War ====================
  const handleFogUpdate = useCallback(
    (newFogData: FogData) => {
      // Immediate local update for DM smooth rendering
      setFogData(newFogData);

      if (!campaignId || !isDM || !currentMapUrl) return;

      // Debounce DB save + WebSocket broadcast so players get one batched update
      // instead of per-cell updates which cause flickering
      if (fogDebounceTimer.current) {
        clearTimeout(fogDebounceTimer.current);
      }

      fogDebounceTimer.current = setTimeout(async () => {
        try {
          await authedFetch(`/api/campaigns/${campaignId}/fog-of-war`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(newFogData),
          });
          logger.debug("[useMapEvents] Fog data saved (batched)");

          sendMessage({
            type: "fog_update",
            data: {
              fog_data: newFogData,
              map_url: currentMapUrl,
            },
          });
          logger.debug("[useMapEvents] Fog update broadcasted (batched)");
        } catch (error) {
          logger.error("[useMapEvents] Failed to save fog data:", error);
        }
      }, FOG_DEBOUNCE_MS);
    },
    [campaignId, isDM, sendMessage, currentMapUrl, setFogData]
  );

  // ==================== Rulers ====================
  const handleRulerAdd = useCallback(
    async (ruler: Omit<Ruler, "id" | "campaign_id" | "map_url">) => {
      if (!campaignId || !currentMapUrl) return;

      try {
        // 保存到数据库
        const response = await authedFetch(`/api/campaigns/${campaignId}/rulers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...ruler,
            map_url: currentMapUrl,
          }),
        });

        if (response.ok) {
          const newRuler = await response.json();
          logger.debug("[useMapEvents] Ruler saved:", newRuler);

          // Optimistic update
          setRulers((prev) => [...prev, newRuler]);

          // 广播到所有客户端
          sendMessage({
            type: "ruler_added",
            data: {
              ruler: newRuler,
            },
          });
          logger.debug("[useMapEvents] Ruler added broadcasted via WebSocket");
        }
      } catch (error) {
        logger.error("[useMapEvents] Failed to save ruler:", error);
      }
    },
    [campaignId, currentMapUrl, isDM, sendMessage, setRulers]
  );

  const handleRulerRemove = useCallback(
    async (rulerId: number) => {
      if (!campaignId) return;

      try {
        // 从数据库删除
        const response = await authedFetch(`/api/campaigns/${campaignId}/rulers/${rulerId}`, {
          method: "DELETE",
        });

        if (response.ok) {
          logger.debug("[useMapEvents] Ruler removed:", rulerId);

          // Optimistic update
          setRulers((prev) => prev.filter((r) => r.id !== rulerId));

          // 广播到所有客户端
          sendMessage({
            type: "ruler_removed",
            data: {
              ruler_id: rulerId,
            },
          });
          logger.debug("[useMapEvents] Ruler removed broadcasted via WebSocket");
        }
      } catch (error) {
        logger.error("[useMapEvents] Failed to remove ruler:", error);
      }
    },
    [campaignId, isDM, sendMessage, setRulers]
  );

  // ==================== Drawings ====================
  const handleDrawingAdd = useCallback(
    async (drawingData: any) => {
      if (!campaignId || !currentMapUrl || !userId || !drawTool) return;

      try {
        let newDrawing;

        if (drawTool === "circle") {
          newDrawing = await createCircleDrawing(
            campaignId,
            currentMapUrl,
            userId,
            drawingData.center_x,
            drawingData.center_y,
            drawingData.radius,
            drawingData.color,
            drawingData.stroke_width
          );
        } else if (drawTool === "sketch") {
          newDrawing = await createSketchDrawing(
            campaignId,
            currentMapUrl,
            userId,
            drawingData.points,
            drawingData.color,
            drawingData.stroke_width
          );
        } else if (drawTool === "arrow") {
          newDrawing = await createArrowDrawing(
            campaignId,
            currentMapUrl,
            userId,
            drawingData.points,
            drawingData.color,
            drawingData.stroke_width
          );
        }

        if (newDrawing) {
          logger.debug("[useMapEvents] Drawing saved:", newDrawing);

          // Optimistic update
          setDrawings((prev) => [...prev, newDrawing]);

          // 广播到所有客户端
          sendMessage({
            type: "drawing_added",
            data: {
              drawing: newDrawing,
            },
          });
          logger.debug("[useMapEvents] Drawing added broadcasted via WebSocket");
        }
      } catch (error) {
        logger.error("[useMapEvents] Failed to save drawing:", error);
      }
    },
    [campaignId, currentMapUrl, userId, drawTool, sendMessage, setDrawings]
  );

  const handleDrawingRemove = useCallback(
    async (drawingId: number) => {
      if (!campaignId || !userId) return;

      try {
        const success = await deleteDrawing(campaignId, drawingId, userId);

        if (success) {
          logger.debug("[useMapEvents] Drawing removed:", drawingId);

          // 立即更新本地状态
          setDrawings((prev) => {
            const filtered = prev.filter((d) => d.id !== drawingId);
            logger.debug(`[useMapEvents] Local state updated: ${prev.length} -> ${filtered.length} drawings`);
            return filtered;
          });

          // 广播到所有客户端
          sendMessage({
            type: "drawing_removed",
            data: {
              drawing_id: drawingId,
            },
          });
          logger.debug("[useMapEvents] Drawing removed broadcasted via WebSocket");
        } else {
          logger.error("[useMapEvents] Failed to delete drawing from server");
        }
      } catch (error) {
        logger.error("[useMapEvents] Failed to remove drawing:", error);
      }
    },
    [campaignId, userId, sendMessage, setDrawings]
  );

  const handleUpdateHP = useCallback(
    async () => {
      if (editingTokenId === null) return;

      try {
        const resp = await authedFetch(`/api/tokens/${editingTokenId}/hp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ current_hp: editingTokenHP }), // DM can't modify max HP via this modal
        });

        if (resp.ok) {
          logger.debug(`[useMapEvents] Token ${editingTokenId} HP updated to ${editingTokenHP}`);
          // Optimistic update (only current_hp)
          setTokens((prev) => prev.map((t) => (t.id === editingTokenId ? { ...t, current_hp: editingTokenHP } : t)));
          // Broadcast to other clients for real-time sync (no max change)
          broadcastHP(editingTokenId, editingTokenHP, null);
          setEditingTokenId(null);
        } else {
          logger.error(`[useMapEvents] Failed to update token HP: ${resp.status}`);
          alert("更新HP失败");
        }
      } catch (err) {
        logger.error("[useMapEvents] Failed to update token HP:", err);
        alert("更新HP失败");
      }
    },
    [editingTokenId, editingTokenHP, editingTokenMaxHP, setTokens, setEditingTokenId]
  );

  const handleRemoveToken = useCallback(
    async (tokenIdToRemove?: number) => {
      const targetId = tokenIdToRemove ?? editingTokenId;
      if (targetId === null) return;

      try {
        const resp = await authedFetch(`/api/tokens/${targetId}`, {
          method: "DELETE",
        });

        if (resp.ok) {
          logger.debug(`[useMapEvents] Token ${targetId} removed`);
          // Optimistic update
          setTokens((prev) => prev.filter((t) => t.id !== targetId));
          if (targetId === editingTokenId) {
            setEditingTokenId(null);
          }
        } else {
          logger.error(`[useMapEvents] Failed to remove token: ${resp.status}`);
          alert("移除Token失败");
        }
      } catch (err) {
        logger.error("[useMapEvents] Failed to remove token:", err);
        alert("移除Token失败");
      }
    },
    [editingTokenId, setTokens, setEditingTokenId]
  );

  // ==================== Zoom & Touch ====================
  // Native touch handler (registered with { passive: false } to allow preventDefault)
  // Reads scale/position directly from Konva Stage to avoid stale closure values
  const handleNativeTouchMove = useCallback(
    (e: TouchEvent) => {
      const stage = stageRef.current;
      if (!stage) return;

      const touch1 = e.touches[0];
      const touch2 = e.touches[1];

      // Single finger - let child layers handle
      if (touch1 && !touch2) return;

      // Two fingers - pan + pinch zoom
      if (touch1 && touch2) {
        e.preventDefault();

        if (stage.isDragging()) {
          stage.stopDrag();
        }
        const p1 = { x: touch1.clientX, y: touch1.clientY };
        const p2 = { x: touch2.clientX, y: touch2.clientY };

        const newDist = getDistance(p1, p2);
        const newCenter = getCenter(p1, p2);

        if (lastDist.current === 0) {
          lastDist.current = newDist;
          lastCenter.current = newCenter;
          return;
        }

        const dx = newCenter.x - lastCenter.current.x;
        const dy = newCenter.y - lastCenter.current.y;
        const distRatio = newDist / lastDist.current;

        // Read actual values from Konva Stage (not from React state closure)
        const oldScale = stage.scaleX();
        const curPos = { x: stage.x(), y: stage.y() };

        const PINCH_THRESHOLD = 0.03;
        const isPinching = Math.abs(distRatio - 1) > PINCH_THRESHOLD;

        if (isPinching) {
          const newScale = Math.max(0.1, Math.min(5, distRatio * oldScale));

          const container = stage.container().getBoundingClientRect();
          const stagePointer = {
            x: newCenter.x - container.left,
            y: newCenter.y - container.top,
          };

          const mousePointTo = {
            x: (stagePointer.x - curPos.x) / oldScale,
            y: (stagePointer.y - curPos.y) / oldScale,
          };

          const newPos = {
            x: stagePointer.x - mousePointTo.x * newScale + dx,
            y: stagePointer.y - mousePointTo.y * newScale + dy,
          };

          setStageScale(newScale);
          setStagePos(newPos);
          lastDist.current = newDist;
        } else {
          setStagePos({
            x: curPos.x + dx,
            y: curPos.y + dy,
          });
        }

        lastCenter.current = newCenter;
      }
    },
    [stageRef, lastDist, lastCenter, setStageScale, setStagePos]
  );

  const handleNativeTouchEnd = useCallback(() => {
    lastDist.current = 0;
    lastCenter.current = { x: 0, y: 0 };
  }, [lastDist, lastCenter]);

  const handleWheel = useCallback(
    (e: any) => {
      e.evt.preventDefault();

      // Skip zoom when Ctrl+scroll is used for brush/eraser size adjustment
      if (e.evt.ctrlKey && (drawTool === "sketch" || drawTool === "arrow" || drawTool === "eraser")) {
        return;
      }

      const stage = stageRef.current;
      if (!stage) return;

      const oldScale = stage.scaleX();
      const pointer = stage.getPointerPosition();

      const mousePointTo = {
        x: (pointer.x - stage.x()) / oldScale,
        y: (pointer.y - stage.y()) / oldScale,
      };

      // 缩放范围：0.1x - 5x
      const scaleBy = 1.05;
      const newScale = e.evt.deltaY > 0 ? Math.max(0.1, oldScale / scaleBy) : Math.min(5, oldScale * scaleBy);

      setStageScale(newScale);

      const newPos = {
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale,
      };
      setStagePos(newPos);
    },
    [stageRef, setStageScale, setStagePos, drawTool]
  );

  const handleZoomIn = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = stageScale;
    const newScale = Math.min(5, oldScale * 1.2);

    // 以画布中心为缩放中心
    const center = {
      x: stageSize.width / 2,
      y: stageSize.height / 2,
    };

    const mousePointTo = {
      x: (center.x - stagePos.x) / oldScale,
      y: (center.y - stagePos.y) / oldScale,
    };

    setStageScale(newScale);

    const newPos = {
      x: center.x - mousePointTo.x * newScale,
      y: center.y - mousePointTo.y * newScale,
    };
    setStagePos(newPos);
  }, [stageRef, stageScale, stageSize, stagePos, setStageScale, setStagePos]);

  const handleZoomOut = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = stageScale;
    const newScale = Math.max(0.1, oldScale / 1.2);

    // 以画布中心为缩放中心
    const center = {
      x: stageSize.width / 2,
      y: stageSize.height / 2,
    };

    const mousePointTo = {
      x: (center.x - stagePos.x) / oldScale,
      y: (center.y - stagePos.y) / oldScale,
    };

    setStageScale(newScale);

    const newPos = {
      x: center.x - mousePointTo.x * newScale,
      y: center.y - mousePointTo.y * newScale,
    };
    setStagePos(newPos);
  }, [stageRef, stageScale, stageSize, stagePos, setStageScale, setStagePos]);

  const handleZoomReset = useCallback(() => {
    setStageScale(1);
    setStagePos({ x: 0, y: 0 });
  }, [setStageScale, setStagePos]);

  const handleZoomSet = useCallback((newScale: number) => {
    const stage = stageRef.current;
    if (!stage) {
      setStageScale(newScale);
      return;
    }
    const center = { x: stageSize.width / 2, y: stageSize.height / 2 };
    const mousePointTo = {
      x: (center.x - stagePos.x) / stageScale,
      y: (center.y - stagePos.y) / stageScale,
    };
    setStageScale(newScale);
    setStagePos({
      x: center.x - mousePointTo.x * newScale,
      y: center.y - mousePointTo.y * newScale,
    });
  }, [stageRef, stageScale, stageSize, stagePos, setStageScale, setStagePos]);

  return {
    // Fog of war
    handleFogUpdate,

    // Rulers
    handleRulerAdd,
    handleRulerRemove,

    // Drawings
    handleDrawingAdd,
    handleDrawingRemove,

    handleUpdateHP,
    handleRemoveToken,

    // Zoom & touch (native handlers for { passive: false } registration)
    handleNativeTouchMove,
    handleNativeTouchEnd,
    handleWheel,
    handleZoomIn,
    handleZoomOut,
    handleZoomReset,
    handleZoomSet,
  };
}
