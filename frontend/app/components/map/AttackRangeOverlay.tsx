import React, { useMemo } from "react";
import { Rect } from "react-konva";

interface AttackRangeOverlayProps {
  tokenX: number;
  tokenY: number;
  tokenSize: string;
  normalRangeFeet: number;
  maxRangeFeet: number;
  gridSize: number;
  gridUnitLength: number;
}

/** Parse token_size like "1x1", "2x2", "3x3" into width/height in grid cells */
function parseSize(size: string): [number, number] {
  const m = size.match(/(\d+)x(\d+)/);
  return m ? [parseInt(m[1]), parseInt(m[2])] : [1, 1];
}

/**
 * Renders colored translucent grid squares showing a token's attack range.
 * - Red/warm color for normal range (no penalty)
 * - Yellow for long range (disadvantage for ranged)
 * Uses Chebyshev distance (D&D 5E standard).
 */
export function AttackRangeOverlay({
  tokenX,
  tokenY,
  tokenSize,
  normalRangeFeet,
  maxRangeFeet,
  gridSize,
  gridUnitLength,
}: AttackRangeOverlayProps) {
  const { normalCells, longCells } = useMemo(() => {
    if (maxRangeFeet <= 0 || gridUnitLength <= 0) return { normalCells: [], longCells: [] };

    const normalGrids = Math.floor(normalRangeFeet / gridUnitLength);
    const maxGrids = Math.floor(maxRangeFeet / gridUnitLength);
    if (maxGrids <= 0) return { normalCells: [], longCells: [] };

    const [tw, th] = parseSize(tokenSize);
    const occupied = new Set<string>();
    for (let ox = 0; ox < tw; ox++) {
      for (let oy = 0; oy < th; oy++) {
        occupied.add(`${tokenX + ox},${tokenY + oy}`);
      }
    }

    const normal: { x: number; y: number }[] = [];
    const long: { x: number; y: number }[] = [];

    const minX = tokenX - maxGrids;
    const maxX = tokenX + tw - 1 + maxGrids;
    const minY = tokenY - maxGrids;
    const maxY = tokenY + th - 1 + maxGrids;

    for (let gx = minX; gx <= maxX; gx++) {
      for (let gy = minY; gy <= maxY; gy++) {
        if (occupied.has(`${gx},${gy}`)) continue;
        // Chebyshev distance from nearest occupied cell edge
        let minDist = Infinity;
        for (let ox = 0; ox < tw; ox++) {
          for (let oy = 0; oy < th; oy++) {
            const dist = Math.max(Math.abs(gx - (tokenX + ox)), Math.abs(gy - (tokenY + oy)));
            if (dist < minDist) minDist = dist;
          }
        }
        if (minDist <= normalGrids) {
          normal.push({ x: gx, y: gy });
        } else if (minDist <= maxGrids) {
          long.push({ x: gx, y: gy });
        }
      }
    }
    return { normalCells: normal, longCells: long };
  }, [tokenX, tokenY, tokenSize, normalRangeFeet, maxRangeFeet, gridSize, gridUnitLength]);

  if (normalCells.length === 0 && longCells.length === 0) return null;

  return (
    <>
      {/* Normal range - red */}
      {normalCells.map((c) => (
        <Rect
          key={`ar-n-${c.x}-${c.y}`}
          x={c.x * gridSize}
          y={c.y * gridSize}
          width={gridSize}
          height={gridSize}
          fill="rgba(239,68,68,0.18)"
          stroke="rgba(239,68,68,0.4)"
          strokeWidth={1}
          listening={false}
        />
      ))}
      {/* Long range (disadvantage) - yellow */}
      {longCells.map((c) => (
        <Rect
          key={`ar-l-${c.x}-${c.y}`}
          x={c.x * gridSize}
          y={c.y * gridSize}
          width={gridSize}
          height={gridSize}
          fill="rgba(234,179,8,0.15)"
          stroke="rgba(234,179,8,0.35)"
          strokeWidth={1}
          listening={false}
        />
      ))}
    </>
  );
}
