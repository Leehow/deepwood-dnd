import React, { useMemo } from "react";
import { Group, Rect } from "react-konva";

interface MovementRangeOverlayProps {
  tokenX: number;
  tokenY: number;
  tokenSize: string;
  movementFeet: number;
  gridSize: number;
  gridUnitLength: number;
}

/** Parse token_size like "1x1", "2x2", "3x3" into width/height in grid cells */
function parseSize(size: string): [number, number] {
  const m = size.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
  if (!m) return [1, 1];
  return [Math.max(1, Math.round(parseFloat(m[1]))), Math.max(1, Math.round(parseFloat(m[2])))];
}

/**
 * Renders green translucent grid squares showing a token's movement range.
 * Uses Chebyshev distance (D&D 5E standard: diagonal = same cost as orthogonal).
 * Returns a <Group> (not a <Layer>) — the parent must provide an always-rendered <Layer>.
 */
export function MovementRangeOverlay({
  tokenX,
  tokenY,
  tokenSize,
  movementFeet,
  gridSize,
  gridUnitLength,
}: MovementRangeOverlayProps) {
  const cells = useMemo(() => {
    if (movementFeet <= 0 || gridUnitLength <= 0) return [];

    const rangeInGrids = Math.floor(movementFeet / gridUnitLength);
    if (rangeInGrids <= 0) return [];

    const [tw, th] = parseSize(tokenSize);
    const occupied = new Set<string>();
    for (let ox = 0; ox < tw; ox++) {
      for (let oy = 0; oy < th; oy++) {
        occupied.add(`${tokenX + ox},${tokenY + oy}`);
      }
    }

    const result: { x: number; y: number }[] = [];
    const minX = tokenX - rangeInGrids;
    const maxX = tokenX + tw - 1 + rangeInGrids;
    const minY = tokenY - rangeInGrids;
    const maxY = tokenY + th - 1 + rangeInGrids;

    for (let gx = minX; gx <= maxX; gx++) {
      for (let gy = minY; gy <= maxY; gy++) {
        if (occupied.has(`${gx},${gy}`)) continue;
        let minDist = Infinity;
        for (let ox = 0; ox < tw; ox++) {
          for (let oy = 0; oy < th; oy++) {
            const dist = Math.max(Math.abs(gx - (tokenX + ox)), Math.abs(gy - (tokenY + oy)));
            if (dist < minDist) minDist = dist;
          }
        }
        if (minDist <= rangeInGrids) {
          result.push({ x: gx, y: gy });
        }
      }
    }
    return result;
  }, [tokenX, tokenY, tokenSize, movementFeet, gridSize, gridUnitLength]);

  if (cells.length === 0) return null;

  return (
    <Group listening={false}>
      {cells.map((c) => (
        <Rect
          key={`mr-${c.x}-${c.y}`}
          x={c.x * gridSize}
          y={c.y * gridSize}
          width={gridSize}
          height={gridSize}
          fill="rgba(34,197,94,0.2)"
          stroke="rgba(34,197,94,0.45)"
          strokeWidth={1}
          listening={false}
        />
      ))}
    </Group>
  );
}
