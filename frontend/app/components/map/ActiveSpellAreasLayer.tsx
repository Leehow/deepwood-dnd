/**
 * ActiveSpellAreasLayer - Renders persistent spell area effects from concentration spells
 * Shows areas like Fog Cloud, Darkness, Entangle on the map while caster maintains concentration
 * Includes a tether line connecting the caster to the spell area
 * DM can drag the entire spell area (like tokens) to reposition
 */
import React, { useEffect, useRef, useMemo, useCallback } from "react";
import { Group, Circle, Rect, Wedge, Text, Line } from "react-konva";
import type Konva from "konva";
import type { Token, SpellAreaEffect } from "./types/TacticalMapTypes";
import { isExpiredByWorldTime } from "./utils/runtimeSpellBadgeStatusUtils";

interface ActiveSpellArea extends SpellAreaEffect {
  tokenId: number;
  tokenName: string;
  spellId: string;
  spellName: string;
  casterX: number;
  casterY: number;
  casterSizeW: number;
  casterSizeH: number;
  casterUserId?: string | null;
}

interface ActiveSpellAreasLayerProps {
  tokens: Token[];
  gridSize: number;
  gridUnitLength: number;
  currentMapUrl: string | null | undefined;
  currentWorldTime?: { day?: number | null; hour?: number | null; minute?: number | null; second?: number | null } | null;
  isDM?: boolean;
  userId?: string | null;
  onMoveArea?: (tokenId: number, newCenterX: number, newCenterY: number) => void;
}

const COLOR_THEMES: Record<string, { fill: string; stroke: string; glow: string }> = {
  fire: { fill: "rgba(239, 68, 68, 0.2)", stroke: "#ef4444", glow: "#f97316" },
  ice: { fill: "rgba(59, 130, 246, 0.2)", stroke: "#3b82f6", glow: "#60a5fa" },
  cold: { fill: "rgba(59, 130, 246, 0.2)", stroke: "#3b82f6", glow: "#60a5fa" },
  lightning: { fill: "rgba(250, 204, 21, 0.2)", stroke: "#facc15", glow: "#fde047" },
  thunder: { fill: "rgba(139, 92, 246, 0.2)", stroke: "#8b5cf6", glow: "#a78bfa" },
  acid: { fill: "rgba(34, 197, 94, 0.2)", stroke: "#22c55e", glow: "#4ade80" },
  force: { fill: "rgba(236, 72, 153, 0.2)", stroke: "#ec4899", glow: "#f472b6" },
  radiant: { fill: "rgba(253, 224, 71, 0.2)", stroke: "#fde047", glow: "#fef08a" },
  necrotic: { fill: "rgba(75, 85, 99, 0.25)", stroke: "#4b5563", glow: "#6b7280" },
  poison: { fill: "rgba(34, 197, 94, 0.2)", stroke: "#22c55e", glow: "#4ade80" },
  psychic: { fill: "rgba(168, 85, 247, 0.2)", stroke: "#a855f7", glow: "#c084fc" },
  oil: { fill: "rgba(92, 64, 32, 0.35)", stroke: "#78571e", glow: "#a07030" },
  holy: { fill: "rgba(253, 230, 138, 0.2)", stroke: "#fbbf24", glow: "#fde68a" },
  ward: { fill: "rgba(96, 165, 250, 0.15)", stroke: "#60a5fa", glow: "#93c5fd" },
  arcane: { fill: "rgba(192, 132, 252, 0.2)", stroke: "#c084fc", glow: "#d8b4fe" },
  prismatic: { fill: "rgba(251, 146, 60, 0.2)", stroke: "#fb923c", glow: "#fdba74" },
};

const DEFAULT_THEME = { fill: "rgba(156, 163, 175, 0.2)", stroke: "#9ca3af", glow: "#d1d5db" };

