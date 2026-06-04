import { useCallback, useState } from "react";

import { createLogger } from "~/utils/logger";

const logger = createLogger("useMapMarkerController");

type ShowToastFn = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

interface UseMapMarkerControllerArgs {
  isDM: boolean;
  campaignId: string;
  currentMapUrl?: string | null;
  markerIcon: string;
  markerColor: string;
  authedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  setMarkers: (updater: (prev: any[]) => any[]) => void;
  showToast: ShowToastFn;
}

export function useMapMarkerController({
  isDM,
  campaignId,
  currentMapUrl,
  markerIcon,
  markerColor,
  authedFetch,
  setMarkers,
  showToast,
}: UseMapMarkerControllerArgs) {
  const [selectedMarkerId, setSelectedMarkerId] = useState<number | null>(null);
  const [pendingMarkerPos, setPendingMarkerPos] = useState<{ x: number; y: number } | null>(null);
  const [markerLabelInput, setMarkerLabelInput] = useState("");
  const [showMarkerDialog, setShowMarkerDialog] = useState(false);

  const handleMarkerClick = useCallback((marker: { id: number }) => {
    if (!isDM) return;
    setSelectedMarkerId((previous) => (previous === marker.id ? null : marker.id));
  }, [isDM]);

  const handleCreateMarker = useCallback(async () => {
    if (!pendingMarkerPos || !markerLabelInput.trim() || !currentMapUrl) return;

    try {
      const response = await authedFetch(`/api/campaigns/${campaignId}/markers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          map_url: currentMapUrl,
          position_x: pendingMarkerPos.x,
          position_y: pendingMarkerPos.y,
          icon: markerIcon,
          label: markerLabelInput.trim(),
          color: markerColor,
          visible_to_players: 1,
        }),
      });

      if (response.ok) {
        const newMarker = await response.json();
        setMarkers((previous) => [...previous, newMarker]);
        showToast(`标记 "${newMarker.label}" 已创建`, "success");
      }
    } catch (error) {
      logger.error("[TacticalMap] Failed to create marker:", error);
      showToast("创建标记失败", "error");
    }

    setShowMarkerDialog(false);
    setPendingMarkerPos(null);
    setMarkerLabelInput("");
  }, [
    authedFetch,
    campaignId,
    currentMapUrl,
    markerColor,
    markerIcon,
    markerLabelInput,
    pendingMarkerPos,
    setMarkers,
    showToast,
  ]);

  const handleDeleteMarker = useCallback(async () => {
    if (!selectedMarkerId) return;

    try {
      const response = await authedFetch(`/api/campaigns/${campaignId}/markers/${selectedMarkerId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        setMarkers((previous) => previous.filter((marker) => marker.id !== selectedMarkerId));
        setSelectedMarkerId(null);
        showToast("标记已删除", "success");
      }
    } catch (error) {
      logger.error("[TacticalMap] Failed to delete marker:", error);
      showToast("删除标记失败", "error");
    }
  }, [authedFetch, campaignId, selectedMarkerId, setMarkers, showToast]);

  return {
    handleCreateMarker,
    handleDeleteMarker,
    handleMarkerClick,
    markerLabelInput,
    pendingMarkerPos,
    selectedMarkerId,
    setMarkerLabelInput,
    setPendingMarkerPos,
    setSelectedMarkerId,
    setShowMarkerDialog,
    showMarkerDialog,
  };
}
