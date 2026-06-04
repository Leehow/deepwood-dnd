/**
 * SpellAreaOverlay - Renders area spell preview and targeting for multiple shapes
 * Supports: Sphere, Cone, Line, Cube, Cylinder
 */
import React, { useEffect, useMemo, useState } from "react";
import { Circle, Group, Text, Rect, Wedge, Line } from "react-konva";

export type SpellAreaShape = "sphere" | "cone" | "line" | "cube" | "cylinder";

export interface SpellAreaOverlayProps {
  /** Center X position in grid coordinates (for sphere/cube/cylinder) */
  centerX: number;
  /** Center Y position in grid coordinates (for sphere/cube/cylinder) */
  centerY: number;
  /** Spell radius/size in feet */
  radiusFeet: number;
  /** Grid size in pixels */
  gridSize: number;
  /** How many feet per grid square (typically 5) */
  gridUnitLength: number;
  /** Whether spell is ready to cast (position placed) */
  ready: boolean;
  /** Spell name to display */
  spellName?: string;
  /** Number of targets in range */
  targetCount?: number;
  /** Color theme - defaults to arcane (purple) for non-damaging, fire (red) for fire damage, etc. */
  color?: "fire" | "ice" | "lightning" | "thunder" | "acid" | "force" | "radiant" | "necrotic" | "arcane";

  /** Shape type - defaults to sphere */
  shapeType?: SpellAreaShape;
  /** Origin X position for cone/line (caster position) */
  originX?: number;
  /** Origin Y position for cone/line (caster position) */
  originY?: number;
  /** Direction angle in degrees for cone/line (0=right, 90=down) */
  direction?: number;
  /** Line width in feet (default 5) */
  lineWidth?: number;
  /** For distance-range directional spells: true = placing origin, false = setting direction */
  placingOrigin?: boolean;

  /** Caster X position in grid coordinates (for distance calculation) */
  casterX?: number;
  /** Caster Y position in grid coordinates (for distance calculation) */
  casterY?: number;
  /** Maximum spell range in feet (for distance warning) */
  maxRange?: number;
}

// Color themes for different damage types
export const COLOR_THEMES: Record<string, { fill: string; stroke: string; glow: string }> = {
  fire: { fill: "rgba(239, 68, 68, 0.25)", stroke: "#ef4444", glow: "#f97316" },
  ice: { fill: "rgba(59, 130, 246, 0.25)", stroke: "#3b82f6", glow: "#60a5fa" },
  cold: { fill: "rgba(59, 130, 246, 0.25)", stroke: "#3b82f6", glow: "#60a5fa" },
  lightning: { fill: "rgba(250, 204, 21, 0.25)", stroke: "#facc15", glow: "#fde047" },
  thunder: { fill: "rgba(139, 92, 246, 0.25)", stroke: "#8b5cf6", glow: "#a78bfa" },
  acid: { fill: "rgba(34, 197, 94, 0.25)", stroke: "#22c55e", glow: "#4ade80" },
  force: { fill: "rgba(236, 72, 153, 0.25)", stroke: "#ec4899", glow: "#f472b6" },
  radiant: { fill: "rgba(253, 224, 71, 0.25)", stroke: "#fde047", glow: "#fef08a" },
  necrotic: { fill: "rgba(75, 85, 99, 0.25)", stroke: "#4b5563", glow: "#6b7280" },
  arcane: { fill: "rgba(147, 130, 220, 0.2)", stroke: "#8b7fd4", glow: "#a594f9" },
};

// Map damage type strings to color themes
export function getDamageTypeColor(damageType?: string): SpellAreaOverlayProps["color"] {
  if (!damageType) return "arcane";
  const lower = damageType.toLowerCase();
  if (lower.includes("fire") || lower.includes("火")) return "fire";
  if (lower.includes("cold") || lower.includes("ice") || lower.includes("冰")) return "ice";
  if (lower.includes("lightning") || lower.includes("闪电")) return "lightning";
  if (lower.includes("thunder") || lower.includes("雷")) return "thunder";
  if (lower.includes("acid") || lower.includes("酸")) return "acid";
  if (lower.includes("force") || lower.includes("力场")) return "force";
  if (lower.includes("radiant") || lower.includes("光耀")) return "radiant";
  if (lower.includes("necrotic") || lower.includes("黯蚀")) return "necrotic";
  return "fire";
}