/** Snap area center to grid based on shape and size */
function snapAreaCenter(rawX: number, rawY: number, shape: string, sizeGrids: number) {
  if (shape === 'cube') {
    // Odd number of grid squares → snap to cell center (integer + 0.5)
    // Even number → snap to grid intersection (integer)
    if (Math.round(sizeGrids) % 2 === 1) {
      return { x: Math.floor(rawX) + 0.5, y: Math.floor(rawY) + 0.5 };
    }
    return { x: Math.round(rawX), y: Math.round(rawY) };
  }
  // Sphere/cylinder/cone/line: snap to grid intersection
  return { x: Math.round(rawX), y: Math.round(rawY) };
}

/**
 * Individual persistent spell area.
 * Uses the SAME drag pattern as TokenComponent:
 *   <Group x={pixelX} y={pixelY} draggable dragBoundFunc onDragEnd>
 *     <Shape x={0} y={0} ... />  (children at relative positions)
 *   </Group>
 */

const PersistentSpellArea = React.memo(function PersistentSpellArea({
  area, gridSize, gridUnitLength, isDM, userId, onMoveArea,
}: {
  area: ActiveSpellArea;
  gridSize: number;
  gridUnitLength: number;
  isDM?: boolean;
  userId?: string | null;
  onMoveArea?: (tokenId: number, newCenterX: number, newCenterY: number) => void;
}) {
  const theme = COLOR_THEMES[area.color || "ice"] || DEFAULT_THEME;
  const shapeRef = useRef<any>(null);
  const previewRef = useRef<any>(null);
  const canDrag = !area.followCaster && ((!!isDM || (!!area.playerMovable && !!userId && userId === area.casterUserId)) && !!onMoveArea);

  // Pulse animation via Konva ref — no React state, no re-renders
  useEffect(() => {
    const start = performance.now();
    const baseColor = theme.fill;
    const interval = setInterval(() => {
      const elapsed = (performance.now() - start) / 1000;
      const opacity = 0.15 + Math.sin(elapsed * Math.PI / 2) * 0.1;
      shapeRef.current?.fill(baseColor.replace(/[\d.]+\)$/, `${opacity})`));
      shapeRef.current?.getLayer()?.batchDraw();
    }, 200);
    return () => clearInterval(interval);
  }, [theme.fill]);

  const sizeGrids = area.radius / gridUnitLength;
  const sizePixels = sizeGrids * gridSize;

  // Caster position for tether (Math.max(1) to match TokenComponent visual center for sub-grid tokens)
  const casterCenterGridX = area.casterX + Math.max(area.casterSizeW, 1) / 2;
  const casterCenterGridY = area.casterY + Math.max(area.casterSizeH, 1) / 2;
  const casterCenterX = casterCenterGridX * gridSize;
  const casterCenterY = casterCenterGridY * gridSize;

  // Group position = spell center in pixels. Self-centered effects stay anchored on the caster.
  const snappedCenter = area.followCaster
    ? { x: casterCenterGridX, y: casterCenterGridY }
    : snapAreaCenter(area.center_x, area.center_y, area.shape, sizeGrids);
  const groupX = snappedCenter.x * gridSize;
  const groupY = snappedCenter.y * gridSize;

  const coneAngle = 53;
  const lineWidthPixels = (10 / gridUnitLength) * gridSize;
  const initialFill = theme.fill.replace(/[\d.]+\)$/, `0.2)`);

  // Handle drag position (relative to Group center, i.e. relative to spell area center)
  const handleAngle = -Math.PI / 4; // top-right edge
  const handleLocalX = Math.cos(handleAngle) * sizePixels;
  const handleLocalY = Math.sin(handleAngle) * sizePixels;

  // On handle drag end — compute new spell center from handle displacement
  const handleDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    if (!onMoveArea) return;
    const node = e.target;
    const dx = node.x() - handleLocalX;
    const dy = node.y() - handleLocalY;
    const rawCenterX = (groupX + dx) / gridSize;
    const rawCenterY = (groupY + dy) / gridSize;
    const snapped = snapAreaCenter(rawCenterX, rawCenterY, area.shape, sizeGrids);
    // Reset handle and hide preview
    node.position({ x: handleLocalX, y: handleLocalY });
    if (previewRef.current) previewRef.current.visible(false);
    node.getLayer()?.batchDraw();
    e.cancelBubble = true;
    onMoveArea(area.tokenId, snapped.x, snapped.y);
  }, [onMoveArea, gridSize, area.tokenId, area.shape, sizeGrids, groupX, groupY, handleLocalX, handleLocalY]);

  // On handle drag move — update preview position (snapped to grid)
  const handleDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    if (!previewRef.current) return;
    const node = e.target;
    const dx = node.x() - handleLocalX;
    const dy = node.y() - handleLocalY;
    // Snap preview center to grid based on shape
    const rawCenterX = (groupX + dx) / gridSize;
    const rawCenterY = (groupY + dy) / gridSize;
    const snapped = snapAreaCenter(rawCenterX, rawCenterY, area.shape, sizeGrids);
    const snappedPxX = snapped.x * gridSize;
    const snappedPxY = snapped.y * gridSize;
    // Preview position is in Layer space (absolute), convert to Group-relative
    previewRef.current.x(snappedPxX - groupX);
    previewRef.current.y(snappedPxY - groupY);
    previewRef.current.visible(true);
    node.getLayer()?.batchDraw();
  }, [gridSize, area.shape, sizeGrids, groupX, groupY, handleLocalX, handleLocalY]);

  // On handle drag start — show preview
  const handleDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    if (previewRef.current) {
      previewRef.current.position({ x: 0, y: 0 });
      previewRef.current.visible(true);
      e.target.getLayer()?.batchDraw();
    }
  }, []);

  const shapeProps = {
    ref: shapeRef,
    fill: initialFill,
    stroke: theme.stroke,
    strokeWidth: 2,
    dash: [8, 4] as number[],
    shadowColor: theme.glow,
    shadowBlur: 4,
    shadowOpacity: 0.4,
    listening: false,
  };

  // All shapes are positioned relative to the Group center (0,0)
  const renderShape = () => {
    switch (area.shape) {
      case "sphere":
      case "cylinder":
        return <Circle x={0} y={0} radius={sizePixels} {...shapeProps} />;
      case "cube":
        return (
          <Rect
            x={-sizePixels / 2} y={-sizePixels / 2}
            width={sizePixels} height={sizePixels} {...shapeProps}
          />
        );
      case "cone":
        return (
          <Wedge
            x={0} y={0} radius={sizePixels}
            angle={coneAngle} rotation={(area.direction ?? 0) - coneAngle / 2}
            {...shapeProps}
          />
        );
      case "line":
        return (
          <Rect
            x={0} y={0}
            width={sizePixels} height={lineWidthPixels}
            rotation={area.direction ?? 0} offsetY={lineWidthPixels / 2}
            {...shapeProps}
          />
        );
      default:
        return null;
    }
  };

  const labelOffsetY = area.shape === "cube"
    ? -sizePixels / 2 - 25
    : -sizePixels - 25;

  return (
    <>
      {/* Tether line: only for detached map areas, not self-centered auras */}
      {!area.followCaster && (
        <>
          <Line
            points={[casterCenterX, casterCenterY, groupX, groupY]}
            stroke={theme.stroke} strokeWidth={2} dash={[6, 6]}
            opacity={0.5} lineCap="round" listening={false}
          />
          <Circle
            x={casterCenterX} y={casterCenterY}
            radius={4} fill={theme.stroke} opacity={0.7} listening={false}
          />
        </>
      )}

      {/* Group positioned at spell center — NOT draggable (only the handle is) */}
      <Group x={groupX} y={groupY}>
        {renderShape()}

        {/* Preview ghost — shows where the area will land during drag */}
        {canDrag && (area.shape === "sphere" || area.shape === "cylinder") && (
          <Circle
            ref={previewRef as React.RefObject<Konva.Circle>}
            x={0} y={0} radius={sizePixels}
            stroke={theme.stroke} strokeWidth={3} dash={[4, 4]}
            fill={theme.fill.replace(/[\d.]+\)$/, '0.25)')}
            opacity={0.8} visible={false} listening={false}
          />
        )}
        {canDrag && area.shape === "cube" && (
          <Rect
            ref={previewRef as React.RefObject<Konva.Rect>}
            x={-sizePixels / 2} y={-sizePixels / 2}
            width={sizePixels} height={sizePixels}
            stroke={theme.stroke} strokeWidth={3} dash={[4, 4]}
            fill={theme.fill.replace(/[\d.]+\)$/, '0.25)')}
            opacity={0.8} visible={false} listening={false}
          />
        )}

        {/* Labels relative to group center */}
        <Text
          x={-80} y={labelOffsetY} width={160} align="center"
          text={area.spellName} fontSize={12} fontStyle="bold"
          fill="white" shadowColor="black" shadowBlur={4} listening={false}
        />
        <Text
          x={-80} y={labelOffsetY + 14} width={160} align="center"
          text={`(${area.tokenName})`} fontSize={10}
          fill="#9ca3af" shadowColor="black" shadowBlur={3} listening={false}
        />

        {/* DM drag handle — the ONLY draggable element, on edge of area */}
        {canDrag && (area.shape === "sphere" || area.shape === "cylinder" || area.shape === "cube") && (
          <Circle
            x={handleLocalX}
            y={handleLocalY}
            radius={12}
            fill="rgba(255,255,255,0.4)"
            stroke="white"
            strokeWidth={1.5}
            shadowColor="black"
            shadowBlur={4}
            shadowOpacity={0.5}
            draggable
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "grab";
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "";
            }}
          />
        )}
      </Group>
    </>
  );
});

