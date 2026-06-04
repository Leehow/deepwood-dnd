/**
 * MapGrid Component
 * Renders only the visible portion of the grid overlay (viewport culling)
 */

import React, { useMemo } from "react";
import { Line } from "react-konva";
import { GRID_SIZE, MAP_WIDTH, MAP_HEIGHT } from "./types/TacticalMapTypes";


interface MapGridProps {
  showGrid: boolean;
  mapImage: HTMLImageElement | null;
  mapImageScale: number;
  /** Viewport bounds in canvas pixels for culling (optional — renders all if omitted) */
  viewportBounds?: { left: number; top: number; right: number; bottom: number };
}

export const MapGrid = React.memo(function MapGrid({ showGrid, mapImage, mapImageScale, viewportBounds }: MapGridProps) {
  const mapDisplayWidth = mapImage ? mapImage.width * mapImageScale : MAP_WIDTH * GRID_SIZE;
  const mapDisplayHeight = mapImage ? mapImage.height * mapImageScale : MAP_HEIGHT * GRID_SIZE;

  const lines = useMemo(() => {
    if (!showGrid) return null;

    const totalCols = Math.ceil(mapDisplayWidth / GRID_SIZE);
    const totalRows = Math.ceil(mapDisplayHeight / GRID_SIZE);

    // Compute visible range (clamp to map bounds)
    let startCol = 0, endCol = totalCols;
    let startRow = 0, endRow = totalRows;

    if (viewportBounds) {
      startCol = Math.max(0, Math.floor(viewportBounds.left / GRID_SIZE));
      endCol = Math.min(totalCols, Math.ceil(viewportBounds.right / GRID_SIZE));
      startRow = Math.max(0, Math.floor(viewportBounds.top / GRID_SIZE));
      endRow = Math.min(totalRows, Math.ceil(viewportBounds.bottom / GRID_SIZE));
    }

    // Clamp line endpoints to map bounds
    const yTop = startRow * GRID_SIZE;
    const yBot = Math.min(endRow * GRID_SIZE, mapDisplayHeight);
    const xLeft = startCol * GRID_SIZE;
    const xRight = Math.min(endCol * GRID_SIZE, mapDisplayWidth);

    const result = [];

    // 垂直线
    for (let i = startCol; i <= endCol; i++) {
      const x = i * GRID_SIZE;
      if (x > mapDisplayWidth) break;
      result.push(
        <Line key={`v-${i}`} points={[x, yTop, x, yBot]} stroke="#374151" strokeWidth={1} />
      );
    }

    // 水平线
    for (let i = startRow; i <= endRow; i++) {
      const y = i * GRID_SIZE;
      if (y > mapDisplayHeight) break;
      result.push(
        <Line key={`h-${i}`} points={[xLeft, y, xRight, y]} stroke="#374151" strokeWidth={1} />
      );
    }

    return result;
  }, [showGrid, mapDisplayWidth, mapDisplayHeight, viewportBounds]);

  if (!lines) return null;

  return <>{lines}</>;
});