// Shape type translations
const SHAPE_NAMES: Record<SpellAreaShape, string> = {
  sphere: "球形",
  cone: "锥形",
  line: "直线",
  cube: "立方",
  cylinder: "圆柱",
};

/** Normalize angle to [-180, 180] */
function normalizeAngle(angle: number): number {
  let a = angle % 360;
  if (a > 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

/** Check if a point (in grid units, relative to area origin) is inside the spell area */
function isPointInArea(
  shapeType: SpellAreaShape,
  px: number,
  py: number,
  sizeGrids: number,
  direction: number,
  lineWidthGrids: number,
  coneAngle: number
): boolean {
  const dist = Math.sqrt(px * px + py * py);

  switch (shapeType) {
    case "sphere":
    case "cylinder":
      return dist <= sizeGrids;

    case "cube": {
      const half = sizeGrids / 2;
      return Math.abs(px) <= half && Math.abs(py) <= half;
    }

    case "cone": {
      if (dist > sizeGrids) return false;
      if (dist < 0.01) return true;
      const pointAngle = Math.atan2(py, px) * (180 / Math.PI);
      const diff = Math.abs(normalizeAngle(pointAngle - direction));
      return diff <= coneAngle / 2;
    }

    case "line": {
      const rad = (-direction * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rx = px * cos - py * sin;
      const ry = px * sin + py * cos;
      return rx >= 0 && rx <= sizeGrids && Math.abs(ry) <= lineWidthGrids / 2;
    }
  }
}

/** Compute grid squares affected by the spell area */
function computeAffectedSquares(
  shapeType: SpellAreaShape,
  cx: number,
  cy: number,
  ox: number,
  oy: number,
  direction: number,
  sizeGrids: number,
  lineWidthGrids: number,
  coneAngle: number
): { gx: number; gy: number }[] {
  // Determine bounding box in grid coords
  let minGx: number, maxGx: number, minGy: number, maxGy: number;
  const refX = shapeType === "cone" || shapeType === "line" ? ox : cx;
  const refY = shapeType === "cone" || shapeType === "line" ? oy : cy;
  const pad = Math.ceil(sizeGrids) + 1;

  if (shapeType === "line") {
    const rad = (direction * Math.PI) / 180;
    const endX = refX + Math.cos(rad) * sizeGrids;
    const endY = refY + Math.sin(rad) * sizeGrids;
    const extra = Math.ceil(lineWidthGrids / 2) + 1;
    minGx = Math.floor(Math.min(refX, endX)) - extra;
    maxGx = Math.ceil(Math.max(refX, endX)) + extra;
    minGy = Math.floor(Math.min(refY, endY)) - extra;
    maxGy = Math.ceil(Math.max(refY, endY)) + extra;
  } else {
    minGx = Math.floor(refX) - pad;
    maxGx = Math.ceil(refX) + pad;
    minGy = Math.floor(refY) - pad;
    maxGy = Math.ceil(refY) + pad;
  }

  const results: { gx: number; gy: number }[] = [];
  for (let gy = minGy; gy <= maxGy; gy++) {
    for (let gx = minGx; gx <= maxGx; gx++) {
      const px = gx + 0.5 - refX;
      const py = gy + 0.5 - refY;
      if (isPointInArea(shapeType, px, py, sizeGrids, direction, lineWidthGrids, coneAngle)) {
        results.push({ gx, gy });
      }
    }
  }
  return results;
}

/** Parse hex color to RGB tuple */
function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "").match(/.{2}/g);
  if (!m) return [255, 0, 0];
  return [parseInt(m[0], 16), parseInt(m[1], 16), parseInt(m[2], 16)];
}

export function SpellAreaOverlay({
  centerX,
  centerY,
  radiusFeet,
  gridSize,
  gridUnitLength,
  ready,
  spellName,
  targetCount,
  color = "fire",
  shapeType = "sphere",
  originX,
  originY,
  direction = 0,
  lineWidth = 10,
  placingOrigin = false,
  casterX,
  casterY,
  maxRange,
}: SpellAreaOverlayProps) {
  // Convert feet to pixels
  const sizeGrids = radiusFeet / gridUnitLength;
  const sizePixels = sizeGrids * gridSize;
  const lineWidthPixels = (lineWidth / gridUnitLength) * gridSize;
  const lineWidthGrids = lineWidth / gridUnitLength;

  // Cone angle in degrees (D&D 5E standard is ~53 degrees)
  const coneAngle = 53;

  // Compute affected grid squares (memoized)
  const affectedSquares = useMemo(
    () =>
      computeAffectedSquares(
        shapeType,
        centerX, centerY,
        originX ?? centerX, originY ?? centerY,
        direction, sizeGrids, lineWidthGrids, coneAngle
      ),
    [shapeType, centerX, centerY, originX, originY, direction, sizeGrids, lineWidthGrids]
  );

  // Center position in pixels
  const centerPixelX = centerX * gridSize;
  const centerPixelY = centerY * gridSize;

  // Calculate distance from caster to target position (in feet)
  const distanceToTarget = (casterX !== undefined && casterY !== undefined)
    ? Math.round(Math.sqrt(
        Math.pow(centerX - casterX, 2) + Math.pow(centerY - casterY, 2)
      ) * gridUnitLength)
    : undefined;

  // Check if target is out of range
  const isOutOfRange = maxRange !== undefined && distanceToTarget !== undefined && distanceToTarget > maxRange;

  // Origin position in pixels (for cone/line)
  const originPixelX = (originX ?? centerX) * gridSize;
  const originPixelY = (originY ?? centerY) * gridSize;

  // Get color theme
  const theme = COLOR_THEMES[color] || COLOR_THEMES.arcane;

  // Animation for unready state (pulsing) — uses rAF for smoother animation
  const [pulseScale, setPulseScale] = useState(1);
  useEffect(() => {
    if (ready) {
      setPulseScale(1);
      return;
    }
    let rafId: number;
    const start = performance.now();
    const tick = () => {
      const elapsed = (performance.now() - start) / 1000;
      setPulseScale(1 + Math.sin(elapsed * 3) * 0.05);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [ready]);

  // Render grid square highlights for affected area
  const renderGridHighlight = () => {
    if (placingOrigin || affectedSquares.length === 0) return null;
    const [r, g, b] = hexToRgb(theme.stroke);
    return affectedSquares.map(({ gx, gy }) => (
      <Rect
        key={`grid-${gx}-${gy}`}
        x={gx * gridSize}
        y={gy * gridSize}
        width={gridSize}
        height={gridSize}
        fill={`rgba(${r},${g},${b},0.28)`}
        stroke={`rgba(${r},${g},${b},0.55)`}
        strokeWidth={1}
        listening={false}
      />
    ));
  };

  // Get display label position based on shape
  const getLabelPosition = () => {
    switch (shapeType) {
      case "cone":
      case "line":
        return { x: originPixelX, y: originPixelY - 50 };
      case "cube":
        return { x: centerPixelX, y: centerPixelY - sizePixels / 2 - 30 };
      default:
        return { x: centerPixelX, y: centerPixelY - sizePixels - 30 };
    }
  };

  // Get size label position based on shape
  const getSizeLabelPosition = () => {
    switch (shapeType) {
      case "cone":
        const rad = (direction * Math.PI) / 180;
        return {
          x: originPixelX + Math.cos(rad) * (sizePixels + 10),
          y: originPixelY + Math.sin(rad) * (sizePixels + 10) - 6,
        };
      case "line":
        const lineRad = (direction * Math.PI) / 180;
        return {
          x: originPixelX + Math.cos(lineRad) * (sizePixels + 10),
          y: originPixelY + Math.sin(lineRad) * (sizePixels + 10) - 6,
        };
      case "cube":
        return { x: centerPixelX + sizePixels / 2 + 5, y: centerPixelY - 6 };
      default:
        return { x: centerPixelX + sizePixels + 5, y: centerPixelY - 6 };
    }
  };

  // Render the appropriate shape
  const renderShape = () => {
    switch (shapeType) {
      case "sphere":
      case "cylinder":
        return (
          <Circle
            x={centerPixelX}
            y={centerPixelY}
            radius={sizePixels * pulseScale}
            fill={ready ? theme.fill.replace("0.25", "0.35") : theme.fill}
            stroke={theme.stroke}
            strokeWidth={ready ? 3 : 2}
            dash={ready ? undefined : [10, 5]}
            shadowColor={theme.glow}
            shadowBlur={ready ? 6 : 4}
            shadowOpacity={ready ? 0.8 : 0.5}
            listening={false}
          />
        );

      case "cube":
        const cubeSize = sizePixels * pulseScale;
        return (
          <Rect
            x={centerPixelX - cubeSize / 2}
            y={centerPixelY - cubeSize / 2}
            width={cubeSize}
            height={cubeSize}
            fill={ready ? theme.fill.replace("0.25", "0.35") : theme.fill}
            stroke={theme.stroke}
            strokeWidth={ready ? 3 : 2}
            dash={ready ? undefined : [10, 5]}
            shadowColor={theme.glow}
            shadowBlur={ready ? 6 : 4}
            shadowOpacity={ready ? 0.8 : 0.5}
            listening={false}
          />
        );

      case "cone":
        return (
          <Wedge
            x={originPixelX}
            y={originPixelY}
            radius={sizePixels * pulseScale}
            angle={coneAngle}
            rotation={direction - coneAngle / 2}
            fill={ready ? theme.fill.replace("0.25", "0.35") : theme.fill}
            stroke={theme.stroke}
            strokeWidth={ready ? 3 : 2}
            dash={ready ? undefined : [10, 5]}
            shadowColor={theme.glow}
            shadowBlur={ready ? 6 : 4}
            shadowOpacity={ready ? 0.8 : 0.5}
            listening={false}
          />
        );

      case "line":
        // Line is rendered as rotated rectangle from origin
        // Use offset to rotate around the origin point (left-center of rectangle)
        const lineLength = sizePixels * pulseScale;
        const lineWidthPx = lineWidthPixels * pulseScale;
        return (
          <Rect
            x={originPixelX}
            y={originPixelY}
            width={lineLength}
            height={lineWidthPx}
            rotation={direction}
            offsetX={0}
            offsetY={lineWidthPx / 2}  // Center vertically on origin
            fill={ready ? theme.fill.replace("0.25", "0.35") : theme.fill}
            stroke={theme.stroke}
            strokeWidth={ready ? 3 : 2}
            dash={ready ? undefined : [10, 5]}
            shadowColor={theme.glow}
            shadowBlur={ready ? 6 : 4}
            shadowOpacity={ready ? 0.8 : 0.5}
            listening={false}
          />
        );
    }
  };

  // Render inner glow based on shape (only for ready state)
  const renderInnerGlow = () => {
    if (!ready) return null;

    switch (shapeType) {
      case "sphere":
      case "cylinder":
        return (
          <Circle
            x={centerPixelX}
            y={centerPixelY}
            radius={sizePixels * 0.6}
            fill="transparent"
            stroke={theme.glow}
            strokeWidth={1}
            opacity={0.5}
            listening={false}
          />
        );
      case "cube":
        return (
          <Rect
            x={centerPixelX - sizePixels * 0.3}
            y={centerPixelY - sizePixels * 0.3}
            width={sizePixels * 0.6}
            height={sizePixels * 0.6}
            fill="transparent"
            stroke={theme.glow}
            strokeWidth={1}
            opacity={0.5}
            listening={false}
          />
        );
      case "cone":
        return (
          <Wedge
            x={originPixelX}
            y={originPixelY}
            radius={sizePixels * 0.6}
            angle={coneAngle}
            rotation={direction - coneAngle / 2}
            fill="transparent"
            stroke={theme.glow}
            strokeWidth={1}
            opacity={0.5}
            listening={false}
          />
        );
      case "line":
        return (
          <Rect
            x={originPixelX}
            y={originPixelY}
            width={sizePixels * 0.6}
            height={lineWidthPixels * 0.6}
            rotation={direction}
            offsetY={(lineWidthPixels * 0.6) / 2}  // Center vertically on origin
            fill="transparent"
            stroke={theme.glow}
            strokeWidth={1}
            opacity={0.5}
            listening={false}
          />
        );
    }
  };

  // Get center position for progress ring
  const getProgressRingPosition = () => {
    switch (shapeType) {
      case "cone":
      case "line":
        return { x: originPixelX, y: originPixelY };
      default:
        return { x: centerPixelX, y: centerPixelY };
    }
  };

  const progressRingPos = getProgressRingPosition();
  const labelPos = getLabelPosition();
  const sizeLabelPos = getSizeLabelPosition();

  // Instructions text based on shape and state
  const getInstructions = () => {
    if (ready) {
      return "滑动调整 · 点击上方按钮施放";
    }
    if (placingOrigin) {
      return "点击地图选择起点";
    }
    if (shapeType === "cone" || shapeType === "line") {
      return "滑动选择方向";
    }
    return "点击地图选择位置";
  };

  // For placingOrigin phase, show a simple crosshair at cursor position
  if (placingOrigin) {
    const previewPixelX = centerX * gridSize;
    const previewPixelY = centerY * gridSize;
    const hasCaster = casterX !== undefined && casterY !== undefined;
    const casterPxX = hasCaster ? casterX! * gridSize : 0;
    const casterPxY = hasCaster ? casterY! * gridSize : 0;
    const placingLineColor = isOutOfRange ? "#ef4444" : "rgba(255,255,255,0.6)";
    const placingMidX = hasCaster ? (casterPxX + previewPixelX) / 2 : 0;
    const placingMidY = hasCaster ? (casterPxY + previewPixelY) / 2 : 0;
    const placingDistText = distanceToTarget !== undefined
      ? (isOutOfRange
          ? `${distanceToTarget}尺 / 最大${maxRange}尺 超出范围!`
          : `${distanceToTarget}尺${maxRange ? ` / ${maxRange}尺` : ""}`)
      : undefined;
    return (
      <Group>
        {/* Dashed line from caster to cursor */}
        {hasCaster && (
          <Line
            points={[casterPxX, casterPxY, previewPixelX, previewPixelY]}
            stroke={placingLineColor}
            strokeWidth={isOutOfRange ? 2 : 1.5}
            dash={[8, 6]}
            opacity={isOutOfRange ? 0.9 : 0.7}
            listening={false}
          />
        )}
        {/* Distance text at midpoint */}
        {hasCaster && placingDistText && (
          <Text
            text={placingDistText}
            x={placingMidX - 80}
            y={placingMidY - 18}
            width={160}
            align="center"
            fontSize={isOutOfRange ? 12 : 11}
            fontStyle={isOutOfRange ? "bold" : "normal"}
            fill={isOutOfRange ? "#ef4444" : "#d1d5db"}
            shadowColor="black"
            shadowBlur={4}
            shadowOpacity={1}
            listening={false}
          />
        )}
        {/* Crosshair at preview position */}
        <Circle
          x={previewPixelX}
          y={previewPixelY}
          radius={12 * pulseScale}
          fill="rgba(255,255,255,0.3)"
          stroke={theme.stroke}
          strokeWidth={2}
          dash={[5, 3]}
          shadowColor={theme.glow}
          shadowBlur={8}
          listening={false}
        />
        <Circle
          x={previewPixelX}
          y={previewPixelY}
          radius={4}
          fill={theme.stroke}
          listening={false}
        />
        {/* Info label */}
        {spellName && (
          <Group x={previewPixelX} y={previewPixelY - 50}>
            <Text
              text={spellName}
              x={-100}
              y={-20}
              width={200}
              align="center"
              fontSize={14}
              fontStyle="bold"
              fill="white"
              shadowColor="black"
              shadowBlur={4}
              listening={false}
            />
            <Text
              text={getInstructions()}
              x={-100}
              y={0}
              width={200}
              align="center"
              fontSize={11}
              fill="#9ca3af"
              shadowColor="black"
              shadowBlur={3}
              listening={false}
            />
          </Group>
        )}
      </Group>
    );
  }

  return (
    <Group>
      {/* Grid square highlights (bottom layer) */}
      {renderGridHighlight()}

      {/* Main area shape */}
      {renderShape()}

      {/* Inner glow for ready state */}
      {renderInnerGlow()}

      {/* Center/Origin crosshair */}
      <Circle
        x={progressRingPos.x}
        y={progressRingPos.y}
        radius={8}
        fill={ready ? theme.stroke : "rgba(255,255,255,0.8)"}
        stroke={theme.stroke}
        strokeWidth={2}
        listening={false}
      />

      {/* Info label */}
      {(spellName || targetCount !== undefined) && (
        <Group x={labelPos.x} y={labelPos.y}>
          {/* Spell name */}
          {spellName && (
            <Text
              text={spellName}
              x={-100}
              y={-20}
              width={200}
              align="center"
              fontSize={14}
              fontStyle="bold"
              fill="white"
              shadowColor="black"
              shadowBlur={4}
              listening={false}
            />
          )}
          {/* Target count */}
          {targetCount !== undefined && (
            <Text
              text={`${targetCount} 个目标`}
              x={-100}
              y={0}
              width={200}
              align="center"
              fontSize={12}
              fill={targetCount > 0 ? "#4ade80" : "#9ca3af"}
              shadowColor="black"
              shadowBlur={3}
              listening={false}
            />
          )}
          {/* Instructions */}
          <Text
            text={getInstructions()}
            x={-100}
            y={16}
            width={200}
            align="center"
            fontSize={11}
            fill="#9ca3af"
            shadowColor="black"
            shadowBlur={3}
            listening={false}
          />
        </Group>
      )}

      {/* Size indicator */}
      <Text
        text={`${radiusFeet}尺${shapeType !== "sphere" ? " " + SHAPE_NAMES[shapeType] : ""}`}
        x={sizeLabelPos.x}
        y={sizeLabelPos.y}
        fontSize={11}
        fill={theme.stroke}
        shadowColor="black"
        shadowBlur={2}
        listening={false}
      />

      {/* Dashed line from caster to target + distance label */}
      {casterX !== undefined && casterY !== undefined && distanceToTarget !== undefined && (() => {
        const casterPxX = casterX * gridSize;
        const casterPxY = casterY * gridSize;
        const targetPxX = (shapeType === "cone" || shapeType === "line") ? originPixelX : centerPixelX;
        const targetPxY = (shapeType === "cone" || shapeType === "line") ? originPixelY : centerPixelY;
        const midX = (casterPxX + targetPxX) / 2;
        const midY = (casterPxY + targetPxY) / 2;
        const lineColor = isOutOfRange ? "#ef4444" : "rgba(255,255,255,0.6)";
        const distText = isOutOfRange
          ? `${distanceToTarget}尺 / 最大${maxRange}尺 超出范围!`
          : `${distanceToTarget}尺${maxRange ? ` / ${maxRange}尺` : ""}`;
        return (
          <Group>
            <Line
              points={[casterPxX, casterPxY, targetPxX, targetPxY]}
              stroke={lineColor}
              strokeWidth={isOutOfRange ? 2 : 1.5}
              dash={[8, 6]}
              opacity={isOutOfRange ? 0.9 : 0.7}
              listening={false}
            />
            {/* Distance text at midpoint of the line */}
            <Text
              text={distText}
              x={midX - 80}
              y={midY - 18}
              width={160}
              align="center"
              fontSize={isOutOfRange ? 12 : 11}
              fontStyle={isOutOfRange ? "bold" : "normal"}
              fill={isOutOfRange ? "#ef4444" : "#d1d5db"}
              shadowColor="black"
              shadowBlur={4}
              shadowOpacity={1}
              listening={false}
            />
          </Group>
        );
      })()}
    </Group>
  );
}
