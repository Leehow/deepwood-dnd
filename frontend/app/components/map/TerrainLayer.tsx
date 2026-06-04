/**
 * TerrainLayer - Konva Layer rendering terrain cells
 * Inserted between grid and aura layers, visible to all players
 */

import React, { useMemo } from "react";
import { Rect, Text as KonvaText } from "react-konva";
import type { TerrainData, TerrainType } from "./TerrainManager";
import { TERRAIN_TYPE_MAP } from "./TerrainManager";

interface TerrainLayerProps {
  terrainData: TerrainData | null;
  gridSize: number;
  stageScale: number;
}

/** Get render style for each terrain type */
function getTerrainStyle(type: TerrainType): { fill: string; strokeColor?: string; strokeDash?: number[] } {
  const config = TERRAIN_TYPE_MAP.get(type);
  if (!config) return { fill: "rgba(128,128,128,0.3)" };

  const { color, opacity } = config;
  // Convert hex + opacity to rgba
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const fill = `rgba(${r},${g},${b},${opacity})`;

  // Cover types use border instead of fill
  if (type === "half_cover") {
    return { fill: `rgba(${r},${g},${b},0.15)`, strokeColor: `rgba(${r},${g},${b},0.7)`, strokeDash: [4, 4] };
  }
  if (type === "three_quarter_cover") {
    return { fill: `rgba(${r},${g},${b},0.2)`, strokeColor: `rgba(${r},${g},${b},0.8)` };
  }

  return { fill };
}

export const TerrainLayer = React.memo(function TerrainLayer({
  terrainData,
  gridSize,
  stageScale,
}: TerrainLayerProps) {
  const cells = useMemo(() => {
    if (!terrainData?.cells?.length) return [];
    return terrainData.cells;
  }, [terrainData]);

  // Don't render empty layer
  if (cells.length === 0) return null;

  // Calculate icon font size based on grid size
  const iconSize = Math.max(10, gridSize * 0.35);

  return (
    <>
      {cells.map((cell) => {
        const style = getTerrainStyle(cell.type);
        const config = TERRAIN_TYPE_MAP.get(cell.type);
        const key = `${cell.x},${cell.y}`;

        return (
          <React.Fragment key={key}>
            <Rect
              x={cell.x * gridSize}
              y={cell.y * gridSize}
              width={gridSize}
              height={gridSize}
              fill={style.fill}
              stroke={style.strokeColor}
              strokeWidth={style.strokeColor ? 2 / stageScale : 0}
              dash={style.strokeDash}
              perfectDrawDisabled
            />
            {config && stageScale > 0.4 && (
              <KonvaText
                x={cell.x * gridSize + 2}
                y={cell.y * gridSize + 2}
                text={config.icon}
                fontSize={iconSize}
                listening={false}
                perfectDrawDisabled
              />
            )}
          </React.Fragment>
        );
      })}
    </>
  );
});
