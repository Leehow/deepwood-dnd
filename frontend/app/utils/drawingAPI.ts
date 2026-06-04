/**
 * Drawing API and state management utilities
 */
import { apiFetch } from "~/utils/api-client";
import { createLogger } from "~/utils/logger";

const logger = createLogger("drawingAPI");

export interface DrawingData {
  id: number;
  type: "ruler" | "circle" | "sketch" | "arrow";
  created_by_user_id: string;
  start_x?: number;
  start_y?: number;
  end_x?: number;
  end_y?: number;
  distance?: number;
  center_x?: number;
  center_y?: number;
  radius?: number;
  points?: Array<{ x: number; y: number }>;
  color: string;
  stroke_color: string;
  fill_color?: string;
  stroke_width: number;
}

/**
 * Load drawings for a specific map from the API
 */
export async function loadDrawings(
  campaignId: string,
  mapUrl: string
): Promise<DrawingData[]> {
  try {
    const response = await apiFetch(
      `/api/campaigns/${campaignId}/drawings?map_url=${encodeURIComponent(mapUrl)}`
    );
    if (response.ok) {
      return await response.json();
    }
    return [];
  } catch (error) {
    logger.error("[Drawing] Failed to load drawings:", error);
    return [];
  }
}

/**
 * Create a circle drawing
 */
export async function createCircleDrawing(
  campaignId: string,
  mapUrl: string,
  userId: string,
  centerX: number,
  centerY: number,
  radius: number,
  color: string,
  strokeWidth: number = 2
): Promise<DrawingData | null> {
  try {
    const response = await apiFetch(
      `/api/campaigns/${campaignId}/drawings/circle`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          map_url: mapUrl,
          center_x: centerX,
          center_y: centerY,
          radius,
          color,
          stroke_width: strokeWidth,
        }),
        userId,
      }
    );
    if (response.ok) {
      return await response.json();
    }
    return null;
  } catch (error) {
    logger.error("[Drawing] Failed to create circle:", error);
    return null;
  }
}

/**
 * Create a sketch (freehand) drawing
 */
export async function createSketchDrawing(
  campaignId: string,
  mapUrl: string,
  userId: string,
  points: Array<{ x: number; y: number }>,
  color: string,
  strokeWidth: number = 2
): Promise<DrawingData | null> {
  try {
    const response = await apiFetch(
      `/api/campaigns/${campaignId}/drawings/sketch`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          map_url: mapUrl,
          points,
          color,
          stroke_width: strokeWidth,
        }),
        userId,
      }
    );
    if (response.ok) {
      return await response.json();
    }
    return null;
  } catch (error) {
    logger.error("[Drawing] Failed to create sketch:", error);
    return null;
  }
}

/**
 * Create an arrow drawing
 */
export async function createArrowDrawing(
  campaignId: string,
  mapUrl: string,
  userId: string,
  points: Array<{ x: number; y: number }>,
  color: string,
  strokeWidth: number = 2
): Promise<DrawingData | null> {
  try {
    const response = await apiFetch(
      `/api/campaigns/${campaignId}/drawings/arrow`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          map_url: mapUrl,
          points,
          color,
          stroke_width: strokeWidth,
        }),
        userId,
      }
    );
    if (response.ok) {
      return await response.json();
    }
    return null;
  } catch (error) {
    logger.error("[Drawing] Failed to create arrow:", error);
    return null;
  }
}

/**
 * Delete a drawing
 */
export async function deleteDrawing(
  campaignId: string,
  drawingId: number,
  userId: string
): Promise<boolean> {
  try {
    const response = await apiFetch(
      `/api/campaigns/${campaignId}/drawings/${drawingId}`,
      {
        method: "DELETE",
        userId,
      }
    );
    return response.ok;
  } catch (error) {
    logger.error("[Drawing] Failed to delete drawing:", error);
    return false;
  }
}

/**
 * Clear all drawings for a map
 */
export async function clearAllDrawings(
  campaignId: string,
  mapUrl: string
): Promise<boolean> {
  try {
    const response = await apiFetch(
      `/api/campaigns/${campaignId}/drawings?map_url=${encodeURIComponent(mapUrl)}`,
      {
        method: "DELETE",
      }
    );
    return response.ok;
  } catch (error) {
    logger.error("[Drawing] Failed to clear drawings:", error);
    return false;
  }
}

/**
 * Handle drawing WebSocket messages and update state
 * IMPORTANT: Uses functional updates to avoid stale closure issues
 */
export function handleDrawingWebSocketMessage(
  message: any,
  currentMapUrl: string,
  userId: string,
  isDM: boolean,
  setDrawings: (updater: (prev: DrawingData[]) => DrawingData[]) => void
): void {
  const messageUserId = message?.data?.user_id;

  if (message.type === "drawing_added") {
    const data = message.data;
    const { drawing } = data || {};
    if (drawing && drawing.map_url === currentMapUrl) {
      logger.debug(`[Drawing] Drawing added from user ${messageUserId}`);
      setDrawings((prev) => [...prev, drawing]);
    }
  } else if (message.type === "drawing_updated") {
    const data = message.data;
    const { drawing_id, ...updates } = data || {};
    if (drawing_id) {
      logger.debug(`[Drawing] Drawing updated from user ${messageUserId}:`, drawing_id);
      setDrawings((prev) =>
        prev.map((d) => (d.id === drawing_id ? { ...d, ...updates } : d))
      );
    }
  } else if (message.type === "drawing_removed") {
    const data = message.data;
    const { drawing_id } = data || {};
    if (drawing_id) {
      // 忽略自己发送的删除消息（本地状态已在 handleDrawingRemove 中更新）
      if (messageUserId === userId) {
        logger.debug(`[Drawing] Ignoring own drawing_removed message for ${drawing_id}`);
        return;
      }

      logger.debug(`[Drawing] Drawing removed from user ${messageUserId}:`, drawing_id);
      setDrawings((prev) => {
        const filtered = prev.filter((d) => d.id !== drawing_id);
        logger.debug(`[Drawing] Removed drawing ${drawing_id}, before: ${prev.length}, after: ${filtered.length}`);
        return filtered;
      });
    }
  } else if (message.type === "drawings_cleared") {
    const data = message.data;
		const { map_url } = data || {};
		if (map_url === currentMapUrl) {
      logger.debug(`[Drawing] Drawings cleared from user ${messageUserId}`);
      setDrawings(() => []);
    }
  }
}
