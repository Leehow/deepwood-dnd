/**
 * AuraLayer - Renders aura circles for tokens with active auras
 * Displays below tokens but above the grid layer
 */
import React from 'react';
import { Circle, Text } from 'react-konva';
import type { Token, AuraVisual } from './types/TacticalMapTypes';
import { GRID_SIZE } from './types/TacticalMapTypes';
import { getAuraPresentation } from './utils/auraPresentation';

interface AuraLayerProps {
  tokens: Token[];
  auraVisuals: AuraVisual[];
  gridSize?: number;
  stageScale?: number;
}

// Parse token size string (e.g., "2x2") to width/height
function parseTokenSize(sizeStr: string | undefined): { width: number; height: number } {
  if (!sizeStr) return { width: 1, height: 1 };
  const parts = sizeStr.split('x');
  return {
    width: parseInt(parts[0]) || 1,
    height: parseInt(parts[1]) || parseInt(parts[0]) || 1,
  };
}

// Convert feet to pixels (5ft = 1 grid = GRID_SIZE pixels)
function feetToPixels(feet: number, gridSize: number = GRID_SIZE): number {
  return (feet / 5) * gridSize;
}

// Get token center position in pixels
function getTokenCenter(token: Token, gridSize: number = GRID_SIZE): { x: number; y: number } {
  const size = parseTokenSize(token.token_size);
  return {
    x: (token.position_x + Math.max(size.width, 1) / 2) * gridSize,
    y: (token.position_y + Math.max(size.height, 1) / 2) * gridSize,
  };
}

export const AuraLayer = React.memo(function AuraLayer({
  tokens,
  auraVisuals,
  gridSize = GRID_SIZE,
  stageScale = 1,
}: AuraLayerProps) {
  // Build a map of token_id -> token for quick lookup
  const tokenMap = React.useMemo(() => {
    const map: Record<number, Token> = {};
    for (const token of tokens) {
      map[token.id] = token;
    }
    return map;
  }, [tokens]);

  // Render auras from auraVisuals (computed by backend)
  const auraElements = React.useMemo(() => {
    const elements: React.ReactNode[] = [];

    for (const aura of auraVisuals) {
      const sourceToken = tokenMap[aura.source_token_id];
      if (!sourceToken) continue;

      const center = getTokenCenter(sourceToken, gridSize);
      const radiusPixels = feetToPixels(aura.radius, gridSize);
      const presentation = getAuraPresentation(aura);

      // Main aura circle with fill
      elements.push(
        <Circle
          key={`aura-fill-${aura.source_token_id}-${aura.aura_id}`}
          x={center.x}
          y={center.y}
          radius={radiusPixels}
          fill={presentation.fillColor}
          listening={false}
        />
      );

      // Aura border (dashed)
      elements.push(
        <Circle
          key={`aura-border-${aura.source_token_id}-${aura.aura_id}`}
          x={center.x}
          y={center.y}
          radius={radiusPixels}
          stroke={presentation.color}
          strokeWidth={2 / stageScale}
          dash={[8 / stageScale, 4 / stageScale]}
          listening={false}
        />
      );

      // Aura icon at the edge (top)
      const iconY = center.y - radiusPixels - 12 / stageScale;
      elements.push(
        <Text
          key={`aura-icon-${aura.source_token_id}-${aura.aura_id}`}
          x={center.x - 10 / stageScale}
          y={iconY}
          text={presentation.icon}
          fontSize={16 / stageScale}
          listening={false}
        />
      );
    }

    return elements;
  }, [auraVisuals, tokenMap, gridSize, stageScale]);

  // Also render auras directly from token.active_auras (fallback when no WebSocket update yet)
  const localAuraElements = React.useMemo(() => {
    const elements: React.ReactNode[] = [];

    // If we have auraVisuals from WebSocket, skip local rendering to avoid duplicates
    if (auraVisuals.length > 0) return elements;

    for (const token of tokens) {
      if (!token.active_auras || token.active_auras.length === 0) continue;

      const center = getTokenCenter(token, gridSize);

      for (const aura of token.active_auras) {
        if (!aura.enabled) continue;

        const radiusPixels = feetToPixels(aura.radius, gridSize);
        const presentation = getAuraPresentation(aura);

        // Main aura circle
        elements.push(
          <Circle
            key={`local-aura-fill-${token.id}-${aura.id}`}
            x={center.x}
            y={center.y}
            radius={radiusPixels}
            fill={presentation.fillColor}
            listening={false}
          />
        );

        // Aura border
        elements.push(
          <Circle
            key={`local-aura-border-${token.id}-${aura.id}`}
            x={center.x}
            y={center.y}
            radius={radiusPixels}
            stroke={presentation.color}
            strokeWidth={2 / stageScale}
            dash={[8 / stageScale, 4 / stageScale]}
            listening={false}
          />
        );

        // Icon
        const iconY = center.y - radiusPixels - 12 / stageScale;
        elements.push(
          <Text
            key={`local-aura-icon-${token.id}-${aura.id}`}
            x={center.x - 10 / stageScale}
            y={iconY}
            text={presentation.icon}
            fontSize={16 / stageScale}
            listening={false}
          />
        );
      }
    }

    return elements;
  }, [tokens, auraVisuals.length, gridSize, stageScale]);

  return (
    <>
      {auraElements}
      {localAuraElements}
    </>
  );
});

AuraLayer.displayName = "AuraLayer";

export default AuraLayer;
