/**
 * AIMapMarkerOverlay - Renders AI-generated map markers as percentage-based overlays
 * These markers are positioned using CSS percentages (x: "25%", y: "30%")
 * Markers are persisted to the database per campaign and map URL
 */

import { useState, useEffect } from 'react';
import { useModuleStore, type MapMarker } from '~/stores/moduleStore';

interface AIMapMarkerOverlayProps {
  // Campaign and map context for persistence
  campaignId?: number;
  mapUrl?: string;
  // Map image dimensions for proper scaling
  mapWidth: number;
  mapHeight: number;
  // Stage transform for viewport alignment
  stageScale: number;
  stageX: number;
  stageY: number;
}

export function AIMapMarkerOverlay({
  campaignId,
  mapUrl,
  mapWidth,
  mapHeight,
  stageScale,
  stageX,
  stageY,
}: AIMapMarkerOverlayProps) {
  const mapMarkers = useModuleStore(state => state.mapMarkers);
  const mapMarkersLoading = useModuleStore(state => state.mapMarkersLoading);
  const clearMapMarkers = useModuleStore(state => state.clearMapMarkers);
  const loadAIMapMarkers = useModuleStore(state => state.loadAIMapMarkers);
  const deleteAIMapMarkers = useModuleStore(state => state.deleteAIMapMarkers);
  const [hoveredMarker, setHoveredMarker] = useState<MapMarker | null>(null);

  // Load markers from database when campaign/map changes
  useEffect(() => {
    if (campaignId && mapUrl) {
      loadAIMapMarkers(campaignId, mapUrl);
    }
  }, [campaignId, mapUrl, loadAIMapMarkers]);

  // Handle clearing markers - delete from database
  const handleClearMarkers = () => {
    if (campaignId && mapUrl) {
      deleteAIMapMarkers(campaignId, mapUrl);
    } else {
      clearMapMarkers();
    }
  };

  if (mapMarkers.length === 0) return null;

  // Parse percentage value to number
  const parsePercent = (value: string): number => {
    const num = parseFloat(value.replace('%', ''));
    return isNaN(num) ? 0 : num;
  };

  return (
    <>
      {/* Marker overlay container - positioned relative to the map image */}
      <div
        className="absolute pointer-events-none"
        style={{
          left: stageX,
          top: stageY,
          width: mapWidth * stageScale,
          height: mapHeight * stageScale,
          transform: 'translate(0, 0)',
        }}
      >
        {mapMarkers.map((marker, index) => {
          const xPercent = parsePercent(marker.x);
          const yPercent = parsePercent(marker.y);

          // Extract number from label if it starts with "N." pattern (e.g., "2. 马厩" -> "2")
          const labelMatch = marker.label.match(/^(\d+)\./);
          const displayNumber = labelMatch ? labelMatch[1] : String(index + 1);

          return (
            <div
              key={`ai-marker-${index}`}
              className="absolute pointer-events-auto cursor-pointer group"
              style={{
                left: `${xPercent}%`,
                top: `${yPercent}%`,
                transform: 'translate(-50%, -50%)',
              }}
              onMouseEnter={() => setHoveredMarker(marker)}
              onMouseLeave={() => setHoveredMarker(null)}
            >
              {/* Marker pin */}
              <div className="relative">
                {/* Outer glow - only animate on hover to save GPU */}
                <div className="absolute inset-0 w-8 h-8 bg-amber-500/30 rounded-full group-hover:animate-ping" />

                {/* Main marker */}
                <div className="relative w-8 h-8 bg-gradient-to-br from-amber-500 to-orange-600 rounded-full flex items-center justify-center shadow-lg shadow-amber-900/50 border-2 border-amber-300/50 group-hover:scale-110 transition-transform">
                  <span className="text-white text-xs font-bold">{displayNumber}</span>
                </div>

                {/* Label */}
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 whitespace-nowrap">
                  <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-stone-900/90 text-amber-300 rounded border border-amber-700/50 shadow-lg">
                    {marker.label}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Tooltip for hovered marker */}
      {hoveredMarker && (
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{
            left: stageX + (mapWidth * stageScale * parsePercent(hoveredMarker.x)) / 100 + 20,
            top: stageY + (mapHeight * stageScale * parsePercent(hoveredMarker.y)) / 100 - 10,
          }}
        >
          <div className="max-w-xs p-3 bg-stone-900/95 rounded-lg border border-amber-600/50 shadow-xl">
            <div className="font-semibold text-amber-300 mb-1">{hoveredMarker.label}</div>
            <div className="text-sm text-stone-300">{hoveredMarker.content}</div>
          </div>
        </div>
      )}

      {/* Clear markers button */}
      <div className="absolute top-2 right-2 z-50">
        <button
          onClick={handleClearMarkers}
          className="px-3 py-1.5 text-xs bg-stone-800/90 hover:bg-stone-700/90 text-amber-300 rounded-lg border border-amber-700/50 shadow-lg transition-colors flex items-center gap-1.5"
          title="清除AI标记"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          清除标记 ({mapMarkers.length})
        </button>
      </div>
    </>
  );
}