/**
 * Main layer component that collects and renders all active spell areas.
 */
export const ActiveSpellAreasLayer = React.memo(function ActiveSpellAreasLayer({
  tokens, gridSize, gridUnitLength, currentMapUrl, currentWorldTime, isDM, userId, onMoveArea,
}: ActiveSpellAreasLayerProps) {
  const parseTokenSize = (sizeStr: string | undefined) => {
    if (!sizeStr) return { width: 1, height: 1 };
    const parts = sizeStr.split('x');
    return { width: parseInt(parts[0]) || 1, height: parseInt(parts[1]) || parseInt(parts[0]) || 1 };
  };

  const activeAreas = useMemo(() => {
    const areas: ActiveSpellArea[] = [];
    for (const t of tokens) {
      const tokenSize = parseTokenSize(t.token_size);
      const baseProps = {
        tokenId: t.id,
        tokenName: t.instance_name || t.character_name || t.monster_name_cn || t.monster_name || "Unknown",
        casterX: t.position_x,
        casterY: t.position_y,
        casterSizeW: tokenSize.width,
        casterSizeH: tokenSize.height,
        casterUserId: t.user_id,
      };
      // From concentration_spell
      const conc = t.concentration_spell;
      const concArea = conc?.area_effect;
      if (
        conc &&
        concArea &&
        concArea.map_url === currentMapUrl &&
        !isExpiredByWorldTime(conc.expires_at, currentWorldTime)
      ) {
        areas.push({
          ...concArea,
          ...baseProps,
          spellId: conc.spell_id,
          spellName: conc.spell_name,
        } as ActiveSpellArea);
      }
      // From active_effects (non-concentration persistent area spells like Grease)
      for (const eff of (t.active_effects || [])) {
        const effArea = eff.area_effect;
        if (
          eff.spell_buff &&
          effArea &&
          effArea.map_url === currentMapUrl &&
          !isExpiredByWorldTime((eff as any).expires_at, currentWorldTime)
        ) {
          areas.push({
            ...effArea,
            ...baseProps,
            spellId: eff.spell_id || eff.id,
            spellName: eff.name || "Unknown",
          } as ActiveSpellArea);
        }
      }
    }
    return areas;
  }, [tokens, currentMapUrl, currentWorldTime]);

  if (activeAreas.length === 0) return null;

  return (
    <>
      {activeAreas.map((area) => (
        <PersistentSpellArea
          key={`spell-area-${area.tokenId}-${area.spellId}`}
          area={area} gridSize={gridSize} gridUnitLength={gridUnitLength}
          isDM={isDM} userId={userId} onMoveArea={onMoveArea}
        />
      ))}
    </>
  );
});

ActiveSpellAreasLayer.displayName = "ActiveSpellAreasLayer";
